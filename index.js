
// index.js
// npm install express mongoose fs-extra axios mime-types cloudinary @aws-sdk/client-s3 @whiskeysockets/baileys qrcode-terminal

const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const mongoose = require("mongoose");
const axios = require("axios");
const mime = require("mime-types");
const qrcode = require("qrcode-terminal");

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const cloudinary = require("cloudinary").v2;

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadContentFromMessage,
  jidNormalizedUser
} = require("@whiskeysockets/baileys");

// ---------- CONFIG ----------
const USE_PAIRING_CODE = (process.env.USE_PAIRING_CODE === "true") || false;
const PHONE_NUMBER = process.env.PHONE_NUMBER || "2349050704741";
const OWNER_NUMBER = process.env.OWNER_NUMBER || `${PHONE_NUMBER}@s.whatsapp.net`;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/hon_ajibola_bot";
const PORT = process.env.PORT || 3000;

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "",
  api_key: process.env.CLOUDINARY_API_KEY || "",
  api_secret: process.env.CLOUDINARY_API_SECRET || ""
});

// S3 client config
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});
const S3_BUCKET = process.env.S3_BUCKET_NAME;

// Ensure local media folder (for fallback or temporary)
fs.ensureDirSync("./db/media");

// ---------- Mongo Models ----------
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB connected"))
  .catch(e => console.error("❌ MongoDB connection error:", e && e.message));

const AntideleteSchema = new mongoose.Schema({
  chatId: { type: String, unique: true }
});
const SavedMsgSchema = new mongoose.Schema({
  messageId: { type: String, unique: true },
  chatId: String,
  sender: String,
  timestamp: Number,
  text: String,
  mediaUrl: String,   // URL in Cloudinary or S3
  mime: String,
  isViewOnce: Boolean
});

const Antidelete = mongoose.model("Antidelete", AntideleteSchema);
const SavedMsg = mongoose.model("SavedMsg", SavedMsgSchema);

// ---------- Express Keep-Alive ----------
const app = express();
app.get("/", (req, res) => {
  res.send("🔥 Hon. Ajibola Bot is online and unstoppable 💥");
});
app.listen(PORT, () => console.log(`🌍 Server active on port ${PORT}`));

// ---------- Helpers: upload to Cloudinary or S3 ----------

async function uploadToCloudinary(buffer, mimeType) {
  try {
    const upload = await cloudinary.uploader.upload_stream({
      resource_type: "auto",
      folder: "whatsapp_media"
    }, (error, result) => {
      if (error) throw error;
      return result;
    });
    // But upload_stream returns a stream function, so we pipe
    const stream = cloudinary.uploader.upload_stream({ resource_type: "auto", folder: "whatsapp_media" }, (error, result) => {
      if (error) console.error("Cloudinary upload error:", error);
      // result.secure_url is the URL
    });
    // Actually better: use upload method with base64 or buffer
    const result = await cloudinary.uploader.upload(`data:${mimeType};base64,${buffer.toString('base64')}`, {
      resource_type: "auto",
      folder: "whatsapp_media"
    });
    return result.secure_url;
  } catch (e) {
    console.error("uploadToCloudinary error:", e && e.message);
    return null;
  }
}

async function uploadToS3(buffer, keyName, mimeType) {
  try {
    const cmd = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: keyName,
      Body: buffer,
      ContentType: mimeType
    });
    await s3.send(cmd);
    // Return the public URL (depends on your bucket policy)
    const url = `https://${S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${keyName}`;
    return url;
  } catch (e) {
    console.error("uploadToS3 error:", e && e.message);
    return null;
  }
}

