const { config, config_categories, languages } = require("./data/app.data.seeders");
const App = require("../models/app.models");

const app_config_categories_seeder = async () => {
  try {
    const count = await App.Category.count();
    if (count === 0) {
      await App.Category.bulkCreate(config_categories, { updateOnDuplicate: ["title"] });
      return 'SYNC';
    }
    return 'EXISTING';
  } catch { return 'ERROR'; }
};

const app_config_seeder = async () => {
  try {
    // Inserta solo las keys faltantes; no modifica las existentes (ON CONFLICT DO NOTHING).
    // Asi, agregar una key nueva al seeder la crea en DBs ya pobladas al reiniciar.
    await App.Config.bulkCreate(config, { ignoreDuplicates: true });
    return 'SYNC';
  } catch { return 'ERROR'; }
};

const app_languages_seeder = async () => {
  try {
    const count = await App.Language.count();
    if (count === 0) {
      await App.Language.bulkCreate(languages, { updateOnDuplicate: ["name", "code"] });
      return 'SYNC';
    }
    return 'EXISTING';
  } catch { return 'ERROR'; }
};

module.exports = {
  app_config_categories_seeder,
  app_config_seeder,
  app_languages_seeder,
};
