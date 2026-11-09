// Canonical action names written to app.app_logs. Keep them stable — the
// admin panel filters and translates by these exact strings.
const LOG_ACTIONS = {
  ACCOUNT_REGISTER: "account:register",
  ACCOUNT_LOGIN: "account:login",
  ACCOUNT_LOGOUT: "account:logout",
  ACCOUNT_UPDATE: "account:update",
  ACCOUNT_PASSWORD: "account:password",
  ACCOUNT_STATUS: "account:status",
  ANIME_SYNC: "anime:sync",
  ANIME_UPDATE: "anime:update",
  EPISODE_CREATE: "episode:create",
  EPISODE_UPDATE: "episode:update",
  SOURCE_CREATE: "source:create",
  CONFIG_UPDATE: "config:update",
  JOB_RUN: "job:run",
};

module.exports = LOG_ACTIONS;
