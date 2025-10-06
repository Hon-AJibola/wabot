import express from "express";
import http from "http";
import { Server } from "socket.io";
import fs from "fs";
import path from "path";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public")); // serve your HTML/CSS/JS frontend

io.on("connection", (socket) => {
  console.log("🌐 Website connected");

  // Save phone number dynamically
  socket.on("updatePhone", ({ phone }) => {
    const envPath = path.resolve("./.env");
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";

    if (envContent.includes("PHONE_NUMBER=")) {
      envContent = envContent.replace(/PHONE_NUMBER=.*/, `PHONE_NUMBER=${phone}`);
    } else {
      envContent += `\nPHONE_NUMBER=${phone}`;
    }

    fs.writeFileSync(envPath, envContent, "utf-8");
    console.log("✅ Updated PHONE_NUMBER in .env:", phone);
  });

  // Listen for login requests from the website
  socket.on("loginRequest", ({ phone, method }) => {
    // Emit event to your bot logic (we’ll handle in index.js)
    io.emit("botLoginRequest", { phone, method });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
