const Anime = require("../../models/anime.models");
const services = require("../../services");
const catchAsync = require("../../utils/catchAsync");
const AppError = require("../../utils/appError");
const LOG_ACTIONS = require("../../utils/log.actions");
const { paginate, meta } = require("../../utils/pagination.util");
const { fromMal, genresFromMal, episodesFromJikan } = require("../../utils/anime.util");
const { Op } = require("sequelize");

const { jikan, mal } = services;

exports.list = catchAsync(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const { q } = req.query;

  const { count, rows } = await Anime.Anime.findAndCountAll({
    where: q ? { title: { [Op.iLike]: `%${q}%` } } : {},
    include: [{ model: Anime.Genre, as: "genres", attributes: ["id", "name"], through: { attributes: [] } }],
    order: [["createdAt", "DESC"]],
    distinct: true,
    limit,
    offset,
  });

  return res.status(200).send({ data: rows, pagination: meta({ page, limit, count }) });
});

// Trae un titulo desde la API oficial a nuestro catalogo. Se puede repetir sin
// riesgo: refresca la fila existente en vez de fallar por el malId unico.
exports.sync = catchAsync(async (req, res, next) => {
  const malId = Number(req.params.malId);

  if (!Number.isInteger(malId)) {
    return next(new AppError(`Anime ID must be a valid integer`, 406));
  }

  const payload = await mal.anime(malId);

  const [anime] = await Anime.Anime.upsert(fromMal(payload), { returning: true });

  const genres = genresFromMal(payload);

  if (genres.length) {
    await Anime.Genre.bulkCreate(genres, { ignoreDuplicates: true });

    const rows = await Anime.Genre.findAll({ where: { malId: genres.map((g) => g.malId) } });
    await anime.setGenres(rows);
  }

  services.logger.fromRequest(req, {
    action: LOG_ACTIONS.ANIME_SYNC,
    meta: { malId, title: anime.title },
  });

  return res.status(200).send(anime);
});

// Crea las fichas de los episodios desde la lista de Jikan: es el unico sitio
// de donde salen, la API oficial no expone ese endpoint (responde 403). Las
// fuentes de video se anaden aparte; ninguna de las dos APIs las tiene.
exports.syncEpisodes = catchAsync(async (req, res) => {
  const { anime } = req;

  let page = 1;
  let hasNext = true;
  const collected = [];

  while (hasNext) {
    const payload = await jikan.episodes(anime.malId, page);
    collected.push(...jikan.unwrap(payload));
    hasNext = Boolean(jikan.paginationOf(payload)?.has_next_page);
    page += 1;
  }

  await Anime.Episode.bulkCreate(
    episodesFromJikan(anime.id, collected),
    { updateOnDuplicate: ["title", "filler", "recap", "aired"] }
  );

  services.logger.fromRequest(req, {
    action: LOG_ACTIONS.EPISODE_CREATE,
    meta: { malId: anime.malId, episodes: collected.length },
  });

  return res.status(200).send({ synced: collected.length });
});

exports.update = catchAsync(async (req, res) => {
  const FIELDS = ["title", "synopsis", "banner", "trailer", "featured", "visible"];

  const payload = Object.fromEntries(
    Object.entries(req.body).filter(([key]) => FIELDS.includes(key))
  );

  await req.anime.update(payload);

  services.logger.fromRequest(req, {
    action: LOG_ACTIONS.ANIME_UPDATE,
    meta: { malId: req.anime.malId, fields: Object.keys(payload) },
  });

  return res.status(200).send(req.anime);
});

exports.episodes = catchAsync(async (req, res) => {
  const episodes = await Anime.Episode.findAll({
    where: { animeId: req.anime.id },
    include: [{ model: Anime.Source, as: "sources" }],
    order: [["number", "ASC"]],
  });

  return res.status(200).send(episodes);
});

exports.episode = catchAsync(async (req, res) => {
  const FIELDS = ["title", "thumbnail", "duration", "filler", "recap", "visible"];

  const payload = Object.fromEntries(
    Object.entries(req.body).filter(([key]) => FIELDS.includes(key))
  );

  await req.episode.update(payload);

  services.logger.fromRequest(req, {
    action: LOG_ACTIONS.EPISODE_UPDATE,
    meta: { episodeId: req.episode.id, fields: Object.keys(payload) },
  });

  return res.status(200).send(req.episode);
});

exports.source = catchAsync(async (req, res) => {
  const { server, url, type, quality, language } = req.body;

  const source = await Anime.Source.create({
    episodeId: req.episode.id,
    server,
    url,
    type: type ?? 'hls',
    quality: quality ?? 'auto',
    language: language ?? 'sub',
  });

  services.logger.fromRequest(req, {
    action: LOG_ACTIONS.SOURCE_CREATE,
    meta: { episodeId: req.episode.id, server },
  });

  return res.status(201).send(source);
});

exports.removeSource = catchAsync(async (req, res) => {
  await Anime.Source.destroy({ where: { id: req.params.id } });

  return res.status(200).send({ message: "Source deleted" });
});


