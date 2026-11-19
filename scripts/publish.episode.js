require("dotenv").config();

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { parseArgs } = require("util");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

// Publica un episodio de punta a punta: convierte el video a HLS con ffmpeg
// (una calidad, una pista de audio por idioma), convierte los subtitulos a
// WebVTT, lo sube todo a Cloudflare R2 y registra la fuente y los subtitulos en
// la base. Se puede repetir sobre el mismo episodio: sobrescribe en vez de duplicar.
//
//   npm run publish:episode -- --anime 52991 --episode 1 --video ./ep01.mkv \
//       --audio-lang ja \
//       --audio es=./ep01.es.m4a \
//       --sub es=./ep01.es.srt --sub en=./ep01.en.ass
//
//   --anime         id de MyAnimeList del anime (el de la URL /anime/<id>)
//   --episode       numero del episodio; debe existir (sincroniza la lista antes)
//   --video         archivo de video; su primer audio es la pista principal
//   --audio-lang    idioma de ese audio principal (por defecto ja)
//   --audio L=ARCH  pista de audio extra (doblaje); se puede repetir
//   --sub L=ARCH    subtitulos (.srt, .ass o .vtt); se puede repetir
//   --default-sub   idioma de subtitulos activado por defecto (el primero si no se indica)
//   --server        nombre que ve el usuario en el selector (por defecto Zenkai)
//   --language      sub | dub, etiqueta de la fuente (por defecto sub)
//   --reencode      recodifica el video aunque ya sea compatible (H.264 8 bits)
//   --keep          no borra los archivos temporales
//   --dry-run       convierte y muestra el plan, sin subir ni tocar la base
//
// Variables (en .env): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
// R2_BUCKET y R2_PUBLIC_URL (URL publica del bucket, sin barra final). Opcionales:
// R2_ENDPOINT (otro servicio compatible con S3) y FFMPEG_PATH (si ffmpeg no esta en el PATH).

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

const { values: opts } = parseArgs({
  options: {
    anime: { type: "string" },
    episode: { type: "string" },
    video: { type: "string" },
    "audio-lang": { type: "string", default: "ja" },
    audio: { type: "string", multiple: true, default: [] },
    sub: { type: "string", multiple: true, default: [] },
    "default-sub": { type: "string" },
    server: { type: "string", default: "Zenkai" },
    language: { type: "string", default: "sub" },
    reencode: { type: "boolean", default: false },
    keep: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

const fail = (message) => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};

const log = (message) => console.log(`› ${message}`);

// ─── Argumentos ───────────────────────────────────────────────────────────────

const pair = (text, flag) => {
  const at = text.indexOf("=");
  if (at < 1) fail(`${flag} espera IDIOMA=ARCHIVO (por ejemplo es=./ep01.es.srt), recibi "${text}"`);
  return { lang: text.slice(0, at), file: text.slice(at + 1) };
};

const malId = Number(opts.anime);
const number = Number(opts.episode);

if (!Number.isInteger(malId) || !Number.isInteger(number)) fail("--anime y --episode son obligatorios y deben ser numeros");
if (!opts.video) fail("--video es obligatorio");
if (!["sub", "dub"].includes(opts.language)) fail("--language debe ser sub o dub");

const extraAudio = opts.audio.map((text) => pair(text, "--audio"));
const subtitles = opts.sub.map((text) => pair(text, "--sub"));

for (const file of [opts.video, ...extraAudio.map((a) => a.file), ...subtitles.map((s) => s.file)]) {
  if (!fs.existsSync(file)) fail(`No existe el archivo: ${file}`);
}

const R2 = {
  account: process.env.R2_ACCOUNT_ID,
  key: process.env.R2_ACCESS_KEY_ID,
  secret: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET,
  base: (process.env.R2_PUBLIC_URL ?? "").replace(/\/$/, ""),
  endpoint: process.env.R2_ENDPOINT,
};

if (!opts["dry-run"]) {
  const missing = [
    !R2.endpoint && !R2.account && "R2_ACCOUNT_ID",
    !R2.key && "R2_ACCESS_KEY_ID",
    !R2.secret && "R2_SECRET_ACCESS_KEY",
    !R2.bucket && "R2_BUCKET",
    !R2.base && "R2_PUBLIC_URL",
  ].filter(Boolean);

  if (missing.length) fail(`Faltan variables en .env: ${missing.join(", ")}`);
}

// ─── ffmpeg ───────────────────────────────────────────────────────────────────

// ffmpeg escribe sus mensajes por stderr; `capture` los devuelve en vez de mostrarlos.
const ffmpeg = (args, { capture = false } = {}) => new Promise((resolve, reject) => {
  const child = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", capture ? "pipe" : "inherit"] });

  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr += chunk; });

  child.on("error", (err) => reject(err.code === "ENOENT"
    ? new Error("No se encontro ffmpeg. Instalalo (en Windows: winget install Gyan.FFmpeg) o indica la ruta en FFMPEG_PATH")
    : err));

  // Con `-i` sin salida ffmpeg termina con codigo 1 aunque haya leido bien el archivo.
  child.on("close", (code) => (code === 0 || capture ? resolve(stderr) : reject(new Error(`ffmpeg termino con codigo ${code}`))));
});

