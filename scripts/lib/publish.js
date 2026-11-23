require("dotenv").config({ quiet: true });

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const storage = require("../../services/modules/storage.service");
const hls = require("../../utils/hls.util");
const segments = require("../../services/modules/segments.service");

// Nucleo de la publicacion de episodios: convierte un video a HLS con ffmpeg (una
// calidades —la del original y las inferiores—, una pista de audio por idioma), pasa los subtitulos a WebVTT, lo sube
// a Cloudflare R2 y registra la fuente y los subtitulos en la base. Lo usan
// `publish.episode.js` (un episodio) y `publish.folder.js` (una carpeta entera).
//
// Las pistas de audio y los subtitulos de texto que ya traiga el propio archivo
// (un .mkv, por ejemplo) se aprovechan solos; los archivos sueltos que se pasen
// aparte se suman, y si coincide el idioma mandan sobre los incrustados.

const FFMPEG = () => process.env.FFMPEG_PATH || "ffmpeg";

// ─── Idiomas ──────────────────────────────────────────────────────────────────

// Los contenedores etiquetan con codigos de tres letras ("jpn"); HLS y el
// reproductor usan los de dos ("ja").
const ISO = {
  jpn: "ja", eng: "en", spa: "es", por: "pt", fre: "fr", fra: "fr", ger: "de", deu: "de",
  ita: "it", chi: "zh", zho: "zh", kor: "ko", rus: "ru", ara: "ar", hin: "hi", tur: "tr",
  pol: "pl", nld: "nl", dut: "nl", swe: "sv", tha: "th", vie: "vi", ind: "id",
};

const iso = (code) => {
  const value = (code ?? "").toLowerCase();
  if (!value || value === "und") return null;
  return ISO[value] ?? value;
};

const languageName = (code) => {
  try {
    const name = new Intl.DisplayNames(["es"], { type: "language" }).of(code);
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return code;
  }
};

// ─── Contexto ─────────────────────────────────────────────────────────────────

// Abre la base y el cliente de R2 una sola vez: una carpeta con cien episodios no
// debe reconectar cien veces.
const createContext = async ({ dryRun = false } = {}) => {
  const { db } = require("../../database/config");
  const init = require("../../models/init.models");
  const Anime = require("../../models/anime.models");

  const r2 = storage.config();

  if (!dryRun) {
    const missing = storage.missing(r2);
    if (missing.length) throw new Error(`Faltan variables en .env: ${missing.join(", ")}`);
  }

  await db.authenticate();
  init();

  return { db, Anime, r2, client: dryRun ? null : storage.client() };
};

const closeContext = (ctx) => ctx.db.close().catch(() => {});

// ─── ffmpeg ───────────────────────────────────────────────────────────────────

// ffmpeg escribe sus mensajes por stderr; `capture` los devuelve en vez de mostrarlos.
const ffmpeg = (args, { capture = false } = {}) => new Promise((resolve, reject) => {
  const child = spawn(FFMPEG(), args, { stdio: ["ignore", "ignore", capture ? "pipe" : "inherit"] });

  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr += chunk; });

  child.on("error", (err) => reject(err.code === "ENOENT"
    ? new Error("No se encontro ffmpeg. Instalalo (en Windows: winget install Gyan.FFmpeg) o indica la ruta en FFMPEG_PATH")
    : err));

  // Con `-i` sin salida ffmpeg termina con codigo 1 aunque haya leido bien el archivo.
  child.on("close", (code) => (code === 0 || capture ? resolve(stderr) : reject(new Error(`ffmpeg termino con codigo ${code}`))));
});

const STREAM = /Stream #0:(\d+)(?:\[0x[0-9a-fA-F]+\])?(?:\((\w+)\))?[^:\n]*: (Video|Audio|Subtitle): (\w+)([^\n]*)/g;

// Pistas del archivo a partir del texto que imprime ffmpeg. El indice es el
// absoluto del contenedor: asi no se confunde el video con una portada incrustada.
const probe = async (file) => {
  const text = await ffmpeg(["-hide_banner", "-i", file], { capture: true });
  const streams = [...text.matchAll(STREAM)]
    .map(([, index, lang, kind, codec, rest]) => ({ index: Number(index), lang: iso(lang), kind: kind.toLowerCase(), codec, rest }));

  return {
    video: streams.find((s) => s.kind === "video" && !/attached pic/.test(s.rest) && !["mjpeg", "png", "bmp"].includes(s.codec)),
    audio: streams.filter((s) => s.kind === "audio"),
    subs: streams.filter((s) => s.kind === "subtitle"),
  };
};

