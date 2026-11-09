const express = require("express");

// CONTROLLERS
const controllers = {
  anime: require("../../controllers/public/anime.controllers"),
};

// MIDDLEWARES
const middlewares = {
  auth: require("../../middlewares/auth/auth.middlewares"),
  anime: require("../../middlewares/public/anime.middlewares"),
};

const router = express.Router();

router.get("/",
  controllers.anime.search,
);

router.get("/:malId",
  middlewares.anime.anime,
  controllers.anime.anime,
);

router.get("/:malId/episodes",
  middlewares.auth.optional,
  middlewares.anime.anime,
  middlewares.anime.local,
  controllers.anime.episodes,
);

router.get("/:malId/episodes/:number",
  middlewares.anime.anime,
  middlewares.anime.local,
  controllers.anime.episode,
);

router.get("/:malId/characters",
  middlewares.anime.anime,
  controllers.anime.characters,
);

router.get("/:malId/recommendations",
  middlewares.anime.anime,
  controllers.anime.recommendations,
);

router.get("/:malId/comments",
  middlewares.anime.anime,
  middlewares.anime.local,
  controllers.anime.comments,
);

module.exports = router;
