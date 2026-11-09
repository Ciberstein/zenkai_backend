require("dotenv").config();

const { db } = require("../database/config");
const { ensureColumns } = require("../database/migrations");
const init = require("../models/init.models");
const catalog = require("../services/modules/catalog.service");
const syslog = require("../utils/syslog.util");

// Trae las listas de episodios de los titulos ya replicados, empezando por los
// mas populares. Se puede cortar y relanzar: los que ya se trajeron quedan
// marcados y no se vuelven a pedir.
//
//   npm run sync:episodes           -> 100 titulos
//   npm run sync:episodes -- 500    -> 500 titulos
const maxTitles = Number(process.argv[2]) || 100;

const run = async () => {
  syslog.banner();

  await db.authenticate();
  syslog.ok('DATABASE AUTH STATUS', 'AUTHENTICATED');

  init();
  await ensureColumns();
  await db.sync({ force: false });

  const started = Date.now();

  const result = await catalog.backfillEpisodes({
    maxTitles,
    onProgress: ({ title, count, error, synced, total, aborted }) => {
      if (aborted) return syslog.fail('Episodes', 'too many consecutive failures, upstream is down');
      if (error) return syslog.warn('EPISODES', `${title} skipped (${error})`);

      syslog.info('EPISODES', `${synced}/${total} · ${title} · ${count} episodes`);
    },
  });

  const minutes = ((Date.now() - started) / 60000).toFixed(1);
  syslog.ok('EPISODES', `${result.synced}/${result.pending} titles · ${result.episodes} episodes · ${minutes} min`);
};

run()
  .then(async () => { await db.close(); process.exit(0); })
  .catch(async (err) => {
    syslog.fail('Episodes', err.message);
    await db.close().catch(() => {});
    process.exit(0);
  });
