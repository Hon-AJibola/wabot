const socket = io(); // assumes socket.io.js is included in HTML

const phoneInput = document.getElementById("phone");
phoneInput.addEventListener("input", () => {
  socket.emit("updatePhone", { phone: phoneInput.value });
});
