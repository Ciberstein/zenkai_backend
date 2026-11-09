const express = require("express");

// CONTROLLERS
const controllers = {
  app: require("../../controllers/public/app.controllers"),
};

const router = express.Router();

router.get("/config",
  controllers.app.config,
);

router.get("/languages",
  controllers.app.languages,
);

module.exports = router;
