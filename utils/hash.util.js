const bcrypt = require("bcryptjs");

const SALT_ROUNDS = 12;

const hash = async (plain) => await bcrypt.hash(plain, SALT_ROUNDS);

const compare = async (plain, hashed) => await bcrypt.compare(plain, hashed);

module.exports = { hash, compare };
