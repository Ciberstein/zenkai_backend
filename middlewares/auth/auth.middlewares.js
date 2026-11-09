const Accounts = require("../../models/accounts.models");
const Profile = require("../../models/profile.models");
const services = require("../../services");
const AppError = require("../../utils/appError");
const catchAsync = require("../../utils/catchAsync");
const { verifyJWT } = require("../../utils/jwt");

const load = async (token) => {
  const { id } = verifyJWT(token);

  return await Accounts.Account.findOne({
    where: { id },
    attributes: ["id", "email", "username", "authority", "status", "verified"],
    include: [{ model: Profile.Profiles, as: "profile" }],
  });
};

// Hard gate: everything under /me and /admin goes through here.
exports.protect = catchAsync(async (req, _, next) => {
  const token = req.cookies?.[services.auth.ACCESS_COOKIE];

  if (!token) {
    return next(new AppError(`You are not logged in`, 401));
  }

  const account = await load(token);

  if (!account) {
    return next(new AppError(`The owner of this session no longer exists`, 401));
  }

  // 503 is what the frontend axios interceptor treats as "force logout"
  // instead of trying a token refresh, which is the right outcome for a ban.
  if (account.status === 'banned') {
    return next(new AppError(`This account is suspended`, 503));
  }

  req.sessionAccount = account;

  next();
});

// Soft gate: public catalog endpoints use it to personalise the response
// (watchlist flags, resume position) without ever rejecting a guest.
exports.optional = catchAsync(async (req, _, next) => {
  const token = req.cookies?.[services.auth.ACCESS_COOKIE];

  if (!token) return next();

  try {
    const account = await load(token);
    if (account && account.status !== 'banned') req.sessionAccount = account;
  } catch { /* an invalid token is simply treated as a guest */ }

  next();
});

exports.restrict = (authority) => (req, _, next) => {
  if (!req.sessionAccount || req.sessionAccount.authority < authority) {
    return next(new AppError(`You do not have permission to perform this action`, 403));
  }

  next();
};
