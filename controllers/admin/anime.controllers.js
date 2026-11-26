const Anime = require("../../models/anime.models");
const services = require("../../services");
const catchAsync = require("../../utils/catchAsync");
const AppError = require("../../utils/appError");
const LOG_ACTIONS = require("../../utils/log.actions");
const { paginate, meta } = require("../../utils/pagination.util");
const { fromMal, genresFromMal, episodesFromJikan } = require("../../utils/anime.util");
const crypto = require("crypto");
const { Op, literal } = require("sequelize");
const storage = require("../../services/modules/storage.service");
const { toVtt } = require("../../utils/subtitle.util");
const hls = require("../../utils/hls.util");
const segments = require("../../services/modules/segments.service");

const { jikan, mal } = services;

exports.list = catchAsync(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const { q } = req.query;

  const { count, rows } = await Anime.Anime.findAndCountAll({
    where: q ? { title: { [Op.iLike]: `%${q}%` } } : {},
    attributes: {
      include: [
        // Capitulos con al menos un video activo (los que ya se pueden ver).
        [
          literal(
            `(SELECT COUNT(*) FROM anime.anime_episodes e WHERE e."animeId" = "anime_anime"."id" AND EXISTS (SELECT 1 FROM anime.anime_sources s WHERE s."episodeId" = e."id" AND s."active" = true))`
          ),
          "loadedEpisodes",
        ],
      ],
    },
    include: [{ model: Anime.Genre, as: "genres", attributes: ["id", "name"], through: { attributes: [] } }],
    order: [["createdAt", "DESC"]],
    distinct: true,
    limit,
    offset,
  });

  return res.status(200).send({ data: rows, pagination: meta({ page, limit, count }) });
});

// Datos basicos de un anime del catalogo (la pagina de episodios muestra su nombre).
exports.show = catchAsync(async (req, res) => {
  const { id, malId, title, titleEnglish } = req.anime;

  return res.status(200).send({ id, malId, title, titleEnglish });
});

// Trae un titulo desde la API oficial a nuestro catalogo. Se puede repetir sin
// riesgo: refresca la fila existente en vez de fallar por el malId unico.
exports.sync = catchAsync(async (req, res, next) => {
  const malId = Number(req.params.malId);

  if (!Number.isInteger(malId)) {
    return next(new AppError(`Anime ID must be a valid integer`, 406));
  }

  const payload = await mal.anime(malId);

  const [anime] = await Anime.Anime.upsert(fromMal(payload), { returning: true });

  const genres = genresFromMal(payload);

  if (genres.length) {
    await Anime.Genre.bulkCreate(genres, { ignoreDuplicates: true });

    const rows = await Anime.Genre.findAll({ where: { malId: genres.map((g) => g.malId) } });
    await anime.setGenres(rows);
  }

  services.logger.fromRequest(req, {
    action: LOG_ACTIONS.ANIME_SYNC,
    meta: { malId, title: anime.title },
  });

  return res.status(200).send(anime);
});

// Crea las fichas de los episodios desde la lista de Jikan: es el unico sitio
// de donde salen, la API oficial no expone ese endpoint (responde 403). Las
// fuentes de video se anaden aparte; ninguna de las dos APIs las tiene.
exports.syncEpisodes = catchAsync(async (req, res) => {
  const { anime } = req;

  let page = 1;
  let hasNext = true;
  const collected = [];

  while (hasNext) {
    const payload = await jikan.episodes(anime.malId, page);
    collected.push(...jikan.unwrap(payload));
    hasNext = Boolean(jikan.paginationOf(payload)?.has_next_page);
    page += 1;
  }

  await Anime.Episode.bulkCreate(
    episodesFromJikan(anime.id, collected),
    { updateOnDuplicate: ["title", "filler", "recap", "aired"] }
  );

  services.logger.fromRequest(req, {
    action: LOG_ACTIONS.EPISODE_CREATE,
    meta: { malId: anime.malId, episodes: collected.length },
  });

  return res.status(200).send({ synced: collected.length });
});

