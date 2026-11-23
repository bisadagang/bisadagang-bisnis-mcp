import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { BisadagangClient } from './client.js';
import type { Config } from './config.js';
import { BisadagangError, unavailable } from './errors.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
const docsUrl = 'https://bisnis.bisadagang.com/llms-full.txt';
const openApiUrl = 'https://bisnis.bisadagang.com/openapi.json';
const readOnly = { readOnlyHint: true, openWorldHint: true };

const productCode = z.string().trim().regex(/^[A-Za-z0-9]{1,20}$/).toUpperCase();
const productDestination = {
  product_code: productCode,
  customer_no: z.string().trim().regex(/^[0-9]{4,20}$/).describe('Nomor tujuan, termasuk nol di depan.'),
};
const rupiah = z.number().int().min(1).max(100_000_000);
const refId = z.string().regex(/^[A-Za-z0-9._-]{1,50}$/);
const dayMs = 86_400_000;
const wibOffsetMs = 7 * 3_600_000;
const date = z.iso.date();
const dateRange = {
  from: date.optional().describe('Tanggal awal WIB (YYYY-MM-DD). Default enam hari sebelum tanggal akhir.'),
  to: date.optional().describe('Tanggal akhir WIB (YYYY-MM-DD). Default hari ini di WIB.'),
};

function resolveDateRange(input: { from?: string; to?: string }) {
  const to = input.to ?? new Date(Date.now() + wibOffsetMs).toISOString().slice(0, 10);
  const end = Date.parse(to);
  const from = input.from ?? new Date(end - 6 * dayMs).toISOString().slice(0, 10);
  const days = (end - Date.parse(from)) / dayMs + 1;
  if (!date.safeParse(from).success || days < 1 || days > 92) {
    throw new BisadagangError('VALIDATION_ERROR', 'Rentang tanggal WIB harus mencakup 1 sampai 92 hari.');
  }
  return { from, to };
}

async function toolResult(run: () => Promise<object>): Promise<CallToolResult> {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(await run()) }] };
  } catch (error) {
    const failure = error instanceof BisadagangError ? error : unavailable();
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(failure.toResult()) }],
    };
  }
}

