const crypto = require("crypto");
const { Server } = require("socket.io");
const { cors: corsConfig } = require("../../cors/config");
const Accounts = require("../../models/accounts.models");
const { verifyJWT } = require("../../utils/jwt");
const { ACCESS_COOKIE } = require("./auth.service");
const syslog = require("../../utils/syslog.util");

// Ver juntos (watch party): salas en memoria sincronizadas por WebSocket.
//
// Cada usuario reproduce su propio stream; aqui solo viaja el ESTADO de la sala (play/pausa/posicion)
// y el chat. El servidor guarda la posicion y el instante en que era valida, de modo que quien entra
// despues calcula donde deberia ir (position + tiempo transcurrido si esta reproduciendo).
//
// Las salas viven en memoria de UNA instancia de la API: si hubiera varias, habria que anadir el
// adaptador de Redis de socket.io y mover el estado a Redis. Una sala se pierde al reiniciar el servidor.
//
// Eventos (el cliente siempre recibe un ack { ok, ... }):
//   party:create   { malId, number }          crea una sala y entra como anfitrion
//   party:join     { code }                   entra (o vuelve a pedir la foto de la sala)
//   party:leave                                sale
//   party:time                                 hora del servidor, para que el cliente compense su reloj
//   party:control  { type, position }          play | pause | seek de cualquier miembro
//   party:episode  { malId, number }           solo el anfitrion: cambia de episodio para todos
//   party:chat     { text }                    mensaje de chat
// El servidor emite: party:state, party:episode, party:members, party:chat, party:closed.

const MAX_MEMBERS = 50;
const MAX_CHAT = 300;
const KEEP_CHAT = 50;
const MEMBER_GRACE_MS = 10 * 1000;      // recargar la pagina no debe sacar a nadie de la sala
const EMPTY_ROOM_MS = 2 * 60 * 1000;
const CHAT_GAP_MS = 400;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // sin 0/O/1/I: se dicta y se copia mejor

const rooms = new Map();

const newCode = () => {
  for (;;) {
    const code = Array.from(crypto.randomBytes(6), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
    if (!rooms.has(code)) return code;
  }
};

const isId = (value) => Number.isInteger(value) && value >= 0 && value < 1e9;

const snapshot = (room) => ({
  code: room.code,
  malId: room.malId,
  number: room.number,
  hostId: room.hostId,
  members: [...room.members.values()].map((member) => ({ id: member.id, username: member.username })),
  playing: room.playing,
  position: room.position,
  at: room.at,
  serverTime: Date.now(),
  chat: room.chat,
});

const membersOf = (room) => ({
  hostId: room.hostId,
  members: [...room.members.values()].map((member) => ({ id: member.id, username: member.username })),
});

const say = (io, room, text) => {
  const message = { id: crypto.randomUUID(), system: true, text, at: Date.now() };
  room.chat = [...room.chat, message].slice(-KEEP_CHAT);
  io.to(room.code).emit("party:chat", message);
};

const scheduleRemoval = (room) => {
  clearTimeout(room.timer);

  if (room.members.size) return;

  room.timer = setTimeout(() => rooms.delete(room.code), EMPTY_ROOM_MS);
};

// Quita al miembro (todas sus pestanas) de la sala. Si era el anfitrion, el miembro mas antiguo pasa a serlo.
const drop = (io, room, member) => {
  if (!room.members.delete(member.id)) return;

  if (room.hostId === member.id) room.hostId = [...room.members.keys()][0] ?? null;

  say(io, room, `${member.username} salió de la sala`);
  io.to(room.code).emit("party:members", membersOf(room));
  scheduleRemoval(room);
};

const cookieOf = (header = "", name) => {
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
  }

  return null;
};

