const aniskip = require("./aniskip.service");

// Segmentos de un episodio (intro, outro, recap) que el reproductor ofrece saltar.
//
// Cada segmento recuerda de donde salio:
//   manual    lo puso un admin: nunca se pisa solo
//   aniskip   viene de AniSkip
//   detected  (reservado) lo detecto el propio servidor comparando episodios
//
// Prioridad: manual > aniskip > detected. Una fuente automatica solo escribe donde no hay un
// segmento manual de ese tipo.

const TYPES = ["intro", "outro", "recap"];

// Busca los tiempos en AniSkip y los guarda. `Anime` son los modelos (en el servidor y en los
// scripts se cargan distinto). Devuelve { found, saved, kept } para informar al admin.
const fetchFromAniskip = async (Anime, { episode, malId, length = null }) => {
  const duration = length ?? episode.duration ?? 0;
  const times = await aniskip.skipTimes(malId, episode.number, duration);

  const existing = await Anime.Segment.findAll({ where: { episodeId: episode.id } });
  const byType = new Map(existing.map((segment) => [segment.type, segment]));

  let saved = 0;
  let kept = 0;

  for (const time of times) {
    const current = byType.get(time.type);

    if (current && current.source === "manual") { kept += 1; continue; }

    const data = { start: time.start, end: time.end, source: "aniskip", confidence: time.confidence };

    if (current) await current.update(data);
    else await Anime.Segment.create({ episodeId: episode.id, type: time.type, ...data });

    saved += 1;
  }

  return { found: times.length, saved, kept };
};

module.exports = { TYPES, fetchFromAniskip };
