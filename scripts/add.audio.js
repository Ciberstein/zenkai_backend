require("dotenv").config({ quiet: true });

const fs = require("fs");
const { parseArgs } = require("util");
const { createContext, closeContext, addAudio } = require("./lib/publish");

// Añade un audio extra (por ejemplo, otro doblaje) a un episodio YA publicado, sin volver a
// subir el video: solo se convierte el audio nuevo y se suma al manifiesto del episodio.
//
//   npm run add:audio -- --anime 52991 --episode 1 --audio es-419=./doblaje-latino.m4a
//   npm run add:audio -- --anime 52991 --episode 1 --audio es=./doblaje.m4a --offset 250
//
//   --anime      id de MyAnimeList del anime
//   --episode    numero del episodio; debe estar publicado con publish:episode / el admin
//   --audio L=F  idioma y archivo. Vale un archivo de audio o un video/mkv (se usa su primera
//                pista de audio). Con region para distinguir doblajes: es, es-419, es-ES…
//   --offset     desfase en milisegundos para corregir un doblaje que no cuadra: positivo lo
//                retrasa, negativo lo adelanta (por defecto 0)
//
// Si ya habia un audio de ese idioma, se reemplaza. Mismas variables .env que publish:episode.

const fail = (message) => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};

// parseArgs toma "-300" por otra opcion y se queja: el valor negativo se pega a su flag
// ("--offset=-300"), que es lo que si entiende.
const raw = process.argv.slice(2);
const args = [];

for (let i = 0; i < raw.length; i += 1) {
  if (raw[i] === "--offset" && /^-\d+(\.\d+)?$/.test(raw[i + 1] ?? "")) { args.push(`--offset=${raw[i + 1]}`); i += 1; }
  else args.push(raw[i]);
}

let opts;

try {
  ({ values: opts } = parseArgs({
    args,
    options: {
      anime: { type: "string" },
      episode: { type: "string" },
      audio: { type: "string" },
      offset: { type: "string", default: "0" },
    },
  }));
} catch (err) {
  fail(err.message);
}

const malId = Number(opts.anime);
const number = Number(opts.episode);
const offsetMs = Number(opts.offset);

if (!Number.isInteger(malId) || !Number.isInteger(number)) fail("--anime y --episode son obligatorios y deben ser numeros");
if (!opts.audio || !opts.audio.includes("=")) fail("--audio espera IDIOMA=ARCHIVO (por ejemplo es-419=./doblaje.m4a)");
if (!Number.isFinite(offsetMs)) fail("--offset debe ser un numero de milisegundos");

const at = opts.audio.indexOf("=");
const lang = opts.audio.slice(0, at);
const file = opts.audio.slice(at + 1);

if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(lang)) fail(`Idioma no valido: "${lang}" (usa es, en, es-419…)`);
if (!fs.existsSync(file)) fail(`No existe el archivo: ${file}`);

(async () => {
  const ctx = await createContext();

  try {
    const result = await addAudio(ctx, { malId, number, file, lang, offsetMs });

    console.log(`\n✓ Audio ${lang} ${result.replaced ? "reemplazado" : "añadido"}: el episodio tiene ahora ${result.tracks} pistas de audio`);
    for (const warning of result.warnings) console.log(`  ⚠ ${warning}`);
  } finally {
    await closeContext(ctx);
  }
})().then(() => process.exit(0)).catch((err) => fail(err.message));
