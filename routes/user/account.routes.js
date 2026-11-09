const express = require("express");

// CONTROLLERS
const controllers = {
  accounts: require("../../controllers/user/accounts.controllers"),
};

// MIDDLEWARES
const middlewares = {
  accounts: require("../../middlewares/user/accounts.middlewares"),
};

const router = express.Router();

router.get("/",
  controllers.accounts.account,
);

router.patch("/password",
  middlewares.accounts.password,
  controllers.accounts.password,
);

router.get("/sessions",
  controllers.accounts.sessions,
);

router.delete("/sessions/:id",
  controllers.accounts.revoke,
);

module.exports = router;
