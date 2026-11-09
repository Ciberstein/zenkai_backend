const crypto = require('crypto');
const Redis = require('ioredis');
const syslog = require('../../utils/syslog.util');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

try {
  const u = new URL(REDIS_URL);
  syslog.ok('REDIS TARGET', `${u.protocol}//${u.hostname}:${u.port || 6379}`);
} catch (_) {
  syslog.warn('REDIS TARGET', 'UNPARSEABLE URL');
}

// Hosted Redis services (Upstash, Redis Cloud, etc.) restrict the INFO
// command via ACLs, which ioredis runs by default during its ready check.
// Disabling the check avoids the noisy NOPERM warning without changing
// behaviour - the connection is still established the same way.
// `enableOfflineQueue: false` + `commandTimeout` son lo que hace que un Redis
// caido degrade en vez de colgar: sin ellos ioredis encola los comandos hasta
// reconectar y cada peticion del catalogo se queda esperando para siempre.
// Asi el GET falla al instante, se trata como cache miss y se va a Jikan.
const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
  enableOfflineQueue: false,
  commandTimeout: 1000,
  lazyConnect: false,
});

// Throttle the noisy reconnect-error logs to one message per minute so a
// misconfigured/missing Redis does not drown the console.
const logErrorThrottled = (label) => {
  let lastAt = 0;
  return (err) => {
    const now = Date.now();
    if (now - lastAt < 60_000) return;
    lastAt = now;
    syslog.error('REDIS ERROR', `[${label}] ${err.code || err.message || err}`);
  };
};

redis.on('error', logErrorThrottled('redis'));
redis.on('ready', () => syslog.ok('REDIS STATUS', 'CONNECTED'));

const get = async (key) => {
  try {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    // A cache miss and a dead Redis must behave identically: the caller
    // falls through to the upstream request instead of failing the response.
    return null;
  }
};

const set = async (key, value, ttl) => {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttl);
  } catch { /* cache writes are best-effort */ }
};

const del = async (pattern) => {
  try {
    if (!pattern.includes('*')) return await redis.del(pattern);

    // SCAN instead of KEYS: never blocks the Redis event loop, which matters
    // once the anime cache holds tens of thousands of keys.
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length) await redis.del(keys);
    } while (cursor !== '0');
  } catch { /* noop */ }
};

// Bloqueo entre procesos para los trabajos programados: si hay dos instancias de
// la API, solo una ejecuta cada tarea. El token evita que una instancia libere
// un bloqueo que ya expiro y tomo otra. Si Redis no responde devuelve
// 'unavailable' y quien llama cae al control en memoria, en vez de dejar de
// ejecutar los trabajos por una cache caida.
const RELEASE = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

const acquire = async (name, ttlSeconds) => {
  const token = crypto.randomUUID();

  try {
    const result = await redis.set(`lock:${name}`, token, 'EX', ttlSeconds, 'NX');
    return result === 'OK' ? token : null;
  } catch {
    return 'unavailable';
  }
};

const release = async (name, token) => {
  if (!token || token === 'unavailable') return;

  try {
    await redis.eval(RELEASE, 1, `lock:${name}`, token);
  } catch { /* el TTL lo libera igualmente */ }
};

// Si alguien tiene el bloqueo ahora mismo. Con Redis caido responde false: sin
// forma de saberlo, se asume que nadie lo tiene.
const isLocked = async (name) => {
  try {
    return (await redis.exists(`lock:${name}`)) === 1;
  } catch {
    return false;
  }
};

module.exports = { redis, get, set, del, acquire, release, isLocked };
