const axios = require("axios");
const cache = require("./redis.service");
const syslog = require("../../utils/syslog.util");
const AppError = require("../../utils/appError");

const BASE_URL = process.env.JIKAN_BASE_URL || "https://api.jikan.moe/v4";
const CACHE_TTL = Number(process.env.JIKAN_CACHE_TTL) || 86400;

// Jikan v4 limita a 3 req/s Y a 60 req/min. Los dos techos importan: espaciar
// 400 ms respeta el primero pero da 150 req/min, que es justo lo que devuelve
// 429 (y 504 desde Cloudflare cuando insiste). Por eso hay dos frenos.
const MIN_GAP_MS = 400;
const WINDOW_MS = 60_000;
const WINDOW_LIMIT = 50;

// Las respuestas se guardan mucho mas tiempo del que se consideran frescas:
// pasada la frescura se revalida, pero si el upstream falla se sirve la copia
// vieja en vez de romper la pagina.
const STALE_TTL = 7 * 86400;

const MAX_RETRIES = 2;
const BACKOFF_MS = 1500;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

// Solo el 429 pausa la salida entera: insistir mientras la IP esta castigada
// alarga el castigo. El 504 de Jikan es otra cosa (BadResponseException: no
// alcanza a MyAnimeList) y afecta a endpoints sueltos, asi que frenar todo por
// el seria dejar sin catalogo lo que si funciona.
const COOLDOWN_MS = 60_000;

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { Accept: "application/json" },
});

let chain = Promise.resolve();
let lastCallAt = 0;
let cooldownUntil = 0;
const window = [];

const cooling = () => Date.now() < cooldownUntil;

// El limite de Jikan es por IP, no por proceso: la API y los scripts de
// sincronizacion comparten cuota. Con un limitador en memoria cada proceso se
// cree solo y entre los dos se pasan del techo, que es exactamente el 429 que
// aparecia al sincronizar episodios con el servidor levantado. Este permiso se
// pide a Redis, que si ve a todos.
const WINDOW_KEY = 'zenkai:jikan:window';
const LAST_KEY = 'zenkai:jikan:last';
const COOL_KEY = 'zenkai:jikan:cooldown';
const SEQ_KEY = 'zenkai:jikan:seq';

// Devuelve 0 si se puede llamar (y reserva el hueco), o los ms que hay que
// esperar. Va en Lua para que comprobar y reservar sea atomico: si no, dos
// procesos leerian el mismo hueco libre y lo tomarian los dos.
const ACQUIRE = `
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local gap = tonumber(ARGV[4])

local cool = redis.call('PTTL', KEYS[3])
if cool > 0 then return cool end

redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - windowMs)

local last = tonumber(redis.call('GET', KEYS[2]) or '0')
local since = now - last
if since < gap then return gap - since end

if redis.call('ZCARD', KEYS[1]) >= limit then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local wait = (tonumber(oldest[2]) + windowMs) - now
  if wait < 1 then wait = 1 end
  return wait
end

local seq = redis.call('INCR', KEYS[4])
redis.call('ZADD', KEYS[1], now, now .. ':' .. seq)
redis.call('PEXPIRE', KEYS[1], windowMs)
redis.call('SET', KEYS[2], now, 'PX', windowMs)
return 0
`;

// Freno local, que sigue siendo la red de seguridad cuando Redis no responde.
const acquireLocal = async () => {
  const gap = Date.now() - lastCallAt;
  if (gap < MIN_GAP_MS) await wait(MIN_GAP_MS - gap);

  prune();
  while (window.length >= WINDOW_LIMIT) {
    await wait(Math.max(50, window[0] + WINDOW_MS - Date.now()));
    prune();
  }

  lastCallAt = Date.now();
  window.push(lastCallAt);
};

