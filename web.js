import express from "express";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.use(express.json());

app.get("/", (req, res) => {
  res.sendFile(new URL("./public/index.html", import.meta.url).pathname);
});

io.on("connection", (socket) => {
  console.log("Client connected via web");
  
  // When the web client sends phone info
  socket.on("loginRequest", async ({ phone, method }) => {
    // send event to bot script to start login
    io.emit("botEvent", { msg: `Trying to log in ${phone} using ${method}` });
    
    // Later the bot can emit QR or pairing code events
    // e.g., io.emit("botEvent", { qr: qrString }) or { code: "123456" }
  });
});

server.listen(process.env.WEB_PORT || 3000, () => {
  console.log(`🌐 Web interface running on http://localhost:${process.env.WEB_PORT || 3000}`);
});
