const path = require("path");
const http = require("http");
const express = require("express");
const helmet = require("helmet");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e6,
  pingInterval: 25000,
  pingTimeout: 20000
});

app.disable("x-powered-by");
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.socket.io"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      upgradeInsecureRequests: null
    }
  }
}));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "watchtogether" }));
app.get("/runtime-config.js", (_req, res) => {
  let iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ];
  if (process.env.ICE_SERVERS_JSON) {
    try {
      const configured = JSON.parse(process.env.ICE_SERVERS_JSON);
      if (Array.isArray(configured) && configured.length) iceServers = configured;
    } catch {
      console.warn("ICE_SERVERS_JSON is not valid JSON; using public STUN defaults.");
    }
  }
  res.type("application/javascript").send(\`window.WT_CONFIG = \${JSON.stringify({ iceServers })};\`);
});

const rooms = new Map();
const ROOM_RE = /^[a-z0-9]{6,12}$/;
const NAME_MAX = 24;
const CHAT_MAX = 500;

function cleanName(value) {
  return String(value || "").trim().replace(/[<>]/g, "").slice(0, NAME_MAX) || "Guest";
}
function roomSummary(room) {
  return [...room.members.values()].map(({ id, name }) => ({ id, name }));
}
function emitRoom(roomCode, event, payload, exceptId) {
  for (const id of rooms.get(roomCode)?.members.keys() || []) {
    if (id !== exceptId) io.to(id).emit(event, payload);
  }
}

io.on("connection", (socket) => {
  let joinedRoom = null;
  let displayName = "Guest";
  let lastChatAt = 0;

  socket.on("join-room", (payload = {}, ack = () => {}) => {
    if (joinedRoom) return ack({ ok: false, error: "You are already in a room." });
    const code = String(payload.code || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!ROOM_RE.test(code)) return ack({ ok: false, error: "Room codes must be 6–12 letters or numbers." });

    let room = rooms.get(code);
    if (!room) {
      room = { members: new Map(), playback: null };
      rooms.set(code, room);
    }
    if (room.members.size >= 2) return ack({ ok: false, error: "This room already has two people." });

    displayName = cleanName(payload.name);
    joinedRoom = code;
    room.members.set(socket.id, { id: socket.id, name: displayName });
    socket.join(code);

    ack({ ok: true, code, selfId: socket.id, members: roomSummary(room), playback: room.playback });
    socket.to(code).emit("peer-joined", { id: socket.id, name: displayName });
    io.to(code).emit("room-members", roomSummary(room));
  });

  socket.on("chat-message", (payload = {}) => {
    if (!joinedRoom) return;
    const now = Date.now();
    if (now - lastChatAt < 250) return;
    lastChatAt = now;
    const message = String(payload.text || "").trim().slice(0, CHAT_MAX);
    if (!message) return;
    io.to(joinedRoom).emit("chat-message", {
      id: \`\${socket.id}-\${now}\`,
      name: displayName,
      text: message,
      at: now,
      senderId: socket.id
    });
  });

  socket.on("request-playback", () => {
    if (!joinedRoom) return;
    const room = rooms.get(joinedRoom);
    if (room?.playback) socket.emit("playback-state", room.playback);
  });

  socket.on("playback", (payload = {}) => {
    if (!joinedRoom) return;
    const time = Number(payload.time);
    if (!Number.isFinite(time) || time < 0) return;
    const state = {
      time: Math.min(time, 24 * 60 * 60),
      paused: Boolean(payload.paused),
      sentAt: Date.now(),
      file: payload.file && typeof payload.file === "object" ? {
        name: String(payload.file.name || "").slice(0, 180),
        size: Math.max(0, Number(payload.file.size) || 0)
      } : null,
      senderId: socket.id
    };
    const room = rooms.get(joinedRoom);
    if (room) room.playback = state;
    socket.to(joinedRoom).emit("playback-update", state);
  });

  socket.on("rtc-signal", (payload = {}) => {
    if (!joinedRoom || !payload.to || payload.to === socket.id) return;
    const room = rooms.get(joinedRoom);
    if (!room || !room.members.has(payload.to)) return;
    io.to(payload.to).emit("rtc-signal", {
      from: socket.id,
      description: payload.description || null,
      candidate: payload.candidate || null
    });
  });

  socket.on("disconnect", () => {
    if (!joinedRoom) return;
    const room = rooms.get(joinedRoom);
    if (!room) return;
    room.members.delete(socket.id);
    socket.to(joinedRoom).emit("peer-left", { id: socket.id });
    if (room.members.size === 0) rooms.delete(joinedRoom);
    else io.to(joinedRoom).emit("room-members", roomSummary(room));
  });
});

const port = Number(process.env.PORT) || 10000;
server.listen(port, "0.0.0.0", () => {
  console.log(\`WatchTogether listening on \${port}\`);
});