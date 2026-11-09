const Anime = require("../../models/anime.models");
const { db } = require("../../database/config");
const jikan = require("./jikan.service");
const mal = require("./mal.service");
const AppError = require("../../utils/appError");
const syslog = require("../../utils/syslog.util");
const { episodesFromJikan, fromMal, genresFromMal } = require("../../utils/anime.util");

const BACKFILL_JOB = "catalog:backfill";
const PAGE_SIZE = 25;

// Campos que un resync sobrescribe. Se listan explicitamente para no pisar lo
// que gestiona el panel (featured, visible) ni el banner subido a mano.
const UPDATABLE = [
  "title", "titleEnglish", "titleJapanese", "slug", "synopsis", "type", "status",
  "episodesCount", "duration", "rating", "score", "season", "year", "image",
  "trailer", "studios", "rank", "popularity", "members", "favoritesCount",
  "scoredBy", "airedFrom", "airedTo", "broadcastDay", "origin", "titles", "syncedAt",
];

// El catalogo se replica desde la API oficial de MyAnimeList y punto. Hubo dos
// fuentes de Jikan (`/anime` y `/top/anime`) como respaldo, pero se quitaron: la
// oficial trae 500 entradas por peticion en vez de 25, y el respaldo no valia
// para nada — cuando Jikan falla es porque no alcanza a MAL, o sea que si la
// oficial esta caida el respaldo tambien lo esta. Jikan se queda unicamente
// para los episodios, que la API oficial no expone.
const SOURCES = {
  mal: {
    key: 'mal',
    label: 'api.myanimelist.net (oficial)',
    job: `${BACKFILL_JOB}:mal`,
    available: () => mal.configured(),
    fetch: async (page) => {
      const { items, hasNext } = await mal.ranking({ offset: (page - 1) * mal.PAGE_SIZE });
      return { items, pagination: { has_next_page: hasNext } };
    },
    map: fromMal,
    genresOf: genresFromMal,
  },
};

const state = async (job) => {
  const [row] = await Anime.SyncState.findOrCreate({ where: { job }, defaults: { cursor: 1 } });
  return row;
};

// Los generos llegan repetidos en cada pagina: se acumulan en memoria y se
// insertan de una vez, en vez de un INSERT por titulo.
const persistGenres = async (items, source = SOURCES.mal) => {
  const seen = new Map();

  for (const item of items) {
    for (const genre of source.genresOf(item)) {
      if (!seen.has(genre.malId)) seen.set(genre.malId, genre);
    }
  }

  if (!seen.size) return new Map();

  await Anime.Genre.bulkCreate([...seen.values()], { ignoreDuplicates: true });

  const rows = await Anime.Genre.findAll({ where: { malId: [...seen.keys()] } });
  return new Map(rows.map((row) => [row.malId, row.id]));
};

// Un lote = una pagina de la fuente. Se escribe con bulkCreate +
// updateOnDuplicate (un solo INSERT ... ON CONFLICT DO UPDATE) porque hacerlo
// fila a fila multiplicaria por 500 los viajes a la base en cada tanda.
const persistPage = async (items, source = SOURCES.mal) => {
  // Se mapea una sola vez y se conserva el original al lado, que es de donde
  // salen los generos.
  const mapped = items
    .map((item) => ({ item, row: source.map(item) }))
    .filter(({ row }) => row.malId && row.title);

  if (!mapped.length) return 0;

  // Dos entradas de MAL pueden compartir titulo (y por tanto slug); el mal_id
  // del sufijo los separa, pero un remake con el mismo nombre podria colisionar,
  // asi que se deduplica antes de escribir.
  const bySlug = new Map(mapped.map(({ row }) => [row.slug, row]));

  await Anime.Anime.bulkCreate([...bySlug.values()], { updateOnDuplicate: UPDATABLE });

  const stored = await Anime.Anime.findAll({
    where: { malId: mapped.map(({ row }) => row.malId) },
    attributes: ["id", "malId"],
  });

  const idByMal = new Map(stored.map((row) => [row.malId, row.id]));
  const genreIds = await persistGenres(items, source);

  const links = [];
  for (const { item, row } of mapped) {
    const animeId = idByMal.get(row.malId);
    if (!animeId) continue;

    for (const genre of source.genresOf(item)) {
      const genreId = genreIds.get(genre.malId);
      if (genreId) links.push({ animeId, genreId });
    }
  }

  if (links.length) await Anime.AnimeGenre.bulkCreate(links, { ignoreDuplicates: true });

  return mapped.length;
};

// Una pagina del catalogo. Se aisla para poder pedirla igual en el barrido
// secuencial que en la repesca de las que fallaron.
const fetchPage = (page, source) => source.fetch(page);