exports.update = catchAsync(async (req, res) => {
  const FIELDS = ["title", "synopsis", "banner", "trailer", "featured", "visible"];

  const payload = Object.fromEntries(
    Object.entries(req.body).filter(([key]) => FIELDS.includes(key))
  );

  await req.anime.update(payload);

  services.logger.fromRequest(req, {
    action: LOG_ACTIONS.ANIME_UPDATE,
    meta: { malId: req.anime.malId, fields: Object.keys(payload) },
  });

  return res.status(200).send(req.anime);
});

exports.episodes = catchAsync(async (req, res) => {
  const episodes = await Anime.Episode.findAll({
    where: { animeId: req.anime.id },
    include: [
      { model: Anime.Source, as: "sources" },
      { model: Anime.Subtitle, as: "subtitles" },
      { model: Anime.Segment, as: "segments", required: false },
      {
        // Lo que esta en curso, y lo terminado hace poco para poder mostrar el resultado.
        model: Anime.Upload,
        as: "uploads",
        required: false,
        attributes: ["id", "status", "message", "createdAt", "updatedAt", "finishedAt"],
        where: { [Op.or]: [{ status: { [Op.ne]: "done" } }, { finishedAt: { [Op.gt]: new Date(Date.now() - 10 * 60 * 1000) } }] },
      },
    ],
    order: [["number", "ASC"]],
  });

  return res.status(200).send(episodes);
});

exports.episode = catchAsync(async (req, res) => {
  const FIELDS = ["title", "thumbnail", "duration", "filler", "recap", "visible"];

  const payload = Object.fromEntries(
    Object.entries(req.body).filter(([key]) => FIELDS.includes(key))
  );

  await req.episode.update(payload);

  services.logger.fromRequest(req, {
    action: LOG_ACTIONS.EPISODE_UPDATE,
    meta: { episodeId: req.episode.id, fields: Object.keys(payload) },
  });

  return res.status(200).send(req.episode);
});

exports.source = catchAsync(async (req, res) => {
  const { server, url, type, quality, language } = req.body;

  const source = await Anime.Source.create({
    episodeId: req.episode.id,
    server,
    url,
    type: type ?? 'hls',
    quality: quality ?? 'auto',
    language: language ?? 'sub',
  });

  services.logger.fromRequest(req, {
    action: LOG_ACTIONS.SOURCE_CREATE,
    meta: { episodeId: req.episode.id, server },
  });

  return res.status(201).send(source);
});

exports.subtitle = catchAsync(async (req, res) => {
  const { language, label, url } = req.body;

  // Una sola pista por defecto por episodio: si esta lo es, la anterior deja de serlo.
  if (req.body.default) {
    await Anime.Subtitle.update({ default: false }, { where: { episodeId: req.episode.id } });
  }

  const subtitle = await Anime.Subtitle.create({
    episodeId: req.episode.id,
    language,
    label,
    url,
    default: Boolean(req.body.default),
  });

  services.logger.fromRequest(req, {
    action: LOG_ACTIONS.SUBTITLE_CREATE,
    meta: { episodeId: req.episode.id, language },
  });

  return res.status(201).send(subtitle);
});

