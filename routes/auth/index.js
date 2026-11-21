const express = require("express");
const rateLimit = require("express-rate-limit");

// CONTROLLERS
const controllers = {
  accounts: require("../../controllers/auth/accounts.controllers"),
};

// MIDDLEWARES
const middlewares = {
  auth: require("../../middlewares/auth/auth.middlewares"),
  login: require("../../middlewares/auth/login.middlewares"),
  register: require("../../middlewares/auth/register.middlewares"),
  verify: require("../../middlewares/auth/verify.middlewares"),
};

const router = express.Router();

// Todo lo que manda un correo o adivina un codigo tiene un limite propio, mas estricto que el
// general: protege la cuota de Resend y el codigo de 6 digitos de la fuerza bruta.
const mailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_MAIL_LIMIT) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: "error", message: "Too many requests, try again in a few minutes" },
});

router.post("/register",
  mailLimiter,
  middlewares.register.validate,
  controllers.accounts.register,
);

router.post("/verify",
  mailLimiter,
  middlewares.verify.validate,
  controllers.accounts.verify,
);

router.post("/verify/resend",
  mailLimiter,
  middlewares.verify.resend,
  controllers.accounts.resend,
);

router.post("/recovery",
  mailLimiter,
  middlewares.verify.resend,
  controllers.accounts.recover,
);

router.post("/recovery/reset",
  mailLimiter,
  middlewares.verify.reset,
  controllers.accounts.reset,
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
