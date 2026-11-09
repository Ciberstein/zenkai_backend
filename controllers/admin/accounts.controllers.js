const Accounts = require("../../models/accounts.models");
const Profile = require("../../models/profile.models");
const services = require("../../services");
const catchAsync = require("../../utils/catchAsync");
const LOG_ACTIONS = require("../../utils/log.actions");
const { paginate, meta } = require("../../utils/pagination.util");
const { Op } = require("sequelize");

exports.accounts = catchAsync(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const { q, status } = req.query;

  const { count, rows } = await Accounts.Account.findAndCountAll({
    where: {
      ...(status ? { status } : {}),
      ...(q ? {
        [Op.or]: [
          { username: { [Op.iLike]: `%${q}%` } },
          { email: { [Op.iLike]: `%${q}%` } },
        ],
      } : {}),
    },
    attributes: ["id", "email", "username", "authority", "status", "verified", "lastLogin", "createdAt"],
    include: [{ model: Profile.Profiles, as: "profile", attributes: ["nickname", "avatar"] }],
    order: [["createdAt", "DESC"]],
    limit,
    offset,
  });

  return res.status(200).send({ data: rows, pagination: meta({ page, limit, count }) });
});

exports.account = catchAsync(async (req, res) => {
  return res.status(200).send(req.account);
});

exports.update = catchAsync(async (req, res) => {
  const { account, payload } = req;

  await account.update(payload);

  // Banning must take effect immediately, not when the access token expires.
  if (payload.status === 'banned') {
    await Accounts.Session.destroy({ where: { accountId: account.id } });
  }

  services.logger.fromRequest(req, {
    action: LOG_ACTIONS.ACCOUNT_STATUS,
    targetId: account.id,
    meta: payload,
  });

  return res.status(200).send(account);
});

exports.roles = catchAsync(async (_, res) => {
  const roles = await Accounts.Role.findAll({ order: [["authority", "ASC"]] });

  return res.status(200).send(roles);
});
