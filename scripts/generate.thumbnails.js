require("dotenv").config({ quiet: true });

const { parseArgs } = require("util");
const { createContext, closeContext, generateThumbnail } = require("./lib/publish");

// Saca la miniatura de los episodios YA publicados: un fotograma del propio video, que se sube
// junto al episodio y se usa en la lista de episodios de la serie. Los episodios que se publican
// ahora ya la sacan solos; esto es para los que se publicaron antes.
//
//   npm run generate:thumbnails                          todos los episodios publicados sin miniatura
//   npm run generate:thumbnails -- --anime 52991         solo ese anime (id de MyAnimeList)
//   npm run generate:thumbnails -- --anime 52991 --episode 3
//   npm run generate:thumbnails -- --force               rehacerlas aunque ya tengan
//
// Mismas variables .env que publish:episode (R2_*) y ffmpeg.

const fail = (message) => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};

let opts;

try {
  ({ values: opts } = parseArgs({
    options: { anime: { type: "string" }, episode: { type: "string" }, force: { type: "boolean", default: false } },
  }));
} catch (err) {
  fail(err.message);
}

const malId = opts.anime === undefined ? null : Number(opts.anime);
const number = opts.episode === undefined ? null : Number(opts.episode);

if (malId !== null && !Number.isInteger(malId)) fail("--anime debe ser un numero (id de MyAnimeList)");
if (number !== null && !Number.isFinite(number)) fail("--episode debe ser un numero");
if (number !== null && malId === null) fail("--episode necesita --anime");

(async () => {
  const ctx = await createContext();

  try {
    const where = {};

    if (malId !== null) {
      const anime = await ctx.Anime.Anime.findOne({ where: { malId } });
      if (!anime) fail(`No hay ningun anime con malId ${malId} en la base`);
      where.animeId = anime.id;
    }
    if (number !== null) where.number = number;

    const episodes = await ctx.Anime.Episode.findAll({
      where,
      include: [
        { model: ctx.Anime.Anime, as: "anime", attributes: ["malId", "title"] },
        { model: ctx.Anime.Source, as: "sources", attributes: ["id"], where: { type: "hls" }, required: true },
      ],
      order: [["animeId", "ASC"], ["number", "ASC"]],
    });

    console.log(`${episodes.length} episodio(s) con video publicado`);

    let made = 0;

    for (const episode of episodes) {
      const label = `${episode.anime.title} · ${episode.number}`;

      try {
        const result = await generateThumbnail(ctx, { malId: episode.anime.malId, number: episode.number, force: opts.force });

        if (result.skipped) console.log(`  ${label}: omitido (${result.skipped})`);
        else { made += 1; console.log(`  ${label}: ✓`); }
      } catch (err) {
        console.log(`  ${label}: ✗ ${err.message}`);
      }
    }

    console.log(`\n✓ ${made} miniatura(s) generada(s)`);
  } finally {
    await closeContext(ctx);
  }
})().then(() => process.exit(0)).catch((err) => fail(err.message));
