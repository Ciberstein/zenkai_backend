const { DataTypes } = require("sequelize");
const { db } = require("../database/config");

const Account = db.define(
  "accounts_accounts",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
      field: "id",
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      field: "email",
    },
    username: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      field: "username",
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "password",
    },
    // Numeric level instead of a role string so permission checks stay a
    // single comparison (>= 30000 is staff, >= 40000 is admin).
    authority: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 10000,
      field: "authority",
    },
    status: {
      type: DataTypes.ENUM('active', 'pending', 'banned'),
      allowNull: false,
      defaultValue: 'active',
      field: "status",
    },
    verified: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "verified",
    },
    lastLogin: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "lastLogin",
    },
  },
  { tableName: "accounts_accounts", schema: "accounts" }
);

const Session = db.define(
  "accounts_sessions",
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
    token: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "token",
    },
    ip: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "ip",
    },
    agent: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "agent",
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "expiresAt",
    },
  },
  { tableName: "accounts_sessions", schema: "accounts" }
);

// Codigo de un solo uso enviado por correo (verificar el correo al crear la cuenta; `purpose`
// deja sitio para otros usos, como recuperar la contrasena). Se guarda su huella, nunca el
// codigo; un solo codigo vigente por cuenta y uso.
const Code = db.define(
  "accounts_codes",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false, field: "id" },
    accountId: { type: DataTypes.INTEGER, allowNull: false, field: "accountId" },
    purpose: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "verify", field: "purpose" },
    hash: { type: DataTypes.STRING(64), allowNull: false, field: "hash" },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "attempts" },
    expiresAt: { type: DataTypes.DATE, allowNull: false, field: "expiresAt" },
    sentAt: { type: DataTypes.DATE, allowNull: false, field: "sentAt" },
  },
  {
    tableName: "accounts_codes",
    schema: "accounts",
    indexes: [{ unique: true, fields: ["accountId", "purpose"] }],
  }
);

const Role = db.define(
  "accounts_roles",
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
    authority: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "authority",
    },
    color: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "color",
    },
  },
  { tableName: "accounts_roles", schema: "accounts" }
);

module.exports = { Account, Session, Code, Role };
