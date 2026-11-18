const Anime = require("../../models/anime.models");
const catalog = require("../../services/modules/catalog.service");
const syslog = require("../../utils/syslog.util");

// Cada handler devuelve `{ processed, message }` y deja que el error suba: el
// ejecutor (scheduler/index.js) es quien lo registra en base y en consola.

// Refresca lo que cambia a diario (emision, proximos estrenos y populares). El
// catalogo completo no se re-recorre desde aqui: de eso se ocupa `fullSync`.
const refresh = async () => {
  const processed = await catalog.refresh();
  return { processed, message: `${processed} títulos (en emisión, próximos y populares)` };
};

// Cada fallo se deja en el log del servidor: sin esto una tanda donde Jikan no
// responde terminaba "bien" con 0 titulos y no habia pista de por que.
const logProgress = ({ title, error }) => {
  if (error) syslog.warn('EPISODES', `${title} omitido (${error})`);
};

// Si la tanda aborto, o fallo todo lo que intento, es un error de verdad: el
// panel de Jobs lo muestra en rojo con el motivo en vez de un "0 titulos".
const assertWorked = (result) => {
  if (result.aborted || (result.pending > 0 && result.synced === 0 && result.failed > 0)) {
    throw new Error(`Jikan no respondió (${result.failed} fallos, último: ${result.lastError})`);
  }
};

// Capitulos nuevos de lo que se esta emitiendo. Hasta 80 series por tanda,
// empezando por las que mas tiempo llevan sin revisarse.
const airingEpisodes = async () => {
  const result = await catalog.refreshAiringEpisodes({ maxTitles: 80, onProgress: logProgress });
  assertWorked(result);
  return {
    processed: result.synced,
    message: `${result.synced} series · ${result.episodes} episodios revisados`,
  };
};

// Barrido completo del catalogo, de la pagina 1 al final. Con la API oficial son
// ~30.000 titulos en menos de un minuto, asi que una vez por semana basta para
// que puntuaciones, estados y estrenos de todo el catalogo no se queden viejos.
// Lo que gestiona el panel (featured, visible, banner) no se pisa.
const fullSync = async () => {
  await catalog.restartBackfill();
  const result = await catalog.backfill();

  // Si MyAnimeList se cae a media faena el cursor queda guardado y la
  // continuacion horaria termina el barrido; aqui solo se deja constancia.
  if (result.aborted) {
    throw new Error(`MyAnimeList dejó de responder en la página ${result.page}; el barrido continúa cada hora`);
  }

  return {
    processed: result.processed,
    message: `${result.processed} títulos${result.failed ? ` · ${result.failed} páginas pendientes de repesca` : ''}`,
  };
};

// Continua el backfill si quedo a medias (tras una caida de MAL o un reinicio).
// 60 paginas por tanda para no acaparar la cuota del resto de la aplicacion.
const resume = async () => {
  const result = await catalog.backfill({ maxPages: 60 });
  return { processed: result.processed, message: `Continuó en la página ${result.page}` };
};

// Solo tiene sentido ejecutarlo mientras quede algo pendiente: sin esto el
// trabajo se registraria cada hora sin hacer nada.
const resumePending = async () => {
  const job = await catalog.state(catalog.SOURCES.mal.job);
  return job.status !== 'done';
};

// Listas de episodios de titulos que aun no las tienen, de lo mas popular a lo
// menos. 2.000 por tanda: el techo real es la cuota de Jikan (~50 peticiones por
// minuto), asi que la tanda dura cerca de una hora y el catalogo entero se pone
// al dia en un dia o dos en vez de en semanas.
const episodes = async () => {
  const result = await catalog.backfillEpisodes({ maxTitles: 2000, onProgress: logProgress });
  assertWorked(result);
  return {
    processed: result.synced,
    message: `${result.synced} títulos · ${result.episodes} episodios`,
  };
};

const episodesPending = async () =>
  (await Anime.Anime.count({ where: { episodesSyncedAt: null, visible: true } })) > 0;

module.exports = { refresh, airingEpisodes, fullSync, resume, resumePending, episodes, episodesPending };
