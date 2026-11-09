const jwt = require("jsonwebtoken");

const generateJWT = (id, expiresIn = process.env.JWT_EXPIRE_IN) => {
  return new Promise((resolve, reject) => {
    const payload = { id };

    jwt.sign(
      payload,
      process.env.JWT_SECRET_SEED,
      { expiresIn },
      (err, token) => {
        if (err) {
          console.log(err);
          reject(err);
        }
        resolve(token);
      }
    );
  });
};

const generateRefreshJWT = (id) =>
  generateJWT(id, process.env.JWT_REFRESH_EXPIRE_IN);

const verifyJWT = (token) => jwt.verify(token, process.env.JWT_SECRET_SEED);

module.exports = { generateJWT, generateRefreshJWT, verifyJWT };
