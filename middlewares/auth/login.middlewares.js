const Accounts = require("../../models/accounts.models");
const Profile = require("../../models/profile.models");
const AppError = require("../../utils/appError");
const catchAsync = require("../../utils/catchAsync");
const { compare } = require("../../utils/hash.util");

exports.validate = catchAsync(async (req, _, next) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return next(new AppError(`Email/username and password are required`, 406));
  }

  const value = String(identifier).trim();

  const account = await Accounts.Account.findOne({
    where: value.includes('@')
      ? { email: value.toLowerCase() }
      : { username: value },
    include: [{ model: Profile.Profiles, as: "profile" }],
  });

  // Same message for "no such account" and "wrong password" so the endpoint
  // cannot be used to enumerate registered emails.
  if (!account || !(await compare(password, account.password))) {
    return next(new AppError(`Invalid credentials`, 401));
  }

  if (account.status === 'banned') {
    return next(new AppError(`This account is suspended`, 403));
  }

  req.account = account;

  next();
});
