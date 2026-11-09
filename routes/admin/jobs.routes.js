const express = require("express");

// CONTROLLERS
const controllers = {
  jobs: require("../../controllers/admin/jobs.controllers"),
};

// MIDDLEWARES
const middlewares = {
  auth: require("../../middlewares/auth/auth.middlewares"),
};

const router = express.Router();

router.get("/",
  controllers.jobs.list,
);

// Lanzar una sincronizacion gasta cuota de MyAnimeList y Jikan: solo admin.
router.post("/:name/run",
  middlewares.auth.restrict(40000),
  controllers.jobs.run,
);

module.exports = router;
