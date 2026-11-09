const Anime = require("../../models/anime.models");
const catchAsync = require("../../utils/catchAsync");
const { paginate } = require("../../utils/pagination.util");
const query = require("../../utils/catalog.query.util");
const { Op } = require("sequelize");

const CARD_ATTRS = [
  "id", "malId", "slug", "title", "titleEnglish", "image", "score", "type",
  "episodesCount", "year", "season", "status", "popularity", "members",
];

const cards = () => [...CARD_ATTRS, [query.available, "available"]];

const pagination = ({ page, limit, count }) => {
  const pages = Math.ceil(count / limit) || 1;

  return { page, limit, total: count, pages, last_visible_page: pages, has_next_page: page < pages };
};

const list = async ({ where, order, page, limit, offset }) => {
  const { count, rows } = await Anime.Anime.findAndCountAll({
    where: { visible: true, ...where },
    attributes: cards(),
    order,
    limit,
    offset,
  });

  return { data: rows, pagination: pagination({ page, limit, count }) };
};

// Los filtros replican los de Jikan (`airing`, `bypopularity`, `favorite`)
// para no cambiar el contrato que ya consume el frontend.
const TOP_FILTERS = {
  airing: { where: { status: { [Op.iLike]: '%Currently Airing%' } }, order: 'popularity' },
  upcoming: { where: { status: { [Op.iLike]: '%Not yet aired%' } }, order: 'members' },
  bypopularity: { where: {}, order: 'popularity' },
  favorite: { where: {}, order: 'favorites' },
};

exports.top = catchAsync(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const { type, filter } = req.query;

  const preset = TOP_FILTERS[filter] ?? { where: {}, order: 'rank' };

  return res.status(200).send(await list({
    where: { ...preset.where, ...(type ? { type: { [Op.iLike]: type } } : {}) },
    order: query.order(preset.order),
    page,
    limit,
    offset,
  }));
});

exports.now = catchAsync(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const { year, season } = query.currentSeason();

  return res.status(200).send(await list({
    where: { year, season },
    order: query.order('members'),
    page,
    limit,
    offset,
  }));
});

exports.upcoming = catchAsync(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);

  return res.status(200).send(await list({
    where: { status: { [Op.iLike]: '%Not yet aired%' } },
    order: query.order('members'),
    page,
    limit,
    offset,
  }));
});

exports.season = catchAsync(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const { year, season } = req.season;

  return res.status(200).send(await list({
    where: { year, season },
    order: query.order('members'),
    page,
    limit,
    offset,
  }));
});

// Calendario semanal. MAL guarda el dia en plural ("mondays"), que es como lo
// deja el mapper, asi que se normaliza lo que llega por query.
exports.schedules = catchAsync(async (req, res) => {
  const { limit } = paginate(req.query);
  const { day } = req.query;

  const where = { status: { [Op.iLike]: '%Currently Airing%' } };

  if (day) {
    const normalised = String(day).toLowerCase().replace(/s?$/, 's');
    where.broadcastDay = normalised;
  }

  const rows = await Anime.Anime.findAll({
    where: { visible: true, ...where },
    attributes: cards(),
    order: query.order('members'),
    limit,
  });

  return res.status(200).send(rows);
});

exports.genres = catchAsync(async (_, res) => {
  const genres = await Anime.Genre.findAll({
    attributes: ["id", "malId", "name", "slug"],
    order: [["name", "ASC"]],
  });

  return res.status(200).send(genres);
});

// Todo lo que necesita la portada en un solo viaje, y ahora todo desde
// Postgres: cuatro consultas en paralelo, sin depender de que Jikan responda.
exports.home = catchAsync(async (req, res) => {
  const limit = Number(req.query.limit) || 12;
  const { year, season } = query.currentSeason();

  const base = { visible: true };
  const attributes = cards();

  const [featured, latest, now, top] = await Promise.all([
    Anime.Anime.findAll({
      where: { ...base, featured: true },
      attributes,
      limit,
      order: [["updatedAt", "DESC"]],
    }),
    // "Ultimos añadidos" son los que ya tienen episodios publicados, no los
    // ultimos que entraron por el backfill (que serian 29.000 sin ver).
    Anime.Anime.findAll({
      where: { ...base, id: { [Op.in]: query.availableIds } },
      attributes,
      limit,
      order: [["createdAt", "DESC"]],
    }),
    Anime.Anime.findAll({
      where: { ...base, year, season },
      attributes,
      limit,
      order: query.order('members'),
    }),
    Anime.Anime.findAll({
      where: base,
      attributes,
      limit,
      order: query.order('popularity'),
    }),
  ]);

  return res.status(200).send({ featured, latest, now, top });
});