const attach = (server) => {
  const io = new Server(server, {
    serveClient: false,
    cors: corsConfig,
    // La sesion viaja en una cookie: sin comprobar el origen, cualquier web podria abrir un WebSocket
    // con la sesion del usuario (CSWSH). El CORS de socket.io solo cubre el sondeo HTTP, no el WebSocket.
    allowRequest: (req, callback) => corsConfig.origin(req.headers.origin, (err, ok) => callback(null, !err && Boolean(ok))),
  });

  io.use(async (socket, next) => {
    try {
      const token = cookieOf(socket.handshake.headers.cookie, ACCESS_COOKIE);
      if (!token) return next(new Error("unauthorized"));

      const { id } = verifyJWT(token);
      const account = await Accounts.Account.findByPk(id, { attributes: ["id", "username", "status"] });

      if (!account || account.status === "banned") return next(new Error("unauthorized"));

      socket.data.user = { id: account.id, username: account.username };
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const { user } = socket.data;
    let room = null;
    let lastChat = 0;

    const reply = (ack, payload) => typeof ack === "function" && ack(payload);

    const enter = (target) => {
      const known = target.members.get(user.id);

      if (!known && target.members.size >= MAX_MEMBERS) return false;

      clearTimeout(target.timer);

      const member = known ?? { id: user.id, username: user.username, sockets: new Set(), timer: null };
      clearTimeout(member.timer);
      member.sockets.add(socket.id);
      target.members.set(user.id, member);

      socket.join(target.code);
      room = target;

      if (!known) {
        target.hostId ??= user.id;
        say(io, target, `${user.username} se unió a la sala`);
        socket.to(target.code).emit("party:members", membersOf(target));
      }

      return true;
    };

    const leave = (immediately) => {
      if (!room) return;

      const current = room;
      const member = current.members.get(user.id);

      room = null;
      socket.leave(current.code);

      if (!member) return;

      member.sockets.delete(socket.id);

      if (member.sockets.size) return;

      if (immediately) return drop(io, current, member);

      member.timer = setTimeout(() => {
        if (!member.sockets.size) drop(io, current, member);
      }, MEMBER_GRACE_MS);
    };

    // El ack es siempre el ultimo argumento, lleve o no datos el evento.
    socket.on("party:time", (...args) => reply(args.at(-1), { serverTime: Date.now() }));

    socket.on("party:create", (data, ack) => {
      if (!isId(data?.malId) || !isId(data?.number)) return reply(ack, { ok: false, error: "Episodio no válido" });

      leave(true);

      const created = {
        code: newCode(), malId: data.malId, number: data.number, hostId: user.id,
        members: new Map(), playing: false, position: 0, at: Date.now(), chat: [], timer: null,
      };

      rooms.set(created.code, created);
      enter(created);

      reply(ack, { ok: true, you: user.id, room: snapshot(created) });
    });

    socket.on("party:join", (data, ack) => {
      const target = rooms.get(String(data?.code ?? "").toUpperCase());

      if (!target) return reply(ack, { ok: false, error: "La sala no existe o ya se cerró" });

      if (room && room !== target) leave(true);

      if (!enter(target)) return reply(ack, { ok: false, error: "La sala está llena" });

      reply(ack, { ok: true, you: user.id, room: snapshot(target) });
    });

    socket.on("party:leave", (...args) => { leave(true); reply(args.at(-1), { ok: true }); });

    socket.on("party:control", (data, ack) => {
      if (!room) return reply(ack, { ok: false });

      const position = Number(data?.position);

      if (!["play", "pause", "seek"].includes(data?.type) || !Number.isFinite(position) || position < 0 || position > 86400) {
        return reply(ack, { ok: false });
      }

      // seek no cambia si esta reproduciendo; play/pause si.
      if (data.type !== "seek") room.playing = data.type === "play";

      room.position = position;
      room.at = Date.now();

      socket.to(room.code).emit("party:state", {
        type: data.type, playing: room.playing, position: room.position, at: room.at, by: user.username,
      });

      reply(ack, { ok: true });
    });

    socket.on("party:episode", (data, ack) => {
      if (!room || room.hostId !== user.id) return reply(ack, { ok: false, error: "Solo el anfitrión cambia de episodio" });
      if (!isId(data?.malId) || !isId(data?.number)) return reply(ack, { ok: false, error: "Episodio no válido" });

      Object.assign(room, { malId: data.malId, number: data.number, playing: false, position: 0, at: Date.now() });

      socket.to(room.code).emit("party:episode", { malId: room.malId, number: room.number });
      reply(ack, { ok: true });
    });

    socket.on("party:chat", (data, ack) => {
      if (!room) return reply(ack, { ok: false });

      const text = typeof data?.text === "string" ? data.text.trim().slice(0, MAX_CHAT) : "";

      if (!text || Date.now() - lastChat < CHAT_GAP_MS) return reply(ack, { ok: false });

      lastChat = Date.now();

      const message = { id: crypto.randomUUID(), userId: user.id, username: user.username, text, at: Date.now() };
      room.chat = [...room.chat, message].slice(-KEEP_CHAT);

      io.to(room.code).emit("party:chat", message);
      reply(ack, { ok: true });
    });

    socket.on("disconnect", () => leave(false));
  });

  syslog.ok("WATCH PARTY", "READY");

  return io;
};

module.exports = { attach, rooms };
