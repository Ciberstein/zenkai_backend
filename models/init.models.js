const Accounts = require("./accounts.models");
const Profile = require("./profile.models");
const Anime = require("./anime.models");
const Library = require("./library.models");
const App = require("./app.models");

const init = () => {

  /* APP RELATIONSHIPS */

  App.Config.belongsTo(App.Category, {
    foreignKey: 'categoryId',
    as: 'category'
  });
  App.Category.hasMany(App.Config, {
    foreignKey: 'categoryId',
    as: 'items'
  });

  // Logs sobreviven al borrado de cuentas (audit trail): SET NULL en vez de CASCADE.

  Accounts.Account.hasMany(App.Log, {
    onDelete: 'SET NULL',
    foreignKey: 'actorId',
    as: 'logs_as_actor',
  });
  App.Log.belongsTo(Accounts.Account, {
    foreignKey: 'actorId',
    as: 'actor',
  });

  Accounts.Account.hasMany(App.Log, {
    onDelete: 'SET NULL',
    foreignKey: 'targetId',
    as: 'logs_as_target',
  });
  App.Log.belongsTo(Accounts.Account, {
    foreignKey: 'targetId',
    as: 'target',
  });

  /* END APP RELATIONSHIPS */

  /* ACCOUNT RELATIONSHIPS */

  Accounts.Account.hasOne(Profile.Profiles, {
    onDelete: 'CASCADE',
    foreignKey: 'accountId',
    as: 'profile',
  });
  Profile.Profiles.belongsTo(Accounts.Account, {
    foreignKey: 'accountId',
    as: 'account',
  });

  Accounts.Account.hasMany(Accounts.Session, {
    onDelete: 'CASCADE',
    foreignKey: 'accountId',
    as: 'sessions',
  });
  Accounts.Session.belongsTo(Accounts.Account, {
    foreignKey: 'accountId',
    as: 'account',
  });

  /* END ACCOUNT RELATIONSHIPS */

  /* ANIME RELATIONSHIPS */

  Anime.Anime.belongsToMany(Anime.Genre, {
    through: Anime.AnimeGenre,
    foreignKey: 'animeId',
    otherKey: 'genreId',
    as: 'genres',
  });
  Anime.Genre.belongsToMany(Anime.Anime, {
    through: Anime.AnimeGenre,
    foreignKey: 'genreId',
    otherKey: 'animeId',
    as: 'anime',
  });

  Anime.Anime.hasMany(Anime.Episode, {
    onDelete: 'CASCADE',
    foreignKey: 'animeId',
    as: 'episodes',
  });
  Anime.Episode.belongsTo(Anime.Anime, {
    foreignKey: 'animeId',
    as: 'anime',
  });

  Anime.Episode.hasMany(Anime.Source, {
    onDelete: 'CASCADE',
    foreignKey: 'episodeId',
    as: 'sources',
  });
  Anime.Source.belongsTo(Anime.Episode, {
    foreignKey: 'episodeId',
    as: 'episode',
  });

  /* END ANIME RELATIONSHIPS */

  /* LIBRARY RELATIONSHIPS */

  Accounts.Account.hasMany(Library.Watchlist, {
    onDelete: 'CASCADE',
    foreignKey: 'accountId',
    as: 'watchlist',
  });
  Library.Watchlist.belongsTo(Accounts.Account, {
    foreignKey: 'accountId',
    as: 'account',
  });
  Library.Watchlist.belongsTo(Anime.Anime, {
    foreignKey: 'animeId',
    as: 'anime',
  });
  Anime.Anime.hasMany(Library.Watchlist, {
    onDelete: 'CASCADE',
    foreignKey: 'animeId',
    as: 'watchlist',
  });

  Accounts.Account.hasMany(Library.Favorite, {
    onDelete: 'CASCADE',
    foreignKey: 'accountId',
    as: 'favorites',
  });
  Library.Favorite.belongsTo(Accounts.Account, {
    foreignKey: 'accountId',
    as: 'account',
  });
  Library.Favorite.belongsTo(Anime.Anime, {
    foreignKey: 'animeId',
    as: 'anime',
  });
  Anime.Anime.hasMany(Library.Favorite, {
    onDelete: 'CASCADE',
    foreignKey: 'animeId',
    as: 'favorites',
  });

  Accounts.Account.hasMany(Library.History, {
    onDelete: 'CASCADE',
    foreignKey: 'accountId',
    as: 'history',
  });
  Library.History.belongsTo(Accounts.Account, {
    foreignKey: 'accountId',
    as: 'account',
  });
  Library.History.belongsTo(Anime.Anime, {
    foreignKey: 'animeId',
    as: 'anime',
  });
  Library.History.belongsTo(Anime.Episode, {
    foreignKey: 'episodeId',
    as: 'episode',
  });
  Anime.Episode.hasMany(Library.History, {
    onDelete: 'CASCADE',
    foreignKey: 'episodeId',
    as: 'history',
  });

  Accounts.Account.hasMany(Library.Rating, {
    onDelete: 'CASCADE',
    foreignKey: 'accountId',
    as: 'ratings',
  });
  Library.Rating.belongsTo(Accounts.Account, {
    foreignKey: 'accountId',
    as: 'account',
  });
  Library.Rating.belongsTo(Anime.Anime, {
    foreignKey: 'animeId',
    as: 'anime',
  });
  Anime.Anime.hasMany(Library.Rating, {
    onDelete: 'CASCADE',
    foreignKey: 'animeId',
    as: 'ratings',
  });

  Accounts.Account.hasMany(Library.Comment, {
    onDelete: 'CASCADE',
    foreignKey: 'accountId',
    as: 'comments',
  });
  Library.Comment.belongsTo(Accounts.Account, {
    foreignKey: 'accountId',
    as: 'account',
  });
  Library.Comment.belongsTo(Anime.Anime, {
    foreignKey: 'animeId',
    as: 'anime',
  });
  Anime.Anime.hasMany(Library.Comment, {
    onDelete: 'CASCADE',
    foreignKey: 'animeId',
    as: 'comments',
  });
  Library.Comment.belongsTo(Anime.Episode, {
    foreignKey: 'episodeId',
    as: 'episode',
  });
  Anime.Episode.hasMany(Library.Comment, {
    onDelete: 'CASCADE',
    foreignKey: 'episodeId',
    as: 'comments',
  });

  /* END LIBRARY RELATIONSHIPS */

};

module.exports = init;
