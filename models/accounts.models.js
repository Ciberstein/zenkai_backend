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

module.exports = { Account, Session, Role };