// Elige la fuente viva. Se prueba la canonica y, si no responde, se tira de la
// alternativa en vez de no traer nada.
// Orden de preferencia: la oficial primero si hay credencial, y el scraper
// como respaldo. Se prueba pidiendo la primera pagina de verdad.
const pickSource = async () => {
  const source = SOURCES.mal;

  return source.available() ? source : null;
};

// Cortamos si fallan muchas seguidas: eso ya no es intermitencia, es que
// MyAnimeList esta caido del todo y seguir insistiendo no aporta nada.
const MAX_CONSECUTIVE_FAILURES = 15;

// Jikan pagina las listas de episodios de 100 en 100.
const EPISODES_PER_PAGE = 100;

// Backfill completo del catalogo de MAL, pagina a pagina. Reanudable (el cursor
// vive en base) y tolerante: una pagina que falla no tumba el trabajo, se anota
// para repescarla despues.
const backfill = async ({ onProgress = () => {}, maxPages = Infinity, source } = {}) => {
  const feed = source ? SOURCES[source] : await pickSource();

  if (!feed) throw new AppError('No Jikan catalog endpoint is responding right now', 503);

  const job = await state(feed.job);

  await job.update({ status: 'running', message: null });

  let page = job.cursor;
  let processed = job.processed;
  let failed = [...(job.failedPages ?? [])];
  let pagesDone = 0;
  let consecutive = 0;
  // La fuente oficial pagina por offset y no informa de una ultima pagina, asi
  // que el final se detecta cuando deja de haber siguiente, no comparando con
  // un total que nunca llega.
  let reachedEnd = false;

  // `[...failed]` y no `failed`: Sequelize detecta cambios en JSONB por
  // referencia, asi que mutar el mismo array deja las escrituras siguientes
  // fuera del UPDATE y solo se guardaria la primera pagina fallida.
  const save = (extra = {}) => job.update({ processed, failedPages: [...failed], ...extra });

  try {
    while (pagesDone < maxPages) {
      let result;

      try {
        result = await fetchPage(page, feed);
        consecutive = 0;
      } catch (err) {
        // Una credencial invalida no es intermitencia: reintentar 15 veces con
        // la misma clave mala solo alarga el fallo.
        if (err.statusCode === 401) {
          await save({ status: 'error', message: err.message });
          throw err;
        }

        consecutive += 1;
        if (!failed.includes(page)) failed.push(page);

        onProgress({ page, processed, failed: failed.length, error: err.message });

        if (consecutive >= MAX_CONSECUTIVE_FAILURES) {
          await save({ cursor: page + 1, status: 'error', message: err.message });
          return { finished: false, processed, page, failed: failed.length, aborted: true, source: feed.key };
        }

        page += 1;
        pagesDone += 1;
        await save({ cursor: page });
        continue;
      }

      const { items, pagination } = result;

      if (!items.length) {
        reachedEnd = true;
        break;
      }

      processed += await persistPage(items, feed);
      pagesDone += 1;
      page += 1;

      // El cursor se guarda despues de escribir: si el proceso muere en medio,
      // como maximo se repite una pagina, y el upsert la hace inocua.
      await save({ cursor: page, lastPage: pagination?.last_visible_page ?? job.lastPage });

      onProgress({ page: page - 1, processed, failed: failed.length, lastPage: job.lastPage });

      if (!pagination?.has_next_page) {
        reachedEnd = true;
        break;
      }
    }

    // Repesca de las pendientes antes de dar el trabajo por terminado.
    if (pagesDone < maxPages && failed.length) {
      const pending = [...failed];
      onProgress({ retrying: pending.length });

      for (const target of pending) {
        try {
          const { items } = await fetchPage(target, feed);
          processed += await persistPage(items, feed);
          failed = failed.filter((value) => value !== target);
          await save();
        } catch { /* sigue pendiente para la proxima ejecucion */ }
      }
    }

    const done = reachedEnd && !failed.length;
    await save({ status: done ? 'done' : 'idle', ...(done ? { finishedAt: new Date() } : {}) });

    return { finished: done, processed, page, failed: failed.length, source: feed.key };
  } catch (err) {
    await save({ status: 'error', message: err.message });
    throw err;
  }
};

