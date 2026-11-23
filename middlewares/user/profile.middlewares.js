const multer = require("multer");
const AppError = require("../../utils/appError");
const catchAsync = require("../../utils/catchAsync");

// `avatar` no esta: la foto de perfil solo entra por la subida (POST /avatar, que la guarda en
// Cloudinary). Aceptar aqui una URL cualquiera dejaria meter imagenes de terceros en la web.
const FIELDS = ["nickname", "cover", "bio", "country", "language", "preferences"];

const CAPTION_FONTS = ["default", "sans", "serif", "mono", "casual"];

// Las preferencias del reproductor se limpian clave a clave: solo entra lo conocido y con su rango,
// lo demas se descarta. Devuelve null si el valor no es un objeto.
const cleanPreferences = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const out = {};
  const bool = (key) => { if (typeof value[key] === "boolean") out[key] = value[key]; };
  const text = (key, max) => { if (typeof value[key] === "string" && value[key].length <= max) out[key] = value[key]; };

  bool("autoplay");
  bool("autoNext");
  text("quality", 16);
  text("language", 16);

  const sub = value.subtitles;

  if (sub && typeof sub === "object" && !Array.isArray(sub)) {
    const size = Number(sub.size);
    const opacity = Number(sub.opacity);

    if (!Number.isFinite(size) || size < 50 || size > 200
      || !Number.isFinite(opacity) || opacity < 0 || opacity > 100
      || !/^#[0-9a-f]{6}$/i.test(sub.color) || !CAPTION_FONTS.includes(sub.font)) {
      return false;
    }

    out.subtitles = { size, opacity, color: sub.color.toLowerCase(), font: sub.font };
  }

  return out;
};

const MAX_AVATAR = 5 * 1024 * 1024;

const parseAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR, files: 1 },
}).single("avatar");

// Lo que dice el propio archivo (sus primeros bytes), no lo que declare el navegador.
const isImage = (buffer) =>
  (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)                                                  // JPEG
  || (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))  // PNG
  || (buffer.length > 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP");    // WebP

// Foto de perfil: un archivo en el campo "avatar", JPEG / PNG / WebP, de hasta 5 MB.
exports.avatar = (req, res, next) => parseAvatar(req, res, (err) => {
  if (err) {
    return next(new AppError(err.code === "LIMIT_FILE_SIZE" ? `The image cannot exceed 5 MB` : `Invalid upload`, 406));
  }

  if (!req.file) {
    return next(new AppError(`An image is required in the "avatar" field`, 406));
  }

  if (!isImage(req.file.buffer)) {
    return next(new AppError(`The file must be a JPEG, PNG or WebP image`, 406));
  }

  next();
});

// Whitelist: the payload is written straight to the row, so anything not
// listed here (accountId included) must never survive the request.
exports.update = catchAsync(async (req, _, next) => {
  const payload = Object.fromEntries(
    Object.entries(req.body).filter(([key]) => FIELDS.includes(key))
  );

  if (!Object.keys(payload).length) {
    return next(new AppError(`No valid fields to update`, 406));
  }

  if (payload.nickname && String(payload.nickname).trim().length < 3) {
    return next(new AppError(`Nickname must be at least 3 characters`, 406));
  }

  if (payload.bio && String(payload.bio).length > 500) {
    return next(new AppError(`Bio cannot exceed 500 characters`, 406));
  }

  if (payload.preferences !== undefined) {
    const preferences = cleanPreferences(payload.preferences);

    if (!preferences) {
      return next(new AppError(`Invalid preferences`, 406));
    }

    payload.preferences = preferences;
  }

  req.payload = payload;

  next();
});
