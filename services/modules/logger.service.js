const App = require("../../models/app.models");
const syslog = require("../../utils/syslog.util");

// Audit trail. Never throws: a failed log must not break the request that
// triggered it, so errors are reported to stdout and swallowed.
const write = async ({ actorId = null, targetId = null, action, meta = null, ip = null }) => {
  try {
    await App.Log.create({ actorId, targetId, action, meta, ip });
  } catch (err) {
    syslog.fail('Logger', `${action}: ${err.message}`);
  }
};

// Express helper: pulls actor and ip straight off the request.
const fromRequest = (req, { action, targetId = null, meta = null }) =>
  write({
    actorId: req.sessionAccount?.id ?? null,
    targetId,
    action,
    meta,
    ip: req.ip,
  });

module.exports = { write, fromRequest };
