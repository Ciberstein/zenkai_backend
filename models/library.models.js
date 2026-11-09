const { DataTypes } = require("sequelize");
const { db } = require("../database/config");

const Watchlist = db.define(
  "library_watchlist",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
      field: "id",
    },
    accountId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "accountId",
    },
    animeId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "animeId",
    },
    status: {
      type: DataTypes.ENUM('watching', 'planned', 'completed', 'on_hold', 'dropped'),
      allowNull: false,
      defaultValue: 'planned',
      field: "status",
    },
  },
  {
    tableName: "library_watchlist",
    schema: "library",
    indexes: [{ unique: true, fields: ["accountId", "animeId"] }],
  }
);

const Favorite = db.define(
  "library_favorites",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
      field: "id",
    },
    accountId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "accountId",
    },
    animeId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "animeId",
    },
  },
  {
    tableName: "library_favorites",
    schema: "library",
    indexes: [{ unique: true, fields: ["accountId", "animeId"] }],
  }
);

// One row per (account, episode), updated in place as the viewer advances.
// This is what feeds the "continue watching" rail on the home page.
const History = db.define(
  "library_history",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
      field: "id",
    },
    accountId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "accountId",
    },
    animeId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "animeId",
    },
    episodeId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "episodeId",
    },
    progress: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: "progress",
    },
    duration: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "duration",
    },
    completed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "completed",
    },
  },
  {
    tableName: "library_history",
    schema: "library",
    indexes: [{ unique: true, fields: ["accountId", "episodeId"] }],
  }
);

const Rating = db.define(
  "library_ratings",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
      field: "id",
    },
    accountId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "accountId",
    },
    animeId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "animeId",
    },
    score: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "score",
    },
  },
  {
    tableName: "library_ratings",
    schema: "library",
    indexes: [{ unique: true, fields: ["accountId", "animeId"] }],
  }
);

const Comment = db.define(
  "library_comments",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
      field: "id",
    },
    accountId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "accountId",
    },
    animeId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "animeId",
    },
    episodeId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "episodeId",
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "body",
    },
    spoiler: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "spoiler",
    },
  },
  { tableName: "library_comments", schema: "library" }
);

module.exports = { Watchlist, Favorite, History, Rating, Comment };
