# Bisadagang Bisnis MCP

Server MCP melalui stdio untuk mengakses API H2H Bisadagang Bisnis atas nama Mitra Bisnis. Gunakan server ini untuk mengecek saldo, mencari produk, membuat transaksi prabayar, dan mengecek status transaksi.

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
- Gunakan `get_product` atau `list_products` untuk melihat harga, lalu kirim harga yang disetujui sebagai `max_price`. Jika `max_price` kosong, server memakai harga yang sudah dilihat dalam sesi yang sama. Untuk produk nominal bebas, harga total adalah `amount + fee` dan diperlukan `account_check_id` dari pengecekan nama.
- Simpan `ref_id` dari `create_transaction` dan gunakan `get_transaction` untuk mengecek status. Jika hasil permintaan tidak pasti, cek referensi tersebut sebelum mengajukan transaksi baru. Jika harga berubah, minta persetujuan ulang untuk harga terbaru.
- Simpan API key dan API secret di environment atau konfigurasi lokal yang terlindungi. Hindari memasukkan kredensial ke riwayat chat atau repositori.

Sumber daya MCP `llms-full.txt` memuat panduan integrasi dan spesifikasi API Bisadagang Bisnis.

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

Jika spesifikasi resmi berubah, jalankan `npm run sync:spec` untuk memperbarui snapshot OpenAPI dan tipe TypeScript, lalu tinjau perubahannya.

- [Dokumentasi Bisadagang Bisnis](https://bisnis.bisadagang.com/docs)
- [Panduan integrasi lengkap](https://bisnis.bisadagang.com/llms-full.txt)
- [Spesifikasi OpenAPI](https://bisnis.bisadagang.com/openapi.json)
- [Contoh integrasi dan sumber fungsi tanda tangan](https://github.com/bisadagang/bisadagang-bisnis-examples)
- [Lisensi MIT](LICENSE)