export function createServer(config: Config, fetcher: typeof fetch = fetch): McpServer {
  const client = new BisadagangClient(config, fetcher);
  const server = new McpServer({ name: 'bisadagang-bisnis', version });

  server.registerTool('get_balance', {
    description: 'Cek saldo Mitra Bisnis dalam rupiah untuk environment API key.',
    annotations: readOnly,
  }, () => toolResult(() => client.getBalance()));

  server.registerTool('list_products', {
    description: 'Cari produk dan harga Mitra Bisnis. Hasil ringkas memuat total_count sebelum limit diterapkan. Gunakan get_product untuk detail produk.',
    annotations: readOnly,
    inputSchema: {
      search: z.string().trim().max(100).optional().describe('Bagian dari kode atau nama produk, tanpa membedakan huruf besar dan kecil.'),
      brand: z.string().trim().max(100).optional().describe('Nama merek lengkap, tanpa membedakan huruf besar dan kecil.'),
      category: z.string().trim().max(100).optional().describe('Nama kategori lengkap, tanpa membedakan huruf besar dan kecil.'),
      only_available: z.boolean().optional().describe('Gunakan true untuk hanya menampilkan produk aktif dengan status normal.'),
      limit: z.number().int().min(1).max(200).default(50).describe('Jumlah maksimum produk yang ditampilkan. Default 50.'),
      status: z.enum(['normal', 'gangguan']).optional(),
      semua: z.boolean().optional().describe('Gunakan true untuk menyertakan produk yang belum aktif.'),
    },
  }, (filters) => toolResult(() => client.listProducts(filters)));

  server.registerTool('get_product', {
    description: 'Cari satu produk berdasarkan kode dan ambil harga atau biaya untuk Mitra Bisnis.',
    annotations: readOnly,
    inputSchema: { product_code: productCode },
  }, ({ product_code }) => toolResult(() => client.getProduct(product_code)));

  server.registerTool('check_account', {
    description: 'Cek nama pemilik rekening atau dompet digital dan dapatkan check_id beserta waktu kedaluwarsanya.',
    annotations: { ...readOnly, idempotentHint: true },
    inputSchema: productDestination,
  }, (destination) => toolResult(() => client.checkAccount(destination)));

  server.registerTool('create_transaction', {
    description: [
      'Buat transaksi prabayar Bisadagang dengan referensi unik.',
      'Sebelum memanggil tool ini, tampilkan produk, nomor pelanggan, dan harga total kepada pengguna.',
      'Minta persetujuan eksplisit untuk transaksi ini, lalu kirim confirm: true.',
      'Gunakan harga yang sudah ditampilkan sebagai max_price agar kenaikan harga tidak langsung disetujui.',
      'Untuk nominal bebas, harga total adalah amount ditambah fee. Panggil check_account untuk produk dan nomor yang sama, lalu gunakan check_id yang masih berlaku sebagai account_check_id.',
      'Buat atau pilih ref_id unik sebelum memanggil tool ini. Pada setiap percobaan ulang, gunakan ref_id yang sama dan semua field dengan nilai yang sama.',
      'Server menurunkan Idempotency-Key dari ref_id sehingga percobaan ulang mengembalikan transaksi yang sama. Jika ref_id dihilangkan, server membuatnya secara otomatis.',
      'Jika hasil tidak pasti, cek get_transaction dengan ref_id sebelum mempertimbangkan transaksi baru.',
      'Tentukan hasil berdasarkan status, bukan teks message yang hanya untuk tampilan.',
    ].join(' '),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      ...productDestination,
      ref_id: refId.optional().describe('Referensi unik. Gunakan kembali referensi yang sama untuk percobaan ulang.'),
      max_price: rupiah.optional().describe('Batas harga total dalam rupiah yang telah disetujui pengguna.'),
      amount: rupiah.optional().describe('Isi hanya untuk produk nominal bebas.'),
      account_check_id: z.uuid().optional().describe('ID cek nama yang masih berlaku untuk produk nominal bebas.'),
      confirm: z.boolean().describe('Harus true setelah pengguna menyetujui produk, nomor, dan harga.'),
    },
  }, (input) => toolResult(() => client.createTransaction(input)));

  server.registerTool('get_transaction', {
    description: 'Cek status transaksi melalui ref_id. Status akhir adalah success atau failed. Tentukan hasil berdasarkan status, bukan teks message yang hanya untuk tampilan.',
    annotations: readOnly,
    inputSchema: {
      ref_id: refId.refine((ref) => ref !== '.' && ref !== '..'),
    },
  }, ({ ref_id }) => toolResult(() => client.getTransaction(ref_id)));

  server.registerTool('list_transactions', {
    description: 'Lihat transaksi satu per satu untuk menjawab pertanyaan tentang transaksi tertentu. Gunakan get_summary untuk total atau tren. Rentang tanggal WIB maksimal 92 hari, termasuk tanggal awal dan akhir. Gunakan next_cursor untuk halaman berikutnya dengan filter dan tanggal yang sama. Samarkan nomor pelanggan saat menyajikan hasil. Tentukan hasil berdasarkan status, bukan teks message yang hanya untuk tampilan.',
    annotations: readOnly,
    inputSchema: {
      ...dateRange,
      status: z.enum(['pending', 'success', 'failed']).optional(),
      product_code: productCode.optional(),
      limit: z.number().int().min(1).max(100).default(50).describe('Jumlah maksimum transaksi per halaman. Default 50.'),
      cursor: z.string().min(1).optional().describe('Nilai next_cursor dari halaman sebelumnya.'),
    },
  }, (filters) => toolResult(() => client.listTransactions({ ...filters, ...resolveDateRange(filters) })));

  server.registerTool('get_summary', {
    description: 'Utamakan ringkasan ini untuk total, omzet transaksi sukses, tingkat keberhasilan, atau tren per hari atau produk. Gunakan list_transactions untuk rincian transaksi. Rentang tanggal WIB maksimal 92 hari, termasuk tanggal awal dan akhir. Samarkan nomor pelanggan jika merujuk ke rincian transaksi.',
    annotations: readOnly,
    inputSchema: {
      ...dateRange,
      group_by: z.enum(['day', 'product']).describe('Gunakan day untuk tren harian atau product untuk perbandingan produk.'),
    },
  }, ({ group_by, ...dates }) => toolResult(() => client.getSummary({ ...resolveDateRange(dates), group_by })));

  server.registerResource('llms-full.txt', docsUrl, {
    title: 'Dokumentasi API Bisadagang Bisnis',
    description: 'Panduan integrasi dan spesifikasi OpenAPI H2H Bisadagang Bisnis.',
    mimeType: 'text/plain',
  }, async (uri) => {
    try {
      const response = await fetcher(docsUrl, {
        headers: { Accept: 'text/plain' },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error();
      return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: await response.text() }] };
    } catch {
      throw new McpError(ErrorCode.InternalError, 'Dokumentasi Bisadagang tidak dapat diambil.');
    }
  });

  server.registerResource('openapi.json', openApiUrl, {
    title: 'Spesifikasi OpenAPI Bisadagang Bisnis',
    description: 'Spesifikasi OpenAPI H2H Bisadagang Bisnis dalam format JSON.',
    mimeType: 'application/json',
  }, async (uri) => {
    try {
      const response = await fetcher(openApiUrl, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error();
      const text = JSON.stringify(await response.json(), null, 2);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text }] };
    } catch {
      throw new McpError(ErrorCode.InternalError, 'Spesifikasi OpenAPI Bisadagang tidak dapat diambil.');
    }
  });

  return server;
}
