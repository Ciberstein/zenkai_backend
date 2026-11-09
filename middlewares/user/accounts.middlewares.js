const AppError = require("../../utils/appError");
const catchAsync = require("../../utils/catchAsync");
const { compare } = require("../../utils/hash.util");
const { isPassword } = require("../../utils/validators");
const Accounts = require("../../models/accounts.models");

exports.password = catchAsync(async (req, _, next) => {
  const { current, password } = req.body;

  if (!current || !password) {
    return next(new AppError(`Current and new password are required`, 406));
  }

  if (!isPassword(password)) {
    return next(new AppError(`Password must be at least 8 characters with upper, lower and a digit`, 406));
  }

  // req.sessionAccount is the trimmed projection from the auth middleware, so
  // fetch the row again to get the hash.
  const account = await Accounts.Account.findByPk(req.sessionAccount.id);

  if (!(await compare(current, account.password))) {
    return next(new AppError(`Current password is incorrect`, 401));
  }

  req.account = account;

  next();
});