const acquire = async () => {
  for (;;) {
    let pause;

    try {
      pause = await cache.redis.eval(
        ACQUIRE, 4, WINDOW_KEY, LAST_KEY, COOL_KEY, SEQ_KEY,
        Date.now(), WINDOW_MS, WINDOW_LIMIT, MIN_GAP_MS
      );
    } catch {
      return acquireLocal();
    }

    if (!pause || pause <= 0) return;

    await wait(Math.min(Number(pause), 5000));
  }
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const prune = () => {
  const cutoff = Date.now() - WINDOW_MS;
  while (window.length && window[0] <= cutoff) window.shift();
};

// Cola serializada: por muchas peticiones simultaneas que entren, hacia Jikan
// sale una cada vez y siempre dentro de los dos limites.
const enqueue = (fn) => {
  const run = chain.then(async () => {
    if (cooling()) await wait(cooldownUntil - Date.now());

    await acquire();

    return fn();
  });

  // Se mantiene viva la cadena tras un rechazo para que un fallo no envenene
  // todo lo que quedo encolado detras.
  chain = run.then(() => undefined, () => undefined);
  return run;
};

// v2 en la clave: el valor cacheado ahora lleva marca de tiempo, y asi las
// entradas del formato anterior se ignoran en vez de leerse mal.
const cacheKey = (path, params) => {
  const query = new URLSearchParams(
    Object.entries(params ?? {})
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .sort(([a], [b]) => a.localeCompare(b))
  ).toString();

  return `zenkai:jikan:v2:${path}${query ? `?${query}` : ""}`;
};

// Reintenta lo que es transitorio (429 y 5xx) respetando Retry-After. Cada
// intento vuelve a pasar por la cola, para que los reintentos tambien cuenten
// contra la ventana del minuto.
const fetchWithRetry = async (path, params, attempt = 0, retries = MAX_RETRIES) => {
  try {
    return await enqueue(() => client.get(path, { params }));
  } catch (err) {
    const status = err.response?.status;

    const retryAfter = Number(err.response?.headers?.["retry-after"]);
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : BACKOFF_MS * 2 ** attempt;

    // El 429 no se reintenta: se abre el castigo y se sale ya. Reintentar
    // dentro de la cola la dejaria bloqueada el cooldown entero, y quien
    // esperaba detras habria recibido igual su copia vieja al instante.
    if (status === 429) {
      const pause = Math.max(delay, COOLDOWN_MS);
      cooldownUntil = Date.now() + pause;

      // Tambien en Redis: el castigo es de la IP, asi que si un proceso lo
      // provoca, los demas tienen que frenar con el.
      cache.redis.set(COOL_KEY, '1', 'PX', pause).catch(() => {});

      syslog.warn('JIKAN COOLDOWN', `paused for ${Math.round(pause / 1000)}s`);
      throw err;
    }

    const retryable = !status || RETRYABLE.has(status);
    if (!retryable || attempt >= retries) throw err;

    syslog.warn('JIKAN RETRY', `${path} (${status ?? 'network'}) in ${delay}ms`);
    await wait(delay);

    return fetchWithRetry(path, params, attempt + 1, retries);
  }
};

// Cache read-through con revalidacion: fresco se devuelve tal cual, vencido se
// intenta refrescar, y si Jikan falla se entrega la copia vieja.
const request = async (path, params = {}, ttl = CACHE_TTL, { retries = MAX_RETRIES } = {}) => {
  // ttl 0 = sin cache. Lo usa el backfill: son ~1.160 paginas que acaban en
  // Postgres de todas formas, y guardarlas ademas en Redis serian decenas de
  // MB que nadie va a volver a leer.
  if (ttl === 0) {
    const { data } = await fetchWithRetry(path, params, 0, retries);
    return data;
  }

  const key = cacheKey(path, params);

  const cached = await cache.get(key);
  if (cached?.at && Date.now() - cached.at < ttl * 1000) return cached.data;

  // En castigo no se encola nada: se sirve lo viejo si lo hay y si no se
  // responde ya, en vez de dejar peticiones esperando el minuto entero.
  if (cooling()) {
    if (cached?.data) return cached.data;
    throw new AppError("Jikan rate limit reached, try again shortly", 429);
  }

  try {
    const { data } = await fetchWithRetry(path, params, 0, retries);
    await cache.set(key, { at: Date.now(), data }, STALE_TTL);
    return data;
  } catch (err) {
    const status = err.response?.status;

    if (cached?.data) {
      syslog.warn('JIKAN STALE', `${path} served from cache (${status ?? 'network error'})`);
      return cached.data;
    }

    if (status === 404) throw new AppError("Resource not found on Jikan", 404);
    if (status === 429) throw new AppError("Jikan rate limit reached, try again shortly", 429);

    syslog.fail('Jikan', `${path}: ${err.message}`);
    throw new AppError("Jikan is unavailable right now", 503);
  }
};

// Jikan se quedo reducido a lo que la API oficial de MyAnimeList no expone:
// las listas de episodios (su endpoint responde 403) y los personajes (ignora
// el campo). Todo lo demas — catalogo, fichas, metricas, recomendaciones — sale
// ya de la oficial, que es mas rapida y no depende de un scraper.
const episodes = (malId, page = 1) => request(`/anime/${malId}/episodes`, { page }, 43200);

const characters = (malId) => request(`/anime/${malId}/characters`, {}, CACHE_TTL, { retries: 0 });

// Jikan envuelve los recursos sueltos en `data` y las listas en
// `{ data, pagination }`. Los controllers solo quieren el contenido, asi que
// se desenvuelve en un unico sitio.
const unwrap = (payload) => payload?.data ?? payload;

const paginationOf = (payload) => payload?.pagination ?? null;

module.exports = { request, episodes, characters, unwrap, paginationOf };
