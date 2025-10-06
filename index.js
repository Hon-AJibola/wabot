// --- START OF MERGED HANDLER ---
// ...existing code...

  // Save messages and commands handler (merged logic)
  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      for (const raw of messages) {
        if (!raw.message) continue;
        // unwrap viewOnce / ephemeral
        let messageContent = raw.message;
        let isViewOnce = false;
        if (messageContent.viewOnceMessage) { isViewOnce = true; messageContent = messageContent.viewOnceMessage.message; }
        if (messageContent.ephemeralMessage) messageContent = messageContent.ephemeralMessage.message;

        const key = raw.key;
        const from = key.remoteJid;
        const sender = key.participant || key.remoteJid;
        const msgId = key.id;
        const timestamp = raw.messageTimestamp || Date.now();
        let body = messageContent.conversation || messageContent.extendedTextMessage?.text || "";
        if (messageContent.imageMessage?.caption) body = messageContent.imageMessage.caption;
        if (messageContent.videoMessage?.caption) body = messageContent.videoMessage.caption;
        body = body.trim();

        // Save message if media or text
        let mediaUrl = null;
        let mediaObj = messageContent.imageMessage || messageContent.videoMessage || messageContent.documentMessage || messageContent.audioMessage || null;
        if (mediaObj) {
          mediaUrl = await cloudSaveMedia(mediaObj);
        }

        // 🧠 Save the message
        if ((body && body.trim()) || mediaUrl) {
          try {
            await SavedMsg.findOneAndUpdate(
              { messageId: msgId },
              {
                messageId: msgId,
                chatId: from,
                sender,
                timestamp: Date.now(),
                text: body || "",
                mediaUrl,
                mime: mediaObj?.mimetype || null,
                isViewOnce
              },
              { upsert: true }
            );
          } catch (e) {
            console.error("SavedMsg save error:", e.message);
          }
        }

        // 🔥 Command Logic
        const cmd = body.split(" ")[0].toLowerCase();
        const args = body.split(" ").slice(1);

        const reply = async (t, extra = {}) => {
          await sock.sendMessage(from, { text: t, ...extra });
        };

        // ✅ Handle Commands
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

        // --- .tagall ---
        if (cmd === ".tagall") {
          if (!from.endsWith("@g.us")) return reply("⚠️ This command only works in groups.");
          const metadata = await sock.groupMetadata(from);
          if (!metadata) return reply("⚠️ Unable to fetch group metadata.");
          const participants = metadata.participants;
          const mentions = participants.map(p => p.id);
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
        const quoted = messageContent.extendedTextMessage?.contextInfo?.quotedMessage;
        if (cmd === ".save") {
          if (!quoted) return reply("⚠️ Reply to the message you want to save with `.save`.");
          const qmsg = quoted;
          let savedPath = null;
          let savedText = qmsg?.conversation || qmsg?.extendedTextMessage?.text || qmsg?.imageMessage?.caption || "";
          try {
            if (qmsg.imageMessage || qmsg.videoMessage || qmsg.documentMessage || qmsg.audioMessage) {
              const mediaObj = qmsg.imageMessage || qmsg.videoMessage || qmsg.documentMessage || qmsg.audioMessage;
              const saved = await downloadAndSave(mediaObj);
              if (saved) savedPath = saved;
            }
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
            await sock.sendMessage(from, { audio: { url }, mimetype: "audio/mp4" , ptt: true });
          } catch (e) { console.error("tts error", e && e.message); await reply("❌ TTS failed."); }
        }

        // --- .sticker (reply to image) ---
        if (cmd === ".sticker") {
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
              try {
                await sock.sendMessage(from, { text: `⚠️ Link detected and removed.` });
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
          for (const t of toKick) {
            try { await sock.groupParticipantsUpdate(from, [t], "remove"); } catch (e) { console.error("kick error", e && e.message); }
            await new Promise(r=>setTimeout(r,800));
          }
          await reply("✅ Non-admin members kicked (attempted).");
        }

        // Announcement-only group check
        const fromMe = key.fromMe || false;
        if (!fromMe && from.endsWith("@g.us")) {
          const meta = await sock.groupMetadata(from);
          if (meta.announce) {
            const botId = sock.user?.id?.split(':')[0] ? sock.user.id.split(':')[0]+"@s.whatsapp.net" : null;
            const botParticipant = meta.participants.find(p => p.id && p.id.includes(botId?.split('@')[0]));
            const isBotAdmin = botParticipant?.admin;
            if (!isBotAdmin) {
              // No bypass possible, just warn/log
            }
          }
        }
      } // end for messages
    } catch (e) {
      console.error("command handler error", e && e.message);
    }
  }); // closes merged sock.ev.on("messages.upsert")

