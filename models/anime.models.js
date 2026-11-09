const { DataTypes } = require("sequelize");
const { db } = require("../database/config");

// Local mirror of the Jikan payload. Only the fields the UI renders are
// persisted — anything else is fetched live and served from the Redis cache,
// so the DB stays small and the catalog keeps working if Jikan is down.
const Anime = db.define(
  "anime_anime",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
      field: "id",
    },
    malId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      field: "malId",
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "title",
    },
    titleEnglish: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "titleEnglish",
    },
    titleJapanese: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "titleJapanese",
    },
    slug: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      field: "slug",
    },
    synopsis: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "synopsis",
    },
    type: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "type",
    },
    status: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "status",
    },
    // "episodesCount" y no "episodes": ese alias lo ocupa la asociacion con
    // anime_episodes y Sequelize no permite que coincidan.
    episodesCount: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "episodesCount",
    },
    duration: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "duration",
    },
    rating: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "rating",
    },
    score: {
      type: DataTypes.FLOAT,
      allowNull: true,
      field: "score",
    },
    season: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "season",
    },
    year: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "year",
    },
    image: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "image",
    },
    banner: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "banner",
    },
    trailer: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "trailer",
    },
    studios: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "studios",
    },
    featured: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "featured",
    },
    visible: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "visible",
    },
    // Metricas de MAL. Son las que ordenan el catalogo (top, populares,
    // mejor valorados) ahora que eso se resuelve en base y no en Jikan.
    rank: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "rank",
    },
    popularity: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "popularity",
    },
    members: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "members",
    },
    favoritesCount: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "favoritesCount",
    },
    scoredBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "scoredBy",
    },
    airedFrom: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "airedFrom",
    },
    airedTo: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "airedTo",
    },
    // Dia de emision en minusculas ("mondays"), tal cual lo da MAL: es lo que
    // alimenta el calendario semanal sin volver a pedirlo a Jikan.
    broadcastDay: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "broadcastDay",
    },
    origin: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "origin",
    },
    // Titulos alternativos y sinonimos, para que la busqueda local encuentre
    // "Shingeki no Kyojin" y "Attack on Titan" por igual.
    titles: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "titles",
    },
    syncedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "syncedAt",
    },
    // Ultima vez que se trajo la lista de episodios de este titulo. Separada de
    // `syncedAt` porque son dos trabajos distintos: la ficha se refresca sola y
    // los episodios cuestan una peticion por titulo.
    episodesSyncedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "episodesSyncedAt",
    },
  },
  {
    tableName: "anime_anime",
    schema: "anime",
    indexes: [
      { fields: ["score"] },
      { fields: ["popularity"] },
      { fields: ["year", "season"] },
      { fields: ["broadcastDay"] },
    ],
  }
);

const Genre = db.define(
  "anime_genres",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
      field: "id",
    },
    malId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      unique: true,
      field: "malId",
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      field: "name",
    },
    slug: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "slug",
    },
  },
  { tableName: "anime_genres", schema: "anime" }
);

const AnimeGenre = db.define(
  "anime_anime_genres",
  {
    animeId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "animeId",
    },
    genreId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "genreId",
    },
  },
  { tableName: "anime_anime_genres", schema: "anime", timestamps: false }
);

const Episode = db.define(
  "anime_episodes",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
      field: "id",
    },
    animeId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "animeId",
    },
    number: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "number",
    },
    title: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "title",
    },
    thumbnail: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "thumbnail",
    },
    duration: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "duration",
    },
    filler: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "filler",
    },
    recap: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "recap",
    },
    aired: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "aired",
    },
    visible: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "visible",
    },
  },
  {
    tableName: "anime_episodes",
    schema: "anime",
    indexes: [{ unique: true, fields: ["animeId", "number"] }],
  }
);

// One row per playable stream. An episode usually has several (server x
// language x quality) and the player picks the one matching the saved
// preference stored on the profile.
const Source = db.define(
  "anime_sources",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
      field: "id",
    },
    episodeId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "episodeId",
    },
    server: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "server",
    },
    url: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "url",
    },
    type: {
      type: DataTypes.ENUM('hls', 'mp4', 'embed'),
      allowNull: false,
      defaultValue: 'hls',
      field: "type",
    },
    quality: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'auto',
      field: "quality",
    },
    language: {
      type: DataTypes.ENUM('sub', 'dub'),
      allowNull: false,
      defaultValue: 'sub',
      field: "language",
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "active",
    },
  },
  { tableName: "anime_sources", schema: "anime" }
);

// Estado de los trabajos de sincronizacion. El backfill del catalogo entero
// son ~1.160 paginas y Jikan se cae a media faena, asi que la pagina en curso
// se persiste aqui: el proceso se reanuda donde lo dejo en vez de empezar
// desde cero.
const SyncState = db.define(
  "anime_sync_state",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
      field: "id",
    },
    job: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      field: "job",
    },
    cursor: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      field: "cursor",
    },
    lastPage: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "lastPage",
    },
    processed: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: "processed",
    },
    // Paginas que fallaron y hay que repescar. MyAnimeList devuelve 504 de
    // forma intermitente (una pagina falla y la siguiente va), asi que saltarla
    // y reintentarla luego rescata mucho mas catalogo que abortar el trabajo.
    failedPages: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
      field: "failedPages",
    },
    status: {
      type: DataTypes.ENUM('idle', 'running', 'done', 'error'),
      allowNull: false,
      defaultValue: 'idle',
      field: "status",
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "message",
    },
    finishedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "finishedAt",
    },
    // Inicio de la ultima ejecucion: junto a `finishedAt` da la duracion que
    // muestra el panel de tareas.
    startedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "startedAt",
    },
  },
  { tableName: "anime_sync_state", schema: "anime" }
);

module.exports = { Anime, Genre, AnimeGenre, Episode, Source, SyncState };
