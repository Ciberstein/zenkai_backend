require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const { parseArgs } = require("util");
const { createContext, closeContext, publishEpisode } = require("./lib/publish");

// Publica TODOS los episodios de una carpeta: das el video y lo demas lo hace solo
// (convertir a HLS, subir a la carpeta del episodio en el bucket y registrarlo).
// Con --watch se queda vigilando la carpeta y publica lo que vayas soltando en ella.
//
//   npm run publish:folder -- ./episodios
//   npm run publish:folder -- ./episodios --watch
//
// Estructura (el id de MyAnimeList es el de la URL /anime/<id>):
//
//   episodios/
//     52991/                  ← id de MyAnimeList del anime
//       01.mkv                ← numero del episodio (01, 1, 001…)
//       01.es.srt             ← subtitulos sueltos: NUMERO.IDIOMA.srt|ass|vtt
//       01.es.m4a             ← audio suelto (doblaje): NUMERO.IDIOMA.m4a|aac|mka|mp3…
//       02.mp4
//
// Las pistas de audio y los subtitulos de texto que ya traiga el video se usan solos.
// Lo ya publicado se recuerda en episodios/.zenkai-published.json: no se repite salvo
// que el video o sus archivos cambien (o uses --force).
//
//   --watch       vigila la carpeta en vez de procesarla una vez
//   --interval    segundos entre revisiones en --watch (por defecto 30)
//   --force       vuelve a publicar aunque ya estuviera
//   --server, --language, --audio-lang, --reencode, --dry-run: como en publish:episode

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    watch: { type: "boolean", default: false },
    interval: { type: "string", default: "30" },
    force: { type: "boolean", default: false },
    server: { type: "string", default: "Zenkai" },
    language: { type: "string", default: "sub" },
    "audio-lang": { type: "string", default: "ja" },
    reencode: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

const fail = (message) => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};

const root = positionals[0];

if (!root) fail("Indica la carpeta: npm run publish:folder -- ./episodios");
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) fail(`No existe la carpeta: ${root}`);
if (!["sub", "dub"].includes(opts.language)) fail("--language debe ser sub o dub");

const VIDEO = new Set([".mkv", ".mp4", ".m4v", ".mov", ".avi", ".webm", ".ts"]);
const SUBS = new Set([".srt", ".ass", ".ssa", ".vtt"]);
const AUDIO = new Set([".m4a", ".aac", ".mka", ".mp3", ".flac", ".wav", ".ac3", ".opus", ".ogg"]);

const STATE = path.join(root, ".zenkai-published.json");

const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return {}; } };
const writeState = (state) => fs.writeFileSync(STATE, JSON.stringify(state, null, 2));

const stamp = () => new Date().toLocaleTimeString("es");
const log = (message) => console.log(`[${stamp()}] ${message}`);

// Recorre `raiz/<malId>/` y agrupa cada video con sus archivos sueltos.
const scan = () => {
  const jobs = [];

  for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory() || !/^\d+$/.test(dir.name)) continue;

    const folder = path.join(root, dir.name);
    const files = fs.readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);

    for (const name of files) {
      const { name: base, ext } = path.parse(name);
      if (!VIDEO.has(ext.toLowerCase()) || !/^\d{1,4}$/.test(base)) continue;

      const number = Number(base);
      const sidecar = files
        .map((other) => other.match(new RegExp(`^${base}\\.([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?)(\\.[a-z0-9]+)$`)))
        .filter(Boolean)
        .map(([file, lang, extension]) => ({ lang: lang.toLowerCase(), extension: extension.toLowerCase(), file: path.join(folder, file) }));

      const video = path.join(folder, name);
      const stat = fs.statSync(video);

      jobs.push({
        key: `${dir.name}/${number}`,
        malId: Number(dir.name),
        number,
        video,
        audio: sidecar.filter((s) => AUDIO.has(s.extension)).map(({ lang, file }) => ({ lang, file })),
        subs: sidecar.filter((s) => SUBS.has(s.extension)).map(({ lang, file }) => ({ lang, file })),
        // Si cambia el video o cualquier archivo suelto, se vuelve a publicar.
        signature: [stat.size, Math.floor(stat.mtimeMs), ...sidecar.map((s) => `${path.basename(s.file)}:${fs.statSync(s.file).size}`)].join("|"),
        modified: stat.mtimeMs,
      });
    }
  }

  return jobs.sort((a, b) => a.malId - b.malId || a.number - b.number);
};

// Un episodio que falla (por ejemplo, porque aun no existe en la base) no se
// reintenta en cada pasada de --watch: se reintenta pasados unos minutos, o antes
// si el archivo cambia. Asi el log no se llena del mismo error cada 30 segundos.
const RETRY_FAILED_MS = 10 * 60 * 1000;
const failures = new Map();

const pass = async (ctx) => {
  const state = readState();
  const summary = { done: 0, skipped: 0, failed: 0 };

  for (const job of scan()) {
    if (!opts.force && state[job.key]?.signature === job.signature) { summary.skipped += 1; continue; }

    const failure = failures.get(job.key);
    if (failure && failure.signature === job.signature && Date.now() - failure.at < RETRY_FAILED_MS) continue;

    // Un archivo que se esta copiando ahora mismo cambia de tamano: se espera a la siguiente pasada.
    if (Date.now() - job.modified < 15000) { log(`${job.key}: se esta copiando, lo dejo para la siguiente revision`); continue; }

    log(`── ${job.key} (${path.basename(job.video)})`);

    try {
      const result = await publishEpisode(ctx, {
        ...job,
        audioLang: opts["audio-lang"],
        server: opts.server,
        language: opts.language,
        reencode: opts.reencode,
        dryRun: opts["dry-run"],
        log: (message) => log(`   ${message}`),
      });

      if (!result.dryRun) {
        state[job.key] = { signature: job.signature, url: result.url, at: new Date().toISOString() };
        writeState(state);
      }

      failures.delete(job.key);
      log(`✓ ${job.key} publicado${result.url ? `: ${result.url}` : ""}`);
      summary.done += 1;
    } catch (err) {
      log(`✗ ${job.key}: ${err.message}`);
      failures.set(job.key, { signature: job.signature, at: Date.now() });
      summary.failed += 1;
    }
  }

  return summary;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const ctx = await createContext({ dryRun: opts["dry-run"] });

  try {
    if (!opts.watch) {
      const { done, skipped, failed } = await pass(ctx);
      log(`Listo: ${done} publicado(s), ${skipped} ya estaban, ${failed} con error`);
      process.exitCode = failed ? 1 : 0;
      return;
    }

    log(`Vigilando ${path.resolve(root)} cada ${opts.interval} s. Ctrl+C para salir.`);

    process.on("SIGINT", () => { log("Saliendo…"); closeContext(ctx).finally(() => process.exit(0)); });

    for (;;) {
      await pass(ctx);
      await sleep(Math.max(5, Number(opts.interval) || 30) * 1000);
    }
  } finally {
    if (!opts.watch) await closeContext(ctx);
  }
})().then(() => process.exit(process.exitCode ?? 0)).catch((err) => fail(err.message));
