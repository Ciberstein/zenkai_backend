const express = require("express");

// CONTROLLERS
const controllers = {
  jobs: require("../../controllers/admin/jobs.controllers"),
};

// MIDDLEWARES
const middlewares = {
  auth: require("../../middlewares/auth/auth.middlewares"),
};

const router = express.Router();

router.get("/",
  controllers.jobs.list,
);

router.post("/:name/run",
  controllers.jobs.run,
);

module.exports = router;
