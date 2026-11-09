const Anime = require("../../models/anime.models");
const AppError = require("../../utils/appError");
const catchAsync = require("../../utils/catchAsync");
const { isInteger } = require("../../utils/validators");

exports.anime = catchAsync(async (req, _, next) => {
  const { id } = req.params;

  if (!isInteger(id)) {
    return next(new AppError(`Anime ID must be a valid integer`, 406));
  }

  const anime = await Anime.Anime.findByPk(id);

  if (!anime) {
    return next(new AppError(`Anime not found`, 404));
  }

  req.anime = anime;

  next();
});

exports.episode = catchAsync(async (req, _, next) => {
  const { id } = req.params;

  if (!isInteger(id)) {
    return next(new AppError(`Episode ID must be a valid integer`, 406));
  }

  const episode = await Anime.Episode.findByPk(id);

  if (!episode) {
    return next(new AppError(`Episode not found`, 404));
  }

  req.episode = episode;

  next();
});

exports.source = catchAsync(async (req, _, next) => {
  const { server, url, type, language } = req.body;

  if (!server || !url) {
    return next(new AppError(`Server and url are required`, 406));
  }

  try {
    new URL(url);
  } catch {
    return next(new AppError(`Source url must be a valid URL`, 406));
  }

  if (type && !['hls', 'mp4', 'embed'].includes(type)) {
    return next(new AppError(`Type must be one of: hls, mp4, embed`, 406));
  }

  if (language && !['sub', 'dub'].includes(language)) {
    return next(new AppError(`Language must be sub or dub`, 406));
  }

  next();
});
