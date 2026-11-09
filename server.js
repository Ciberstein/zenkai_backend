require("dotenv").config();
const { server } = require("./app");
const { db } = require("./database/config");
const { createSchemas } = require("./database/schemas");
const { ensureColumns } = require("./database/migrations");
const init = require("./models/init.models");
const scheduler = require("./scheduler");
const syslog = require("./utils/syslog.util");

// SEEDERS
const { role_seeder } = require("./seeders/role.seeders");
const { genre_seeder } = require("./seeders/anime.seeders");
const {
  app_config_categories_seeder,
  app_config_seeder,
  app_languages_seeder,
} = require("./seeders/app.seeders");

const PORT = process.env.PORT || 3010;

syslog.banner();

// Arranque secuencial a proposito: los schemas tienen que existir antes de
// sincronizar, y las columnas nuevas antes de que sync intente crear sus
// indices. Encadenarlo evita esa carrera.
const boot = async () => {
  await db.authenticate();
  syslog.ok('DATABASE AUTH STATUS', 'AUTHENTICATED');

  init();

  await createSchemas();
  await ensureColumns();

  await db.sync({ force: false });
  syslog.ok('DATABASE STATUS', 'SYNC');

  const row = (group, name, status) => ({ group, name, status });
  const seederRows = [
    row('APP',   'Config Categories', await app_config_categories_seeder()),
    row('APP',   'Config',            await app_config_seeder()),
    row('APP',   'Languages',         await app_languages_seeder()),
    row('ROLES', 'Roles',             await role_seeder()),
    row('ANIME', 'Genres',            await genre_seeder()),
  ];

  syslog.table(seederRows);

  await scheduler.init();
};

boot().catch((err) => syslog.fail('Boot', err.message));

server.listen(PORT, () => {
  syslog.ok('SERVER PORT', PORT);
});
