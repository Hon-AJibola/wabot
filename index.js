// npm install @whiskeysockets/baileys qrcode-terminal
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");

const OWNER_NUMBER = "234XXXXXXXXXX@s.whatsapp.net"; // <-- replace with your WhatsApp number in intl format (e.g. 2348123456789@s.whatsapp.net)

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true
  });

  // QR Display Event
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (update.qr) {
      console.log("Scan the QR code above using WhatsApp -> Linked Devices");
      qrcode.generate(update.qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ Bot connected successfully");
      await sock.sendMessage(OWNER_NUMBER, { text: "✅ WhatsApp Bot is now connected!" });
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        await sock.sendMessage(OWNER_NUMBER, { text: "⚠️ Bot disconnected. Attempting to reconnect..." });
        startBot(); // auto reconnect
      } else {
        await sock.sendMessage(OWNER_NUMBER, { text: "🚫 Bot logged out. Please re-scan the QR code." });
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  // Command Handling
  const startTime = Date.now();

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || !msg.key.remoteJid) return;

    const from = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

    // TAGALL Command
    if (text.toLowerCase() === ".tagall") {
      const metadata = await sock.groupMetadata(from).catch(() => null);
      if (!metadata) return sock.sendMessage(from, { text: "This command only works in groups." });

      let mentions = [];
      let message = "📣 *Tagging everyone in the group!*\n\n";
      for (let member of metadata.participants) {
        mentions.push(member.id);
        message += `@${member.id.split("@")[0]} `;
      }

      await sock.sendMessage(from, { text: message.trim(), mentions });
    }

    // PING Command
    if (text.toLowerCase() === ".ping") {
      const uptime = Math.floor((Date.now() - startTime) / 1000);
      const hrs = Math.floor(uptime / 3600);
      const mins = Math.floor((uptime % 3600) / 60);
      const secs = uptime % 60;

      const reply = `🏓 *Bot Uptime:*\n${hrs}h ${mins}m ${secs}s`;
      await sock.sendMessage(from, { text: reply });
    }

    // HELP Command
    if (text.toLowerCase() === ".help") {
      const helpText = `
🧭 *Available Commands:*
1️⃣ .tagall - Mention all group members
2️⃣ .ping - Check bot uptime
3️⃣ .help - Show this help menu

👑 Owner: Caleb
      `;
      await sock.sendMessage(from, { text: helpText });
    }
  });
}

startBot();
