# Bisadagang Bisnis MCP

Server MCP melalui stdio untuk mengakses API H2H Bisadagang Bisnis atas nama Mitra Bisnis. Gunakan server ini untuk mengecek saldo, mencari produk, mengecek nama pemilik rekening atau dompet digital, membuat transaksi prabayar, dan mengecek status transaksi.

## Instalasi

Siapkan Node.js 20 atau lebih baru, npm, Git, serta API key sandbox (`bdk_test_`) dan API secret dari akun Mitra Bisnis. Server dijalankan langsung dari GitHub.

```sh
npx -y github:bisadagang/bisadagang-bisnis-mcp
```

### Claude Code

Set `BISADAGANG_API_KEY` dan `BISADAGANG_API_SECRET` di environment terminal yang menjalankan Claude Code. Dari direktori proyek, daftarkan server dengan referensi ke variabel tersebut.

```sh
claude mcp add --env 'BISADAGANG_API_KEY=${BISADAGANG_API_KEY}' 'BISADAGANG_API_SECRET=${BISADAGANG_API_SECRET}' --transport stdio --scope project bisadagang-bisnis -- npx -y github:bisadagang/bisadagang-bisnis-mcp
```

Di PowerShell pada Windows, ganti bagian setelah `--` dengan `cmd.exe /d /c npx -y github:bisadagang/bisadagang-bisnis-mcp`. Buka Claude Code dan jalankan `/mcp` untuk mengecek koneksi.

### Claude Desktop

Buka **Settings → Developer → Edit Config**. Tambahkan entri berikut ke `mcpServers` di `claude_desktop_config.json`. Isi kredensial di file lokal tersebut dan mulai ulang Claude Desktop.

```json
{
  "mcpServers": {
    "bisadagang-bisnis": {
      "command": "npx",
      "args": ["-y", "github:bisadagang/bisadagang-bisnis-mcp"],
      "env": {
        "BISADAGANG_API_KEY": "bdk_test_ISI_API_KEY_ANDA",
        "BISADAGANG_API_SECRET": "ISI_API_SECRET_ANDA",
        "BISADAGANG_ENV": "sandbox"
      }
    }
  }
}
```

Di Windows, gunakan `"command": "cmd.exe"` dan `"args": ["/d", "/c", "npx", "-y", "github:bisadagang/bisadagang-bisnis-mcp"]`.

### Cursor

Set kedua variabel kredensial di environment yang menjalankan Cursor. Tambahkan konfigurasi ini ke `.cursor/mcp.json` di proyek atau `~/.cursor/mcp.json` untuk semua proyek.

```json
{
  "mcpServers": {
    "bisadagang-bisnis": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:bisadagang/bisadagang-bisnis-mcp"],
      "env": {
        "BISADAGANG_API_KEY": "${env:BISADAGANG_API_KEY}",
        "BISADAGANG_API_SECRET": "${env:BISADAGANG_API_SECRET}",
        "BISADAGANG_ENV": "sandbox"
      }
    }
  }
}
```

Di Windows, gunakan kombinasi `command` dan `args` yang sama seperti pada Claude Desktop.

### Codex

Set kedua variabel kredensial di environment yang menjalankan Codex. Tambahkan konfigurasi ini ke `~/.codex/config.toml`.

```toml
[mcp_servers.bisadagang-bisnis]
command = "npx"
args = ["-y", "github:bisadagang/bisadagang-bisnis-mcp"]
env_vars = ["BISADAGANG_API_KEY", "BISADAGANG_API_SECRET"]

[mcp_servers.bisadagang-bisnis.env]
BISADAGANG_ENV = "sandbox"
```

Di Windows, gunakan `command = "cmd.exe"` dan `args = ["/d", "/c", "npx", "-y", "github:bisadagang/bisadagang-bisnis-mcp"]`.

## Penggunaan dan keamanan transaksi

