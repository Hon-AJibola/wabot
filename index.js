import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import P from "pino";
import dotenv from "dotenv";
import fs from "fs";
import mongoose from "mongoose";
import axios from "axios";
import cloudinary from "cloudinary";
import mime from "mime-types";
import { io } from "socket.io-client";

dotenv.config();

// --- Cloudinary Config ---
cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// --- Socket.IO ---
const socket = io(`http://localhost:${process.env.WEB_PORT || 3000}`);

// --- Owner & Phone ---
const OWNER_NUMBER = process.env.OWNER_NUMBER;
const PHONE_NUMBER = process.env.PHONE_NUMBER;

// --- Bot Uptime Tracking ---
const startTime = Date.now();

// --- Helper Functions ---
const isOwnerJid = (jid) => jid.includes(OWNER_NUMBER);

// Dummy stubs (replace with your mongoose models)
const SavedMsg = mongoose.model("SavedMsg", new mongoose.Schema({}, { strict: false }));
const Antidelete = mongoose.model("Antidelete", new mongoose.Schema({}, { strict: false }));

async function cloudSaveMedia(mediaObj) {
  // implement cloudinary upload
  return "https://example.com/media.jpg"; // placeholder
}

async function downloadAndSave(mediaObj) {
  // implement download
  return "./tempfile"; // placeholder
}

// --- MAIN START BOT FUNCTION ---
async function startBot(phone = PHONE_NUMBER, method = "qr") {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ["Hon. Ajibola Bot", "Chrome", "10.0.0"]
  });

  // --- Pairing or QR ---
  if (method === "pairing") {
    if (!state.creds?.me?.id) {
      try {
        const code = await sock.requestPairingCode(phone);
        console.log(`✅ Pairing code for ${phone}: ${code}`);
        socket.emit("botEvent", { code });
      } catch (err) {
        console.error("❌ Failed pairing code:", err.message);
        socket.emit("botEvent", { msg: "❌ Failed to generate pairing code" });
      }
    } else {
      console.log(`✅ Already logged in as ${state.creds.me.id}`);
    }
  } else if (method === "qr") {
    sock.ev.on("connection.update", ({ qr, connection }) => {
      if (qr) socket.emit("botEvent", { qr });
      if (connection === "close") console.log("⚠️ Connection closed, restart bot");
      if (connection === "open") console.log("✅ Connected to WhatsApp");
    });
  }

  // --- MESSAGE HANDLER ---
  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      for (const raw of messages) {
        if (!raw.message) continue;

        let messageContent = raw.message;
        let isViewOnce = false;
        if (messageContent.viewOnceMessage) { isViewOnce = true; messageContent = messageContent.viewOnceMessage.message; }
        if (messageContent.ephemeralMessage) messageContent = messageContent.ephemeralMessage.message;

        const key = raw.key;
        const from = key.remoteJid;
        const sender = key.participant || key.remoteJid;
        const msgId = key.id;
        let body = messageContent.conversation || messageContent.extendedTextMessage?.text || "";
        if (messageContent.imageMessage?.caption) body = messageContent.imageMessage.caption;
        if (messageContent.videoMessage?.caption) body = messageContent.videoMessage.caption;
        body = body.trim();

        // Save media
        let mediaUrl = null;
        let mediaObj = messageContent.imageMessage || messageContent.videoMessage || messageContent.documentMessage || messageContent.audioMessage || null;
        if (mediaObj) mediaUrl = await cloudSaveMedia(mediaObj);

        // Save to DB
        if ((body && body.trim()) || mediaUrl) {
          try {
            await SavedMsg.findOneAndUpdate(
              { messageId: msgId },
              { messageId: msgId, chatId: from, sender, timestamp: Date.now(), text: body || "", mediaUrl, mime: mediaObj?.mimetype || null, isViewOnce },
              { upsert: true }
            );
          } catch (e) { console.error("SavedMsg save error:", e.message); }
        }

        const cmd = body.split(" ")[0].toLowerCase();
        const args = body.split(" ").slice(1);
        const reply = async (t, extra = {}) => { await sock.sendMessage(from, { text: t, ...extra }); };

        // --------------------------
        // --- COMMANDS START ---
        // --------------------------

        if (cmd === ".vv") {
          const doc = await SavedMsg.findOne({ chatId: from, isViewOnce: true }).sort({ timestamp: -1 });
          if (!doc) return reply("No saved view-once media in this chat.");
          let message = "🔓 Resending view-once as normal:\n\n" + (doc.text || "");
          if (doc.mediaUrl) {
            await sock.sendMessage(from, { text: message });
            await sock.sendMessage(from, { image: { url: doc.mediaUrl } });
          } else { await reply(message); }
        }

       
    // ========== .TAGALL COMMAND ==========
     if (cmd === ".tagall") {
    const metadata = await sock.groupMetadata(from).catch(() => null);
    if (!metadata) return reply("⚠️ This command only works in group chats.");
       
      let mentions = [];
      let message = `
➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤
╭──────────────────────────────╮
│ 🤖 *HON. AJIBOLA BOT™* ⚡
│   Your Digital Right-Hand
│──────────────────────────────│
│   _Automate_ ⚙️
│   _Elevate_ 🚀
│   _Dominate_ 👑
╰──────────────────────────────╯
➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤
`;

      for (let member of metadata.participants) {
        mentions.push(member.id);
        message += `📍 @${member.id.split("@")[0]}\n`;
      }

      message += `
────────────── ⚡──────────────
    Developed by *Hon. Ajibola*
    © 2025 All Rights Reserved
    🔗 https://wa.link/z6zrve
────────────── ⚡──────────────`;

      await sock.sendMessage(from, { text: message, mentions });
    }}

        if (cmd === ".ping" || cmd === ".info") {
          const uptimeS = Math.floor((Date.now()-startTime)/1000);
          const hrs = Math.floor(uptimeS/3600);
          const mins = Math.floor((uptimeS%3600)/60);
          const secs = uptimeS%60;
          const infoMsg = `🏓 Bot uptime: ${hrs}h ${mins}m ${secs}s\nMemory: ${(process.memoryUsage().heapUsed/1024/1024).toFixed(1)} MB\nOwner: Hon. Ajibola`;
          await reply(infoMsg);
        }

        if (cmd === ".help" || cmd === ".menu") {
          const helpText = `
✨ *HON. AJIBOLA BOT™ MENU*
Core: .tagall · .ping · .info · .help
Utility: .save · .vv · .antidelete on|off · .antilink on|off
Media: .sticker · .tts <text>
Admin: .ginfo · .promote · .demote · .kickall
Owner: .restart
`;
          await reply(helpText);
        }
        // ...rest of your commands like .save, .antidelete, .quote, .say, .tts, .sticker, .ginfo, .owner, .restart, .antilink, .promote/.demote, .kickall
        // can be copied exactly from your current merged handler

      } // end for messages
    } catch (e) { console.error("command handler error", e?.message); }
  });
}

// --- SOCKET LOGIN TRIGGER ---
socket.on("botLoginRequest", ({ phone, method }) => {
  console.log("🌐 Received login request:", phone, method);
  startBot(phone, method);
});

// --- AUTO START ---
startBot();
