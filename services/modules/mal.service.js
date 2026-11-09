const axios = require("axios");
const syslog = require("../../utils/syslog.util");
const AppError = require("../../utils/appError");

const BASE_URL = process.env.MAL_BASE_URL || "https://api.myanimelist.net/v2";

// La API oficial no publica un techo concreto. 500 ms entre llamadas es de
// sobra educado y, con 500 entradas por peticion, recorre el catalogo entero
// en poco mas de un minuto.
const MIN_GAP_MS = 500;
const PAGE_SIZE = 500;
const MAX_RETRIES = 2;
const BACKOFF_MS = 2000;

// Todo lo que necesita nuestro mapper. Sin `fields` la API solo devuelve
// id, titulo e imagen.
const FIELDS = [
  "id", "title", "main_picture", "alternative_titles", "start_date", "end_date",
  "synopsis", "mean", "rank", "popularity", "num_list_users", "num_scoring_users",
  "media_type", "status", "genres", "num_episodes", "start_season", "broadcast",
  "source", "average_episode_duration", "rating", "studios",
].join(",");

// Solo para la ficha: son pesados y no tienen sentido pedirlos por cada una de
// las 500 entradas de una tanda del backfill.
const DETAIL_FIELDS = [FIELDS, "recommendations", "related_anime", "statistics"].join(",");

const client = axios.create({
  timeout: 20000,
  headers: { Accept: "application/json" },
});

// La baseURL se resuelve en cada peticion y no al crear el cliente, para que
// valga un override por entorno aunque llegue despues de cargar el modulo.
const baseUrl = () => process.env.MAL_BASE_URL || BASE_URL;

const configured = () => Boolean(process.env.MAL_CLIENT_ID);

let chain = Promise.resolve();
let lastCallAt = 0;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const enqueue = (fn) => {
  const run = chain.then(async () => {
    const gap = Date.now() - lastCallAt;
    if (gap < MIN_GAP_MS) await wait(MIN_GAP_MS - gap);

    lastCallAt = Date.now();
    return fn();
  });

  chain = run.then(() => undefined, () => undefined);
  return run;
};

const request = async (path, params = {}, attempt = 0, fields = FIELDS) => {
  if (!configured()) {
    throw new AppError("MAL_CLIENT_ID is not set", 503);
  }

  try {
    const { data } = await enqueue(() => client.get(`${baseUrl()}${path}`, {
      params: { ...params, fields },
      headers: { "X-MAL-CLIENT-ID": process.env.MAL_CLIENT_ID },
    }));

    return data;
  } catch (err) {
    const status = err.response?.status;

    // 400 con "Invalid client id" no se reintenta: no va a arreglarse solo.
    if (status === 400 || status === 401 || status === 403) {
      const detail = err.response?.data?.error ?? err.message;
      throw new AppError(`MAL API rejected the request (${detail})`, 401);
    }

    if (attempt < MAX_RETRIES) {
      await wait(BACKOFF_MS * 2 ** attempt);
      return request(path, params, attempt + 1, fields);
    }

    syslog.fail('MAL', `${path}: ${err.message}`);
    throw new AppError("MyAnimeList API is unavailable right now", 503);
  }
};

// El ranking global es la unica via para enumerar el catalogo entero: `/anime`
// exige un termino de busqueda. `ranking_type=all` los recorre todos.
const ranking = async ({ offset = 0, limit = PAGE_SIZE, type = 'all' } = {}) => {
  const data = await request("/anime/ranking", { ranking_type: type, limit, offset });

  return {
    items: (data.data ?? []).map((entry) => entry.node),
    hasNext: Boolean(data.paging?.next),
  };
};

const season = async ({ year, season: name, offset = 0, limit = PAGE_SIZE }) => {
  const data = await request(`/anime/season/${year}/${name}`, { limit, offset });

  return {
    items: (data.data ?? []).map((entry) => entry.node),
    hasNext: Boolean(data.paging?.next),
  };
};

const anime = async (malId) => await request(`/anime/${malId}`, {}, 0, DETAIL_FIELDS);

// Recomendaciones y relacionados salen de la misma peticion que la ficha, asi
// que se extraen de ahi en vez de gastar llamadas aparte.
const recommendations = (detail) =>
  (detail?.recommendations ?? []).map((entry) => entry.node);

const related = (detail) =>
  (detail?.related_anime ?? []).map((entry) => ({
    ...entry.node,
    relation: entry.relation_type_formatted ?? entry.relation_type,
  }));

module.exports = {
  configured, request, ranking, season, anime, recommendations, related,
  PAGE_SIZE, FIELDS, DETAIL_FIELDS,
};
