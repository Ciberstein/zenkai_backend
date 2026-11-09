const Accounts = require("../../models/accounts.models");
const Profile = require("../../models/profile.models");
const AppError = require("../../utils/appError");
const catchAsync = require("../../utils/catchAsync");
const { isInteger } = require("../../utils/validators");

exports.account = catchAsync(async (req, _, next) => {
  const { id } = req.params;

  if (!isInteger(id)) {
    return next(new AppError(`Account ID must be a valid integer`, 406));
  }

  const account = await Accounts.Account.findOne({
    where: { id },
    include: [{ model: Profile.Profiles, as: "profile" }],
  });

  if (!account) {
    return next(new AppError(`Account not found`, 404));
  }

  // A staff member must never be able to edit or ban someone at or above
  // their own level, which also stops privilege escalation through PATCH.
  if (account.authority >= req.sessionAccount.authority && account.id !== req.sessionAccount.id) {
    return next(new AppError(`You cannot manage an account of equal or higher authority`, 403));
  }

  req.account = account;

  next();
});

exports.update = catchAsync(async (req, _, next) => {
  const { authority, status, verified } = req.body;

  if (authority !== undefined) {
    if (!isInteger(authority)) {
      return next(new AppError(`Authority must be a valid integer`, 406));
    }

    if (Number(authority) >= req.sessionAccount.authority) {
      return next(new AppError(`You cannot grant an authority equal or higher than yours`, 403));
    }
  }

  if (status !== undefined && !['active', 'pending', 'banned'].includes(status)) {
    return next(new AppError(`Status must be one of: active, pending, banned`, 406));
  }

  req.payload = {
    ...(authority !== undefined ? { authority: Number(authority) } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(verified !== undefined ? { verified: Boolean(verified) } : {}),
  };

  next();
});
