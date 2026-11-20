require("dotenv").config({ quiet: true });

const fs = require("fs");
const { parseArgs } = require("util");
const { createContext, closeContext, publishEpisode } = require("./lib/publish");

// Publica UN episodio: convierte el video a HLS, sube a R2 y lo registra en la base.
// Para una carpeta entera (o para dejarlo vigilando una carpeta) usa publish:folder.
//
//   npm run publish:episode -- --anime 52991 --episode 1 --video ./ep01.mkv \
//       --audio es=./ep01.es.m4a --sub es=./ep01.es.srt --sub en=./ep01.en.ass
//
//   --anime         id de MyAnimeList del anime (el de la URL /anime/<id>)
//   --episode       numero del episodio; debe existir (sincroniza la lista antes)
//   --video         archivo de video. Sus pistas de audio y los subtitulos de
//                   texto que traiga (un .mkv, por ejemplo) se usan solos
//   --audio-lang    idioma del audio si el archivo no lo indica (por defecto ja)
//   --audio L=ARCH  pista de audio extra, por ejemplo un doblaje (repetible)
//   --sub L=ARCH    subtitulos (.srt, .ass o .vtt); mandan sobre los incrustados (repetible)
//   --default-sub   idioma de subtitulos activado por defecto (el primero si no se indica)
//   --server        nombre que ve el usuario en el selector (por defecto Zenkai)
//   --language      sub | dub, etiqueta de la fuente (por defecto sub)
//   --reencode      recodifica el video aunque ya sea compatible (H.264 8 bits)
//   --keep          no borra los archivos temporales
//   --dry-run       convierte y muestra el plan, sin subir ni tocar la base
//
// Variables (en .env): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
// R2_BUCKET y R2_PUBLIC_URL. Opcionales: R2_ENDPOINT (otro servicio compatible
// con S3) y FFMPEG_PATH (si ffmpeg no esta en el PATH).

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

const audio = opts.audio.map((text) => pair(text, "--audio"));
const subs = opts.sub.map((text) => pair(text, "--sub"));

for (const file of [opts.video, ...audio.map((a) => a.file), ...subs.map((s) => s.file)]) {
  if (!fs.existsSync(file)) fail(`No existe el archivo: ${file}`);
}

(async () => {
  const ctx = await createContext({ dryRun: opts["dry-run"] });

  try {
    const result = await publishEpisode(ctx, {
      malId,
      number,
      video: opts.video,
      audio,
      subs,
      audioLang: opts["audio-lang"],
      defaultSub: opts["default-sub"],
      server: opts.server,
      language: opts.language,
      reencode: opts.reencode,
      keep: opts.keep,
      dryRun: opts["dry-run"],
    });

    if (result.dryRun) console.log(result.files.map((f) => `  ${f}`).join("\n"));
    else console.log(`\n✓ Publicado: ${result.url}\n  Ver en: /watch/${malId}/${number}`);
  } finally {
    await closeContext(ctx);
  }
})().then(() => process.exit(0)).catch((err) => fail(err.message));
