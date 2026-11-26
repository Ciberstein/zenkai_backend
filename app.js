
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

// Ver juntos (WebSocket): comparte el servidor HTTP, asi que usa el mismo puerto.
require("./services/modules/party.service").attach(server);
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

// Detras de Railway (y de Cloudflare si el dominio pasa por el) la IP real llega
// en X-Forwarded-For. Sin esto `req.ip` es la del proxy, el limitador cuenta a
// todos los usuarios como uno solo y express-rate-limit lanza
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR. TRUST_PROXY es el numero de proxies de
// confianza delante de la app: 1 con Railway, 2 con Cloudflare por delante.
app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 1));

app.use("/ping", (_, r) => r.send("pong"));
app.use(cors(cors_conf));
app.use(helmet());
app.use(cookieParser());
app.use(express.json());

// Global rate limit for API traffic. The catalog endpoints proxy Jikan and
// are cached in Redis, so the limit here protects our own process, not the
// upstream — the Jikan queue in services/modules/jikan.service.js does that.
// Disabled for now: set RATE_LIMIT=on to enable it again (the stricter limiter on the
// auth routes that send e-mail or check codes stays active either way).
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  skip: () => process.env.RATE_LIMIT !== "on",
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
