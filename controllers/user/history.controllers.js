const Library = require("../../models/library.models");
const Anime = require("../../models/anime.models");
const App = require("../../models/app.models");
const catchAsync = require("../../utils/catchAsync");
const { paginate, meta } = require("../../utils/pagination.util");

const SEEN_PERCENT_FALLBACK = 85;

const seenPercent = async () => {
  const row = await App.Config.findOne({ where: { key: "player_seen_percent" } });
  return Number(row?.value) || SEEN_PERCENT_FALLBACK;
};

exports.history = catchAsync(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);

  const { count, rows } = await Library.History.findAndCountAll({
    where: { accountId: req.sessionAccount.id },
    attributes: ["id", "progress", "duration", "completed", "updatedAt"],
    include: [
      { model: Anime.Anime, as: "anime", attributes: ["id", "malId", "slug", "title", "image"] },
      { model: Anime.Episode, as: "episode", attributes: ["id", "number", "title", "thumbnail"] },
    ],
    order: [["updatedAt", "DESC"]],
    limit,
    offset,
  });

  return res.status(200).send({ data: rows, pagination: meta({ page, limit, count }) });
});

// "Continue watching" rail: the newest unfinished episode per title, so a
// viewer never sees the same anime twice in the row.
exports.resume = catchAsync(async (req, res) => {
  const rows = await Library.History.findAll({
    where: { accountId: req.sessionAccount.id, completed: false },
    attributes: ["id", "animeId", "progress", "duration", "updatedAt"],
    include: [
      { model: Anime.Anime, as: "anime", attributes: ["id", "malId", "slug", "title", "image"] },
      { model: Anime.Episode, as: "episode", attributes: ["id", "number", "title", "thumbnail"] },
    ],
    order: [["updatedAt", "DESC"]],
  });

  const seen = new Set();
  const data = rows.filter((row) => {
    if (seen.has(row.animeId)) return false;
    seen.add(row.animeId);
    return true;
  });

  return res.status(200).send(data.slice(0, Number(req.query.limit) || 12));
});

// The player calls this every few seconds, so it is a single upsert and the
// completion flag is derived here instead of trusting the client.
exports.progress = catchAsync(async (req, res) => {
  const { episode } = req;
  const progress = Number(req.body.progress);
  const duration = Number(req.body.duration) || episode.duration || null;

  const threshold = await seenPercent();
  const completed = Boolean(duration) && (progress / duration) * 100 >= threshold;

  const [entry, created] = await Library.History.findOrCreate({
    where: { accountId: req.sessionAccount.id, episodeId: episode.id },
    defaults: { animeId: episode.animeId, progress, duration, completed },
  });

  if (!created) await entry.update({ progress, duration, completed });

  return res.status(200).send(entry);
});

exports.remove = catchAsync(async (req, res) => {
  await Library.History.destroy({
    where: { id: req.params.id, accountId: req.sessionAccount.id },
  });

  return res.status(200).send({ message: "Entry removed" });
});

exports.clear = catchAsync(async (req, res) => {
  await Library.History.destroy({ where: { accountId: req.sessionAccount.id } });

  return res.status(200).send({ message: "History cleared" });
});