// Copiar el video solo vale si el navegador lo va a poder reproducir: H.264 de 8 bits.
const browserSafe = (video) =>
  video?.codec === "h264" && /yuv420p(?!\d)/.test(video.rest) && !/High 10|High 4:[24]:[24]/.test(video.rest);

// Subtitulos que se pueden pasar a texto; los de imagen (PGS, DVD) no.
const TEXT_SUBS = new Set(["ass", "ssa", "subrip", "srt", "webvtt", "mov_text", "text", "ttml"]);

// ─── Escalera de calidades ────────────────────────────────────────────────────

// Alturas de las calidades que se generan por debajo de la del original.
const LADDER = [2160, 1080, 720, 480];

// Tope de tasa por calidad (Mbps): sin él, un CRF fijo infla las escenas complejas y la calidad
// deja de poder cambiar de forma suave según la conexión del espectador.
const CAPS = { 2160: { crf: 21, rate: 16 }, 1080: { crf: 21, rate: 6 }, 720: { crf: 22, rate: 3.5 }, 480: { crf: 23, rate: 1.6 } };
const capFor = (height) => CAPS[LADDER.filter((rung) => rung >= height).pop() ?? 2160];

// Altura del video, del texto que imprime ffmpeg ("..., 1920x1080 [SAR ...").
const heightOf = (video) => {
  const match = /(?:^|[\s,])(\d{2,5})x(\d{2,5})(?=[\s,\[]|$)/.exec(video?.rest ?? "");
  return match ? Number(match[2]) - (Number(match[2]) % 2) : null;
};

// Calidades a generar, de mayor a menor: la del propio video (sea 4K o 1080p) y, por debajo, las
// de la escalera que le queden claramente por debajo. Nunca se amplía. Sin altura legible, solo la original.
const renditions = (height) => {
  if (!height) return [{ height: null }];

  return [{ height }, ...LADDER.filter((rung) => rung < height * 0.9).map((rung) => ({ height: rung }))];
};

const posix = (p) => p.replace(/\\/g, "/");

const convert = async (out, job, log) => {
  const info = await probe(job.video);

  if (!info.video) throw new Error(`${path.basename(job.video)} no tiene pista de video`);

  // Con varias calidades todas se recodifican: así comparten los mismos fotogramas clave y el
  // reproductor puede saltar de una a otra sin cortes. Con una sola (video pequeño) se copia si se puede.
  const rungs = renditions(heightOf(info.video));
  const copy = rungs.length === 1 && !job.reencode && browserSafe(info.video);

  log(rungs.length > 1
    ? `Video ${info.video.codec} de ${rungs[0].height}p: se generan ${rungs.map((rung) => `${rung.height}p`).join(", ")} (puede tardar)`
    : `Video ${info.video.codec}: ${copy ? "se copia sin recodificar" : "se recodifica a H.264 (puede tardar)"}`);

  const videoNames = rungs.map((rung) => (rung.height ? `v${rung.height}` : "video"));

  // Audio en el orden en que saldra en el manifiesto: primero lo que trae el archivo, luego lo suelto.
  const audioLang = job.audioLang ?? "ja";
  const extra = job.audio ?? [];

  const tracks = [
    ...info.audio.map((s) => ({ input: 0, map: `0:${s.index}`, lang: s.lang ?? audioLang })),
    ...extra.map((a, index) => ({ input: index + 1, map: `${index + 1}:a:0`, lang: a.lang })),
  ];

  if (!tracks.length) throw new Error("No hay ninguna pista de audio: ni en el video ni suelta");

  const names = tracks.map((track, index) => (tracks.filter((t) => t.lang === track.lang).length > 1 ? `${track.lang}${index}` : track.lang));
  const main = Math.max(0, tracks.findIndex((t) => t.lang === audioLang));

  for (const dir of [...videoNames, ...names]) fs.mkdirSync(path.join(out, dir), { recursive: true });

  const variants = [
    ...videoNames.map((name, index) => `v:${index},agroup:aud,name:${name}`),
    ...tracks.map((track, index) => `a:${index},agroup:aud,language:${track.lang},name:${names[index]}${index === main ? ",default:yes" : ""}`),
  ].join(" ");

  await ffmpeg([
    "-y", "-hide_banner", "-loglevel", "warning", "-stats",
    "-i", job.video,
    ...extra.flatMap((a) => ["-i", a.file]),
    "-map_metadata", "-1", "-map_chapters", "-1",
    ...rungs.flatMap(() => ["-map", `0:${info.video.index}`]),
    ...tracks.flatMap((track) => ["-map", track.map]),
    ...(copy
      ? ["-c:v", "copy"]
      : rungs.flatMap((rung, index) => {
        const cap = rung.height ? capFor(rung.height) : { crf: 20, rate: null };

        return [
          ...(index > 0 ? [`-filter:v:${index}`, `scale=-2:${rung.height}`] : []),
          `-c:v:${index}`, "libx264", `-preset:v:${index}`, "veryfast", `-crf:v:${index}`, String(cap.crf),
          ...(cap.rate ? [`-maxrate:v:${index}`, `${cap.rate}M`, `-bufsize:v:${index}`, `${cap.rate * 2}M`] : []),
          `-pix_fmt:v:${index}`, "yuv420p",
          // Un fotograma clave cada 2 s en todas las calidades (con cualquier fps): los segmentos coinciden.
          `-force_key_frames:v:${index}`, "expr:gte(t,n_forced*2)", `-sc_threshold:v:${index}`, "0",
        ];
      })),
    "-c:a", "aac", "-b:a", "160k", "-ac", "2",
    "-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod",
    "-hls_flags", "independent_segments", "-hls_segment_type", "mpegts",
    "-master_pl_name", "master.m3u8",
    "-var_stream_map", variants,
    "-hls_segment_filename", posix(path.join(out, "%v", "seg_%04d.ts")),
    posix(path.join(out, "%v", "index.m3u8")),
  ]);

  log(`HLS generado: ${videoNames.length} calidad(es), ${tracks.length} pista(s) de audio (${names.join(", ")})`);

  // Subtitulos: WebVTT, uno por idioma. Lo suelto manda sobre lo incrustado.
  fs.mkdirSync(path.join(out, "subs"), { recursive: true });

  const subs = [];
  const add = (lang) => subs.push({ lang });

  for (const sub of job.subs ?? []) {
    const target = path.join(out, "subs", `${sub.lang}.vtt`);

    if (sub.file.toLowerCase().endsWith(".vtt")) fs.copyFileSync(sub.file, target);
    else await ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-i", sub.file, target]);

    add(sub.lang);
    log(`Subtitulos ${sub.lang} (archivo suelto)`);
  }

  for (const s of info.subs) {
    if (!TEXT_SUBS.has(s.codec)) {
      log(`Subtitulos ${s.lang ?? "?"} omitidos: son de imagen (${s.codec}), no se pueden pasar a texto`);
      continue;
    }

    if (!s.lang) {
      log("Subtitulos incrustados sin idioma: omitidos (usa un archivo suelto NOMBRE.es.srt)");
      continue;
    }

    if (subs.some((sub) => sub.lang === s.lang)) continue;

    await ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-i", job.video, "-map", `0:${s.index}`, "-c:s", "webvtt", path.join(out, "subs", `${s.lang}.vtt`)]);

    add(s.lang);
    log(`Subtitulos ${s.lang} (incrustados)`);
  }

  return { tracks: names, subs };
};

// ─── R2: subida ───────────────────────────────────────────────────────────────

const TYPES = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".vtt": "text/vtt; charset=utf-8",
  ".jpg": "image/jpeg",
};

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