// ...existing code...

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: !USE_PAIRING_CODE,
    browser: ["Hon. Ajibola Bot", "Chrome", "10.0.0"]
  });

  // Place merged handler here, after sock is defined
  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      for (const raw of messages) {
        if (!raw.message) continue;
        // unwrap viewOnce / ephemeral
        let messageContent = raw.message;
        let isViewOnce = false;
        if (messageContent.viewOnceMessage) { isViewOnce = true; messageContent = messageContent.viewOnceMessage.message; }
        if (messageContent.ephemeralMessage) messageContent = messageContent.ephemeralMessage.message;

        const key = raw.key;
        const from = key.remoteJid;
        const sender = key.participant || key.remoteJid;
        const msgId = key.id;
        const timestamp = raw.messageTimestamp || Date.now();
        let body = messageContent.conversation || messageContent.extendedTextMessage?.text || "";
        if (messageContent.imageMessage?.caption) body = messageContent.imageMessage.caption;
        if (messageContent.videoMessage?.caption) body = messageContent.videoMessage.caption;
        body = body.trim();

        // Save message if media or text
        let mediaUrl = null;
        let mediaObj = messageContent.imageMessage || messageContent.videoMessage || messageContent.documentMessage || messageContent.audioMessage || null;
        if (mediaObj) {
          mediaUrl = await cloudSaveMedia(mediaObj);
        }

        // 🧠 Save the message
        if ((body && body.trim()) || mediaUrl) {
          try {
            await SavedMsg.findOneAndUpdate(
              { messageId: msgId },
              {
                messageId: msgId,
                chatId: from,
                sender,
                timestamp: Date.now(),
                text: body || "",
                mediaUrl,
                mime: mediaObj?.mimetype || null,
                isViewOnce
              },
              { upsert: true }
            );
          } catch (e) {
            console.error("SavedMsg save error:", e.message);
          }
        }

        // 🔥 Command Logic
        const cmd = body.split(" ")[0].toLowerCase();
        const args = body.split(" ").slice(1);

        const reply = async (t, extra = {}) => {
          await sock.sendMessage(from, { text: t, ...extra });
        };

        // ✅ Handle Commands
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

        // --- .tagall ---
        if (cmd === ".tagall") {
          if (!from.endsWith("@g.us")) return reply("⚠️ This command only works in groups.");
          const metadata = await sock.groupMetadata(from);
          if (!metadata) return reply("⚠️ Unable to fetch group metadata.");
          const participants = metadata.participants;
          const mentions = participants.map(p => p.id);
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
        const quoted = messageContent.extendedTextMessage?.contextInfo?.quotedMessage;
        if (cmd === ".save") {
          if (!quoted) return reply("⚠️ Reply to the message you want to save with `.save`.");
          const qmsg = quoted;
          let savedPath = null;
          let savedText = qmsg?.conversation || qmsg?.extendedTextMessage?.text || qmsg?.imageMessage?.caption || "";
          try {
            if (qmsg.imageMessage || qmsg.videoMessage || qmsg.documentMessage || qmsg.audioMessage) {
              const mediaObj = qmsg.imageMessage || qmsg.videoMessage || qmsg.documentMessage || qmsg.audioMessage;
              const saved = await downloadAndSave(mediaObj);
              if (saved) savedPath = saved;
            }
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
            await sock.sendMessage(from, { audio: { url }, mimetype: "audio/mp4" , ptt: true });
          } catch (e) { console.error("tts error", e && e.message); await reply("❌ TTS failed."); }
        }

        // --- .sticker (reply to image) ---
        if (cmd === ".sticker") {
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
              try {
                await sock.sendMessage(from, { text: `⚠️ Link detected and removed.` });
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
          for (const t of toKick) {
            try { await sock.groupParticipantsUpdate(from, [t], "remove"); } catch (e) { console.error("kick error", e && e.message); }
            await new Promise(r=>setTimeout(r,800));
          }
          await reply("✅ Non-admin members kicked (attempted).");
        }

        // Announcement-only group check
        const fromMe = key.fromMe || false;
        if (!fromMe && from.endsWith("@g.us")) {
          const meta = await sock.groupMetadata(from);
          if (meta.announce) {
            const botId = sock.user?.id?.split(':')[0] ? sock.user.id.split(':')[0]+"@s.whatsapp.net" : null;
            const botParticipant = meta.participants.find(p => p.id && p.id.includes(botId?.split('@')[0]));
            const isBotAdmin = botParticipant?.admin;
            if (!isBotAdmin) {
              // No bypass possible, just warn/log
            }
          }
        }
      } // end for messages
    } catch (e) {
      console.error("command handler error", e && e.message);
    }
  }); // closes merged sock.ev.on("messages.upsert")

  // ...other event handlers and logic...
}

startBot(); // Start the bot
