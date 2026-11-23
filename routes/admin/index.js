const express = require("express");
const ROLES = require("../../utils/roles");

// ROUTES
const routes = {
  app: require("./app.routes"),
  anime: require("./anime.routes"),
  accounts: require("./account.routes"),
  jobs: require("./jobs.routes"),
};

// MIDDLEWARES
const middlewares = {
  auth: require("../../middlewares/auth/auth.middlewares"),
};

const router = express.Router();

const { restrictTo } = middlewares.auth;

router.use(middlewares.auth.protect, restrictTo(ROLES.MODERATOR));

// El moderador solo gestiona el catalogo; el resto del panel es del administrador.
router.use("/anime", routes.anime);
router.use("/app", restrictTo(ROLES.ADMIN), routes.app);
router.use("/accounts", restrictTo(ROLES.ADMIN), routes.accounts);
router.use("/jobs", restrictTo(ROLES.ADMIN), routes.jobs);

module.exports = router;
