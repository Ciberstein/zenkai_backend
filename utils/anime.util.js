const slugify = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

// Fecha de Jikan: viene como ISO o null, pero tambien como cadena vacia en
// entradas viejas, y `new Date("")` es Invalid Date, que Postgres rechaza.
const date = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// Mapea un elemento de Jikan a nuestras columnas. Sirve igual para el detalle
// (`/anime/{id}/full`) que para cada item del listado (`/anime?page=N`), que es
// lo que usa el backfill: ambos traen los mismos campos.
const fromJikan = (payload) => ({
  malId: payload.mal_id,
  title: payload.title,
  titleEnglish: payload.title_english ?? null,
  titleJapanese: payload.title_japanese ?? null,
  slug: `${slugify(payload.title)}-${payload.mal_id}`,
  synopsis: payload.synopsis ?? null,
  type: payload.type ?? null,
  status: payload.status ?? null,
  episodesCount: payload.episodes ?? null,
  duration: payload.duration ?? null,
  rating: payload.rating ?? null,
  score: payload.score ?? null,
  season: payload.season ?? null,
  year: payload.year ?? payload.aired?.prop?.from?.year ?? null,
  image: payload.images?.webp?.large_image_url ?? payload.images?.jpg?.large_image_url ?? null,
  trailer: payload.trailer?.embed_url ?? null,
  studios: payload.studios?.map(({ mal_id, name }) => ({ mal_id, name })) ?? [],
  rank: payload.rank ?? null,
  popularity: payload.popularity ?? null,
  members: payload.members ?? null,
  favoritesCount: payload.favorites ?? null,
  scoredBy: payload.scored_by ?? null,
  airedFrom: date(payload.aired?.from),
  airedTo: date(payload.aired?.to),
  broadcastDay: payload.broadcast?.day?.toLowerCase() ?? null,
  origin: payload.source ?? null,
  titles: payload.titles?.map(({ type, title }) => ({ type, title })) ?? [],
  syncedAt: new Date(),
});

const genresFromJikan = (payload) =>
  [...(payload.genres ?? []), ...(payload.themes ?? [])].map(({ mal_id, name }) => ({
    malId: mal_id,
    name,
    slug: slugify(name),
  }));

const episodesFromJikan = (animeId, list = []) =>
  list.map((episode) => ({
    animeId,
    number: episode.mal_id,
    title: episode.title ?? null,
    filler: Boolean(episode.filler),
    recap: Boolean(episode.recap),
    aired: episode.aired ?? null,
  }));

// La API oficial de MAL usa otras formas que Jikan para lo mismo: "tv" en vez
// de "TV", "finished_airing" en vez de "Finished Airing", "friday" en vez de
// "Fridays". Se normaliza a la forma de Jikan porque es la que ya esta escrita
// en base y por la que filtran los controllers.
const MAL_TYPES = {
  tv: 'TV', movie: 'Movie', ova: 'OVA', ona: 'ONA',
  special: 'Special', music: 'Music', tv_special: 'TV Special',
};

const MAL_STATUS = {
  finished_airing: 'Finished Airing',
  currently_airing: 'Currently Airing',
  not_yet_aired: 'Not yet aired',
};

// `average_episode_duration` viene en segundos; en base guardamos el texto que
// ya usaba Jikan ("24 min per ep").
const malDuration = (seconds) => {
  if (!seconds) return null;
  const minutes = Math.round(seconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)} hr ${minutes % 60} min`
    : `${minutes} min per ep`;
};

const fromMal = (node) => ({
  malId: node.id,
  title: node.title,
  titleEnglish: node.alternative_titles?.en || null,
  titleJapanese: node.alternative_titles?.ja || null,
  slug: `${slugify(node.title)}-${node.id}`,
  synopsis: node.synopsis ?? null,
  type: MAL_TYPES[node.media_type] ?? node.media_type ?? null,
  status: MAL_STATUS[node.status] ?? node.status ?? null,
  episodesCount: node.num_episodes || null,
  duration: malDuration(node.average_episode_duration),
  rating: node.rating ?? null,
  score: node.mean ?? null,
  season: node.start_season?.season ?? null,
  year: node.start_season?.year ?? null,
  image: node.main_picture?.large ?? node.main_picture?.medium ?? null,
  trailer: null,
  studios: node.studios?.map(({ id, name }) => ({ mal_id: id, name })) ?? [],
  rank: node.rank ?? null,
  popularity: node.popularity ?? null,
  members: node.num_list_users ?? null,
  favoritesCount: null,
  scoredBy: node.num_scoring_users ?? null,
  airedFrom: date(node.start_date),
  airedTo: date(node.end_date),
  // MAL lo da en singular y Jikan en plural; el calendario filtra por plural.
  broadcastDay: node.broadcast?.day_of_the_week ? `${node.broadcast.day_of_the_week}s` : null,
  origin: node.source ?? null,
  titles: (node.alternative_titles?.synonyms ?? []).map((title) => ({ type: 'Synonym', title })),
  syncedAt: new Date(),
});

// Los ids de genero son los mismos que da Jikan, asi que las dos fuentes
// escriben en las mismas filas de anime_genres sin duplicar nada.
const genresFromMal = (node) =>
  (node.genres ?? []).map(({ id, name }) => ({ malId: id, name, slug: slugify(name) }));

module.exports = {
  slugify, fromJikan, genresFromJikan, episodesFromJikan, fromMal, genresFromMal,
};
