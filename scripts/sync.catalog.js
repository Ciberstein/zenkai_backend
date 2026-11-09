require("dotenv").config();

const { db } = require("../database/config");
const { createSchemas } = require("../database/schemas");
const { ensureColumns } = require("../database/migrations");
const init = require("../models/init.models");
const catalog = require("../services/modules/catalog.service");
const syslog = require("../utils/syslog.util");

// Backfill del catalogo completo de MAL. Se puede cortar con Ctrl+C y volver a
// lanzar: retoma por la pagina que quedo pendiente.
//
//   npm run sync:catalog             -> hasta terminar
//   npm run sync:catalog -- 20       -> solo 20 paginas (500 titulos)
//   npm run sync:catalog -- 20 mal   -> forzando una fuente (mal | anime | top)
const maxPages = Number(process.argv[2]) || Infinity;
const source = process.argv[3];

const run = async () => {
  syslog.banner();

  await db.authenticate();
  syslog.ok('DATABASE AUTH STATUS', 'AUTHENTICATED');

  init();
  await createSchemas();
  await db.sync({ force: false });
  await ensureColumns();

  const feed = source ? catalog.SOURCES[source] : await catalog.pickSource();

  if (!feed) {
    syslog.fail('Backfill', 'no Jikan catalog endpoint is responding, try again later');
    return;
  }

  const job = await catalog.state(feed.job);
  syslog.ok('BACKFILL SOURCE', `${feed.label} (page ${job.cursor})`);

  const started = Date.now();

  const result = await catalog.backfill({
    maxPages,
    source: feed.key,
    onProgress: ({ page, processed, failed, lastPage, error, retrying }) => {
      if (retrying) return syslog.info('BACKFILL', `retrying ${retrying} failed pages`);

      if (error) return syslog.warn('BACKFILL', `page ${page} skipped (${error}) · ${failed} pending`);

      // Una linea por pagina son 1.200 lineas de ruido: se informa cada 10.
      if (page % 10 !== 0) return;

      const percent = lastPage ? ` (${Math.round((page / lastPage) * 100)}%)` : '';
      syslog.info('BACKFILL', `page ${page}${lastPage ? `/${lastPage}` : ''}${percent} · ${processed} titles · ${failed} pending`);
    },
  });

  const minutes = ((Date.now() - started) / 60000).toFixed(1);
  const label = result.finished ? 'COMPLETED' : (result.aborted ? 'ABORTED (upstream down)' : 'PAUSED');

  syslog.ok('BACKFILL', `${label} · ${result.processed} titles · ${result.failed} pages pending · ${minutes} min`);

  if (result.failed) {
    syslog.warn('BACKFILL', 'run it again later to pick up the pending pages');
  }
};

run()
  .then(async () => { await db.close(); process.exit(0); })
  .catch(async (err) => {
    syslog.fail('Backfill', err.message);
    // Se sale en 0 aposta: que Jikan se caiga a media faena es lo esperado y
    // el cursor ya quedo guardado, no es un fallo del script.
    await db.close().catch(() => {});
    process.exit(0);
  });
