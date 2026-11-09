const { Sequelize } = require("sequelize");

const db = new Sequelize({
  dialect: process.env.DB_DIALECT,
  host: process.env.DB_HOST,
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  port: process.env.DB_PORT,
  logging: false,

  // Sin limites explicitos, una base inalcanzable deja cada peticion colgada
  // hasta el timeout del sistema —20 s o mas— antes de devolver el 500. Con
  // `acquire` (espera maxima por una conexion del pool) y el timeout de
  // conexion de pg, el fallo llega en unos 5 s y el frontend puede reaccionar
  // en vez de quedarse en blanco.
  pool: {
    max: 10,
    min: 0,
    acquire: 8000,
    idle: 10000,
  },

  dialectOptions: {
    connectionTimeoutMillis: 5000,
  },
});

module.exports = { db };
