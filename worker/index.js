require("dotenv").config({ quiet: true });

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Op } = require("sequelize");
const { db } = require("../database/config");
const Anime = require("../models/anime.models");
const storage = require("../services/modules/storage.service");
const syslog = require("../utils/syslog.util");
const { createContext, publishEpisode, addAudio } = require("../scripts/lib/publish");

// Worker de conversion: un proceso aparte (en Railway, un segundo servicio con
// ffmpeg) que toma los videos subidos desde el admin, los convierte a HLS, los
// publica en la carpeta del episodio y borra los originales del bucket privado.
//
// La API solo encola (anime.anime_uploads, estado `queued`); el trabajo pesado
// vive aqui para que convertir un episodio no ralentice a nadie.
//
//   npm run worker
//
// Variables: las de la base (DB_*), las de R2 (R2_*, incluido R2_UPLOAD_BUCKET) y
// FFMPEG_PATH si ffmpeg no esta en el PATH. WORKER_POLL_SECONDS (10 por defecto).
//
// Pensado para UNA instancia: una subida `processing` sin latido reciente se da
// por huerfana (el proceso murio) y se vuelve a encolar.

const POLL_MS = Math.max(2, Number(process.env.WORKER_POLL_SECONDS) || 10) * 1000;
const HEARTBEAT_MS = 30 * 1000;
const ORPHAN_MS = 3 * 60 * 1000;
const HOUSEKEEPING_MS = 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message) => console.log(`[${new Date().toLocaleTimeString("es")}] ${message}`);

let stopping = false;
let current = null;

// Toma el trabajo en cola mas antiguo. SKIP LOCKED evita que dos workers cojan el mismo.
const claim = () => db.transaction(async (transaction) => {
  const upload = await Anime.Upload.findOne({
    where: { status: "queued" },
    order: [["createdAt", "ASC"]],
    lock: transaction.LOCK.UPDATE,
    skipLocked: true,
    transaction,
  });

  if (!upload) return null;

  await upload.update({ status: "processing", startedAt: new Date(), finishedAt: null, message: "Empezando" }, { transaction });
  return upload;
});

