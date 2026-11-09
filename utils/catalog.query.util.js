const { Op } = require("sequelize");
const { db } = require("../database/config");

// Columnas por las que se puede ordenar. Es lista blanca a proposito: el valor
// entra en un literal SQL y no puede venir del query string sin filtrar.
const ORDERS = {
  score: '"score" DESC NULLS LAST',
  popularity: '"popularity" ASC NULLS LAST',
  members: '"members" DESC NULLS LAST',
  rank: '"rank" ASC NULLS LAST',
  favorites: '"favoritesCount" DESC NULLS LAST',
  start_date: '"airedFrom" DESC NULLS LAST',
  title: '"title" ASC',
};

const order = (by = 'popularity', sort) => {
  const column = ORDERS[by] ?? ORDERS.popularity;

  // `sort` solo puede invertir el sentido que ya trae la columna.
  if (sort === 'asc' && column.includes('DESC'))
    return [db.literal(column.replace('DESC', 'ASC').replace('NULLS LAST', 'NULLS LAST'))];

  if (sort === 'desc' && column.includes('ASC') && by !== 'title')
    return [db.literal(column.replace('ASC', 'DESC').replace('NULLS LAST', 'NULLS LAST'))];

  return [db.literal(column)];
};

// Filtro por generos con semantica AND: pedir "accion,drama" devuelve los que
// tienen los dos, no la union. Los ids se fuerzan a entero antes de entrar al
// literal.
const byGenres = (value) => {
  const ids = String(value).split(',').map((id) => parseInt(id, 10)).filter(Number.isInteger);

  if (!ids.length) return null;

  return db.literal(`(
    SELECT ag."animeId"
      FROM "anime"."anime_anime_genres" ag
      JOIN "anime"."anime_genres" g ON g."id" = ag."genreId"
     WHERE g."malId" IN (${ids.join(',')})
     GROUP BY ag."animeId"
    HAVING COUNT(DISTINCT g."id") = ${ids.length}
  )`);
};

// Busca en los tres titulos principales y ademas en los sinonimos guardados en
// JSONB, para que "Shingeki no Kyojin" y "Attack on Titan" lleven al mismo sitio.
const byQuery = (q) => {
  const term = `%${String(q).trim()}%`;

  return [
    { title: { [Op.iLike]: term } },
    { titleEnglish: { [Op.iLike]: term } },
    { titleJapanese: { [Op.iLike]: term } },
    db.literal(`EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE("anime_anime"."titles", '[]'::jsonb)) AS t
       WHERE t->>'title' ILIKE ${db.escape(term)}
    )`),
  ];
};

// Marca si el titulo tiene algo reproducible, sin traerse los episodios.
const available = db.literal(`(
  EXISTS (
    SELECT 1
      FROM "anime"."anime_episodes" e
      JOIN "anime"."anime_sources" s ON s."episodeId" = e."id" AND s."active" = true
     WHERE e."animeId" = "anime_anime"."id" AND e."visible" = true
  )
)`);

// Misma condicion que `available`, pero como subconsulta de ids: sirve para
// filtrar "solo lo reproducible" en un WHERE.
const availableIds = db.literal(`(
  SELECT DISTINCT e."animeId"
    FROM "anime"."anime_episodes" e
    JOIN "anime"."anime_sources" s ON s."episodeId" = e."id" AND s."active" = true
   WHERE e."visible" = true
)`);

// Temporada natural a partir de la fecha, para resolver "en emision" sin pedirsela a Jikan.
const currentSeason = (date = new Date()) => {
  const seasons = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer',
    'summer', 'summer', 'fall', 'fall', 'fall', 'winter'];

  return { year: date.getFullYear(), season: seasons[date.getMonth()] };
};

module.exports = { ORDERS, order, byGenres, byQuery, available, availableIds, currentSeason };
