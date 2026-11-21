const Accounts = require("../../models/accounts.models");
const AppError = require("../../utils/appError");
const catchAsync = require("../../utils/catchAsync");
const { isEmail, isPassword } = require("../../utils/validators");

// Confirmar el correo con el codigo recibido.
exports.validate = catchAsync(async (req, _, next) => {
  const { email, code } = req.body;

  if (!isEmail(email) || !/^\d{6}$/.test(String(code ?? ""))) {
    return next(new AppError(`Email and a 6-digit code are required`, 406));
  }

  const account = await Accounts.Account.findOne({
    where: { email: email.trim().toLowerCase(), status: "pending" },
  });

  // Mismo mensaje que un codigo equivocado: no se revela si el correo esta registrado.
  if (!account) {
    return next(new AppError(`The code has expired, request a new one`, 401));
  }

  req.account = account;
  req.code = String(code);

  next();
});

// Nueva contrasena con el codigo de recuperacion.
exports.reset = catchAsync(async (req, _, next) => {
  const { email, code, password } = req.body;

  if (!isEmail(email) || !/^\d{6}$/.test(String(code ?? ""))) {
    return next(new AppError(`Email and a 6-digit code are required`, 406));
  }

  if (!isPassword(password)) {
    return next(new AppError(`Password must be at least 8 characters with upper, lower and a digit`, 406));
  }

  const account = await Accounts.Account.findOne({
    where: { email: email.trim().toLowerCase(), status: "active" },
  });

  // Mismo mensaje que un codigo caducado: no se revela si el correo esta registrado.
  if (!account) {
    return next(new AppError(`The code has expired, request a new one`, 401));
  }

  req.account = account;
  req.code = String(code);
  req.password = password;

  next();
});

// Pedir otro codigo.
exports.resend = catchAsync(async (req, _, next) => {
  const { email } = req.body;

  if (!isEmail(email)) {
    return next(new AppError(`A valid email is required`, 406));
  }

  req.email = email.trim().toLowerCase();

  next();
});
