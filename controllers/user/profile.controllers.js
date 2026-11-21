const Accounts = require("../../models/accounts.models");
const Profile = require("../../models/profile.models");
const Library = require("../../models/library.models");
const Anime = require("../../models/anime.models");
const services = require("../../services");
const catchAsync = require("../../utils/catchAsync");
const AppError = require("../../utils/appError");
const LOG_ACTIONS = require("../../utils/log.actions");

exports.profile = catchAsync(async (req, res, next) => {
  const id = req.params.id ?? req.sessionAccount.id;

  const account = await Accounts.Account.findOne({
    where: { id },
    attributes: ["id", "username", "authority", "createdAt"],
    include: [
      { model: Profile.Profiles, as: "profile" },
      {
        as: 'favorites',
        model: Library.Favorite,
        attributes: ["id"],
        include: [{
          as: 'anime',
          model: Anime.Anime,
          attributes: ["id", "malId", "slug", "title", "image"],
        }],
      },
    ],
  });

  if (!account) {
    return next(new AppError(`Profile not found`, 404));
  }

  return res.status(200).send(account);
});

// Foto de perfil: se sube a Cloudinary (zenkai/avatars), se guarda su URL y se borra la anterior.
// El recorte cuadrado lo hace el navegador; aqui solo se limita el tamano (512 px como mucho).
exports.avatar = catchAsync(async (req, res) => {
  if (!services.cloudinary.enabled()) {
    // 501 y no 503: el interceptor del frontend cierra la sesion con cualquier 503.
    throw new AppError(`Image uploads are not configured`, 501);
  }

  const profile = await Profile.Profiles.findOne({ where: { accountId: req.sessionAccount.id } });

  let url;

  try {
    url = await services.cloudinary.upload(req.file.buffer, "avatars", { width: 512, height: 512, crop: "limit", quality: "auto" });
  } catch (err) {
    console.error(`[cloudinary] upload failed: ${err.message}`);
    throw new AppError(`The image could not be uploaded, try again`, 502);
  }

  const previous = profile.avatar;

  await profile.update({ avatar: url });
  await services.cloudinary.destroy(previous);

  services.logger.fromRequest(req, { action: LOG_ACTIONS.ACCOUNT_UPDATE, meta: { fields: ["avatar"] } });

  return res.status(200).send(profile);
});

exports.removeAvatar = catchAsync(async (req, res) => {
  const profile = await Profile.Profiles.findOne({ where: { accountId: req.sessionAccount.id } });
  const previous = profile.avatar;

  await profile.update({ avatar: null });
  await services.cloudinary.destroy(previous);

  services.logger.fromRequest(req, { action: LOG_ACTIONS.ACCOUNT_UPDATE, meta: { fields: ["avatar"] } });

  return res.status(200).send(profile);
});

exports.update = catchAsync(async (req, res) => {
  const profile = await Profile.Profiles.findOne({
    where: { accountId: req.sessionAccount.id },
  });

  await profile.update(req.payload);

  services.logger.fromRequest(req, {
    action: LOG_ACTIONS.ACCOUNT_UPDATE,
    meta: { fields: Object.keys(req.payload) },
  });

  return res.status(200).send(profile);
});
