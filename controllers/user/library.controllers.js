const Library = require("../../models/library.models");
const Anime = require("../../models/anime.models");
const catchAsync = require("../../utils/catchAsync");
const { paginate, meta } = require("../../utils/pagination.util");

const ANIME_ATTRS = ["id", "malId", "slug", "title", "image", "score", "type", "episodesCount", "year"];

exports.watchlist = catchAsync(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const { status } = req.query;

  const { count, rows } = await Library.Watchlist.findAndCountAll({
    where: { accountId: req.sessionAccount.id, ...(status ? { status } : {}) },
    attributes: ["id", "status", "createdAt"],
    include: [{ model: Anime.Anime, as: "anime", attributes: ANIME_ATTRS }],
    order: [["updatedAt", "DESC"]],
    limit,
    offset,
  });

  return res.status(200).send({ data: rows, pagination: meta({ page, limit, count }) });
});

// Upsert rather than create: the UI toggles a status from a dropdown and
// should not care whether the title was already on the list.
exports.track = catchAsync(async (req, res) => {
  const [entry] = await Library.Watchlist.findOrCreate({
    where: { accountId: req.sessionAccount.id, animeId: req.anime.id },
    defaults: { status: req.body.status ?? 'planned' },
  });

  if (req.body.status && entry.status !== req.body.status) {
    await entry.update({ status: req.body.status });
  }

  return res.status(200).send(entry);
});

exports.untrack = catchAsync(async (req, res) => {
  await Library.Watchlist.destroy({
    where: { accountId: req.sessionAccount.id, animeId: req.anime.id },
  });

  return res.status(200).send({ message: "Removed from watchlist" });
});

exports.favorites = catchAsync(async (req, res) => {
  const favorites = await Library.Favorite.findAll({
    where: { accountId: req.sessionAccount.id },
    attributes: ["id", "createdAt"],
    include: [{ model: Anime.Anime, as: "anime", attributes: ANIME_ATTRS }],
    order: [["createdAt", "DESC"]],
  });

  return res.status(200).send(favorites);
});

exports.favorite = catchAsync(async (req, res) => {
  const [favorite, created] = await Library.Favorite.findOrCreate({
    where: { accountId: req.sessionAccount.id, animeId: req.anime.id },
  });

  return res.status(created ? 201 : 200).send(favorite);
});

exports.unfavorite = catchAsync(async (req, res) => {
  await Library.Favorite.destroy({
    where: { accountId: req.sessionAccount.id, animeId: req.anime.id },
  });

  return res.status(200).send({ message: "Removed from favorites" });
});

exports.rate = catchAsync(async (req, res) => {
  const [rating] = await Library.Rating.findOrCreate({
    where: { accountId: req.sessionAccount.id, animeId: req.anime.id },
    defaults: { score: Number(req.body.score) },
  });

  if (rating.score !== Number(req.body.score)) {
    await rating.update({ score: Number(req.body.score) });
  }

  return res.status(200).send(rating);
});

exports.comment = catchAsync(async (req, res) => {
  const comment = await Library.Comment.create({
    accountId: req.sessionAccount.id,
    animeId: req.anime.id,
    episodeId: req.body.episodeId ?? null,
    body: String(req.body.body).trim(),
    spoiler: Boolean(req.body.spoiler),
  });

  return res.status(201).send(comment);
});

exports.uncomment = catchAsync(async (req, res, next) => {
  const deleted = await Library.Comment.destroy({
    where: { id: req.params.id, accountId: req.sessionAccount.id },
  });

  if (!deleted) {
    return res.status(404).send({ status: "error", message: "Comment not found" });
  }

  return res.status(200).send({ message: "Comment deleted" });
});