// Lee las pistas del archivo a partir del texto que imprime ffmpeg.
const probe = async (file) => {
  const text = await ffmpeg(["-hide_banner", "-i", file], { capture: true });
  const streams = [...text.matchAll(/Stream #\d+:\d+(?:\((\w+)\))?[^:]*: (Video|Audio|Subtitle): (\w+)([^\n]*)/g)]
    .map(([, lang, kind, codec, rest]) => ({ lang, kind: kind.toLowerCase(), codec, rest }));

  return { video: streams.find((s) => s.kind === "video"), audio: streams.filter((s) => s.kind === "audio") };
};

// Copiar el video solo vale si el navegador lo va a poder reproducir: H.264 de 8 bits.
const browserSafe = (video) =>
  video?.codec === "h264" && /yuv420p(?!\d)/.test(video.rest) && !/High 10|High 4:[24]:[24]/.test(video.rest);

const languageName = (code) => {
  try {
    const name = new Intl.DisplayNames(["es"], { type: "language" }).of(code);
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return code;
  }
};

const convert = async (out) => {
  const info = await probe(opts.video);

  if (!info.video) fail(`${opts.video} no tiene pista de video`);

  const copy = !opts.reencode && browserSafe(info.video);
  log(`Video ${info.video.codec}: ${copy ? "se copia sin recodificar" : "se recodifica a H.264 (puede tardar)"}`);

  // Pistas de audio en el orden en que saldran en el manifiesto: la del video primero.
  const tracks = [
    ...(info.audio.length ? [{ input: 0, lang: opts["audio-lang"] }] : []),
    ...extraAudio.map((audio, index) => ({ input: index + 1, lang: audio.lang })),
  ];

  if (!tracks.length) fail("No hay ninguna pista de audio: ni en el video ni con --audio");

  const names = tracks.map((track, index) => (tracks.filter((t) => t.lang === track.lang).length > 1 ? `${track.lang}${index}` : track.lang));
  const posix = (p) => p.replace(/\\/g, "/");

  for (const dir of ["video", ...names]) fs.mkdirSync(path.join(out, dir), { recursive: true });

  const variants = [
    "v:0,agroup:aud,name:video",
    ...tracks.map((track, index) => `a:${index},agroup:aud,language:${track.lang},name:${names[index]}${index === 0 ? ",default:yes" : ""}`),
  ].join(" ");

  const args = [
    "-y", "-hide_banner", "-loglevel", "warning", "-stats",
    "-i", opts.video,
    ...extraAudio.flatMap((audio) => ["-i", audio.file]),
    "-map", "0:v:0",
    ...tracks.flatMap((track) => ["-map", `${track.input}:a:0`]),
    ...(copy
      ? ["-c:v", "copy"]
      : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-g", "48", "-keyint_min", "48", "-sc_threshold", "0"]),
    "-c:a", "aac", "-b:a", "160k", "-ac", "2",
    "-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod",
    "-hls_flags", "independent_segments", "-hls_segment_type", "mpegts",
    "-master_pl_name", "master.m3u8",
    "-var_stream_map", variants,
    "-hls_segment_filename", posix(path.join(out, "%v", "seg_%04d.ts")),
    posix(path.join(out, "%v", "index.m3u8")),
  ];

  await ffmpeg(args);
  log(`HLS generado: ${tracks.length} pista(s) de audio (${names.join(", ")})`);

  // Subtitulos: WebVTT, uno por idioma.
  fs.mkdirSync(path.join(out, "subs"), { recursive: true });

  for (const sub of subtitles) {
    const target = path.join(out, "subs", `${sub.lang}.vtt`);

    if (sub.file.toLowerCase().endsWith(".vtt")) fs.copyFileSync(sub.file, target);
    else await ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-i", sub.file, target]);

    log(`Subtitulos ${sub.lang} → ${path.basename(target)}`);
  }
};

// ─── Subida a R2 ──────────────────────────────────────────────────────────────

const TYPES = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".vtt": "text/vtt; charset=utf-8",
};

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

const upload = async (out, prefix) => {
  const client = new S3Client({
    region: "auto",
    endpoint: R2.endpoint ?? `https://${R2.account}.r2.cloudflarestorage.com`,
    forcePathStyle: Boolean(R2.endpoint),
    credentials: { accessKeyId: R2.key, secretAccessKey: R2.secret },
    // R2 no admite los checksums extra que el SDK anade por defecto en las versiones recientes.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  const files = walk(out);
  let done = 0;

  const put = async (file) => {
    const key = prefix + path.relative(out, file).split(path.sep).join("/");
    const ext = path.extname(file);

    await client.send(new PutObjectCommand({
      Bucket: R2.bucket,
      Key: key,
      Body: fs.readFileSync(file),
      ContentType: TYPES[ext] ?? "application/octet-stream",
      // Los segmentos no cambian nunca; los manifiestos y subtitulos si se pueden reemplazar.
      CacheControl: ext === ".ts" ? "public, max-age=31536000, immutable" : "public, max-age=300",
    }));

    process.stdout.write(`\r› Subiendo ${++done}/${files.length}`);
  };

  // Ocho subidas a la vez: cientos de segmentos pequenos tardarian una eternidad de uno en uno.
  const queue = [...files];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) await put(queue.shift());
  }));

  process.stdout.write("\n");
};

