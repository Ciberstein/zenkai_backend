const config_categories = [
  { id: 1, title: "project" },
  { id: 2, title: "catalog" },
  { id: 3, title: "player" },
  { id: 4, title: "social" },
];

const config = [
  { categoryId: 1, key: "project_name",        value: "Zenkai",          type: "string",  public: true },
  { categoryId: 1, key: "project_icon",        value: "/icon.png",       type: "image",   public: true },
  { categoryId: 1, key: "project_description", value: "Anime streaming", type: "string",  public: true },
  { categoryId: 1, key: "project_maintenance", value: "false",           type: "boolean", public: true },
  { categoryId: 2, key: "catalog_page_size",   value: "24",              type: "number",  public: true },
  { categoryId: 2, key: "catalog_home_rails",  value: "12",              type: "number",  public: true },
  { categoryId: 3, key: "player_autoplay",     value: "true",            type: "boolean", public: true },
  { categoryId: 3, key: "player_auto_next",    value: "true",            type: "boolean", public: true },
  // Percentage of an episode that must be watched before it counts as seen.
  { categoryId: 3, key: "player_seen_percent", value: "85",              type: "number",  public: true },
  { categoryId: 4, key: "social_comments",     value: "true",            type: "boolean", public: true },
  { categoryId: 4, key: "social_ratings",      value: "true",            type: "boolean", public: true },
];

const languages = [
  { code: "es", name: "Espanol",  active: true },
  { code: "en", name: "English",  active: true },
  { code: "ja", name: "Japanese", active: true },
];

module.exports = { config_categories, config, languages };
