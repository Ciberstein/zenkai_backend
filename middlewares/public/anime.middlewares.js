const Anime = require("../../models/anime.models");
const AppError = require("../../utils/appError");
const catchAsync = require("../../utils/catchAsync");
const { isInteger } = require("../../utils/validators");

// Resuelve :malId contra el espejo local. Que no este no es error: puede ser
// una entrada nueva de MAL o que el backfill aun no haya llegado ahi, y el
// controller la pide en vivo y la guarda.
exports.anime = catchAsync(async (req, _, next) => {
  const { malId } = req.params;

  if (!isInteger(malId)) {
    return next(new AppError(`Anime ID must be a valid integer`, 406));
  }

  req.malId = Number(malId);
  req.anime = await Anime.Anime.findOne({
    where: { malId: req.malId, visible: true },
    include: [{ model: Anime.Genre, as: "genres", attributes: ["id", "name", "slug"], through: { attributes: [] } }],
  });

  // Reproducible = tiene al menos un episodio visible con una fuente activa.
  // Estar en el catalogo no implica poder verlo: el espejo trae las ~29.000
  // entradas de MAL y solo unas pocas tienen video detras.
  req.available = req.anime
    ? Boolean(await Anime.Episode.count({
        where: { animeId: req.anime.id, visible: true },
        include: [{ model: Anime.Source, as: "sources", where: { active: true }, required: true }],
      }))
    : false;

  next();
});

// Igual que el anterior pero el registro local es obligatorio: lo usan los
// endpoints que sirven contenido reproducible (episodios, fuentes, comentarios).
exports.local = catchAsync(async (req, _, next) => {
  if (!req.anime) {
    return next(new AppError(`This title is not available for streaming yet`, 404));
  }

  next();
});

exports.season = catchAsync(async (req, _, next) => {
  const { year, season } = req.params;
  const seasons = ['winter', 'spring', 'summer', 'fall'];

  if (!isInteger(year) || Number(year) < 1917 || Number(year) > new Date().getFullYear() + 2) {
    return next(new AppError(`Year must be a valid season year`, 406));
  }

  if (!seasons.includes(String(season).toLowerCase())) {
    return next(new AppError(`Season must be one of: ${seasons.join(', ')}`, 406));
  }

  req.season = { year: Number(year), season: String(season).toLowerCase() };

  next();
});