// Republicar con menos segmentos dejaria huerfanos los viejos pagando
// almacenamiento: se vacia la carpeta del episodio (y solo esa) antes de subir.
const clearPrefix = (ctx, prefix) => storage.removePrefix(ctx.r2.bucket, prefix);

const upload = async (ctx, out, prefix, log) => {
  const files = walk(out);
  let done = 0;
  let shown = 0;

  const put = async (file) => {
    const ext = path.extname(file);

    await ctx.client.send(new PutObjectCommand({
      Bucket: ctx.r2.bucket,
      Key: prefix + path.relative(out, file).split(path.sep).join("/"),
      Body: fs.readFileSync(file),
      ContentType: TYPES[ext] ?? "application/octet-stream",
      // Los segmentos no cambian nunca; los manifiestos y subtitulos si se pueden reemplazar.
      CacheControl: ext === ".ts" ? "public, max-age=31536000, immutable" : "public, max-age=300",
    }));

    done += 1;

    // Un aviso cada 10 %: cientos de lineas de progreso ensucian el log.
    const percent = Math.floor((done / files.length) * 10) * 10;
    if (percent > shown) { shown = percent; log(`Subiendo ${percent}% (${done}/${files.length})`); }
  };

  // Ocho subidas a la vez: cientos de segmentos pequenos tardarian una eternidad de uno en uno.
  const queue = [...files];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) await put(queue.shift());
  }));

  return files.length;
};

