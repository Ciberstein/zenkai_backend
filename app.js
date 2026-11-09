
const { cors: cors_conf } = require('./cors/config');
const cookieParser = require('cookie-parser');
const express = require("express");
const morgan = require("morgan");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const http = require('http');
const app = express();

const server = http.createServer(app);
const router = express.Router();

// CONTROLLERS //
const { globalErrorHandler } = require('./controllers/error.controllers');

// ROUTES //
const auth = require("./routes/auth");
const public = require("./routes/public");
const user = require("./routes/user");
const admin = require("./routes/admin");

if (process.env.NODE_ENV === "development")
  app.use(morgan("dev"));

app.use("/ping", (_, r) => r.send("pong"));
app.use(cors(cors_conf));
app.use(helmet());
app.use(cookieParser());
app.use(express.json());

// Global rate limit for API traffic. The catalog endpoints proxy Jikan and
// are cached in Redis, so the limit here protects our own process, not the
// upstream — the Jikan queue in services/modules/jikan.service.js does that.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

router.use("/auth", apiLimiter, auth);
router.use("/public", apiLimiter, public);
router.use("/admin", apiLimiter, admin);
router.use("/me", apiLimiter, user);

app.use("/api/v1", router);

app.use(globalErrorHandler);

module.exports = { server };