// Sube el archivo de subtitulos desde el admin: se convierte a WebVTT aqui (sin ffmpeg), se
// guarda en la carpeta del episodio del bucket y se registra. Subir otro del mismo idioma
// reemplaza el anterior.
exports.uploadSubtitle = catchAsync(async (req, res) => {
  const cfg = storage.config();
  const absent = storage.missing(cfg);

  if (absent.length) {
    throw new AppError(`Storage is not configured: missing ${absent.join(", ")}`, 503);
  }

  const { language, label, filename } = req.query;

  let converted;

  try {
    converted = toVtt(req.body, extOf(filename));
  } catch (err) {
    throw new AppError(err.message, 406);
  }

  const anime = await Anime.Anime.findByPk(req.episode.animeId, { attributes: ["malId"] });
  const key = `anime/${anime.malId}/${req.episode.number}/subs/${language}.vtt`;

  await storage.put(cfg.bucket, key, converted.vtt, {
    contentType: "text/vtt; charset=utf-8",
    cacheControl: "public, max-age=300",
  });

  const isDefault = req.query.default === "true" || req.query.default === "1";

  if (isDefault) {
    await Anime.Subtitle.update({ default: false }, { where: { episodeId: req.episode.id } });
  }

  await Anime.Subtitle.destroy({ where: { episodeId: req.episode.id, language } });

  const subtitle = await Anime.Subtitle.create({
    episodeId: req.episode.id,
    language,
    label,
    url: `${cfg.base}/${key}`,
    default: isDefault,
  });

  services.logger.fromRequest(req, {
    action: LOG_ACTIONS.SUBTITLE_CREATE,
    meta: { episodeId: req.episode.id, language, cues: converted.cues },
  });

  return res.status(201).send({ ...subtitle.toJSON(), cues: converted.cues });
});

// Edita una pista de subtitulos ya guardada: el nombre con el que se muestra, su idioma (con el que se
// elige segun el perfil del usuario) y si es la predeterminada. No toca el archivo .vtt.
exports.updateSubtitle = catchAsync(async (req, res) => {
  const subtitle = await Anime.Subtitle.findByPk(req.params.id);

  if (!subtitle) throw new AppError("Subtitle not found", 404);

  const { label, language, default: makeDefault } = req.body ?? {};
  const changes = {};

  if (label !== undefined) {
    const clean = String(label).trim();

    if (!clean || clean.length > 60) throw new AppError("The name must have between 1 and 60 characters", 406);

    changes.label = clean;
  }

  if (language !== undefined) {
    const code = String(language).trim().toLowerCase();

    if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(code)) throw new AppError("Language must be a code like es, en or es-419", 406);

    if (code !== subtitle.language && await Anime.Subtitle.count({ where: { episodeId: subtitle.episodeId, language: code } })) {
      throw new AppError("This episode already has subtitles in that language", 409);
    }

    changes.language = code;
  }

  if (makeDefault !== undefined) {
    if (typeof makeDefault !== "boolean") throw new AppError("default must be true or false", 406);

    // Una sola predeterminada por episodio.
    if (makeDefault) await Anime.Subtitle.update({ default: false }, { where: { episodeId: subtitle.episodeId } });

    changes.default = makeDefault;
  }

  if (!Object.keys(changes).length) throw new AppError("Nothing to update", 406);

  await subtitle.update(changes);

  services.logger.fromRequest(req, {
    action: LOG_ACTIONS.SUBTITLE_UPDATE,
    meta: { episodeId: subtitle.episodeId, subtitleId: subtitle.id, fields: Object.keys(changes) },
  });

  return res.status(200).send(subtitle);
});

exports.removeSubtitle = catchAsync(async (req, res) => {
  const subtitle = await Anime.Subtitle.findByPk(req.params.id);

  await Anime.Subtitle.destroy({ where: { id: req.params.id } });

  // Si el .vtt esta en nuestro bucket (extraido del video o subido desde el admin), se borra
  // tambien de alli para no pagar por archivos que ya nadie usa. Una URL externa no se toca,
  // ni un archivo que otra pista siga usando. Si el borrado falla, la pista ya esta quitada.
  const cfg = storage.config();

  if (subtitle && cfg.base && subtitle.url.startsWith(`${cfg.base}/anime/`) && subtitle.url.endsWith(".vtt")) {
    const key = subtitle.url.slice(cfg.base.length + 1);
    const shared = await Anime.Subtitle.count({ where: { url: subtitle.url } });

    if (!shared) await storage.remove(cfg.bucket, [key]).catch(() => {});
  }

  return res.status(200).send({ message: "Subtitle deleted" });
});

// ── Subida de episodios desde el admin ───────────────────────────────────────
//
// 1. createUpload   crea el trabajo y devuelve una URL firmada por archivo: el
//                   navegador sube directo al bucket privado, sin pasar por aqui.
// 2. completeUpload comprueba que llegaron enteros y lo deja en cola para el worker.
// 3. el worker (worker/index.js) convierte, publica y borra los originales.

