require("dotenv").config({ quiet: true });

const { parseArgs } = require("util");
const segments = require("../services/modules/segments.service");

// Busca en AniSkip las marcas de intro / ending / resumen de los episodios YA publicados y las
// guarda para que el reproductor ofrezca "Saltar intro". Lo que un admin puso a mano no se toca.
//
//   npm run fetch:segments                       todos los episodios con video publicado
//   npm run fetch:segments -- --anime 52991      solo ese anime (id de MyAnimeList)
//   npm run fetch:segments -- --anime 52991 --episode 3
//
// Usa solo la base de datos (DB_* del .env) y api.aniskip.com: no necesita R2 ni ffmpeg.

const PAUSE_MS = 250;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fail = (message) => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};

let opts;

try {
  ({ values: opts } = parseArgs({ options: { anime: { type: "string" }, episode: { type: "string" } } }));
} catch (err) {
  fail(err.message);
}

const malId = opts.anime === undefined ? null : Number(opts.anime);
const number = opts.episode === undefined ? null : Number(opts.episode);

if (malId !== null && !Number.isInteger(malId)) fail("--anime debe ser un numero (id de MyAnimeList)");
if (number !== null && !Number.isFinite(number)) fail("--episode debe ser un numero");
if (number !== null && malId === null) fail("--episode necesita --anime");

(async () => {
  // Sin R2: createContext exige las variables del bucket, y aqui no se usan.
  const { db } = require("../database/config");
  const init = require("../models/init.models");
  const Anime = require("../models/anime.models");

  await db.authenticate();
  init();
  await Anime.Segment.sync();

  const where = {};
  if (malId !== null) {
    const anime = await Anime.Anime.findOne({ where: { malId } });
    if (!anime) fail(`No hay ningun anime con malId ${malId} en la base`);
    where.animeId = anime.id;
  }
  if (number !== null) where.number = number;

  const episodes = await Anime.Episode.findAll({
    where,
    include: [
      { model: Anime.Anime, as: "anime", attributes: ["malId", "title"] },
      // Solo los que tienen video: sin el no hay nada que saltar.
      { model: Anime.Source, as: "sources", attributes: ["id"], required: true },
    ],
    order: [["animeId", "ASC"], ["number", "ASC"]],
  });

  console.log(`${episodes.length} episodio(s) con video`);

  let saved = 0;
  let missing = 0;

  for (const episode of episodes) {
    try {
      const result = await segments.fetchFromAniskip(Anime, { episode, malId: episode.anime.malId });
      saved += result.saved;
      if (!result.found) missing += 1;
      console.log(`  ${episode.anime.title} · ${episode.number}: ${result.found ? `${result.saved} marca(s)${result.kept ? `, ${result.kept} manual(es) intacta(s)` : ""}` : "sin datos en AniSkip"}`);
    } catch (err) {
      console.log(`  ${episode.anime.title} · ${episode.number}: ✗ ${err.message}`);
    }

    await sleep(PAUSE_MS);
  }

  console.log(`\n✓ ${saved} marca(s) guardada(s); ${missing} episodio(s) sin datos en AniSkip`);
  await db.close();
})().then(() => process.exit(0)).catch((err) => fail(err.message));