// ─── Registro en la base ──────────────────────────────────────────────────────

const register = async (episode, url) => {
  const Anime = require("../models/anime.models");

  // Repetir el comando reemplaza lo anterior en vez de duplicarlo.
  await Anime.Source.destroy({ where: { episodeId: episode.id, server: opts.server } });
  await Anime.Source.create({
    episodeId: episode.id, server: opts.server, url, type: "hls", quality: "auto", language: opts.language,
  });

  const defaultLang = opts["default-sub"] ?? subtitles[0]?.lang;

  for (const sub of subtitles) {
    await Anime.Subtitle.destroy({ where: { episodeId: episode.id, language: sub.lang } });
    await Anime.Subtitle.create({
      episodeId: episode.id,
      language: sub.lang,
      label: languageName(sub.lang),
      url: `${R2.base}/anime/${malId}/${number}/subs/${sub.lang}.vtt`,
      default: sub.lang === defaultLang,
    });
  }
};

// ─── Flujo ────────────────────────────────────────────────────────────────────

const run = async () => {
  const { db } = require("../database/config");
  const init = require("../models/init.models");
  const Anime = require("../models/anime.models");

  await db.authenticate();
  init();

  // Se comprueba antes de convertir nada: no tiene sentido perder media hora de
  // ffmpeg para descubrir que el episodio no existe.
  const anime = await Anime.Anime.findOne({ where: { malId } });
  if (!anime) fail(`No hay ningun anime con malId ${malId} en la base`);

  const episode = await Anime.Episode.findOne({ where: { animeId: anime.id, number } });
  if (!episode) fail(`${anime.title} no tiene episodio ${number}. Sincroniza su lista de episodios en Admin → Catalogo`);

  log(`${anime.title} · episodio ${number}`);

  const out = fs.mkdtempSync(path.join(os.tmpdir(), `zenkai-${malId}-${number}-`));
  const prefix = `anime/${malId}/${number}/`;
  const url = `${R2.base}/${prefix}master.m3u8`;

  try {
    await convert(out);

    if (opts["dry-run"]) {
      console.log(`\nSimulacion: no se sube ni se registra nada. Archivos en ${out}`);
      console.log(walk(out).map((f) => `  ${path.relative(out, f).split(path.sep).join("/")}`).join("\n"));
      opts.keep = true;
      return;
    }

    await upload(out, prefix);
    await register(episode, url);

    console.log(`\n✓ Publicado: ${url}`);
    console.log(`  Ver en: /watch/${malId}/${number}`);
  } finally {
    if (!opts.keep) fs.rmSync(out, { recursive: true, force: true });
    await db.close().catch(() => {});
  }
};

run().then(() => process.exit(0)).catch((err) => fail(err.message));