const ACTIVE = ["uploading", "queued", "processing"];
const ABANDONED_MS = 30 * 60 * 1000;
const STALE_PROCESSING_MS = 3 * 60 * 1000;

const keysOf = (upload) => upload.files.map((file) => file.key);

const discard = async (upload) => {
  const { uploadBucket } = storage.config();

  // Una subida en partes sin cerrar deja partes sueltas en el bucket: se abortan.
  await Promise.all(upload.files
    .filter((file) => file.multipartId)
    .map((file) => storage.abortMultipart(uploadBucket, file.key, file.multipartId).catch(() => {})));

  await storage.remove(uploadBucket, keysOf(upload)).catch(() => {});
  await upload.destroy();
};

const extOf = (name) => (name.toLowerCase().match(/\.[a-z0-9]+$/) ?? [""])[0];

// Un PUT a R2 admite hasta 5 GB, pero uno tan grande es fragil (un corte a mitad lo pierde todo).
// Desde 1 GB se sube en partes: el navegador las envia en paralelo y reintenta solo la que falle.
const MULTIPART_FROM = 1024 ** 3;

// Prepara la subida de un archivo: una URL firmada, o varias (una por parte) si es grande.
// Anota en `file` lo necesario para cerrarla despues (multipartId, partSize, parts).
const prepare = async (cfg, file) => {
  if (file.size < MULTIPART_FROM) return { url: await storage.presignPut(cfg.uploadBucket, file.key) };

  const partSize = storage.partSizeFor(file.size);
  const count = Math.ceil(file.size / partSize);
  const uploadId = await storage.createMultipart(cfg.uploadBucket, file.key);

  Object.assign(file, { multipartId: uploadId, partSize, parts: count });

  const parts = await Promise.all(Array.from({ length: count }, (_, i) => storage.presignPart(cfg.uploadBucket, file.key, uploadId, i + 1)));

  return { parts, partSize };
};

// Un episodio solo admite una subida a la vez. Una a medias que lleva media hora sin tocarse se da
// por abandonada (cerraron la pestana): no debe bloquearlo para siempre.
const claim = async (episodeId) => {
  const current = await Anime.Upload.findOne({ where: { episodeId, status: { [Op.in]: ACTIVE } } });
  if (!current) return;

  if (current.status === "uploading" && Date.now() - current.updatedAt.getTime() > ABANDONED_MS) await discard(current);
  else throw new AppError("This episode already has an upload in progress", 409);
};

exports.createUpload = catchAsync(async (req, res) => {
  const cfg = storage.config();
  const missing = storage.missing(cfg, { upload: true, publish: false });

  if (missing.length) {
    throw new AppError(`Uploads are not configured: missing ${missing.join(", ")}`, 503);
  }

  const { filename, size, extras = [], options = {} } = req.body;

  await claim(req.episode.id);

  const upload = await Anime.Upload.create({
    episodeId: req.episode.id,
    accountId: req.sessionAccount?.id ?? null,
    options: {
      server: options.server || "Zenkai",
      language: options.language || "sub",
      audioLang: options.audioLang || "ja",
    },
  });

  // Ruta con un token aleatorio: con un solo bucket publico, un id correlativo
  // dejaria los originales a un paso de ser adivinados.
  const token = crypto.randomUUID();

  const files = [
    { kind: "video", lang: null, name: filename, size, key: `incoming/${token}/video${extOf(filename)}` },
    ...extras.map((extra, index) => ({
      kind: extra.kind,
      lang: extra.lang,
      name: extra.filename,
      size: extra.size,
      key: `incoming/${token}/${extra.kind}-${index}-${extra.lang}${extOf(extra.filename)}`,
    })),
  ];

  // Una copia: prepare() anota cosas en los objetos de `files`, y si se guardara la misma referencia
  // Sequelize no vería diferencia al guardar de nuevo y no persistiría la subida en partes.
  await upload.update({ files: structuredClone(files) });

  const targets = await Promise.all(files.map((file) => prepare(cfg, file)));

  // prepare() anota en cada archivo su subida en partes: se guarda para poder cerrarla.
  await upload.update({ files });

  services.logger.fromRequest(req, {
    action: LOG_ACTIONS.UPLOAD_CREATE,
    meta: { episodeId: req.episode.id, uploadId: upload.id, files: files.length },
  });

  return res.status(201).send({
    id: upload.id,
    files: files.map((file, index) => ({ kind: file.kind, lang: file.lang, name: file.name, ...targets[index] })),
  });
});

