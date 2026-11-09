const express = require("express");

// CONTROLLERS
const controllers = {
  library: require("../../controllers/user/library.controllers"),
};

// MIDDLEWARES
const middlewares = {
  library: require("../../middlewares/user/library.middlewares"),
};

const router = express.Router();

router.get("/watchlist",
  controllers.library.watchlist,
);

router.post("/watchlist/:malId",
  middlewares.library.anime,
  middlewares.library.status,
  controllers.library.track,
);

router.delete("/watchlist/:malId",
  middlewares.library.anime,
  controllers.library.untrack,
);

router.get("/favorites",
  controllers.library.favorites,
);

router.post("/favorites/:malId",
  middlewares.library.anime,
  controllers.library.favorite,
);

router.delete("/favorites/:malId",
  middlewares.library.anime,
  controllers.library.unfavorite,
);

router.post("/ratings/:malId",
  middlewares.library.anime,
  middlewares.library.score,
  controllers.library.rate,
);

router.post("/comments/:malId",
  middlewares.library.anime,
  middlewares.library.comment,
  controllers.library.comment,
);

router.delete("/comments/:id",
  controllers.library.uncomment,
);

module.exports = router;
