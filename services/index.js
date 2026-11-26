const services = {
  jikan: require("./modules/jikan.service"),
  mal: require("./modules/mal.service"),
  catalog: require("./modules/catalog.service"),
  redis: require("./modules/redis.service"),
  auth: require("./modules/auth.service"),
  pairing: require("./modules/pairing.service"),
  mail: require("./modules/mail.service"),
  cloudinary: require("./modules/cloudinary.service"),
  verification: require("./modules/verification.service"),
  logger: require("./modules/logger.service"),
};

module.exports = services;
