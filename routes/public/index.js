const express = require("express");

// ROUTES
const routes = {
  app: require("./app.routes"),
  anime: require("./anime.routes"),
  catalog: require("./catalog.routes"),
};

const router = express.Router();

router.use("/app", routes.app);
router.use("/anime", routes.anime);
router.use("/catalog", routes.catalog);

module.exports = router;
