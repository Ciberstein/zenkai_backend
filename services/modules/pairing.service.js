const crypto = require("crypto");
const { redis } = require("./redis.service");

// Vincular una TV sin teclado (flujo "device code"):
//   1. La TV pide un par { code, secret }. `code` es corto y se muestra (y va en el QR);
//      `secret` solo lo conoce la TV y es con lo que consulta el estado.
//   2. El usuario abre el codigo en su celular, ya con sesion, y lo autoriza.
//   3. La TV consulta con su `secret`; cuando esta autorizado recibe la sesion, una sola vez.
// Todo vive en Redis con caducidad: no hay nada que limpiar. Del secreto solo se guarda su huella.

const TTL = 5 * 60;
// Sin caracteres que se confunden al leerlos (0/O, 1/I/L).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LENGTH = 8;

const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const byCode = (code) => `pair:code:${code}`;
const bySecret = (secret) => `pair:secret:${sha(secret)}`;

const normalize = (code) => String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const randomCode = () =>
  Array.from({ length: LENGTH }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");

const create = async () => {
  const secret = crypto.randomBytes(32).toString("hex");

  // Un codigo ya en uso es casi imposible (31^8), pero se reintenta por si acaso.
  for (let i = 0; i < 5; i++) {
    const code = randomCode();
    const ok = await redis.set(byCode(code), sha(secret), "EX", TTL, "NX");

    if (ok) {
      await redis.set(bySecret(secret), JSON.stringify({ code, status: "pending" }), "EX", TTL);
      return { code, secret, expiresIn: TTL };
    }
  }

  throw new Error("could not allocate a pairing code");
};

// Marca el codigo como autorizado por una cuenta. Devuelve false si no existe o ya caduco.
const approve = async (rawCode, accountId) => {
  const code = normalize(rawCode);
  if (code.length !== LENGTH) return false;

  const hash = await redis.get(byCode(code));
  if (!hash) return false;

  const key = `pair:secret:${hash}`;
  const raw = await redis.get(key);
  if (!raw) return false;

  const data = JSON.parse(raw);
  if (data.status !== "pending") return false;

  const ttl = await redis.ttl(key);
  await redis.set(key, JSON.stringify({ ...data, status: "approved", accountId }), "EX", Math.max(ttl, 1));

  return true;
};

// Estado para la TV: { status: "pending" | "expired" } o { status: "approved", accountId } la
// primera vez (despues el codigo desaparece).
const poll = async (secret) => {
  if (typeof secret !== "string" || secret.length !== 64) return { status: "expired" };

  const key = bySecret(secret);
  const raw = await redis.get(key);
  if (!raw) return { status: "expired" };

  const data = JSON.parse(raw);
  if (data.status !== "approved") return { status: "pending" };

  // `del` devuelve 1 solo al primero que llega: dos consultas a la vez no abren dos sesiones.
  const removed = await redis.del(key);
  if (!removed) return { status: "expired" };
  await redis.del(byCode(data.code));

  return { status: "approved", accountId: data.accountId };
};

module.exports = { create, approve, poll, normalize, TTL, LENGTH };
