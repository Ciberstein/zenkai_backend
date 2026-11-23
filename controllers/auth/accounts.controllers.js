const Accounts = require("../../models/accounts.models");
const Profile = require("../../models/profile.models");
const services = require("../../services");
const catchAsync = require("../../utils/catchAsync");
const AppError = require("../../utils/appError");
const LOG_ACTIONS = require("../../utils/log.actions");
const { hash } = require("../../utils/hash.util");
const { verifyJWT } = require("../../utils/jwt");
const { Op } = require("sequelize");

// Segundos hasta poder pedir otro codigo. Constante a proposito: si dependiera de que la cuenta
// exista, la respuesta revelaria que correos estan registrados.
const RESEND_WAIT = 60;

// Tras rotar el token de refresco, el anterior aguanta unos segundos mas. Dos pestanas (o dos
// peticiones) que renuevan a la vez llegan con el mismo token: sin este margen la segunda lo
// encuentra ya borrado, falla y cierra la sesion de las dos.
const REFRESH_GRACE_MS = 30_000;

const meta = (req) => ({ ip: req.ip, agent: req.headers["user-agent"] ?? null });

// Abre la sesion de una cuenta recien creada o recien verificada.
const welcome = async (req, res, account, status = 201) => {
  await services.auth.issue(res, account, meta(req));

  services.logger.write({
    actorId: account.id,
    action: LOG_ACTIONS.ACCOUNT_REGISTER,
    ip: req.ip,
  });

  return res.status(status).send({
    id: account.id,
    email: account.email,
    username: account.username,
    authority: account.authority,
  });
};

// Con el servicio de correo configurado la cuenta nace "pending" y no tiene sesion hasta
// confirmar el correo con el codigo; sin el, se crea activa y entra directo (como antes).
exports.register = catchAsync(async (req, res) => {
  const { email, username, password } = req.credentials;
  const verify = services.mail.enabled();

  let account = req.pending;

  if (account) {
    await account.update({ username, password: await hash(password), status: verify ? 'pending' : 'active' });
    await Profile.Profiles.update({ nickname: username }, { where: { accountId: account.id } });
  } else {
    account = await Accounts.Account.create({
      email,
      username,
      password: await hash(password),
      status: verify ? 'pending' : 'active',
    });

    await Profile.Profiles.create({ accountId: account.id, nickname: username });
  }

  if (!verify) return welcome(req, res, account);

  const result = await services.verification.issue(account);

  return res.status(201).send({ verify: true, email: account.email, sent: result.sent, wait: result.wait ?? 0 });
});

// Confirma el correo con el codigo y abre la sesion.
exports.verify = catchAsync(async (req, res) => {
  const { account, code } = req;

  await services.verification.check(account, code);
  await account.update({ status: 'active', verified: true });

  return welcome(req, res, account, 200);
});

// Pide otro codigo. Responde siempre igual, exista o no la cuenta, para no revelar quien esta registrado.
exports.resend = catchAsync(async (req, res) => {
  const account = await Accounts.Account.findOne({ where: { email: req.email, status: 'pending' } });

  if (account) await services.verification.issue(account);

  return res.status(200).send({ message: "If the account is waiting for verification, a new code was sent", wait: RESEND_WAIT });
});

// Recuperar la contrasena, paso 1: manda un codigo al correo. Responde siempre igual, exista o
// no la cuenta. Solo las cuentas activas: una pendiente aun debe verificar su correo, y una
// suspendida no se reactiva por aqui.
exports.recover = catchAsync(async (req, res, next) => {
  if (!services.mail.enabled()) {
    return next(new AppError(`Password recovery is not available right now`, 501));
  }

  const account = await Accounts.Account.findOne({ where: { email: req.email, status: 'active' } });
  if (account) await services.verification.issue(account, 'recovery');

  return res.status(200).send({ message: "If the account exists, a code was sent to its email", wait: RESEND_WAIT });
});

// Paso 2: el codigo y la contrasena nueva. Cierra todas las sesiones abiertas (quien tuviera
// acceso con la contrasena vieja lo pierde) y obliga a entrar de nuevo.
exports.reset = catchAsync(async (req, res) => {
  const { account, code, password } = req;

  await services.verification.check(account, code, 'recovery');
  await account.update({ password: await hash(password), verified: true });
  await Accounts.Session.destroy({ where: { accountId: account.id } });

  services.logger.write({
    actorId: account.id,
    action: LOG_ACTIONS.ACCOUNT_PASSWORD,
    ip: req.ip,
  });

  return res.status(200).send({ message: "Password updated, please login" });
});

exports.login = catchAsync(async (req, res) => {
  const { account } = req;

  await account.update({ lastLogin: new Date() });

  await services.auth.issue(res, account, meta(req));

  services.logger.write({
    actorId: account.id,
    action: LOG_ACTIONS.ACCOUNT_LOGIN,
    ip: req.ip,
  });

  return res.status(200).send({
    id: account.id,
    email: account.email,
    username: account.username,
    authority: account.authority,
    profile: account.profile,
  });
});

exports.logout = catchAsync(async (req, res) => {
  const refresh = req.cookies?.[services.auth.REFRESH_COOKIE];

  await services.auth.revoke(res, refresh);

  return res.status(200).send({ message: "Logged out" });
});

exports.refresh = catchAsync(async (req, res, next) => {
  const refresh = req.cookies?.[services.auth.REFRESH_COOKIE];

  if (!refresh) {
    return next(new AppError(`No refresh token provided`, 401));
  }

  const session = await Accounts.Session.findOne({ where: { token: refresh } });

  // A token that verifies but is not in the table was revoked (logout, ban,
  // password change), so it must not mint a new pair.
  if (!session || session.expiresAt < new Date()) {
    await services.auth.revoke(res, refresh);
    return next(new AppError(`Session expired, please login again`, 401));
  }

  const { id } = verifyJWT(refresh);

  const account = await Accounts.Account.findByPk(id);

  if (!account || account.status === 'banned') {
    await services.auth.revoke(res, refresh);
    return next(new AppError(`Session is no longer valid`, 401));
  }

  // Rotate: the old token stops working right after the new one is written (a few seconds of
  // grace, see REFRESH_GRACE_MS), so a stolen refresh token dies as soon as the real user refreshes.
  const graceEnd = new Date(Date.now() + REFRESH_GRACE_MS);
  if (session.expiresAt > graceEnd) await session.update({ expiresAt: graceEnd });

  await Accounts.Session.destroy({ where: { accountId: account.id, expiresAt: { [Op.lt]: new Date() } } });
  await services.auth.issue(res, account, meta(req));

  return res.status(200).send({ message: "Session refreshed" });
});

exports.validate = catchAsync(async (req, res, next) => {
  // Sin acceso valido pero con refresco: el acceso solo dura 15 min y el navegador lo borra,
  // asi que al abrir la web pasado ese rato no hay que tratar al usuario como invitado. Un 401
  // hace que el frontend renueve la sesion y repita la pregunta. Un invitado de verdad no trae
  // cookie de refresco y recibe { auth: false } como siempre.
  if (!req.sessionAccount && req.cookies?.[services.auth.REFRESH_COOKIE]) {
    return next(new AppError(`Session expired`, 401));
  }

  return res.status(200).send({ auth: Boolean(req.sessionAccount) });
});
