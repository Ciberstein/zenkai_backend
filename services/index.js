const services = {
  jikan: require("./modules/jikan.service"),
  mal: require("./modules/mal.service"),
  catalog: require("./modules/catalog.service"),
  redis: require("./modules/redis.service"),
  auth: require("./modules/auth.service"),
  logger: require("./modules/logger.service"),
};

module.exports = services;
