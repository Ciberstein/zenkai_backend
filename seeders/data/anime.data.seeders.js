// MAL genre ids, mirrored from https://api.jikan.moe/v4/genres/anime so the
// catalog filters work before the first Jikan sync runs.
const genres = [
  { malId: 1,  name: "Action",        slug: "action" },
  { malId: 2,  name: "Adventure",     slug: "adventure" },
  { malId: 4,  name: "Comedy",        slug: "comedy" },
  { malId: 8,  name: "Drama",         slug: "drama" },
  { malId: 10, name: "Fantasy",       slug: "fantasy" },
  { malId: 14, name: "Horror",        slug: "horror" },
  { malId: 7,  name: "Mystery",       slug: "mystery" },
  { malId: 22, name: "Romance",       slug: "romance" },
  { malId: 24, name: "Sci-Fi",        slug: "sci-fi" },
  { malId: 36, name: "Slice of Life", slug: "slice-of-life" },
  { malId: 30, name: "Sports",        slug: "sports" },
  { malId: 37, name: "Supernatural",  slug: "supernatural" },
  { malId: 41, name: "Suspense",      slug: "suspense" },
  { malId: 46, name: "Award Winning", slug: "award-winning" },
  { malId: 62, name: "Isekai",        slug: "isekai" },
];

module.exports = { genres };
