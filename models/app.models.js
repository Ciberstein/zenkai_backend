const { DataTypes } = require("sequelize");
const { db } = require("../database/config");

const Category = db.define(
  "app_config_categories",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
      field: "id",
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      field: "title",
    },
  },
  { tableName: "app_config_categories", schema: "app" }
);

// Runtime settings the admin panel edits without a redeploy. `key` is what
// the frontend reads (config['project_name']), so it must stay stable.
const Config = db.define(
  "app_config",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
      field: "id",
    },
    categoryId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "categoryId",
    },
    key: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      field: "key",
    },
    value: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "value",
    },
    type: {
      type: DataTypes.ENUM('string', 'number', 'boolean', 'json', 'image'),
      allowNull: false,
      defaultValue: 'string',
      field: "type",
    },
    public: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "public",
    },
  },
  { tableName: "app_config", schema: "app" }
);

const Language = db.define(
  "app_languages",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
      field: "id",
    },
    code: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      field: "code",
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "name",
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "active",
    },
  },
  { tableName: "app_languages", schema: "app" }
);

const Log = db.define(
  "app_logs",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
      field: "id",
    },
    actorId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "actorId",
    },
    targetId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "targetId",
    },
    action: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "action",
    },
    meta: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "meta",
    },
    ip: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "ip",
    },
  },
  { tableName: "app_logs", schema: "app" }
);

module.exports = { Category, Config, Language, Log };
