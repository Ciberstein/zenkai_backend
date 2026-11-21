const crypto = require("crypto");
const { Op } = require("sequelize");
const Accounts = require("../../models/accounts.models");
const Profile = require("../../models/profile.models");
const AppError = require("../../utils/appError");
const mail = require("./mail.service");
const templates = require("../../utils/mail.templates");

// Codigos de un solo uso por correo. Reglas:
//   · 6 digitos aleatorios (crypto), valido 15 minutos
//   · solo se guarda su huella (HMAC con el secreto del servidor), no el codigo
//   · un codigo vigente por cuenta: pedir otro invalida el anterior
//   · como mucho 1 correo por minuto y cuenta, y 5 intentos por codigo
//   · se compara en tiempo constante

// Usos de un codigo: cada uno tiene su plantilla de correo y su propio codigo vigente.
const PURPOSES = { verify: templates.verification, recovery: templates.recovery };
const TTL_MS = 15 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const STALE_MS = 24 * 60 * 60 * 1000;

const digest = (purpose, account, code) =>
  crypto.createHmac("sha256", process.env.JWT_SECRET_SEED ?? "").update(`${purpose}:${account.id}:${code}`).digest("hex");

// Genera, guarda y envia un codigo. Devuelve { sent, wait }: `wait` son los segundos que faltan
// para poder pedir otro si se pidio demasiado pronto (no se envia nada en ese caso).
const issue = async (account, purpose = "verify") => {
  const current = await Accounts.Code.findOne({ where: { accountId: account.id, purpose } });

  if (current) {
    const wait = COOLDOWN_MS - (Date.now() - current.sentAt.getTime());
    if (wait > 0) return { sent: false, wait: Math.ceil(wait / 1000) };
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const now = new Date();

  const data = {
    hash: digest(purpose, account, code),
    attempts: 0,
    expiresAt: new Date(now.getTime() + TTL_MS),
    sentAt: now,
  };

  if (current) await current.update(data);
  else await Accounts.Code.create({ accountId: account.id, purpose, ...data });

  const result = await mail.send({
    to: account.email,
    ...PURPOSES[purpose]({ code, username: account.username, minutes: TTL_MS / 60000 }),
  });

  if (!result.ok) {
    console.error(`[mail] could not send the verification code: ${result.error}`);
    // Sin correo enviado el codigo no sirve y no debe bloquear el siguiente intento.
    await Accounts.Code.destroy({ where: { accountId: account.id, purpose } });
    return { sent: false, wait: 0 };
  }

  return { sent: true, wait: COOLDOWN_MS / 1000 };
};

// Comprueba el codigo y lo consume. Lanza un AppError si no vale.
const check = async (account, code, purpose = "verify") => {
  const row = await Accounts.Code.findOne({ where: { accountId: account.id, purpose } });

  if (!row || row.expiresAt < new Date()) {
    throw new AppError("The code has expired, request a new one", 401);
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    await row.destroy();
    throw new AppError("Too many attempts, request a new code", 429);
  }

  const expected = Buffer.from(row.hash, "hex");
  const given = Buffer.from(digest(purpose, account, code), "hex");

  if (!crypto.timingSafeEqual(expected, given)) {
    const left = MAX_ATTEMPTS - (row.attempts + 1);
    await row.increment("attempts");
    throw new AppError(left > 0 ? `Incorrect code, ${left} attempt(s) left` : "Incorrect code, request a new one", 401);
  }

  await row.destroy();
};

// Cuentas que nunca confirmaron el correo: pasado un dia se borran para liberar su nombre.
const purgeStale = async () => {
  const stale = await Accounts.Account.findAll({
    where: { status: "pending", createdAt: { [Op.lt]: new Date(Date.now() - STALE_MS) } },
    attributes: ["id"],
  });

  if (!stale.length) return 0;

  const ids = stale.map((account) => account.id);

  await Accounts.Code.destroy({ where: { accountId: ids } });
  await Accounts.Session.destroy({ where: { accountId: ids } });
  await Profile.Profiles.destroy({ where: { accountId: ids } });
  await Accounts.Account.destroy({ where: { id: ids } });

  return ids.length;
};

module.exports = { issue, check, purgeStale };