// Audio extra para un episodio YA publicado: el navegador sube solo el audio y el worker lo
// convierte y lo suma al manifiesto del episodio (sin tocar el video).
exports.createAudioUpload = catchAsync(async (req, res) => {
  const cfg = storage.config();
  const absent = storage.missing(cfg, { upload: true, publish: false });

  if (absent.length) {
    throw new AppError(`Uploads are not configured: missing ${absent.join(", ")}`, 503);
  }

  const { filename, size, language, offset = 0, track = null } = req.body;

  const published = await Anime.Source.findOne({ where: { episodeId: req.episode.id, type: "hls" } });

  if (!published) {
    throw new AppError("This episode has no video published by Zenkai: upload the video (with its audio tracks) first", 409);
  }

  await claim(req.episode.id);

  const token = crypto.randomUUID();
  const key = `incoming/${token}/audio-${language}${extOf(filename)}`;

  const file = { kind: "audio", lang: language, name: filename, size, key };
  const upload = await Anime.Upload.create({
    episodeId: req.episode.id,
    accountId: req.sessionAccount?.id ?? null,
    options: { kind: "audio", offset, track },
    files: [structuredClone(file)],
  });

  const target = await prepare(cfg, file);
  await upload.update({ files: [file] });

  services.logger.fromRequest(req, {
    action: LOG_ACTIONS.UPLOAD_CREATE,
    meta: { episodeId: req.episode.id, uploadId: upload.id, kind: "audio", language },
  });

  return res.status(201).send({ id: upload.id, files: [{ kind: "audio", lang: language, name: filename, ...target }] });
});

// Audios del episodio publicado, leidos de su manifiesto (master.m3u8) en el bucket.
const masterOf = async (episode) => {
  const cfg = storage.config();
  const absent = storage.missing(cfg);

  if (absent.length) throw new AppError(`Storage is not configured: missing ${absent.join(", ")}`, 503);

  const anime = await Anime.Anime.findByPk(episode.animeId, { attributes: ["malId"] });
  const prefix = `anime/${anime.malId}/${episode.number}/`;
  const published = await Anime.Source.findOne({ where: { episodeId: episode.id, type: "hls" } });

  if (!published || !published.url.endsWith(`${prefix}master.m3u8`)) {
    throw new AppError("This episode has no video published by Zenkai", 409);
  }

  let master;

  try {
    master = await storage.read(cfg.bucket, `${prefix}master.m3u8`);
  } catch {
    throw new AppError("The episode manifest was not found in the bucket", 404);
  }

  return { cfg, prefix, master };
};

exports.listAudio = catchAsync(async (req, res) => {
  const { master } = await masterOf(req.episode);

  const tracks = hls.audioTracks(master).map((track) => ({ dir: track.dir, lang: track.lang, name: hls.customName(track), default: track.isDefault }));

  return res.status(200).send(tracks);
});

