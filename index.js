/**
 * WA Downloader Bot
 * Fitur: .tiktok, .yt, .ytmp3, .ig
 *
 * Cara pakai: lihat README.md
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const P = require("pino");
const qrcode = require("qrcode-terminal");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

// Command Python yang dipakai buat manggil yt-dlp.
// Windows biasanya "python", sebagian Mac/Linux pakai "python3".
// Kalau "python -m yt_dlp" tidak ketemu, ganti PYTHON_CMD ke "python3".
const PYTHON_CMD = "python";

// Path ke file cookies.txt (export manual dari browser) buat akses Instagram Story & konten private.
// Cara dapetin: install extension "Get cookies.txt LOCALLY" di Chrome, login IG, export cookies.txt,
// lalu taruh file itu di folder yang sama dengan index.js ini.
// Kosongkan jadi "" atau hapus file-nya kalau tidak mau pakai cookies (Story akan gagal).
const IG_COOKIES_FILE = path.join(__dirname, "cookies.txt");

const TMP_DIR = path.join(__dirname, "tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

// ------------------------- Helper: Downloaders -------------------------

// TikTok tanpa watermark, pakai API publik tikwm.com
async function downloadTikTok(url) {
  const api = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;
  const res = await fetch(api);
  const json = await res.json();
  if (!json?.data?.play) throw new Error("Gagal ambil video TikTok. Cek link-nya.");
  return json.data.play; // direct video URL (no watermark)
}

// Ambil ID unik dari link Instagram (story/reel/post), buat mencocokkan file hasil download
// dengan item yang BENAR-BENAR diminta (bukan asal ambil file yang paling baru).
function extractInstagramId(url) {
  // Story: instagram.com/stories/username/1234567890123456/
  // Reel/Post: instagram.com/reel/ABC123xyz/ atau /p/ABC123xyz/
  const storyMatch = url.match(/\/stories\/[^/]+\/(\d+)/);
  if (storyMatch) return storyMatch[1];
  const shortcodeMatch = url.match(/\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/);
  if (shortcodeMatch) return shortcodeMatch[1];
  return null;
}

// Menjalankan satu percobaan download yt-dlp.
// Tiap percobaan pakai SUBFOLDER SENDIRI di dalam tmp/, biar tidak ada file nyasar
// dari percobaan lain yang ketuker (terutama kalau extractor download >1 item sekaligus).
function runYtDlpOnce(url, audioOnly, useCookies) {
  return new Promise((resolve, reject) => {
    const attemptId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const attemptDir = path.join(TMP_DIR, attemptId);
    fs.mkdirSync(attemptDir, { recursive: true });

    const outputTemplate = path.join(attemptDir, "%(id)s.%(ext)s");
    const expectedId = extractInstagramId(url);

    const args = audioOnly
      ? ["-m", "yt_dlp", "--no-playlist", "-x", "--audio-format", "mp3", "-o", outputTemplate, url]
      : ["-m", "yt_dlp", "--no-playlist", "-f", "mp4[height<=480]/best[ext=mp4]/best", "-o", outputTemplate, url];

    if (useCookies && fs.existsSync(IG_COOKIES_FILE)) {
      args.push("--cookies", IG_COOKIES_FILE);
    }

    const proc = spawn(PYTHON_CMD, args);

    let stderr = "";
    let stdout = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.stdout.on("data", (d) => (stdout += d.toString()));

    proc.on("error", (err) => {
      reject(new Error(`Gagal jalanin python. Pastikan "${PYTHON_CMD}" ada di PATH. (${err.message})`));
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        cleanupDir(attemptDir);
        return reject(new Error(`yt-dlp gagal (exit ${code}): ${stderr.slice(-300)}`));
      }
      const files = fs.readdirSync(attemptDir);
      if (files.length === 0) {
        cleanupDir(attemptDir);
        return reject(
          new Error(`File hasil download tidak ditemukan. Log: ${(stdout + stderr).slice(-300)}`)
        );
      }

      // Kalau kita tau ID yang diminta, cari file yang namanya PERSIS cocok dulu.
      let chosen = null;
      if (expectedId) {
        chosen = files.find((f) => f.startsWith(expectedId + "."));
      }
      // Fallback: kalau cuma ada 1 file, ambil itu. Kalau lebih dari 1 dan tidak ada yang cocok ID, ambil yang terbaru.
      if (!chosen) {
        if (files.length === 1) {
          chosen = files[0];
        } else {
          chosen = files
            .map((f) => ({ f, mtime: fs.statSync(path.join(attemptDir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime)[0].f;
        }
      }

      // Pindahkan file terpilih ke TMP_DIR utama, lalu bersihkan subfolder attempt (termasuk file lain yang tidak dipakai).
      const finalPath = path.join(TMP_DIR, `${attemptId}_${chosen}`);
      fs.renameSync(path.join(attemptDir, chosen), finalPath);
      cleanupDir(attemptDir);
      resolve(finalPath);
    });
  });
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {
    // abaikan error cleanup
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Download generik pakai "python -m yt_dlp" — dipakai buat YouTube & Instagram
// Instagram Story extractor kadang flaky (kadang gagal padahal cookies & link valid),
// jadi kita retry otomatis beberapa kali sebelum benar-benar nyerah.
async function downloadWithYtDlp(url, audioOnly = false, useCookies = false, maxRetries = 2) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await runYtDlpOnce(url, audioOnly, useCookies);
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await sleep(2000); // tunggu 2 detik sebelum coba lagi
      }
    }
  }
  throw lastError;
}

// ------------------------- Bot Setup -------------------------

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, "auth_session"));
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: P({ level: "silent" }),
    auth: state,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log("Scan QR ini pakai WhatsApp (Perangkat Tertaut):");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("Koneksi terputus. Reconnect:", shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === "open") {
      console.log("✅ Bot WA berhasil terhubung!");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const body =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    if (!body.startsWith(".")) return;

    const [cmdRaw, ...rest] = body.trim().split(" ");
    const cmd = cmdRaw.toLowerCase();
    const arg = rest.join(" ").trim();

    try {
      if (cmd === ".tiktok" || cmd === ".tt") {
        if (!arg) return reply(sock, from, "Kirim: .tiktok <link>");
        await reply(sock, from, "⏳ Lagi ambil video TikTok...");
        const videoUrl = await downloadTikTok(arg);
        await sock.sendMessage(from, {
          video: { url: videoUrl },
          caption: "✅ Berikut videonya (no watermark)",
        });
      } else if (cmd === ".ig" || cmd === ".instagram") {
        if (!arg) return reply(sock, from, "Kirim: .ig <link>");
        await reply(sock, from, "⏳ Lagi ambil media Instagram (auto-retry kalau gagal di percobaan pertama)...");
        const filePath = await downloadWithYtDlp(arg, false, true, 3);
        const ext = path.extname(filePath).toLowerCase();
        const isImage = [".jpg", ".jpeg", ".png", ".webp"].includes(ext);
        const fileBuffer = fs.readFileSync(filePath);
        if (isImage) {
          await sock.sendMessage(from, {
            image: fileBuffer,
            caption: "✅ Berikut fotonya",
          });
        } else {
          await sock.sendMessage(from, {
            video: fileBuffer,
            caption: "✅ Berikut videonya",
          });
        }
        fs.unlinkSync(filePath);
      } else if (cmd === ".yt" || cmd === ".ytmp4") {
        if (!arg) return reply(sock, from, "Kirim: .yt <link>");
        await reply(sock, from, "⏳ Lagi download video YouTube, sabar ya...");
        const filePath = await downloadWithYtDlp(arg, false);
        await sock.sendMessage(from, {
          video: fs.readFileSync(filePath),
          caption: "✅ Berikut videonya",
        });
        fs.unlinkSync(filePath);
      } else if (cmd === ".ytmp3") {
        if (!arg) return reply(sock, from, "Kirim: .ytmp3 <link>");
        await reply(sock, from, "⏳ Lagi download audio YouTube, sabar ya...");
        const filePath = await downloadWithYtDlp(arg, true);
        await sock.sendMessage(from, {
          audio: fs.readFileSync(filePath),
          mimetype: "audio/mp4",
        });
        fs.unlinkSync(filePath);
      } else if (cmd === ".menu" || cmd === ".help") {
        await reply(
          sock,
          from,
          "*📥 WA Downloader Bot*\n\n" +
            ".tiktok <link> - Download TikTok (no watermark)\n" +
            ".ig <link> - Download Instagram\n" +
            ".yt <link> - Download video YouTube\n" +
            ".ytmp3 <link> - Download audio YouTube"
        );
      }
    } catch (err) {
      console.error(err);
      await reply(sock, from, `❌ Error: ${err.message}`);
    }
  });
}

async function reply(sock, jid, text) {
  await sock.sendMessage(jid, { text });
}

startBot();
