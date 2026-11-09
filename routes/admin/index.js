const express = require("express");

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

// 30000 is the moderator floor (see seeders/data/role.data.seeders.js).
// Anything stricter is declared per-route below.
router.use(middlewares.auth.protect, middlewares.auth.restrict(30000));

router.use("/app", routes.app);
router.use("/anime", routes.anime);
router.use("/accounts", routes.accounts);
router.use("/jobs", routes.jobs);

module.exports = router;
