const { db } = require("./config");

const SCHEMAS = [
  "accounts",
  "profile",
  "anime",
  "library",
  "app",
];

const createSchemas = async () => {
  // Sequelize v6's qi.createSchema doesn't honor `ifNotExists`, so list
  // first and only create the missing ones. `showAllSchemas` may yield
  // either strings or `{ schema_name }` objects depending on the dialect
  // build, so normalise.
  const qi = db.getQueryInterface();
  const rows = await qi.showAllSchemas();
  const existing = new Set(rows.map((r) => typeof r === 'string' ? r : r.schema_name));
  const missing = SCHEMAS.filter((s) => !existing.has(s));
  await Promise.all(missing.map((s) => qi.createSchema(s)));
  console.log(
    "\x1b[34mSCHEMAS STATUS:\x1b[0m",
    "\x1b[32mREADY\x1b[0m"
  );
};

module.exports = { createSchemas };
