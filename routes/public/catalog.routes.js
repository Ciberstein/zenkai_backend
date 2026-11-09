const express = require("express");

// CONTROLLERS
const controllers = {
  catalog: require("../../controllers/public/catalog.controllers"),
};

// MIDDLEWARES
const middlewares = {
  anime: require("../../middlewares/public/anime.middlewares"),
};

const router = express.Router();

router.get("/home",
  controllers.catalog.home,
);

router.get("/top",
  controllers.catalog.top,
);

router.get("/genres",
  controllers.catalog.genres,
);

router.get("/schedules",
  controllers.catalog.schedules,
);

router.get("/seasons/now",
  controllers.catalog.now,
);

router.get("/seasons/upcoming",
  controllers.catalog.upcoming,
);

router.get("/seasons/:year/:season",
  middlewares.anime.season,
  controllers.catalog.season,
);

module.exports = router;
