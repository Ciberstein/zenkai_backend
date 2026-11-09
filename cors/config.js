// Base hostname allowed by CORS, derived from FRONTEND_DOMAIN (e.g.
// "https://zenkai.com" -> "zenkai.com", "http://localhost:5173" -> "localhost").
// Any origin whose hostname equals this or is a subdomain of it is allowed.
const baseHost = (() => {
  try {
    return new URL(process.env.FRONTEND_DOMAIN).hostname;
  } catch {
    return null;
  }
})();

const isAllowedOrigin = (origin) => {
  // Requests without an Origin header (server-to-server, curl, mobile apps)
  // aren't subject to CORS in the browser sense — let them through.
  if (!origin) return true;
  if (!baseHost) return false;

  try {
    const { hostname } = new URL(origin);
    return hostname === baseHost || hostname.endsWith(`.${baseHost}`);
  } catch {
    return false;
  }
};

const cors = {
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) return callback(null, true);
    callback(new Error(`Origin not allowed by CORS: ${origin}`));
  },
  credentials: true,
};

module.exports = { cors };
