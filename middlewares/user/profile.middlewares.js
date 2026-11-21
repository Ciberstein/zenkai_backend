const multer = require("multer");
const AppError = require("../../utils/appError");
const catchAsync = require("../../utils/catchAsync");

// `avatar` no esta: la foto de perfil solo entra por la subida (POST /avatar, que la guarda en
// Cloudinary). Aceptar aqui una URL cualquiera dejaria meter imagenes de terceros en la web.
const FIELDS = ["nickname", "cover", "bio", "country", "language", "preferences"];

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

  req.payload = payload;

  next();
});
