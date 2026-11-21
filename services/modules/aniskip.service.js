const axios = require("axios");

// AniSkip (https://api.aniskip.com) es una base de datos comunitaria con los tiempos de la
// intro, el ending y el resumen de los episodios, indexada por id de MyAnimeList y numero de
// episodio. Aqui se consulta y se traduce a los segmentos de Zenkai.
//
// Los tiempos corresponden a UNA version del video (la que midio quien los subio): por eso
// cada resultado trae `episodeLength`, y se elige el que mas se parece al video que tenemos.

const client = axios.create({
  baseURL: process.env.ANISKIP_BASE_URL || "https://api.aniskip.com/v2",
  timeout: 15000,
  validateStatus: (status) => status === 200 || status === 404,
});

// Tipos de AniSkip → tipo de segmento de Zenkai. Los "mixed-*" son intros con trozos del
// episodio mezclados: sirven, pero un "op" limpio siempre gana.
const TYPES = { op: "intro", "mixed-op": "intro", ed: "outro", "mixed-ed": "outro", recap: "recap" };
const PRIORITY = ["op", "ed", "recap", "mixed-op", "mixed-ed"];

// Una version con mas de esto de diferencia en la duracion es otro corte del episodio: sus
// tiempos no valen. (La duracion de Jikan viene en minutos redondeados, de ahi la holgura.)
const MAX_DIFF = 120;

// Devuelve [{ type, start, end, confidence }] (segundos) o [] si no hay datos fiables.
// `length`: duracion en segundos del video que tenemos (0 o null si no se conoce).
const skipTimes = async (malId, number, length = 0) => {
  const params = new URLSearchParams({ episodeLength: "0" });
  for (const type of PRIORITY) params.append("types", type);

  const res = await client.get(`/skip-times/${malId}/${number}`, { params });
  if (res.status === 404 || !res.data?.found) return [];

  const picked = new Map();

  for (const result of res.data.results ?? []) {
    const type = TYPES[result.skipType];
    const { startTime: start, endTime: end } = result.interval ?? {};

    if (!type || !(end > start) || start < 0) continue;

    const diff = length && result.episodeLength ? Math.abs(result.episodeLength - length) : null;
    if (diff !== null && diff > MAX_DIFF) continue;

    // Confianza: la version coincide casi al segundo → 1; si no se sabe la duracion, media.
    const confidence = diff === null ? 0.5 : diff <= 3 ? 1 : diff <= 15 ? 0.8 : 0.6;
    const rank = PRIORITY.indexOf(result.skipType);
    const current = picked.get(type);

    // Entre varios del mismo tipo: el de la version mas parecida; a igualdad, el tipo "limpio".
    if (!current || diff !== null && current.diff !== null && diff < current.diff
      || (diff === current?.diff && rank < current.rank)) {
      picked.set(type, { type, start, end, confidence, diff, rank });
    }
  }

  return [...picked.values()].map(({ type, start, end, confidence }) => ({ type, start, end, confidence }));
};

module.exports = { skipTimes };
