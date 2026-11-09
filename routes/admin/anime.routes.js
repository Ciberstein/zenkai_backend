const express = require("express");

// CONTROLLERS
const controllers = {
  anime: require("../../controllers/admin/anime.controllers"),
};

// MIDDLEWARES
const middlewares = {
  anime: require("../../middlewares/admin/anime.middlewares"),
};

const router = express.Router();

router.get("/",
  controllers.anime.list,
);

router.post("/sync/:malId",
  controllers.anime.sync,
);

router.patch("/:id",
  middlewares.anime.anime,
  controllers.anime.update,
);

router.get("/:id/episodes",
  middlewares.anime.anime,
  controllers.anime.episodes,
);

router.post("/:id/episodes/sync",
  middlewares.anime.anime,
  controllers.anime.syncEpisodes,
);

router.patch("/episodes/:id",
  middlewares.anime.episode,
  controllers.anime.episode,
);

router.post("/episodes/:id/sources",
  middlewares.anime.episode,
  middlewares.anime.source,
  controllers.anime.source,
);

router.delete("/sources/:id",
  controllers.anime.removeSource,
);

module.exports = router;