// ─── Registro en la base ──────────────────────────────────────────────────────

const register = async (ctx, episode, job, subs, urls) => {
  const { Anime } = ctx;

  // Repetir el comando reemplaza lo anterior en vez de duplicarlo.
  await Anime.Source.destroy({ where: { episodeId: episode.id, server: job.server } });
  await Anime.Source.create({
    episodeId: episode.id, server: job.server, url: urls.master, type: "hls", quality: "auto", language: job.language,
  });

  await Anime.Subtitle.destroy({ where: { episodeId: episode.id } });

  // Por defecto en espanol si hay (la interfaz lo esta); si no, el primero.
  const defaultLang = job.defaultSub ?? (subs.some((s) => s.lang === "es") ? "es" : subs[0]?.lang);

  for (const sub of subs) {
    await Anime.Subtitle.create({
      episodeId: episode.id,
      language: sub.lang,
      label: languageName(sub.lang),
      url: `${urls.base}subs/${sub.lang}.vtt`,
      default: sub.lang === defaultLang,
    });
  }
};

// Marcas de intro/outro del episodio recien publicado, de AniSkip. Se pide con la duracion real
// del video para quedarse con la version que coincide. Si AniSkip no responde o no tiene datos,
// no pasa nada: se pueden buscar o poner a mano despues desde el admin.
const findSegments = async (ctx, episode, malId, out, log) => {
  try {
    const master = fs.readFileSync(path.join(out, "master.m3u8"), "utf8");
    const length = hls.duration(fs.readFileSync(path.join(out, hls.videoUri(master)), "utf8"));

    const result = await segments.fetchFromAniskip(ctx.Anime, { episode, malId, length });
    log(result.saved ? `Marcas de AniSkip: ${result.saved}` : "Sin marcas en AniSkip para este episodio");
  } catch (err) {
    log(`No se pudieron buscar las marcas (AniSkip): ${err.message}`);
  }
};

// ─── Miniatura ────────────────────────────────────────────────────────────────

// Un fotograma del video a una cuarta parte de su duracion (pasada la intro, sin llegar a los
// creditos; como mucho al minuto 10), de 640 px de ancho. Sirve de miniatura en la lista de episodios.
const thumbSeconds = (length) => Math.max(1, Math.min(length * 0.25, 600));

const grabFrame = (input, seconds, target) => ffmpeg([
  "-y", "-hide_banner", "-loglevel", "error",
  "-ss", seconds.toFixed(2), "-i", input,
  "-map", "0:v:0", "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", target,
]);

// Duracion (s) del video de un manifiesto maestro ya escrito en disco.
const lengthOf = (masterFile) => {
  const master = fs.readFileSync(masterFile, "utf8");
  return hls.duration(fs.readFileSync(path.join(path.dirname(masterFile), hls.videoUri(master)), "utf8"));
};

// ─── Publicacion ──────────────────────────────────────────────────────────────

