const Accounts = require("../../models/accounts.models");
const Profile = require("../../models/profile.models");
const services = require("../../services");
const catchAsync = require("../../utils/catchAsync");
const AppError = require("../../utils/appError");
const LOG_ACTIONS = require("../../utils/log.actions");
const { hash } = require("../../utils/hash.util");
const { verifyJWT } = require("../../utils/jwt");

const meta = (req) => ({ ip: req.ip, agent: req.headers["user-agent"] ?? null });

exports.register = catchAsync(async (req, res) => {
  const { email, username, password } = req.credentials;

  const account = await Accounts.Account.create({
    email,
    username,
    password: await hash(password),
  });

  await Profile.Profiles.create({ accountId: account.id, nickname: username });

  await services.auth.issue(res, account, meta(req));

  services.logger.write({
    actorId: account.id,
    action: LOG_ACTIONS.ACCOUNT_REGISTER,
    ip: req.ip,
  });

  return res.status(201).send({
    id: account.id,
    email: account.email,
    username: account.username,
    authority: account.authority,
  });
});

exports.login = catchAsync(async (req, res) => {
  const { account } = req;

  await account.update({ lastLogin: new Date() });

  await services.auth.issue(res, account, meta(req));

  services.logger.write({
    actorId: account.id,
    action: LOG_ACTIONS.ACCOUNT_LOGIN,
    ip: req.ip,
  });

  return res.status(200).send({
    id: account.id,
    email: account.email,
    username: account.username,
    authority: account.authority,
    profile: account.profile,
  });
});

exports.logout = catchAsync(async (req, res) => {
  const refresh = req.cookies?.[services.auth.REFRESH_COOKIE];

  await services.auth.revoke(res, refresh);

  return res.status(200).send({ message: "Logged out" });
});

exports.refresh = catchAsync(async (req, res, next) => {
  const refresh = req.cookies?.[services.auth.REFRESH_COOKIE];

  if (!refresh) {
    return next(new AppError(`No refresh token provided`, 401));
  }

  const session = await Accounts.Session.findOne({ where: { token: refresh } });

  // A token that verifies but is not in the table was revoked (logout, ban,
  // password change), so it must not mint a new pair.
  if (!session || session.expiresAt < new Date()) {
    await services.auth.revoke(res, refresh);
    return next(new AppError(`Session expired, please login again`, 401));
  }

  const { id } = verifyJWT(refresh);

  const account = await Accounts.Account.findByPk(id);

  if (!account || account.status === 'banned') {
    await services.auth.revoke(res, refresh);
    return next(new AppError(`Session is no longer valid`, 401));
  }

  // Rotate: the old session row is dropped as the new one is written, so a
  // stolen refresh token stops working as soon as the real user refreshes.
  await session.destroy();
  await services.auth.issue(res, account, meta(req));

  return res.status(200).send({ message: "Session refreshed" });
});

exports.validate = catchAsync(async (req, res) => {
  return res.status(200).send({ auth: Boolean(req.sessionAccount) });
});
