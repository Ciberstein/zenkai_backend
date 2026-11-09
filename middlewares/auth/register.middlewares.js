const Accounts = require("../../models/accounts.models");
const AppError = require("../../utils/appError");
const catchAsync = require("../../utils/catchAsync");
const { isEmail, isPassword, isUsername } = require("../../utils/validators");
const { Op } = require("sequelize");

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

  const exists = await Accounts.Account.findOne({
    where: {
      [Op.or]: [
        { email: email.trim().toLowerCase() },
        { username: username.trim() },
      ],
    },
    attributes: ["id", "email", "username"],
  });

  if (exists) {
    const field = exists.email === email.trim().toLowerCase() ? 'Email' : 'Username';
    return next(new AppError(`${field} is already in use`, 409));
  }

  req.credentials = {
    email: email.trim().toLowerCase(),
    username: username.trim(),
    password,
  };

  next();
});
