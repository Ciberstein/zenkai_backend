const { generateJWT, generateRefreshJWT } = require("../../utils/jwt");
const Accounts = require("../../models/accounts.models");

const ACCESS_COOKIE = "zk_access";
const REFRESH_COOKIE = "zk_refresh";

// SameSite=None is required because the SPA and the API sit on different
// subdomains in production; Secure is mandatory whenever None is used, so it
// is only relaxed in development where the browser allows plain http.
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  path: "/",
});

const parseDuration = (value, fallback) => {
  const match = /^(\d+)([smhd])$/.exec(String(value ?? ""));
  if (!match) return fallback;

  const units = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Number(match[1]) * units[match[2]];
};

// Issues both tokens, persists the refresh session and writes the cookies.
// Used by login, register and refresh so the three stay in sync.
const issue = async (res, account, meta = {}) => {
  const access = await generateJWT(account.id);
  const refresh = await generateRefreshJWT(account.id);

  const maxAge = parseDuration(process.env.JWT_REFRESH_EXPIRE_IN, 30 * 86_400_000);

  await Accounts.Session.create({
    accountId: account.id,
    token: refresh,
    ip: meta.ip ?? null,
    agent: meta.agent ?? null,
    expiresAt: new Date(Date.now() + maxAge),
  });

  res.cookie(ACCESS_COOKIE, access, {
    ...cookieOptions(),
    maxAge: parseDuration(process.env.JWT_EXPIRE_IN, 900_000),
  });
  res.cookie(REFRESH_COOKIE, refresh, { ...cookieOptions(), maxAge });

  return { access, refresh };
};

const revoke = async (res, refresh) => {
  if (refresh) await Accounts.Session.destroy({ where: { token: refresh } });

  res.clearCookie(ACCESS_COOKIE, cookieOptions());
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
};

module.exports = { ACCESS_COOKIE, REFRESH_COOKIE, cookieOptions, issue, revoke };
