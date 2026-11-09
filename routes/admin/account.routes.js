const express = require("express");

// CONTROLLERS
const controllers = {
  accounts: require("../../controllers/admin/accounts.controllers"),
};

// MIDDLEWARES
const middlewares = {
  auth: require("../../middlewares/auth/auth.middlewares"),
  accounts: require("../../middlewares/admin/accounts.middlewares"),
};

const router = express.Router();

router.get("/",
  controllers.accounts.accounts,
);

router.get("/roles",
  controllers.accounts.roles,
);

router.get("/:id",
  middlewares.accounts.account,
  controllers.accounts.account,
);

// Changing authority or ban status is admin-only, not moderator.
router.patch("/:id",
  middlewares.auth.restrict(40000),
  middlewares.accounts.account,
  middlewares.accounts.update,
  controllers.accounts.update,
);

module.exports = router;
