const App = require("../../models/app.models");
const catchAsync = require("../../utils/catchAsync");

// Flattened into { key: value } because the frontend reads it straight from
// the redux store as config['project_name'].
exports.config = catchAsync(async (_, res) => {
  const rows = await App.Config.findAll({
    where: { public: true },
    attributes: ["key", "value", "type"],
  });

  const parse = ({ value, type }) => {
    if (type === 'boolean') return value === 'true';
    if (type === 'number') return Number(value);
    if (type === 'json') return JSON.parse(value ?? 'null');
    return value;
  };

  const config = Object.fromEntries(rows.map((row) => [row.key, parse(row)]));

  return res.status(200).send(config);
});

exports.languages = catchAsync(async (_, res) => {
  const languages = await App.Language.findAll({
    where: { active: true },
    attributes: ["id", "code", "name"],
    order: [["code", "ASC"]],
  });

  return res.status(200).send(languages);
});
