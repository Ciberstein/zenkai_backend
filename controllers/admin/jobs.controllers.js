const scheduler = require("../../scheduler");
const services = require("../../services");
const catchAsync = require("../../utils/catchAsync");
const LOG_ACTIONS = require("../../utils/log.actions");

exports.list = catchAsync(async (_, res) => {
  return res.status(200).send(await scheduler.list());
});

// Responde en cuanto el trabajo arranca: una resincronizacion completa tarda
// minutos y la peticion no puede quedarse esperando. El panel consulta el
// estado con `list` mientras dura.
exports.run = catchAsync(async (req, res) => {
  const { name } = req.params;
  const result = scheduler.start(name, { trigger: 'manual' });

  if (result.status === 'unknown') {
    return res.status(404).send({ status: "error", message: "Job not found" });
  }

  if (result.status === 'busy') {
    return res.status(409).send({ status: "error", message: "Job is already running" });
  }

  services.logger.fromRequest(req, { action: LOG_ACTIONS.JOB_RUN, meta: { job: name } });

  return res.status(202).send({ started: true });
});
