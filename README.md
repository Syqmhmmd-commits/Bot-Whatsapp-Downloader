# WA Downloader Bot

Bot WhatsApp buat download video/audio dari TikTok, Instagram, dan YouTube — tinggal kirim command + link di chat.

## Fitur
| Command | Fungsi |
|---|---|
| `.tiktok <link>` | Download video TikTok tanpa watermark |
| `.ig <link>` | Download video/foto Instagram |
| `.yt <link>` | Download video YouTube |
| `.ytmp3 <link>` | Download audio YouTube (mp3) |
| `.menu` | Lihat daftar command |

## Yang Dibutuhkan
1. **Node.js** versi 18 ke atas — cek dulu: `node -v`
2. **Python** + **yt-dlp** (dipakai buat download YouTube). Bot ini manggil yt-dlp lewat `python -m yt_dlp`, jadi kamu **tidak perlu** yt-dlp ada di PATH terpisah — cukup pastikan `python` bisa dipanggil dan yt-dlp ter-install:
   ```bash
   python -m pip install yt-dlp
   ```
   Cek dengan: `python -m yt_dlp --version`

   > Kalau di sistem kamu perintahnya `python3` bukan `python` (umum di Mac/Linux), buka `index.js` dan ganti baris `const PYTHON_CMD = "python";` jadi `const PYTHON_CMD = "python3";`
3. **ffmpeg** (dibutuhkan yt-dlp buat convert ke mp3):
   - Ubuntu/Debian: `sudo apt install ffmpeg`
   - Mac: `brew install ffmpeg`
   - Windows: download dari https://ffmpeg.org lalu tambahin ke PATH

## Cara Menjalankan

1. Extract folder ini, lalu masuk ke foldernya:
   ```bash
   cd wa-downloader-bot
   ```

2. Install dependency:
   ```bash
   npm install
   ```

3. Jalankan bot:
   ```bash
   npm start
   ```

4. Akan muncul **QR code** di terminal. Scan pakai WhatsApp di HP kamu:
   - Buka WhatsApp → Menu (⋮) atau Settings → **Perangkat Tertaut** (Linked Devices) → **Tautkan Perangkat**
   - Scan QR yang muncul di terminal

5. Setelah konek, kirim pesan ke nomor WA yang kamu pakai (bisa dari HP lain, atau grup yang di-invite), contoh:
   ```
   .tiktok https://www.tiktok.com/@user/video/xxxxxxx
   .yt https://youtu.be/xxxxxxx
   .ytmp3 https://youtu.be/xxxxxxx
   ```

Session login tersimpan di folder `auth_session/` — jadi lain kali jalanin `npm start` lagi nggak perlu scan ulang (selama nggak di-unlink dari HP).

## Deploy 24/7 (Opsional)
Biar bot jalan terus tanpa laptop nyala, bisa deploy ke VPS murah (contoh: pakai `pm2` biar auto-restart):
```bash
npm install -g pm2
pm2 start index.js --name wa-bot
pm2 save
```

## Catatan Penting
- **API downloader pihak ketiga** (tikwm.com dll) yang dipakai di sini bisa berubah/down sewaktu-waktu karena bukan API resmi. Kalau error, cek dulu apakah endpoint-nya masih hidup atau ganti ke API alternatif.
- **Risiko banned**: pakai library unofficial (Baileys) untuk otomasi WA melanggar ToS WhatsApp secara teknis. Jangan spam kirim pesan otomatis dalam jumlah besar, dan sebaiknya pakai nomor sekunder (bukan nomor utama) buat testing/bot.
- File YouTube yang didownload disimpan sementara di folder `tmp/` dan otomatis dihapus setelah dikirim.
- Kalau mau tambah command lain, edit blok `if/else` di `index.js` bagian `messages.upsert`.

## Troubleshooting
- **QR code tidak muncul / error koneksi**: hapus folder `auth_session/` lalu jalankan ulang `npm start`.
- **Video YouTube gagal / error yt-dlp**: pastikan `yt-dlp` sudah versi terbaru: `pip install -U yt-dlp`.
- **File terlalu besar**: WhatsApp punya limit ukuran file (sekitar 16-100MB tergantung tipe), video YouTube resolusi tinggi bisa gagal terkirim — bisa ubah `format` di `downloadYouTube()` ke resolusi lebih rendah, misal `"format": "mp4[height<=480]"`.
