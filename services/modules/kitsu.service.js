const axios = require("axios");

// Respaldo para las listas de episodios cuando Jikan no responde. Kitsu publica
// numero, titulo y fecha de emision de cada episodio y mapea cada titulo con su
// id de MyAnimeList, asi que se cruza sin tocar nuestro catalogo.
//
// No trae las marcas de relleno ni de recap que si da Jikan, y pagina de 20 en
// 20 (una serie larga cuesta varias peticiones): por eso es respaldo y no la
// fuente principal.

const PAGE_SIZE = 20;
const MAX_PAGES = 200;
const MIN_GAP_MS = 250;

const client = axios.create({
  baseURL: process.env.KITSU_BASE_URL || "https://kitsu.io/api/edge",
  timeout: 15000,
  headers: { Accept: "application/vnd.api+json" },
});

// Una peticion cada vez y con un hueco minimo: Kitsu no publica un limite, asi
// que se va con cuidado en lugar de lanzar en rafaga.
let chain = Promise.resolve();
let lastCallAt = 0;

const get = (path, params) => {
  const run = chain.then(async () => {
    const wait = lastCallAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

    try {
      return await client.get(path, { params });
    } finally {
      lastCallAt = Date.now();
    }
  });

  chain = run.then(() => undefined, () => undefined);
  return run;
};

const kitsuIdOf = async (malId) => {
  const { data } = await get("/mappings", {
    "filter[externalSite]": "myanimelist/anime",
    "filter[externalId]": malId,
    include: "item",
    "fields[anime]": "canonicalTitle",
  });

  return data?.included?.find((item) => item.type === "anime")?.id ?? null;
};

// Lista de episodios de un titulo de MAL, ya normalizada: [{ number, title, aired }].
// Vacia si Kitsu no conoce el titulo. `offset` permite retomar una serie larga
// sin releer lo que ya se tiene.
const episodes = async (malId, { offset = 0 } = {}) => {
  const id = await kitsuIdOf(malId);
  if (!id) return [];

  const list = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data } = await get(`/anime/${id}/episodes`, {
      "page[limit]": PAGE_SIZE,
      "page[offset]": offset + page * PAGE_SIZE,
      sort: "number",
      "fields[episodes]": "number,canonicalTitle,titles,airdate",
    });

    const rows = data?.data ?? [];

    for (const row of rows) {
      const { number, canonicalTitle, titles, airdate } = row.attributes ?? {};
      if (!Number.isInteger(number)) continue;

      list.push({
        number,
        title: canonicalTitle ?? titles?.en ?? null,
        aired: airdate ?? null,
      });
    }

    if (rows.length < PAGE_SIZE) break;
  }

  return list;
};

// Miniaturas de los episodios de un titulo de MAL: [{ number, thumbnail }]. Solo los que tienen.
const thumbnails = async (malId) => {
  const id = await kitsuIdOf(malId);
  if (!id) return [];

  const list = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data } = await get(`/anime/${id}/episodes`, {
      "page[limit]": PAGE_SIZE,
      "page[offset]": page * PAGE_SIZE,
      sort: "number",
      "fields[episodes]": "number,thumbnail",
    });

    const rows = data?.data ?? [];

    for (const row of rows) {
      const { number, thumbnail } = row.attributes ?? {};
      const url = thumbnail?.large ?? thumbnail?.original ?? thumbnail?.medium ?? null;

      if (Number.isInteger(number) && url) list.push({ number, thumbnail: url });
    }

    if (rows.length < PAGE_SIZE) break;
  }

  return list;
};

module.exports = { episodes, thumbnails };
