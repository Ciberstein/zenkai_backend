const Anime = require("../../models/anime.models");
const AppError = require("../../utils/appError");
const catchAsync = require("../../utils/catchAsync");
const { isInteger } = require("../../utils/validators");

const STATUSES = ['watching', 'planned', 'completed', 'on_hold', 'dropped'];

// The client always talks in MAL ids (that is what the catalog renders), so
// every write resolves one to our internal anime row before touching library.
exports.anime = catchAsync(async (req, _, next) => {
  const malId = req.params.malId ?? req.body.malId;

  if (!isInteger(malId)) {
    return next(new AppError(`Anime ID must be a valid integer`, 406));
  }

  const anime = await Anime.Anime.findOne({ where: { malId: Number(malId) } });

  if (!anime) {
    return next(new AppError(`Anime not found`, 404));
  }

  req.anime = anime;

  next();
});

exports.status = catchAsync(async (req, _, next) => {
  const { status } = req.body;

  if (status && !STATUSES.includes(status)) {
    return next(new AppError(`Status must be one of: ${STATUSES.join(', ')}`, 406));
  }

  next();
});

exports.score = catchAsync(async (req, _, next) => {
  const { score } = req.body;

  if (!isInteger(score) || Number(score) < 1 || Number(score) > 10) {
    return next(new AppError(`Score must be an integer between 1 and 10`, 406));
  }

  next();
});

exports.comment = catchAsync(async (req, _, next) => {
  const { body } = req.body;

  if (!body || !String(body).trim()) {
    return next(new AppError(`Comment body is required`, 406));
  }

  if (String(body).length > 2000) {
    return next(new AppError(`Comment cannot exceed 2000 characters`, 406));
  }

  next();
});
