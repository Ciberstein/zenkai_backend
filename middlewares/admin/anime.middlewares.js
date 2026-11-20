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

exports.subtitle = catchAsync(async (req, _, next) => {
  const { language, label, url } = req.body;

  if (!language || !label || !url) {
    return next(new AppError(`Language, label and url are required`, 406));
  }

  if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(language)) {
    return next(new AppError(`Language must be a code like es, en or es-419`, 406));
  }

  try {
    new URL(url);
  } catch {
    return next(new AppError(`Subtitle url must be a valid URL`, 406));
  }

  next();
});

// ── Subida de episodios desde el admin ───────────────────────────────────────

const VIDEO_EXT = [".mkv", ".mp4", ".m4v", ".mov", ".avi", ".webm", ".ts"];
const AUDIO_EXT = [".m4a", ".aac", ".mka", ".mp3", ".flac", ".wav", ".ac3", ".opus", ".ogg"];
const SUB_EXT = [".srt", ".ass", ".ssa", ".vtt"];
const MAX_BYTES = 5 * 1024 ** 3; // limite de una sola subida a R2
const MAX_EXTRAS = 30;
const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

const extOf = (name) => (String(name).toLowerCase().match(/\.[a-z0-9]+$/) ?? [""])[0];

// Valida lo que el navegador va a subir ANTES de darle las URLs firmadas.
exports.uploadRequest = catchAsync(async (req, _, next) => {
  const { filename, size, extras = [], options = {} } = req.body;

  if (!filename || !VIDEO_EXT.includes(extOf(filename))) {
    return next(new AppError(`Video must be one of: ${VIDEO_EXT.join(", ")}`, 406));
  }

  if (!Number.isInteger(size) || size <= 0 || size > MAX_BYTES) {
    return next(new AppError("Video size must be between 1 byte and 5 GB", 406));
  }

  if (!Array.isArray(extras) || extras.length > MAX_EXTRAS) {
    return next(new AppError(`Extras must be a list of at most ${MAX_EXTRAS} files`, 406));
  }

  for (const extra of extras) {
    const allowed = extra.kind === "audio" ? AUDIO_EXT : extra.kind === "sub" ? SUB_EXT : null;

    if (!allowed || !allowed.includes(extOf(extra.filename))) {
      return next(new AppError(`Each extra must be audio (${AUDIO_EXT.join(", ")}) or subtitles (${SUB_EXT.join(", ")})`, 406));
    }

    if (!LANG.test(extra.lang ?? "")) {
      return next(new AppError("Extra language must be a code like es, en or es-419", 406));
    }

    if (!Number.isInteger(extra.size) || extra.size <= 0 || extra.size > MAX_BYTES) {
      return next(new AppError("Extra size must be between 1 byte and 5 GB", 406));
    }
  }

  if (options.language && !["sub", "dub"].includes(options.language)) {
    return next(new AppError("Language must be sub or dub", 406));
  }

  if (options.audioLang && !LANG.test(options.audioLang)) {
    return next(new AppError("Audio language must be a code like ja or es", 406));
  }

  next();
});

exports.upload = catchAsync(async (req, _, next) => {
  const { id } = req.params;

  if (!isInteger(id)) {
    return next(new AppError("Upload ID must be a valid integer", 406));
  }

  const upload = await Anime.Upload.findByPk(id);

  if (!upload) {
    return next(new AppError("Upload not found", 404));
  }

  req.upload = upload;

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
