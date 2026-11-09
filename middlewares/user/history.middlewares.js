const Anime = require("../../models/anime.models");
const AppError = require("../../utils/appError");
const catchAsync = require("../../utils/catchAsync");
const { isInteger } = require("../../utils/validators");

exports.progress = catchAsync(async (req, _, next) => {
  const { episodeId, progress } = req.body;

  if (!isInteger(episodeId)) {
    return next(new AppError(`Episode ID must be a valid integer`, 406));
  }

  if (!isInteger(progress) || Number(progress) < 0) {
    return next(new AppError(`Progress must be a positive integer (seconds)`, 406));
  }

  const episode = await Anime.Episode.findByPk(Number(episodeId));

  if (!episode) {
    return next(new AppError(`Episode not found`, 404));
  }

  req.episode = episode;

  next();
});
