const { db } = require("./config");
const syslog = require("../utils/syslog.util");

// `db.sync({ alter: false })` never adds columns to an existing table, so any
// column introduced after a table already shipped goes here. Each entry is
// idempotent — ADD COLUMN IF NOT EXISTS — and runs on every boot.
const COLUMNS = [
  // Metricas y datos de emision incorporados al pasar el catalogo a local.
  { schema: "anime", table: "anime_anime", column: "rank", type: "INTEGER" },
  { schema: "anime", table: "anime_anime", column: "popularity", type: "INTEGER" },
  { schema: "anime", table: "anime_anime", column: "members", type: "INTEGER" },
  { schema: "anime", table: "anime_anime", column: "favoritesCount", type: "INTEGER" },
  { schema: "anime", table: "anime_anime", column: "scoredBy", type: "INTEGER" },
  { schema: "anime", table: "anime_anime", column: "airedFrom", type: "TIMESTAMP WITH TIME ZONE" },
  { schema: "anime", table: "anime_anime", column: "airedTo", type: "TIMESTAMP WITH TIME ZONE" },
  { schema: "anime", table: "anime_anime", column: "broadcastDay", type: "VARCHAR(255)" },
  { schema: "anime", table: "anime_anime", column: "origin", type: "VARCHAR(255)" },
  { schema: "anime", table: "anime_anime", column: "titles", type: "JSONB" },
  { schema: "anime", table: "anime_sync_state", column: "failedPages", type: "JSONB NOT NULL DEFAULT '[]'::jsonb" },
  { schema: "anime", table: "anime_anime", column: "episodesSyncedAt", type: "TIMESTAMP WITH TIME ZONE" },
  { schema: "anime", table: "anime_sync_state", column: "startedAt", type: "TIMESTAMP WITH TIME ZONE" },
];

const exists = async (schema, table) => {
  const [[row]] = await db.query(`SELECT to_regclass('"${schema}"."${table}"') AS oid;`);
  return Boolean(row?.oid);
};

// Corre ANTES de `db.sync()`: si el modelo declara un indice sobre una columna
// nueva, la columna tiene que existir ya o la creacion del indice falla.
// En una base vacia no hay nada que migrar — sync creara las tablas completas.
const ensureColumns = async () => {
  if (!COLUMNS.length) return;

  for (const { schema, table, column, type } of COLUMNS) {
    try {
      if (!(await exists(schema, table))) continue;

      await db.query(
        `ALTER TABLE "${schema}"."${table}" ADD COLUMN IF NOT EXISTS "${column}" ${type};`
      );
    } catch (err) {
      syslog.fail('Migrations', `${schema}.${table}.${column}: ${err.message}`);
    }
  }

  syslog.ok('MIGRATIONS STATUS', 'READY');
};

module.exports = { ensureColumns };
