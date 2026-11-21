const Accounts = require("../../models/accounts.models");
const AppError = require("../../utils/appError");
const catchAsync = require("../../utils/catchAsync");
const { isEmail, isPassword, isUsername } = require("../../utils/validators");
const verification = require("../../services/modules/verification.service");

exports.validate = catchAsync(async (req, _, next) => {
  const { email, username, password } = req.body;

  if (!isEmail(email)) {
    return next(new AppError(`A valid email is required`, 406));
  }

  if (!isUsername(username)) {
    return next(new AppError(`Username must be 3-20 characters (letters, digits or _)`, 406));
  }

  if (!isPassword(password)) {
    return next(new AppError(`Password must be at least 8 characters with upper, lower and a digit`, 406));
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanUsername = username.trim();

  // Cuentas que nunca confirmaron el correo no deben quedarse con el nombre para siempre.
  await verification.purgeStale();

  const [byEmail, byUsername] = await Promise.all([
    Accounts.Account.findOne({ where: { email: cleanEmail } }),
    Accounts.Account.findOne({ where: { username: cleanUsername }, attributes: ["id"] }),
  ]);

  // Una cuenta del mismo correo que aun espera su codigo se puede volver a registrar (quien
  // se equivoco de contrasena o perdio el correo): se actualiza y se manda otro codigo.
  const pending = byEmail?.status === 'pending' ? byEmail : null;

  if (byEmail && !pending) {
    return next(new AppError(`Email is already in use`, 409));
  }

  if (byUsername && byUsername.id !== pending?.id) {
    return next(new AppError(`Username is already in use`, 409));
  }

  req.pending = pending;
  req.credentials = { email: cleanEmail, username: cleanUsername, password };

  next();
});
