const express = require("express");

// CONTROLLERS
const controllers = {
  history: require("../../controllers/user/history.controllers"),
};

// MIDDLEWARES
const middlewares = {
  history: require("../../middlewares/user/history.middlewares"),
};

const router = express.Router();

router.get("/",
  controllers.history.history,
);

router.get("/resume",
  controllers.history.resume,
);

router.post("/progress",
  middlewares.history.progress,
  controllers.history.progress,
);

router.delete("/:id",
  controllers.history.remove,
);

router.delete("/",
  controllers.history.clear,
);

module.exports = router;
