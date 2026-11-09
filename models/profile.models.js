const { DataTypes } = require("sequelize");
const { db } = require("../database/config");

const Profiles = db.define(
  "profile_profiles",
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
      unique: true,
      field: "accountId",
    },
    nickname: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "nickname",
    },
    avatar: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "avatar",
    },
    cover: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "cover",
    },
    bio: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "bio",
    },
    country: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "country",
    },
    language: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'es',
      field: "language",
    },
    // Player defaults the client restores on every episode.
    preferences: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: { autoplay: true, autoNext: true, quality: 'auto', language: 'sub' },
      field: "preferences",
    },
  },
  { tableName: "profile_profiles", schema: "profile" }
);

module.exports = { Profiles };
