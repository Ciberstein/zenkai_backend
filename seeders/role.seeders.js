const { roles } = require("./data/role.data.seeders");
const Accounts = require("../models/accounts.models");

const role_seeder = async () => {
  try {
    const count = await Accounts.Role.count();
    if (count === 0) {
      await Accounts.Role.bulkCreate(roles, { updateOnDuplicate: ["authority", "title"] });
      return 'SYNC';
    }
    return 'EXISTING';
  } catch { return 'ERROR'; }
};

module.exports = { role_seeder };
