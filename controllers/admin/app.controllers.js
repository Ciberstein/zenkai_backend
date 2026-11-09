const App = require("../../models/app.models");
const Accounts = require("../../models/accounts.models");
const services = require("../../services");
const catchAsync = require("../../utils/catchAsync");
const LOG_ACTIONS = require("../../utils/log.actions");
const { paginate, meta } = require("../../utils/pagination.util");

exports.config = catchAsync(async (_, res) => {
  const categories = await App.Category.findAll({
    include: [{ model: App.Config, as: "items" }],
    order: [["id", "ASC"], [{ model: App.Config, as: "items" }, "key", "ASC"]],
  });

  return res.status(200).send(categories);
});

exports.update = catchAsync(async (req, res, next) => {
  const item = await App.Config.findByPk(req.params.id);

  if (!item) {
    return res.status(404).send({ status: "error", message: "Config key not found" });
  }

  await item.update({ value: String(req.body.value) });

  services.logger.fromRequest(req, {
    action: LOG_ACTIONS.CONFIG_UPDATE,
    meta: { key: item.key, value: item.value },
  });

  return res.status(200).send(item);
});

exports.logs = catchAsync(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const { action } = req.query;

  const { count, rows } = await App.Log.findAndCountAll({
    where: action ? { action } : {},
    include: [
      { model: Accounts.Account, as: "actor", attributes: ["id", "username"] },
      { model: Accounts.Account, as: "target", attributes: ["id", "username"] },
    ],
    order: [["createdAt", "DESC"]],
    limit,
    offset,
  });

  return res.status(200).send({ data: rows, pagination: meta({ page, limit, count }) });
});
