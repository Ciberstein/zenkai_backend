const express = require("express");

// CONTROLLERS
const controllers = {
  app: require("../../controllers/admin/app.controllers"),
};

// MIDDLEWARES
const middlewares = {
  auth: require("../../middlewares/auth/auth.middlewares"),
};

const router = express.Router();

router.get("/config",
  controllers.app.config,
);

router.patch("/config/:id",
  controllers.app.update,
);

router.get("/logs",
  controllers.app.logs,
);

module.exports = router;
