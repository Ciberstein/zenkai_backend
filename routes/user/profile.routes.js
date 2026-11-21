const express = require("express");

// CONTROLLERS
const controllers = {
  profile: require("../../controllers/user/profile.controllers"),
};

// MIDDLEWARES
const middlewares = {
  profile: require("../../middlewares/user/profile.middlewares"),
};

const router = express.Router();

router.get("/:id?",
  controllers.profile.profile,
);

router.post("/avatar",
  middlewares.profile.avatar,
  controllers.profile.avatar,
);

router.delete("/avatar",
  controllers.profile.removeAvatar,
);

router.patch("/",
  middlewares.profile.update,
  controllers.profile.update,
);

module.exports = router;