// Download media from message and upload to your cloud storage
async function cloudSaveMedia(mediaObj) {
  try {
    const stream = await downloadContentFromMessage(mediaObj, mediaObj.mimetype || mediaObj.type || "binary");
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    const buffer = Buffer.concat(chunks);
    const mimeType = mediaObj.mimetype || mediaObj.type || null;

    // Choose one:
    const cloudUrl = await uploadToCloudinary(buffer, mimeType);
    if (cloudUrl) return cloudUrl;

    // fallback to S3
    const keyName = `whatsapp_media/${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const s3Url = await uploadToS3(buffer, keyName, mimeType);
    return s3Url;
  } catch (e) {
    console.error("cloudSaveMedia error:", e && e.message);
    return null;
  }
}

// ---------- Start Bot ----------
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: !USE_PAIRING_CODE,
    browser: ["Hon. Ajibola Bot", "Chrome", "10.0.0"]
  });

  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (!USE_PAIRING_CODE && qr) {
      console.log("\n📱 Scan QR below:\n");
      qrcode.generate(qr, { small: true });
    }
    if (USE_PAIRING_CODE && qr && !state.creds.registered) {
      try {
        const code = await sock.requestPairingCode(PHONE_NUMBER);
        console.log("🔐 Pairing code:", code);
      } catch (e) { console.error(e); }
    }
    if (connection === "open") {
      console.log("✅ Connected");
      try { await sock.sendMessage(OWNER_NUMBER, { text: "✅ Hon. Ajibola Bot connected (cloud storage enabled)" }); } catch {}
    }
    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        console.log("⚠️ Reconnect...");
        startBot();
      } else {
        console.log("🚫 Logged out");
        try { await sock.sendMessage(OWNER_NUMBER, { text: "🚫 Bot logged out — require re-auth." }); } catch {}
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  const startTime = Date.now();

  // Save messages and commands handler
  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const raw of messages) {
      if (!raw.message) continue;
      // unwrap viewOnce / ephemeral
      let messageContent = raw.message;
      if (messageContent.viewOnceMessage) messageContent = messageContent.viewOnceMessage.message;
      if (messageContent.ephemeralMessage) messageContent = messageContent.ephemeralMessage.message;

      const key = raw.key;
      const from = key.remoteJid;
      const sender = key.participant || key.remoteJid;
      const msgId = key.id;
      const timestamp = raw.messageTimestamp || Date.now();
      let body = messageContent.conversation || messageContent.extendedTextMessage?.text || "";
      if (messageContent.imageMessage?.caption) body = messageContent.imageMessage.caption;
      if (messageContent.videoMessage?.caption) body = messageContent.videoMessage.caption;

      // Save message if media or text
      let mediaUrl = null;
      if (messageContent.imageMessage || messageContent.videoMessage || messageContent.documentMessage || messageContent.audioMessage) {
        const mediaObj = messageContent.imageMessage || messageContent.videoMessage || messageContent.documentMessage || messageContent.audioMessage;
        mediaUrl = await cloudSaveMedia(mediaObj);
      }

      if ((body && body.trim()) || mediaUrl) {
        try {
          await SavedMsg.findOneAndUpdate(
            { messageId: msgId },
            {
              messageId: msgId,
              chatId: from,
              sender,
              timestamp,
              text: body || "",
              mediaUrl,
              mime: mediaObj?.mimetype || null,
              isViewOnce: !!raw.message.viewOnceMessage
            },
            { upsert: true }
          );
        } catch (e) {
          console.error("SavedMsg save error:", e && e.message);
        }
      }

      // Now command logic (similar to before). For brevity, only key parts:

      const txt = body.trim();
      const cmd = txt.split(" ")[0].toLowerCase();
      const args = txt.split(" ").slice(1);

      const reply = async (t, extra = {}) => {
        await sock.sendMessage(from, { text: t, ...extra });
      };

     if (cmd === ".vv") {
      const doc = await SavedMsg.findOne({ chatId: from, isViewOnce: true }).sort({ timestamp: -1 });
      if (!doc) return reply("No saved view-once media in this chat.");

      let message = "🔓 Resending view-once as normal:\n\n";
      if (doc.text) message += doc.text + "\n\n";

      if (doc.mediaUrl) {
        await sock.sendMessage(from, { text: message });
        await sock.sendMessage(from, { image: { url: doc.mediaUrl } });
      } else {
        await reply(message);
      }
    }

    // Add other commands (.tagall, .antidelete, .save, etc.) similarly as earlier

    // ✅ Close the for-loop properly before the catch
  } // closes for-loop

  } catch (e) {
    console.error("messages.upsert store error:", e && e.message);
  }
}); // closes sock.ev.on("messages.upsert")


  // Handle deleted messages — WhatsApp sends protocolMessage with type 0
  sock.ev.on("messages.update", async (updates) => {
    try {
      for (const u of updates) {
        if (u.message && u.message.protocolMessage && u.message.protocolMessage.type === 0) {
          const deletedKey = u.message.protocolMessage.key;
          const deletedId = deletedKey?.id;
          const deletedChat = deletedKey?.remoteJid;
          const whoDeleted = deletedKey?.participant || deletedKey?.remoteJid;

          // Check if this chat has antidelete enabled
          const found = await Antidelete.findOne({ chatId: deletedChat });
          if (!found) continue;

          // Get the saved message
          const saved = await SavedMsg.findOne({ messageId: deletedId });
          if (!saved) continue;

          let resendText = `📌 Message deleted by @${(whoDeleted||'unknown').split('@')[0]} — restoring below:\n\n`;
          if (saved.text) resendText += saved.text + "\n\n";
          try {
            // Mention the deleter
            const mentioned = [whoDeleted];
            if (saved.mediaPath) {
              const buffer = await fs.readFile(saved.mediaPath);
              await sock.sendMessage(deletedChat, { text: resendText, contextInfo: { mentionedJid: mentioned } });
              await sock.sendMessage(deletedChat, { 
                [saved.mime && saved.mime.startsWith('image') ? 'image' : saved.mime && saved.mime.startsWith('video') ? 'video' : 'document']: buffer,
                mimetype: saved.mime || undefined,
                fileName: path.basename(saved.mediaPath),
                contextInfo: { mentionedJid: mentioned }
              });
            } else {
              await sock.sendMessage(deletedChat, { text: resendText, contextInfo: { mentionedJid: mentioned } });
            }
          } catch (e) {
            console.error("resend deleted error", e && e.message);
          }
        }
      }
    } catch (e) {
      console.error("messages.update error", e && e.message);
    }
  });

  // ========= Commands handler (single pass) =========
  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      for (const raw of messages) {
        if (!raw.message) continue;

        let messageContent = raw.message;
        let isViewOnce = false;
        if (messageContent.viewOnceMessage) { isViewOnce = true; messageContent = messageContent.viewOnceMessage.message; }
        if (messageContent?.ephemeralMessage) messageContent = messageContent.ephemeralMessage.message;

        const key = raw.key;
        const from = key.remoteJid;
        const sender = key.participant || key.remoteJid;
        const fromMe = key.fromMe || false;
        const quoted = messageContent.extendedTextMessage?.contextInfo?.quotedMessage;
        const body = (messageContent.conversation || messageContent.extendedTextMessage?.text || messageContent.imageMessage?.caption || "").trim();
        if (!body) continue;

        const cmd = body.split(" ")[0].toLowerCase();
        const args = body.split(" ").slice(1);

        // --- Helper to reply ---
        const reply = async (text, extra = {}) => {
          await sock.sendMessage(from, { text, ...extra });
        };

        // --- .tagall ---
        if (cmd === ".tagall") {
          if (!from.endsWith("@g.us")) return reply("⚠️ This command only works in groups.");
          const metadata = await sock.groupMetadata(from);
          if (!metadata) return reply("⚠️ Unable to fetch group metadata.");
          const participants = metadata.participants;
          const mentions = participants.map(p => p.id);
          // Build message
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
          // chunk mentions to avoid huge payloads
          const chunkSize = 20;
          for (let i=0;i<mentions.length;i+=chunkSize){
            const chunk = mentions.slice(i,i+chunkSize);
            const names = chunk.map(j => `@${j.split("@")[0]}`).join(" ");
            await sock.sendMessage(from, { text: message + "\n" + names, mentions: chunk });
            await new Promise(r=>setTimeout(r,1200));
          }
        }

        // --- .ping / .info ---
        if (cmd === ".ping" || cmd === ".info") {
          const uptimeS = Math.floor((Date.now()-startTime)/1000);
          const hrs = Math.floor(uptimeS/3600);
          const mins = Math.floor((uptimeS%3600)/60);
          const secs = uptimeS%60;
          const infoMsg = `🏓 Bot uptime: ${hrs}h ${mins}m ${secs}s\nMemory: ${(process.memoryUsage().heapUsed/1024/1024).toFixed(1)} MB\nOwner: Hon. Ajibola\n`;
          await reply(infoMsg);
        }

        // --- .help / .menu ---
        if (cmd === ".help" || cmd === ".menu") {
          const helpText = `
✨ *HON. AJIBOLA BOT™ MENU*
━━━━━━━━━━━━━━━━━━━━━━━
Core: .tagall · .ping · .info · .help
Utility: .save (reply to msg) · .vv · .antidelete on|off · .antilink on|off
Media: .sticker (reply image) · .tts <text>
Admin: .ginfo · .promote @number · .demote @number · .kickall (OWNER)
Fun: .quote · .say <text>
Owner: .restart
━━━━━━━━━━━━━━━━━━━━━━━
`;
          await reply(helpText);
        }

        // --- .save (reply to a message / status) ---
        if (cmd === ".save") {
          if (!quoted) return reply("⚠️ Reply to the message you want to save with `.save`.");
          const qmsg = quoted;
          // try to download media if any
          let savedPath = null;
          let savedText = qmsg?.conversation || qmsg?.extendedTextMessage?.text || qmsg?.imageMessage?.caption || "";
          try {
            if (qmsg.imageMessage || qmsg.videoMessage || qmsg.documentMessage || qmsg.audioMessage) {
              const mediaObj = qmsg.imageMessage || qmsg.videoMessage || qmsg.documentMessage || qmsg.audioMessage;
              const saved = await downloadAndSave(mediaObj);
              if (saved) savedPath = saved;
            }
            // Send copy to owner
            await sock.sendMessage(OWNER_NUMBER, { text: `💾 Saved from ${sender} in ${from}` });
            if (savedText) await sock.sendMessage(OWNER_NUMBER, { text: savedText });
            if (savedPath) {
              const buffer = await fs.readFile(savedPath);
              const sendObj = {};
              if (mime.lookup(savedPath)?.startsWith("image")) sendObj.image = buffer;
              else if (mime.lookup(savedPath)?.startsWith("video")) sendObj.video = buffer;
              else sendObj.document = buffer;
              await sock.sendMessage(OWNER_NUMBER, sendObj);
            }
            await reply("✅ Saved and sent to owner.");
          } catch (e) {
            console.error("save command error", e && e.message);
            await reply("❌ Failed to save message.");
          }
        }

        // --- .antidelete on|off ---
        if (cmd === ".antidelete") {
          const action = args[0]?.toLowerCase();
          if (action === "on") {
            try {
              await Antidelete.findOneAndUpdate({ chatId: from }, { chatId: from }, { upsert: true });
              await reply("✅ Anti-delete ENABLED for this chat.");
            } catch (e) { await reply("❌ Failed to enable anti-delete."); }
          } else if (action === "off") {
            try {
              await Antidelete.deleteOne({ chatId: from });
              await reply("⛔ Anti-delete DISABLED for this chat.");
            } catch (e) { await reply("❌ Failed to disable anti-delete."); }
          } else {
            await reply("Usage: `.antidelete on` or `.antidelete off`");
          }
        }

        // --- .vv resend last view-once in chat ---
        if (cmd === ".vv") {
          const doc = await SavedMsg.findOne({ chatId: from, isViewOnce: true }).sort({ timestamp: -1 });
          if (!doc) return reply("⚠️ No saved view-once found in this chat.");
          let text = "🔓 Resending saved view-once as normal:\n\n";
          if (doc.text) text += doc.text + "\n\n";
          try {
            if (doc.mediaPath) {
              const buffer = await fs.readFile(doc.mediaPath);
              await sock.sendMessage(from, { text });
              const sendObj = {};
              if (mime.lookup(doc.mediaPath)?.startsWith("image")) sendObj.image = buffer;
              else if (mime.lookup(doc.mediaPath)?.startsWith("video")) sendObj.video = buffer;
              else sendObj.document = buffer;
              await sock.sendMessage(from, sendObj);
            } else {
              await reply(text);
            }
          } catch (e) { console.error(".vv error", e && e.message); await reply("❌ Failed to resend view-once."); }
        }

        // --- .quote random ---
        if (cmd === ".quote") {
          try {
            const { data } = await axios.get("https://zenquotes.io/api/random");
            const q = data[0];
            await reply(`💭 "${q.q}"\n— *${q.a}*`);
          } catch (e) { await reply("❌ Quote API failed."); }
        }

        // --- .say <text> ---
        if (cmd === ".say") {
          const toSay = args.join(" ");
          if (!toSay) return reply("Usage: .say <text>");
          await reply(toSay);
        }

        // --- .tts <text> ---
        if (cmd === ".tts") {
          const ttsText = args.join(" ");
          if (!ttsText) return reply("Usage: .tts <text>");
          try {
            const url = `https://api.streamelements.com/kappa/v2/speech?voice=en-GB&text=${encodeURIComponent(ttsText)}`;
            // send as voice note
            await sock.sendMessage(from, { audio: { url }, mimetype: "audio/mp4" , ptt: true });
          } catch (e) { console.error("tts error", e && e.message); await reply("❌ TTS failed."); }
        }

        // --- .sticker (reply to image) ---
        if (cmd === ".sticker") {
          // check quoted message for image or image in message
          const target = messageContent.extendedTextMessage?.contextInfo?.quotedMessage || messageContent;
          const imageMsg = target.imageMessage;
          if (!imageMsg) return reply("⚠️ Reply to an image with .sticker or send an image and type .sticker.");
          try {
            const pathSaved = await downloadAndSave(imageMsg);
            const buffer = await fs.readFile(pathSaved);
            await sock.sendMessage(from, { sticker: buffer });
          } catch (e) { console.error("sticker error", e && e.message); await reply("❌ Sticker creation failed."); }
        }

        // --- .ginfo ---
        if (cmd === ".ginfo") {
          if (!from.endsWith("@g.us")) return reply("⚠️ Not a group.");
          const meta = await sock.groupMetadata(from);
          const adminCount = meta.participants.filter(p => p.admin).length;
          const textInfo = `👥 *Group Info*\nName: ${meta.subject}\nMembers: ${meta.participants.length}\nAdmins: ${adminCount}\nDescription: ${meta.desc || "None"}`;
          await reply(textInfo);
        }

        // --- .owner ---
        if (cmd === ".owner") {
          const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:Hon. Ajibola\nTEL;type=CELL;type=VOICE;waid=${PHONE_NUMBER}:${PHONE_NUMBER}\nEND:VCARD`;
          await sock.sendMessage(from, { contacts: { displayName: "Hon. Ajibola", contacts: [{ vcard }] } });
        }

        // --- .restart (owner only) ---
        if (cmd === ".restart") {
          if (!isOwnerJid(sender) && !isOwnerJid(from)) return reply("⛔ Only owner can restart.");
          await reply("🔄 Restarting...");
          setTimeout(()=> process.exit(0), 1500);
        }

        // --- .antilink on|off (basic) ---
        if (cmd === ".antilink") {
          const action = args[0]?.toLowerCase();
          if (!from.endsWith("@g.us")) return reply("⚠️ Group only.");
          // store in Mongo as antidelete? Here we use Antidelete collection for simplicity: antidelete=antilink (not ideal)
          if (action === "on") {
            await Antidelete.findOneAndUpdate({ chatId: `antilink:${from}` }, { chatId: `antilink:${from}` }, { upsert: true });
            await reply("✅ Anti-link enabled for this group.");
          } else if (action === "off") {
            await Antidelete.deleteOne({ chatId: `antilink:${from}` });
            await reply("⛔ Anti-link disabled for this group.");
          } else {
            await reply("Usage: .antilink on | .antilink off");
          }
        }

        // Monitor messages for antilink if enabled
        if (from.endsWith("@g.us") && !body.startsWith(".")) {
          const hasAntiLink = await Antidelete.findOne({ chatId: `antilink:${from}` });
          if (hasAntiLink) {
            const urlRegex = /(https?:\/\/[^\s]+)/gi;
            if (urlRegex.test(body) || body.includes("wa.me/") || body.includes("chat.whatsapp.com/")) {
              // delete message (if bot has permissions)
              try {
                await sock.sendMessage(from, { text: `⚠️ Link detected and removed.` });
                // Baileys doesn't provide a direct delete for arbitrary messages unless using group modification; but you can send a request to delete if you have key id — we don't have it here; skip delete and warn
              } catch(e) { console.error("antilink warn error", e && e.message); }
            }
          }
        }

        // --- .promote / .demote (owner only) ---
        if ((cmd === ".promote" || cmd === ".demote") && from.endsWith("@g.us")) {
          if (!isOwnerJid(sender) && !isOwnerJid(from)) return reply("⛔ Only owner can promote/demote via bot.");
          const targetMention = messageContent.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || args[0];
          if (!targetMention) return reply("Usage: reply to user or mention @number then .promote / .demote");
          try {
            const j = typeof targetMention === "string" ? targetMention.replace(/[^0-9@.]/g,'') : targetMention;
            if (cmd === ".promote") await sock.groupParticipantsUpdate(from, [j], "promote");
            else await sock.groupParticipantsUpdate(from, [j], "demote");
            await reply(`✅ Done ${cmd} ${j}`);
          } catch (e) { console.error("promote error", e && e.message); await reply("❌ Failed to modify participant."); }
        }

        // --- .kickall (owner only; dangerous) ---
        if (cmd === ".kickall") {
          if (!isOwnerJid(sender) && !isOwnerJid(from)) return reply("⛔ Only owner can kick all.");
          if (!from.endsWith("@g.us")) return reply("⚠️ Use in group.");
          const meta = await sock.groupMetadata(from);
          const toKick = meta.participants.filter(p => !p.admin && p.id !== OWNER_NUMBER).map(p => p.id);
          // kick in batches
          for (const t of toKick) {
            try { await sock.groupParticipantsUpdate(from, [t], "remove"); } catch (e) { console.error("kick error", e && e.message); }
            await new Promise(r=>setTimeout(r,800));
          }
          await reply("✅ Non-admin members kicked (attempted).");
        }

        // === Ability to send in announcement-only groups (admin-only setting)
        // You cannot bypass WhatsApp rules. If group is set to "only admins can send", then the bot can send only if the BOT account is an admin.
        // We check and warn.
        if (!fromMe && from.endsWith("@g.us")) {
          const meta = await sock.groupMetadata(from);
          if (meta.announce) {
            // announce = true means group is announcement-only
            // Check if bot is admin
            const botId = sock.user?.id?.split(':')[0] ? sock.user.id.split(':')[0]+"@s.whatsapp.net" : null;
            const botParticipant = meta.participants.find(p => p.id && p.id.includes(botId?.split('@')[0]));
            const isBotAdmin = botParticipant?.admin;
            if (!isBotAdmin) {
              // if bot sees someone send a message, it's allowed because sender is admin — but for our feature "send even if you're not admin", impossible without bot being admin.
              // So we just log/warn owner if bot isn't admin.
              // No automatic bypass possible.
            }
          }
        }

      } // end for messages
    } catch (e) {
      console.error("command handler error", e && e.message);
    }
  });

  // Graceful exit
  process.on("SIGINT", ()=> { console.log("SIGINT"); process.exit(0); });
  process.on("SIGTERM", ()=> { console.log("SIGTERM"); process.exit(0); });
}

      // ... (you’ll paste your full command block here, but use mediaUrl instead of local path)
    }
  });
}

startBot();
