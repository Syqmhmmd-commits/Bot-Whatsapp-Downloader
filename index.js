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

// Download generik pakai "python -m yt_dlp" — dipakai buat YouTube & Instagram
// (yt-dlp support banyak situs termasuk instagram.com, tiktok.com, dll)
function downloadWithYtDlp(url, audioOnly = false) {
  return new Promise((resolve, reject) => {
    const filename = `dl_${Date.now()}.%(ext)s`;
    const outputTemplate = path.join(TMP_DIR, filename);

    const args = audioOnly
      ? ["-m", "yt_dlp", "-x", "--audio-format", "mp3", "-o", outputTemplate, url]
      : ["-m", "yt_dlp", "-f", "mp4[height<=480]/best[ext=mp4]/best", "-o", outputTemplate, url];

    const proc = spawn(PYTHON_CMD, args);

    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("error", (err) => {
      reject(new Error(`Gagal jalanin python. Pastikan "${PYTHON_CMD}" ada di PATH. (${err.message})`));
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`yt-dlp gagal (exit ${code}): ${stderr.slice(-300)}`));
      }
      const prefix = filename.split(".%(ext)s")[0];
      const found = fs.readdirSync(TMP_DIR).find((f) => f.startsWith(prefix));
      if (!found) return reject(new Error("File hasil download tidak ditemukan."));
      resolve(path.join(TMP_DIR, found));
    });
  });
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
        await reply(sock, from, "⏳ Lagi ambil media Instagram, sabar ya...");
        const filePath = await downloadWithYtDlp(arg, false);
        await sock.sendMessage(from, {
          video: fs.readFileSync(filePath),
          caption: "✅ Berikut medianya",
        });
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
