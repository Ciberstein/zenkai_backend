const cron = require("node-cron");
const { Op } = require("sequelize");
const Anime = require("../models/anime.models");
const redis = require("../services/modules/redis.service");
const catalog = require("./handlers/catalog.handler");
const syslog = require("../utils/syslog.util");

// ─── Trabajos ─────────────────────────────────────────────────────────────────
//
// `schedule` es el texto que ve el panel; `expression` es el cron real (UTC).
// `lock` agrupa trabajos que no pueden correr a la vez: la continuacion horaria
// del backfill y la resincronizacion semanal recorren el mismo catalogo y
// pisarian el mismo cursor. `when` evita registrar ejecuciones vacias.
const JOBS = [
  {
    name: 'catalog:refresh',
    label: 'Refresco diario',
    description: 'Puntuaciones, miembros y episodios de lo que está en emisión, de los próximos estrenos y de lo más popular.',
    schedule: 'Todos los días · 05:00 UTC',
    expression: '0 5 * * *',
    handler: catalog.refresh,
    ttl: 1800,
  },
  {
    name: 'catalog:airing-episodes',
    label: 'Episodios nuevos',
    description: 'Busca los capítulos recién emitidos de las series en emisión, empezando por las que más tiempo llevan sin revisarse.',
    schedule: 'Cada 6 horas',
    expression: '15 */6 * * *',
    handler: catalog.airingEpisodes,
    ttl: 3600,
  },
  {
    name: 'catalog:full-sync',
    label: 'Resincronización completa',
    description: 'Recorre el catálogo entero para actualizar estados, puntuaciones y estrenos de todos los títulos. No pisa lo que editas en el panel.',
    schedule: 'Domingos · 03:00 UTC',
    expression: '0 3 * * 0',
    handler: catalog.fullSync,
    lock: 'catalog:backfill',
    ttl: 3600,
  },
  {
    name: 'catalog:backfill',
    label: 'Continuar barrido',
    description: 'Retoma el barrido del catálogo si quedó a medias. Solo actúa cuando hay algo pendiente.',
    schedule: 'Cada hora',
    expression: '0 * * * *',
    handler: catalog.resume,
    when: catalog.resumePending,
    lock: 'catalog:backfill',
    ttl: 3600,
  },
  {
    name: 'catalog:episodes',
    label: 'Listas de episodios',
    description: 'Trae la lista de episodios de los títulos populares que todavía no la tienen. Solo actúa cuando hay algo pendiente.',
    schedule: 'Cada hora, minuto 30',
    expression: '30 * * * *',
    handler: catalog.episodes,
    when: catalog.episodesPending,
    ttl: 3600,
  },
];

// El estado de cada trabajo se guarda en `anime_sync_state` con este prefijo
// para no chocar con las filas del propio backfill (`catalog:backfill:mal`).
const KEY = (name) => `job:${name}`;

const find = (name) => JOBS.find((job) => job.name === name);
const lockOf = (job) => job.lock ?? job.name;

const tasks = new Map();   // name -> tarea de node-cron (para la proxima ejecucion)
const active = new Map();  // name -> Date de inicio, solo de este proceso

// Dos trabajos con el mismo bloqueo no pueden estar activos a la vez.
const busy = (job) =>
  [...active.keys()].some((name) => lockOf(find(name)) === lockOf(job));

// ─── Ejecucion ────────────────────────────────────────────────────────────────

const execute = async (job, trigger) => {
  const token = await redis.acquire(lockOf(job), job.ttl);

  // Otro proceso ya lo esta ejecutando.
  if (!token) {
    active.delete(job.name);
    syslog.info('SCHEDULER', `${job.name} omitido: lo ejecuta otra instancia`);
    return;
  }

  let row = null;

  try {
    // Solo los trabajos automaticos consultan `when`: si alguien pulsa
    // "Ejecutar ahora", se ejecuta aunque no haya nada pendiente.
    if (trigger === 'cron' && job.when && !(await job.when())) return;

    row = await track(job.name);
    await row.update({ status: 'running', startedAt: new Date(), finishedAt: null, message: null });

    const result = await job.handler();

    await row.update({
      status: 'done',
      processed: result?.processed ?? 0,
      message: result?.message ?? null,
      finishedAt: new Date(),
    });

    syslog.success('SCHEDULER', `${job.name} · ${result?.message ?? 'ok'}`);
  } catch (err) {
    syslog.fail('Scheduler', `${job.name}: ${err.message}`);
    await row?.update({ status: 'error', message: err.message, finishedAt: new Date() }).catch(() => {});
  } finally {
    active.delete(job.name);
    await redis.release(lockOf(job), token);
  }
};

const track = async (name) => {
  const [row] = await Anime.SyncState.findOrCreate({ where: { job: KEY(name) }, defaults: { cursor: 1 } });
  return row;
};

// Arranca un trabajo sin esperar a que termine. Las comprobaciones y el alta en
// `active` ocurren antes del primer `await`, asi que dos llamadas seguidas no
// pueden colarse las dos.
const start = (name, { trigger = 'cron' } = {}) => {
  const job = find(name);

  if (!job) return { status: 'unknown' };
  if (active.has(name) || busy(job)) return { status: 'busy' };

  active.set(name, new Date());
  execute(job, trigger).catch((err) => syslog.fail("Scheduler", `${job.name}: ${err.message}`));

  return { status: 'started' };
};

// ─── Consulta (panel de admin) ────────────────────────────────────────────────

const list = async () => {
  const rows = await Anime.SyncState.findAll({
    where: { job: { [Op.in]: JOBS.map((job) => KEY(job.name)) } },
  });

  return JOBS.map((job) => {
    const row = rows.find((item) => item.job === KEY(job.name));
    // "En curso" tambien si lo dice la base: con varias instancias, el trabajo
    // puede estar corriendo en otro proceso y `active` solo conoce el propio.
    const running = active.has(job.name) || row?.status === 'running';

    return {
      name: job.name,
      label: job.label,
      description: job.description,
      schedule: job.schedule,
      running,
      status: running ? 'running' : (row?.status ?? 'idle'),
      startedAt: active.get(job.name) ?? row?.startedAt ?? null,
      finishedAt: running ? null : (row?.finishedAt ?? null),
      processed: row?.processed ?? 0,
      message: running ? null : (row?.message ?? null),
      nextRun: tasks.get(job.name)?.getNextRun?.() ?? null,
    };
  });
};

// ─── Arranque ─────────────────────────────────────────────────────────────────

const init = async () => {
  // Una ejecucion que quedo "en curso" cuando el proceso murio ya no esta
  // corriendo: se marca como interrumpida para no mostrarla girando para siempre.
  // Salvo que otra instancia tenga el bloqueo: ahi sigue corriendo de verdad.
  for (const job of JOBS) {
    if (await redis.isLocked(lockOf(job))) continue;

    await Anime.SyncState.update(
      { status: 'error', message: 'Interrumpido por un reinicio del servidor', finishedAt: new Date() },
      { where: { job: KEY(job.name), status: 'running' } },
    );
  }

  for (const job of JOBS) {
    tasks.set(
      job.name,
      cron.schedule(job.expression, () => start(job.name, { trigger: 'cron' }), { timezone: 'UTC' }),
    );
  }

  syslog.ok('SCHEDULER STATUS', `${JOBS.length} JOBS SCHEDULED`);
};

module.exports = { init, start, list, JOBS };
