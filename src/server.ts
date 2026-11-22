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
const readOnly = { readOnlyHint: true, openWorldHint: true };

const productCode = z.string().trim().regex(/^[A-Za-z0-9]{1,20}$/).toUpperCase();
const rupiah = z.number().int().min(1).max(100_000_000);

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
    description: 'Ambil daftar produk dan harga Mitra Bisnis. Gunakan filter kategori atau status untuk mempersempit hasil.',
    annotations: readOnly,
    inputSchema: {
      category: z.string().max(100).optional().describe('Kategori produk. Huruf besar dan kecil diperlakukan sama.'),
      status: z.enum(['normal', 'gangguan']).optional(),
      semua: z.boolean().optional().describe('Gunakan true untuk menyertakan produk yang belum aktif.'),
    },
  }, (filters) => toolResult(() => client.listProducts(filters)));

  server.registerTool('get_product', {
    description: 'Cari satu produk berdasarkan kode dan ambil harga atau biaya untuk Mitra Bisnis.',
    annotations: readOnly,
    inputSchema: { product_code: productCode },
  }, ({ product_code }) => toolResult(() => client.getProduct(product_code)));

  server.registerTool('create_transaction', {
    description: [
      'Buat transaksi prabayar Bisadagang dengan referensi unik.',
      'Sebelum memanggil tool ini, tampilkan produk, nomor pelanggan, dan harga total kepada pengguna.',
      'Minta persetujuan eksplisit untuk transaksi ini, lalu kirim confirm: true.',
      'Gunakan harga yang sudah ditampilkan sebagai max_price agar kenaikan harga tidak langsung disetujui.',
      'Untuk nominal bebas, harga total adalah amount ditambah fee dan diperlukan account_check_id.',
      'Jika hasil tidak pasti, cek get_transaction dengan ref_id sebelum mempertimbangkan transaksi baru.',
    ].join(' '),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      product_code: productCode,
      customer_no: z.string().trim().regex(/^[0-9]{4,20}$/).describe('Nomor tujuan, termasuk nol di depan.'),
      max_price: rupiah.nullish().describe('Batas harga total dalam rupiah yang telah disetujui pengguna.'),
      amount: rupiah.nullish().describe('Isi hanya untuk produk nominal bebas.'),
      account_check_id: z.uuid().nullish().describe('ID cek nama yang masih berlaku untuk produk nominal bebas.'),
      confirm: z.boolean().describe('Harus true setelah pengguna menyetujui produk, nomor, dan harga.'),
    },
  }, (input) => toolResult(() => client.createTransaction(input)));

  server.registerTool('get_transaction', {
    description: 'Cek status transaksi melalui ref_id. Status akhir adalah success atau failed.',
    annotations: readOnly,
    inputSchema: {
      ref_id: z.string().regex(/^[A-Za-z0-9._-]{1,50}$/).refine((ref) => ref !== '.' && ref !== '..'),
    },
  }, ({ ref_id }) => toolResult(() => client.getTransaction(ref_id)));

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

  return server;
}
