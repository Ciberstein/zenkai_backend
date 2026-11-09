const { genres } = require("./data/anime.data.seeders");
const Anime = require("../models/anime.models");

const genre_seeder = async () => {
  try {
    await Anime.Genre.bulkCreate(genres, { ignoreDuplicates: true });
    return 'SYNC';
  } catch { return 'ERROR'; }
};

module.exports = { genre_seeder };
