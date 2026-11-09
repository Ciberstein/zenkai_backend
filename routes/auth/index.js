const express = require("express");

// CONTROLLERS
const controllers = {
  accounts: require("../../controllers/auth/accounts.controllers"),
};

// MIDDLEWARES
const middlewares = {
  auth: require("../../middlewares/auth/auth.middlewares"),
  login: require("../../middlewares/auth/login.middlewares"),
  register: require("../../middlewares/auth/register.middlewares"),
};

const router = express.Router();

router.post("/register",
  middlewares.register.validate,
  controllers.accounts.register,
);

router.post("/login",
  middlewares.login.validate,
  controllers.accounts.login,
);

router.post("/logout",
  controllers.accounts.logout,
);

router.post("/refresh",
  controllers.accounts.refresh,
);

// `optional` instead of `protect`: a guest must get { auth: false }, not a 401,
// or the frontend would trigger a refresh loop on every cold load.
router.post("/validate",
  middlewares.auth.optional,
  controllers.accounts.validate,
);

module.exports = router;
