const Anime = require("../../models/anime.models");
const Library = require("../../models/library.models");
const Accounts = require("../../models/accounts.models");
const Profile = require("../../models/profile.models");
const services = require("../../services");
const catchAsync = require("../../utils/catchAsync");
const { paginate } = require("../../utils/pagination.util");
const query = require("../../utils/catalog.query.util");
const { fromMal } = require("../../utils/anime.util");
const { Op } = require("sequelize");

const { jikan, mal } = services;

// Dias tras los cuales una ficha se considera vieja y se revalida contra Jikan
// al visitarla. El catalogo entero lo mantiene al dia el cron.
const STALE_DAYS = 14;

const CARD_ATTRS = [
  "id", "malId", "slug", "title", "titleEnglish", "image", "score", "type",
  "episodesCount", "year", "season", "status", "popularity", "members",
];

const cards = (extra = []) => [...CARD_ATTRS, ...extra, [query.available, "available"]];

// La paginacion mantiene las claves de Jikan (`has_next_page`,
// `last_visible_page`) ademas de las nuestras: el frontend ya scrollea con
// ellas y no tiene por que enterarse de que ahora los datos son locales.
const pagination = ({ page, limit, count }) => {
  const pages = Math.ceil(count / limit) || 1;

  return {
    page,
    limit,
    total: count,
    pages,
    last_visible_page: pages,
    has_next_page: page < pages,
  };
};

// Busqueda contra Postgres. Ya no toca Jikan: sin limite de peticiones, con
// filtros combinables y funcionando aunque MyAnimeList este caido.
exports.search = catchAsync(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const { q, genres, type, status, year, season, min_score, order_by, sort } = req.query;

  const where = { visible: true };

  if (q) where[Op.or] = query.byQuery(q);
  if (type) where.type = { [Op.iLike]: type };
  if (status) where.status = { [Op.iLike]: `%${status}%` };
  if (year) where.year = Number(year);
  if (season) where.season = String(season).toLowerCase();
  if (min_score) where.score = { [Op.gte]: Number(min_score) };

  const genreFilter = genres ? query.byGenres(genres) : null;
  if (genreFilter) where.id = { [Op.in]: genreFilter };

  const { count, rows } = await Anime.Anime.findAndCountAll({
    where,
    attributes: cards(),
    order: query.order(order_by, sort),
    limit,
    offset,
  });

  return res.status(200).send({ data: rows, pagination: pagination({ page, limit, count }) });
});

// Revalidacion perezosa: si la ficha lleva mucho sin tocarse se refresca al
// visitarla contra la API oficial, pero un fallo suyo no impide servirla — para
// eso la tenemos guardada.
const revalidate = async (anime) => {
  const age = Date.now() - new Date(anime.syncedAt ?? 0).getTime();
  if (age < STALE_DAYS * 86_400_000) return anime;

  try {
    await anime.update(fromMal(await mal.anime(anime.malId)));
    return anime.reload();
  } catch {
    return anime;
  }
};

// Nodo de la API oficial a la forma que ya consume el frontend.
const card = (node) => ({
  mal_id: node.id,
  title: node.title,
  image: node.main_picture?.large ?? node.main_picture?.medium ?? null,
  ...(node.relation ? { relation: node.relation } : {}),
});

exports.anime = catchAsync(async (req, res) => {
  if (req.anime) {
    const anime = await revalidate(req.anime);

    return res.status(200).send({
      ...anime.toJSON(),
      mal_id: anime.malId,
      available: Boolean(req.available),
    });
  }

  // No esta en el espejo (entrada recien dada de alta en MAL): se pide en vivo
  // y se guarda, asi la siguiente visita ya sale de base.
  const detail = await mal.anime(req.malId);
  const [created] = await Anime.Anime.upsert(fromMal(detail), { returning: true });

  return res.status(200).send({ ...created.toJSON(), mal_id: created.malId, available: false });
});

// Recomendaciones y relacionados salen de la misma peticion de la ficha, y no
// se replican en base: son colas largas que no justifican el espacio.
exports.recommendations = catchAsync(async (req, res) => {
  const detail = await mal.anime(req.malId).catch(() => null);
  if (!detail) return res.status(200).send([]);

  const entries = [...mal.recommendations(detail), ...mal.related(detail)];

  const local = await Anime.Anime.findAll({
    where: { malId: entries.map((entry) => entry.id), visible: true },
    attributes: cards(),
  });

  // Se devuelve la fila local cuando existe (trae `available` y nuestro slug) y
  // la de MAL solo para lo que aun no este replicado.
  const byMal = new Map(local.map((row) => [row.malId, row]));

  return res.status(200).send(entries.map((entry) => byMal.get(entry.id) ?? card(entry)));
});

// Unico dato de la ficha que sigue viniendo de Jikan: la API oficial ignora el
// campo `characters`.
exports.characters = catchAsync(async (req, res) => {
  const payload = await jikan.characters(req.malId).catch(() => null);

  return res.status(200).send(payload ? jikan.unwrap(payload) : []);
});

// Nuestra lista de episodios (la reproducible). El progreso se adjunta solo
// para un usuario con sesion, para que la grilla pinte la barra de continuar
// en una sola llamada.
exports.episodes = catchAsync(async (req, res) => {
  const episodes = await Anime.Episode.findAll({
    where: { animeId: req.anime.id, visible: true },
    attributes: ["id", "number", "title", "thumbnail", "duration", "filler", "recap", "aired"],
    order: [["number", "ASC"]],
  });

  if (!req.sessionAccount) return res.status(200).send(episodes);

  const history = await Library.History.findAll({
    where: { accountId: req.sessionAccount.id, animeId: req.anime.id },
    attributes: ["episodeId", "progress", "duration", "completed"],
  });

  const byEpisode = new Map(history.map((row) => [row.episodeId, row]));

  return res.status(200).send(
    episodes.map((episode) => ({
      ...episode.toJSON(),
      history: byEpisode.get(episode.id) ?? null,
    }))
  );
});

exports.episode = catchAsync(async (req, res) => {
  const episode = await Anime.Episode.findOne({
    where: { animeId: req.anime.id, number: Number(req.params.number), visible: true },
    include: [{
      model: Anime.Source,
      as: "sources",
      where: { active: true },
      required: false,
      attributes: ["id", "server", "url", "type", "quality", "language"],
    }],
  });

  if (!episode) {
    return res.status(404).send({ status: "error", message: "Episode not found" });
  }

  return res.status(200).send(episode);
});

exports.comments = catchAsync(async (req, res) => {
  const comments = await Library.Comment.findAll({
    where: { animeId: req.anime.id },
    attributes: ["id", "body", "spoiler", "episodeId", "createdAt"],
    order: [["createdAt", "DESC"]],
    include: [{
      as: 'account',
      model: Accounts.Account,
      attributes: ["id", "username", "authority"],
      include: [{ model: Profile.Profiles, as: "profile", attributes: ["nickname", "avatar"] }],
    }],
  });

  return res.status(200).send(comments);
});
