const Accounts = require("../../models/accounts.models");
const Profile = require("../../models/profile.models");
const services = require("../../services");
const catchAsync = require("../../utils/catchAsync");
const LOG_ACTIONS = require("../../utils/log.actions");
const { hash } = require("../../utils/hash.util");

exports.account = catchAsync(async (req, res) => {
  const account = await Accounts.Account.findOne({
    where: { id: req.sessionAccount.id },
    attributes: ["id", "email", "username", "authority", "status", "verified", "lastLogin", "createdAt"],
    include: [{ model: Profile.Profiles, as: "profile" }],
  });

  return res.status(200).send(account);
});

exports.password = catchAsync(async (req, res) => {
  const { account } = req;

  await account.update({ password: await hash(req.body.password) });

  // Every other device is logged out: the refresh tokens in the table are the
  // only way to mint a new access token, so dropping them ends those sessions.
  await Accounts.Session.destroy({ where: { accountId: account.id } });

  await services.auth.revoke(res, req.cookies?.[services.auth.REFRESH_COOKIE]);

  services.logger.fromRequest(req, { action: LOG_ACTIONS.ACCOUNT_PASSWORD });

  return res.status(200).send({ message: "Password updated, please login again" });
});

exports.sessions = catchAsync(async (req, res) => {
  const sessions = await Accounts.Session.findAll({
    where: { accountId: req.sessionAccount.id },
    attributes: ["id", "ip", "agent", "expiresAt", "createdAt"],
    order: [["createdAt", "DESC"]],
  });

  return res.status(200).send(sessions);
});

exports.revoke = catchAsync(async (req, res) => {
  await Accounts.Session.destroy({
    where: { id: req.params.id, accountId: req.sessionAccount.id },
  });

  return res.status(200).send({ message: "Session revoked" });
});
