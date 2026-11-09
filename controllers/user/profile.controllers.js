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