// Quita un audio del episodio (p. ej. un doblaje de mas): primero se publica el manifiesto sin
// la pista y despues se borran sus segmentos del bucket.
exports.removeAudio = catchAsync(async (req, res) => {
  const { dir } = req.params;

  if (!/^[A-Za-z0-9_-]+$/.test(dir)) throw new AppError("Invalid audio folder", 406);

  const { cfg, prefix, master } = await masterOf(req.episode);

  let patched;

  try {
    patched = hls.withoutAudio(master, dir);
  } catch (err) {
    throw new AppError(err.message, 409);
  }

  await storage.put(cfg.bucket, `${prefix}master.m3u8`, patched.master, {
    contentType: "application/vnd.apple.mpegurl",
    cacheControl: "public, max-age=300",
  });

  await storage.removePrefix(cfg.bucket, `${prefix}${dir}/`).catch(() => {});

  services.logger.fromRequest(req, {
    action: LOG_ACTIONS.AUDIO_REMOVE,
    meta: { episodeId: req.episode.id, dir, lang: patched.removed.lang },
  });

  return res.status(200).send({ message: "Audio removed", tracks: hls.audioTracks(patched.master).length });
});

// Cambia el nombre con el que se muestra un audio ("Español latino" en vez de lo que salga del código
// de idioma) y, si se envía `lang`, también su código de idioma. Solo toca el manifiesto: los
// segmentos no cambian.
exports.renameAudio = catchAsync(async (req, res) => {
  const { dir } = req.params;
  const name = req.body?.name ?? "";
  const lang = req.body?.lang ?? null;

  if (!/^[A-Za-z0-9_-]+$/.test(dir)) throw new AppError("Invalid audio folder", 406);

  if (typeof name !== "string" || name.trim().length > 40 || /["\u0000-\u001f]/.test(name)) {
    throw new AppError("The name can have up to 40 characters, without quotes", 406);
  }

  if (lang !== null && (typeof lang !== "string" || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang.trim()))) {
    throw new AppError("Invalid language code (e.g. es, ja, es-419)", 406);
  }

  const { cfg, prefix, master } = await masterOf(req.episode);

  let patched;

  try {
    patched = hls.withAudioName(master, dir, name, lang);
  } catch (err) {
    throw new AppError(err.message, 409);
  }

  await storage.put(cfg.bucket, `${prefix}master.m3u8`, patched, {
    contentType: "application/vnd.apple.mpegurl",
    cacheControl: "public, max-age=300",
  });

  services.logger.fromRequest(req, {
    action: LOG_ACTIONS.AUDIO_UPDATE,
    meta: { episodeId: req.episode.id, dir, name: name.trim(), ...(lang ? { lang: lang.trim() } : {}) },
  });

  return res.status(200).send({ message: "Audio renamed", tracks: hls.audioTracks(patched).map((track) => ({ dir: track.dir, lang: track.lang, name: hls.customName(track), default: track.isDefault })) });
});

exports.defaultAudio = catchAsync(async (req, res) => {
  const { dir } = req.params;

  if (!/^[A-Za-z0-9_-]+$/.test(dir)) throw new AppError("Invalid audio folder", 406);

  const { cfg, prefix, master } = await masterOf(req.episode);

  let patched;

  try {
    patched = hls.withDefaultAudio(master, dir);
  } catch (err) {
    throw new AppError(err.message, 409);
  }

  await storage.put(cfg.bucket, `${prefix}master.m3u8`, patched, {
    contentType: "application/vnd.apple.mpegurl",
    cacheControl: "public, max-age=300",
  });

  return res.status(200).send({ message: "Default audio updated" });
});

// ── Segmentos (intro / outro / recap) ────────────────────────────────────────

// Fija un segmento a mano: manda sobre cualquier fuente automatica.
exports.setSegment = catchAsync(async (req, res) => {
  const { type } = req.params;
  const { start, end } = req.body;

  const data = { start, end, source: "manual", confidence: null };
  const current = await Anime.Segment.findOne({ where: { episodeId: req.episode.id, type } });

  const segment = current
    ? await current.update(data)
    : await Anime.Segment.create({ episodeId: req.episode.id, type, ...data });

  services.logger.fromRequest(req, {
    action: LOG_ACTIONS.SEGMENT_UPDATE,
    meta: { episodeId: req.episode.id, type, start, end },
  });

  return res.status(200).send(segment);
});

exports.removeSegment = catchAsync(async (req, res) => {
  await Anime.Segment.destroy({ where: { episodeId: req.episode.id, type: req.params.type } });

  return res.status(200).send({ message: "Segment removed" });
});

