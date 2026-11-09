const express = require("express");

// ROUTES
const routes = {
  account: require("./account.routes"),
  profile: require("./profile.routes"),
  library: require("./library.routes"),
  history: require("./history.routes"),
};

// MIDDLEWARES
const middlewares = {
  auth: require("../../middlewares/auth/auth.middlewares"),
};

const router = express.Router();

// Every /me endpoint requires a session, so the gate lives here instead of
// being repeated on each child router.
router.use(middlewares.auth.protect);

router.use("/account", routes.account);
router.use("/profile", routes.profile);
router.use("/library", routes.library);
router.use("/history", routes.history);

module.exports = router;
