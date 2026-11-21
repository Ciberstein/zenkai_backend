const kitsu = require("./kitsu.service");

// Miniaturas de episodios. Dos origenes, de mejor a peor:
//   1. un fotograma del propio video, que se saca al publicar el episodio (scripts/lib/publish.js)
//   2. la miniatura que Kitsu tiene del episodio, que se trae aqui para el resto
//
// Kitsu se consulta "bajo demanda": la primera vez que alguien abre la lista de episodios de un
// anime que no tiene miniaturas. Asi solo se pide lo que se ve (no los ~29.000 titulos del
// catalogo) y no hace falta ningun trabajo programado. Mientras llega, la tarjeta usa la
// portada desenfocada de siempre.

const STALE_MS = 30 * 24 * 60 * 60 * 1000;   // pasado este tiempo se vuelve a intentar
const RETRY_MS = 10 * 60 * 1000;             // tras un fallo de Kitsu, no insistir enseguida

const running = new Set();
const failedAt = new Map();

// ¿Merece la pena preguntar a Kitsu? Hay episodios sin miniatura y no se pregunto hace poco.
const due = (anime, episodes) => {
  if (running.has(anime.id)) return false;
  if (Date.now() - (failedAt.get(anime.id) ?? 0) < RETRY_MS) return false;
  if (!episodes.some((episode) => !episode.thumbnail)) return false;

  return !anime.thumbnailsSyncedAt || Date.now() - new Date(anime.thumbnailsSyncedAt).getTime() > STALE_MS;
};

// Guarda las miniaturas de Kitsu en los episodios que no tienen ninguna (nunca pisa una propia).
const fillFromKitsu = async (Anime, anime) => {
  if (running.has(anime.id)) return 0;
  running.add(anime.id);

  try {
    const list = await kitsu.thumbnails(anime.malId);
    let saved = 0;

    for (const { number, thumbnail } of list) {
      const [count] = await Anime.Episode.update({ thumbnail }, { where: { animeId: anime.id, number, thumbnail: null } });
      saved += count;
    }

    // Se marca aunque no haya traido nada (Kitsu no conoce el titulo): no insistir cada visita.
    await anime.update({ thumbnailsSyncedAt: new Date() });
    failedAt.delete(anime.id);

    return saved;
  } catch (err) {
    failedAt.set(anime.id, Date.now());
    throw err;
  } finally {
    running.delete(anime.id);
  }
};

module.exports = { due, fillFromKitsu };