// job: { malId, number, video, audio: [{lang, file}], subs: [{lang, file}],
//        audioLang, defaultSub, server, language, reencode, keep, dryRun, log }
const publishEpisode = async (ctx, job) => {
  const log = job.log ?? ((message) => console.log(`› ${message}`));
  const { malId, number } = job;

  // Antes de convertir nada: no tiene sentido perder media hora de ffmpeg para
  // descubrir que el episodio no existe.
  const anime = await ctx.Anime.Anime.findOne({ where: { malId } });
  if (!anime) throw new Error(`No hay ningun anime con malId ${malId} en la base`);

  const episode = await ctx.Anime.Episode.findOne({ where: { animeId: anime.id, number } });
  if (!episode) throw new Error(`${anime.title} no tiene episodio ${number}. Sincroniza su lista de episodios en Admin → Catalogo`);

  log(`${anime.title} · episodio ${number}`);

  const out = fs.mkdtempSync(path.join(os.tmpdir(), `zenkai-${malId}-${number}-`));
  const prefix = `anime/${malId}/${number}/`;
  const urls = { base: `${ctx.r2.base}/${prefix}`, master: `${ctx.r2.base}/${prefix}master.m3u8` };
  let keep = job.keep;

  try {
    const { subs, tracks } = await convert(out, job, log);

    if (job.dryRun) {
      keep = true;
      log(`Simulacion: no se sube ni se registra nada. Archivos en ${out}`);
      return { dryRun: true, out, files: walk(out).map((f) => path.relative(out, f).split(path.sep).join("/")), tracks, subs };
    }

    // Miniatura del episodio (mejor esfuerzo: sin ella la lista usa la portada de la serie).
    let hasThumb = false;

    try {
      await grabFrame(job.video, thumbSeconds(lengthOf(path.join(out, "master.m3u8"))), path.join(out, "thumb.jpg"));
      hasThumb = true;
    } catch (err) {
      log(`No se pudo sacar la miniatura: ${err.message}`);
    }

    await clearPrefix(ctx, prefix);
    const files = await upload(ctx, out, prefix, log);
    await register(ctx, episode, job, subs, urls);

    // El `?v=` evita que se quede en cache la miniatura de una publicacion anterior.
    if (hasThumb) await episode.update({ thumbnail: `${urls.base}thumb.jpg?v=${Date.now()}` });
    await findSegments(ctx, episode, malId, out, log);

    return { url: urls.master, files, tracks, subs };
  } finally {
    if (!keep) fs.rmSync(out, { recursive: true, force: true });
  }
};

// ─── Añadir un audio a un episodio ya publicado ──────────────────────────────

const minutes = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