const FETCH_PAUSE_MS = 250;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const searchOne = async (episode, malId) => {
  try {
    return await segments.fetchFromAniskip(Anime, { episode, malId });
  } catch (err) {
    throw new AppError(`AniSkip is not available right now: ${err.message}`, 502);
  }
};

// Busca en AniSkip las marcas de un episodio.
exports.fetchSegments = catchAsync(async (req, res) => {
  const anime = await Anime.Anime.findByPk(req.episode.animeId, { attributes: ["malId"] });

  return res.status(200).send(await searchOne(req.episode, anime.malId));
});

// Busca en AniSkip las marcas de todos los episodios del anime. Una serie larga son muchas
// consultas, asi que se hace por detras y el admin va viendo aparecer las marcas.
const running = new Set();

exports.fetchAnimeSegments = catchAsync(async (req, res) => {
  if (running.has(req.anime.id)) throw new AppError("Already searching segments for this anime", 409);

  const episodes = await Anime.Episode.findAll({ where: { animeId: req.anime.id }, order: [["number", "ASC"]] });

  running.add(req.anime.id);

  (async () => {
    try {
      for (const episode of episodes) {
        await segments.fetchFromAniskip(Anime, { episode, malId: req.anime.malId }).catch(() => {});
        await sleep(FETCH_PAUSE_MS);
      }
    } finally {
      running.delete(req.anime.id);
    }
  })();

  return res.status(202).send({ message: "Searching", episodes: episodes.length });
});

exports.completeUpload = catchAsync(async (req, res) => {
  const { upload } = req;

  if (upload.status !== "uploading") {
    throw new AppError(`Upload is already ${upload.status}`, 409);
  }

  const { uploadBucket } = storage.config();

  // Las subidas en partes se cierran aqui: si falta alguna parte, el archivo no esta completo.
  const files = upload.files.map((file) => ({ ...file }));

  for (const file of files.filter((item) => item.multipartId)) {
    const closed = await storage.completeMultipart(uploadBucket, file.key, file.multipartId, file.parts)
      .catch((err) => {
        // Cerrada ya en un intento anterior (se perdio la respuesta): el tamano de abajo la valida.
        if (err.name === "NoSuchUpload") return true;
        throw err;
      });

    if (!closed) throw new AppError(`${file.name} did not finish uploading (some parts are missing)`, 409);

    delete file.multipartId;
  }

  await upload.update({ files });

  // Que lo subido sea de verdad lo que se anuncio: un corte de red a medias
  // dejaria un video truncado que el worker intentaria convertir.
  for (const file of upload.files) {
    const actual = await storage.sizeOf(uploadBucket, file.key);

    if (actual !== file.size) {
      throw new AppError(`${file.name} did not finish uploading (${actual ?? 0} of ${file.size} bytes)`, 409);
    }
  }

  await upload.update({ status: "queued", message: "En cola" });

  return res.status(200).send(upload);
});

exports.retryUpload = catchAsync(async (req, res) => {
  if (req.upload.status !== "error") {
    throw new AppError("Only failed uploads can be retried", 409);
  }

  await req.upload.update({ status: "queued", message: "En cola", startedAt: null, finishedAt: null });

  return res.status(200).send(req.upload);
});

exports.removeUpload = catchAsync(async (req, res) => {
  // Convirtiendose de verdad (el worker avisa cada 30 s): no se toca. Sin avisos hace rato es que el
  // worker murio: se puede cancelar para desbloquear el episodio.
  if (req.upload.status === "processing" && Date.now() - req.upload.updatedAt.getTime() < STALE_PROCESSING_MS) {
    throw new AppError("The video is being converted; wait for it to finish", 409);
  }

  await discard(req.upload);

  return res.status(200).send({ message: "Upload deleted" });
});

exports.removeSource = catchAsync(async (req, res) => {
  await Anime.Source.destroy({ where: { id: req.params.id } });

  return res.status(200).send({ message: "Source deleted" });
});


