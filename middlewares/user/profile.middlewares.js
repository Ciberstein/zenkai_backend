const AppError = require("../../utils/appError");
const catchAsync = require("../../utils/catchAsync");

const FIELDS = ["nickname", "avatar", "cover", "bio", "country", "language", "preferences"];

// Whitelist: the payload is written straight to the row, so anything not
// listed here (accountId included) must never survive the request.
exports.update = catchAsync(async (req, _, next) => {
  const payload = Object.fromEntries(
    Object.entries(req.body).filter(([key]) => FIELDS.includes(key))
  );

  if (!Object.keys(payload).length) {
    return next(new AppError(`No valid fields to update`, 406));
  }

  if (payload.nickname && String(payload.nickname).trim().length < 3) {
    return next(new AppError(`Nickname must be at least 3 characters`, 406));
  }

  if (payload.bio && String(payload.bio).length > 500) {
    return next(new AppError(`Bio cannot exceed 500 characters`, 406));
  }

  req.payload = payload;

  next();
});