- `BISADAGANG_ENV` menggunakan `sandbox` secara default. Untuk production, set `BISADAGANG_ENV=production` dengan API key `bdk_live_` dan jalankan dari IP yang terdaftar. Production memakai saldo asli.
- Pembuatan transaksi di production memerlukan `BISADAGANG_ALLOW_PRODUCTION_TRANSACTIONS=true`. Di kedua environment, agen perlu menampilkan produk, nomor pelanggan, dan harga lalu meminta persetujuan eksplisit sebelum mengirim `confirm: true`.
- Gunakan `list_products` untuk mencari bagian dari kode atau nama dengan `search`, atau cocokkan merek dan kategori dengan `brand` dan `category`. Ketiga filter mengabaikan perbedaan huruf besar dan kecil. `only_available: true` hanya menampilkan produk aktif dengan status `normal`. Gunakan `semua: true` untuk menyertakan produk yang belum aktif atau `status` untuk memilih `normal` atau `gangguan`.
- `list_products` mengembalikan `data.total_count` sebelum pembatasan hasil dan `data.products` dengan field `code`, `name`, `brand`, `category`, `price`, `fee`, `status`, `active`, dan `is_open_amount`. `limit` mengatur jumlah hasil, dengan default 50 dan maksimum 200. Gunakan `get_product` untuk detail lengkap, termasuk `sample_size`, `sample_size_30d`, dan `sample_size_90d`: `rendah` (<50), `sedang` (50?499), atau `tinggi` (>=500 transaksi final); `null` berarti belum dihitung. Tampilkan tier saat menjelaskan ukuran sampel.
- Kirim harga yang disetujui sebagai `max_price`. Jika field tersebut dihilangkan, server memakai harga yang sudah dilihat dalam sesi yang sama. Hilangkan `max_price`, `amount`, dan `account_check_id` yang tidak digunakan. Ketiga field menolak nilai `null`.
- Untuk produk nominal bebas, harga total adalah `amount + fee`. Panggil `check_account` dengan `product_code` dan `customer_no` untuk mendapatkan nama pemilik (`account_name`), `check_id`, dan waktu kedaluwarsa (`expires_at`). Gunakan `check_id` yang masih berlaku sebagai `account_check_id` saat membuat transaksi dengan produk dan nomor yang sama.
- Buat dan simpan `ref_id` unik sebelum memanggil `create_transaction`. Gunakan 1–50 karakter dari `A–Z`, `a–z`, `0–9`, titik, garis bawah, atau tanda hubung. Jika dihilangkan, server membuat `ref_id` otomatis dan mengembalikannya pada hasil transaksi atau kegagalan pengiriman.
- Gunakan `get_transaction` dengan `ref_id` saat hasil permintaan tidak pasti. Untuk mengulangi permintaan yang sama, kirim `ref_id` dan semua nilai field yang sama, termasuk `max_price`. Server menurunkan `Idempotency-Key` dari referensi tersebut sehingga percobaan ulang mengembalikan transaksi yang sama. Jika harga berubah, minta persetujuan ulang untuk harga terbaru.
- `message` transaksi adalah teks tampilan tetap. Tentukan hasil `create_transaction`, `get_transaction`, dan `list_transactions` berdasarkan `status`, bukan teks `message`.
- Rincian inquiry tagihan dapat bernilai `null`; field opsionalnya adalah `lembar_tagihan`, `tarif`, `daya`, `jumlah_peserta`, dan `detail[]` berisi `periode`, `nilai_tagihan`, `admin`, `denda`, `biaya_lain`, `meter_awal`, dan `meter_akhir`. Nilai numerik dapat berupa angka atau string digit.
- Simpan API key dan API secret di environment atau konfigurasi lokal yang terlindungi. Hindari memasukkan kredensial ke riwayat chat atau repositori.

Sumber daya MCP `llms-full.txt` memuat panduan integrasi. Sumber daya `openapi.json` menyajikan spesifikasi OpenAPI Bisadagang Bisnis secara terpisah sebagai JSON berindentasi.

## Analisis transaksi

- Gunakan `get_summary` untuk total, omzet transaksi sukses (`totals.success_amount`), tingkat keberhasilan, dan tren. Pilih `group_by: "day"` untuk tren harian atau `group_by: "product"` untuk membandingkan produk.
- Gunakan `list_transactions` untuk rincian transaksi. Filter dengan `status` atau `product_code` dan gunakan `data.next_cursor` sebagai `cursor` untuk halaman berikutnya dengan tanggal dan filter yang sama. Setiap halaman memuat maksimal 50 transaksi secara default dan dapat dinaikkan hingga 100. Samarkan nomor pelanggan saat menyajikan hasil, misalnya `********0001`.
- Kedua tool bersifat baca saja. `from` dan `to` menggunakan tanggal WIB dalam format `YYYY-MM-DD` dengan maksimum 92 hari, termasuk tanggal awal dan akhir. Jika `to` kosong, gunakan hari ini di WIB. Jika `from` kosong, gunakan enam hari sebelum `to`.

Contoh prompt

- “Produk apa yang paling sering gagal minggu ini?”
- “Bandingkan omzet bulan ini dengan bulan lalu.”
- “Tampilkan transaksi PLN20 yang masih pending hari ini dan samarkan nomor pelanggan.”

## Skill Claude Code

Salin folder `skills/bisadagang-bisnis` ke `.claude/skills/` dalam proyek Mitra Bisnis, atau ke `~/.claude/skills/` untuk pemakaian pribadi di semua proyek. Jalankan `/bisadagang-bisnis` di Claude Code dengan permintaan integrasi yang ingin dikerjakan.

```sh
git clone https://github.com/bisadagang/bisadagang-bisnis-mcp.git
mkdir -p ~/.claude/skills
cp -R bisadagang-bisnis-mcp/skills/bisadagang-bisnis ~/.claude/skills/
```

## Pengembangan

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run check:spec
```

Snapshot OpenAPI mengikuti spesifikasi resmi; generator tipe menerapkan penyesuaian sementara untuk kontrak backend PR #103 sampai dokumentasi web diperbarui. Jika spesifikasi resmi berubah, jalankan `npm run sync:spec` untuk memperbarui snapshot OpenAPI dan tipe TypeScript, lalu tinjau perubahannya.

- [Dokumentasi Bisadagang Bisnis](https://bisnis.bisadagang.com/docs)
- [Panduan integrasi lengkap](https://bisnis.bisadagang.com/llms-full.txt)
- [Spesifikasi OpenAPI](https://bisnis.bisadagang.com/openapi.json)
- [Contoh integrasi dan sumber fungsi tanda tangan](https://github.com/bisadagang/bisadagang-bisnis-examples)
- [Lisensi MIT](LICENSE)