// Convierte SOLO el audio nuevo a HLS, lo sube a su propia carpeta del episodio y lo añade al
// manifiesto: no hace falta volver a subir el video. Si ya habia una pista de ese idioma, la
// reemplaza (en una carpeta nueva: los segmentos viejos estan cacheados "para siempre").
//
// job: { malId, number, file, lang, offsetMs, log }
//   offsetMs > 0 retrasa el audio, < 0 lo adelanta: para corregir un doblaje desfasado.
const addAudio = async (ctx, job) => {
  const log = job.log ?? ((message) => console.log(`› ${message}`));
  const { malId, number, file, lang } = job;
  const offsetMs = Number(job.offsetMs) || 0;

  const anime = await ctx.Anime.Anime.findOne({ where: { malId } });
  if (!anime) throw new Error(`No hay ningun anime con malId ${malId} en la base`);

  const episode = await ctx.Anime.Episode.findOne({ where: { animeId: anime.id, number } });
  if (!episode) throw new Error(`${anime.title} no tiene episodio ${number}`);

  const prefix = `anime/${malId}/${number}/`;
  const masterKey = `${prefix}master.m3u8`;

  // Solo se puede sumar a un paquete que publico Zenkai: es el unico que tiene un manifiesto con
  // pistas separadas que se pueda ampliar.
  const published = await ctx.Anime.Source.findOne({ where: { episodeId: episode.id, type: 'hls' } });
  if (!published || !published.url.endsWith(masterKey)) {
    throw new Error(`${anime.title} · episodio ${number} no tiene un video publicado por Zenkai: sube primero el video con sus audios`);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `zenkai-audio-${malId}-${number}-`));
  let base = null;
  let committed = false;

  try {
    // 1. El manifiesto actual del episodio
    const masterFile = path.join(dir, 'master.m3u8');

    try {
      await storage.download(ctx.r2.bucket, masterKey, masterFile);
    } catch {
      throw new Error('No se encontro el manifiesto del episodio en el bucket');
    }

    const master = fs.readFileSync(masterFile, 'utf8');

    // 2. Convertir el audio nuevo
    const info = await probe(file);
    if (!info.audio.length) throw new Error('El archivo no tiene ninguna pista de audio');

    const out = path.join(dir, 'out');
    fs.mkdirSync(out);

    const shift = offsetMs > 0
      ? ['-af', `adelay=${offsetMs}:all=1`]
      : offsetMs < 0 ? ['-af', `atrim=start=${-offsetMs / 1000},asetpts=PTS-STARTPTS`] : [];

    log(`Convirtiendo el audio (${lang}${offsetMs ? `, desfase ${offsetMs} ms` : ''})`);

    await ffmpeg([
      '-y', '-hide_banner', '-loglevel', 'warning', '-stats',
      '-i', file,
      '-map', `0:${info.audio[0].index}`, '-vn', '-map_metadata', '-1',
      ...shift,
      '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
      '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod',
      '-hls_flags', 'independent_segments', '-hls_segment_type', 'mpegts',
      '-hls_segment_filename', posix(path.join(out, 'seg_%04d.ts')),
      posix(path.join(out, 'index.m3u8')),
    ]);

    // 3. El aviso mas util: un doblaje de otro corte dura distinto y saldria desincronizado.
    const warnings = [];

    try {
      const videoList = hls.videoUri(master);
      const videoFile = path.join(dir, 'video.m3u8');

      if (videoList) {
        await storage.download(ctx.r2.bucket, `${prefix}${videoList}`, videoFile);

        const video = hls.duration(fs.readFileSync(videoFile, 'utf8'));
        const audio = hls.duration(fs.readFileSync(path.join(out, 'index.m3u8'), 'utf8'));

        if (Math.abs(video - audio) > 2) {
          warnings.push(`el audio dura ${minutes(audio)} y el video ${minutes(video)}: puede estar desincronizado`);
        }
      }
    } catch { /* sin la duracion del video no se puede comparar: no es motivo para fallar */ }

    // 4. Subir los segmentos a su carpeta, y SOLO entonces tocar el manifiesto
    const target = hls.freeDir(master, lang);
    base = `${prefix}${target}/`;

    await upload(ctx, out, base, log);

    const { master: patched, replaced } = hls.withAudio(master, { lang, dir: target });

    await storage.put(ctx.r2.bucket, masterKey, patched, {
      contentType: 'application/vnd.apple.mpegurl',
      cacheControl: 'public, max-age=300',
    });
    committed = true;

    // 5. La pista que se sustituyo ya no la usa nadie
    if (replaced?.dir && replaced.dir !== target && /^[A-Za-z0-9_-]+$/.test(replaced.dir)) {
      await storage.removePrefix(ctx.r2.bucket, `${prefix}${replaced.dir}/`);
    }

    return { dir: target, replaced: Boolean(replaced), tracks: hls.audioTracks(patched).length, warnings };
  } catch (err) {
    // Si fallo antes de publicar el manifiesto, los segmentos subidos quedarian huerfanos.
    if (base && !committed) await storage.removePrefix(ctx.r2.bucket, base).catch(() => {});
    throw err;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

// ─── Miniatura de un episodio ya publicado ───────────────────────────────────

// Saca el fotograma leyendo el propio HLS publicado (no hace falta tener el video original) y lo
// sube junto al episodio. job: { malId, number, force }. Sin `force` se salta el episodio que ya
// tiene una miniatura de este tipo. Devuelve { skipped } o { url }.
const generateThumbnail = async (ctx, job) => {
  const { malId, number } = job;

  const anime = await ctx.Anime.Anime.findOne({ where: { malId } });
  if (!anime) throw new Error(`No hay ningun anime con malId ${malId} en la base`);

  const episode = await ctx.Anime.Episode.findOne({ where: { animeId: anime.id, number } });
  if (!episode) throw new Error(`${anime.title} no tiene episodio ${number}`);

  const prefix = `anime/${malId}/${number}/`;
  const masterKey = `${prefix}master.m3u8`;

  const published = await ctx.Anime.Source.findOne({ where: { episodeId: episode.id, type: "hls" } });
  if (!published || !published.url.endsWith(masterKey)) return { skipped: "sin video publicado por Zenkai" };

  if (!job.force && episode.thumbnail?.includes(`${prefix}thumb.jpg`)) return { skipped: "ya tiene miniatura" };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `zenkai-thumb-${malId}-${number}-`));

  try {
    const master = await storage.read(ctx.r2.bucket, masterKey);
    const playlist = await storage.read(ctx.r2.bucket, `${prefix}${hls.videoUri(master)}`);
    const target = path.join(dir, "thumb.jpg");

    await grabFrame(`${ctx.r2.base}/${masterKey}`, thumbSeconds(hls.duration(playlist)), target);
    await storage.put(ctx.r2.bucket, `${prefix}thumb.jpg`, fs.readFileSync(target), { contentType: "image/jpeg", cacheControl: "public, max-age=300" });

    const url = `${ctx.r2.base}/${prefix}thumb.jpg?v=${Date.now()}`;
    await episode.update({ thumbnail: url });

    return { url };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

module.exports = { createContext, closeContext, publishEpisode, addAudio, generateThumbnail, languageName, iso };