// Trae la lista de episodios de un titulo. Jikan la pagina de 100 en 100, asi
// que una serie larga cuesta varias peticiones.
//
// Con `resume` arranca en la ultima pagina que ya se tiene en vez de en la
// primera: una serie larga en emision solo gana capitulos al final, y releer
// las 10 paginas de One Piece cada vez gastaria la cuota de Jikan para nada.
const syncEpisodes = async (anime, { resume = false } = {}) => {
  const collected = [];

  let page = 1;
  let hasNext = true;

  if (resume) {
    const stored = await Anime.Episode.count({ where: { animeId: anime.id } });
    page = Math.floor(stored / EPISODES_PER_PAGE) + 1;
  }

  while (hasNext) {
    const payload = await jikan.request(`/anime/${anime.malId}/episodes`, { page }, 0);

    collected.push(...(jikan.unwrap(payload) ?? []));
    hasNext = Boolean(jikan.paginationOf(payload)?.has_next_page);
    page += 1;
  }

  if (collected.length) {
    await Anime.Episode.bulkCreate(
      episodesFromJikan(anime.id, collected),
      { updateOnDuplicate: ["title", "filler", "recap", "aired"] }
    );
  }

  // Se marca aunque venga vacio (peliculas, OVAs de un solo episodio): si no,
  // el trabajo volveria a pedirlo eternamente.
  await anime.update({ episodesSyncedAt: new Date() });

  return collected.length;
};

// Bucle comun de las sincronizaciones de episodios: uno por uno, tolerante a
// fallos sueltos y con corte si el origen cae del todo.
const syncEpisodeList = async (list, { resume = false, onProgress = () => {} } = {}) => {
  let synced = 0;
  let episodes = 0;
  let consecutive = 0;

  for (const anime of list) {
    try {
      const count = await syncEpisodes(anime, { resume });
      episodes += count;
      synced += 1;
      consecutive = 0;
      onProgress({ title: anime.title, count, synced, total: list.length });
    } catch (err) {
      consecutive += 1;
      onProgress({ title: anime.title, error: err.message, synced, total: list.length });

      if (consecutive >= MAX_CONSECUTIVE_FAILURES) {
        onProgress({ aborted: true });
        break;
      }
    }
  }

  return { synced, episodes, pending: list.length };
};

// Recorre el catalogo trayendo episodios, empezando por lo mas popular: es lo
// que el usuario ve primero, y con MAL cayendose a ratos conviene gastar las
// peticiones que funcionan en los titulos que importan.
const backfillEpisodes = async ({ maxTitles = 100, onProgress = () => {} } = {}) => {
  const pending = await Anime.Anime.findAll({
    where: { episodesSyncedAt: null, visible: true },
    order: [db.literal('"popularity" ASC NULLS LAST')],
    limit: maxTitles,
  });

  return syncEpisodeList(pending, { onProgress });
};

// Pone al dia los episodios de lo que se esta emitiendo. `backfillEpisodes` solo
// toca titulos sin sincronizar, asi que una serie que ya tiene su lista nunca
// recibiria el capitulo de cada semana. Aqui se pide primero a los que llevan
// mas tiempo sin revisarse (los nunca sincronizados van al principio) y solo
// desde la ultima pagina conocida.
const refreshAiringEpisodes = async ({ maxTitles = 80, onProgress = () => {} } = {}) => {
  const airing = await Anime.Anime.findAll({
    where: { status: 'Currently Airing', visible: true },
    order: [
      db.literal('"episodesSyncedAt" ASC NULLS FIRST'),
      db.literal('"popularity" ASC NULLS LAST'),
    ],
    limit: maxTitles,
  });

  return syncEpisodeList(airing, { resume: true, onProgress });
};

// Vuelve a empezar el barrido del catalogo desde la pagina 1. Es lo que permite
// la resincronizacion semanal: sin esto el cursor se queda al final y nunca se
// vuelve a recorrer nada.
const restartBackfill = async () => {
  const job = await state(SOURCES.mal.job);
  await job.update({ cursor: 1, processed: 0, failedPages: [], status: 'idle', message: null, finishedAt: null });
  return job;
};

// Refresco incremental para el cron: lo que esta en emision, lo que esta por
// estrenarse y lo mas visto, que es donde cambian score, miembros y numero de
// episodios.
const refresh = async () => {
  const sources = [
    () => mal.ranking({ type: 'airing', limit: 200 }),
    // Lo que esta por estrenarse: asi un titulo aparece en el catalogo antes de
    // su primer capitulo y pasa a "en emision" cuando llega el dia.
    () => mal.ranking({ type: 'upcoming', limit: 200 }),
    () => mal.ranking({ type: 'bypopularity', limit: 200 }),
  ];

  let processed = 0;

  for (const source of sources) {
    try {
      const { items } = await source();
      processed += await persistPage(items, SOURCES.mal);
    } catch (err) {
      syslog.warn('CATALOG REFRESH', `source skipped: ${err.message}`);
    }
  }

  return processed;
};

module.exports = {
  BACKFILL_JOB, SOURCES, PAGE_SIZE, state, persistPage, persistGenres,
  pickSource, backfill, refresh, syncEpisodes, backfillEpisodes,
  refreshAiringEpisodes, restartBackfill,
};