const handle = async (ctx, upload) => {
  const { uploadBucket } = ctx.r2;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `zenkai-up-${upload.id}-`));

  // El mensaje se ve en el admin; se escribe como mucho cada 3 s para no
  // bombardear la base, y un latido periodico demuestra que sigue vivo.
  let lastMessage = "Empezando";
  let lastWrite = 0;

  const say = (message) => {
    lastMessage = message;
    if (Date.now() - lastWrite < 3000) return;
    lastWrite = Date.now();
    upload.update({ message }).catch(() => {});
  };

  const beat = setInterval(() => {
    Anime.Upload.update({ message: lastMessage }, { where: { id: upload.id } }).catch(() => {});
  }, HEARTBEAT_MS);

  current = upload;

  try {
    const episode = await Anime.Episode.findByPk(upload.episodeId, {
      include: [{ model: Anime.Anime, as: "anime", attributes: ["malId"] }],
    });

    if (!episode) throw new Error("El episodio ya no existe");

    const local = new Map();

    for (const file of upload.files) {
      say(`Descargando ${file.name}`);
      const target = path.join(dir, path.basename(file.key));
      await storage.download(uploadBucket, file.key, target);
      local.set(file.key, target);
    }

    // Un audio extra para un episodio ya publicado: solo se convierte el audio y se suma al manifiesto.
    if (upload.options.kind === "audio") {
      const file = upload.files[0];

      const added = await addAudio(ctx, {
        malId: episode.anime.malId,
        number: episode.number,
        file: local.get(file.key),
        lang: file.lang,
        offsetMs: upload.options.offset,
        log: say,
      });

      await storage.remove(uploadBucket, upload.files.map((f) => f.key));
      await upload.update({
        status: "done",
        message: ["Audio añadido", ...added.warnings].join(" · "),
        finishedAt: new Date(),
      });

      log(`✓ episodio ${upload.episodeId}: audio ${file.lang} añadido (${added.tracks} pistas)`);
      return;
    }

    const pick = (kind) => upload.files.filter((f) => f.kind === kind).map((f) => ({ lang: f.lang, file: local.get(f.key) }));

    const result = await publishEpisode(ctx, {
      malId: episode.anime.malId,
      number: episode.number,
      video: local.get(upload.files.find((f) => f.kind === "video").key),
      audio: pick("audio"),
      subs: pick("sub"),
      audioLang: upload.options.audioLang,
      server: upload.options.server,
      language: upload.options.language,
      log: say,
    });

    await storage.remove(uploadBucket, upload.files.map((f) => f.key));
    await upload.update({ status: "done", message: "Publicado", finishedAt: new Date() });

    log(`✓ episodio ${upload.episodeId} publicado: ${result.url}`);
  } catch (err) {
    log(`✗ subida ${upload.id}: ${err.message}`);
    // Los originales se quedan en el bucket: "Reintentar" no obliga a subirlos otra vez.
    await upload.update({ status: "error", message: String(err.message).slice(0, 500), finishedAt: new Date() }).catch(() => {});
  } finally {
    clearInterval(beat);
    current = null;
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

// Una subida que se quedo `processing` sin latido murio con su proceso: a la cola.
const requeueOrphans = async () => {
  const [count] = await Anime.Upload.update(
    { status: "queued", message: "Reanudando tras un reinicio" },
    { where: { status: "processing", updatedAt: { [Op.lt]: new Date(Date.now() - ORPHAN_MS) } } },
  );

  if (count) log(`${count} subida(s) huerfana(s) vuelven a la cola`);
};

// Limpieza: subidas abandonadas a medias, errores viejos y filas ya terminadas.
const housekeeping = async () => {
  const { uploadBucket } = storage.config();

  const stale = await Anime.Upload.findAll({
    where: {
      [Op.or]: [
        { status: "uploading", updatedAt: { [Op.lt]: new Date(Date.now() - DAY) } },
        { status: "error", updatedAt: { [Op.lt]: new Date(Date.now() - 7 * DAY) } },
      ],
    },
  });

  for (const upload of stale) {
    await storage.remove(uploadBucket, upload.files.map((f) => f.key)).catch(() => {});
    await upload.destroy();
  }

  const done = await Anime.Upload.destroy({ where: { status: "done", finishedAt: { [Op.lt]: new Date(Date.now() - DAY) } } });

  if (stale.length || done) log(`Limpieza: ${stale.length} abandonada(s), ${done} terminada(s)`);
};

const shutdown = async (signal) => {
  if (stopping) return;
  stopping = true;
  log(`${signal}: cerrando`);

  // Lo que se estaba convirtiendo vuelve a la cola para que el siguiente arranque lo retome.
  if (current) {
    await Anime.Upload.update(
      { status: "queued", message: "Reiniciando el servicio…" },
      { where: { id: current.id } },
    ).catch(() => {});
  }

  await db.close().catch(() => {});
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

(async () => {
  syslog.banner();

  const missing = storage.missing(storage.config(), { upload: true });
  if (missing.length) {
    syslog.fail("Worker", `Faltan variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  const ctx = await createContext();
  ctx.r2.uploadBucket = storage.config().uploadBucket;

  log(`Worker listo: busco videos en cola cada ${POLL_MS / 1000} s`);

  let lastHousekeeping = 0;

  while (!stopping) {
    try {
      // El esquema lo crea la API al arrancar; si todavia no existe, se reintenta.
      await Anime.Upload.sync();

      if (Date.now() - lastHousekeeping > HOUSEKEEPING_MS) {
        lastHousekeeping = Date.now();
        await requeueOrphans();
        await housekeeping();
      }

      const upload = await claim();

      if (upload) {
        log(`── subida ${upload.id} (episodio ${upload.episodeId})`);
        await handle(ctx, upload);
        continue;
      }
    } catch (err) {
      log(`Error del ciclo: ${err.message}`);
    }

    await sleep(POLL_MS);
  }
})().catch((err) => {
  syslog.fail("Worker", err.message);
  process.exit(1);
});
