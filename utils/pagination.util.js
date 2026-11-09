const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

// Normalise ?page & ?limit into Sequelize's { limit, offset } and echo the
// values back so controllers can build the response meta without re-parsing.
const paginate = (query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT));

  return { page, limit, offset: (page - 1) * limit };
};

const meta = ({ page, limit, count }) => ({
  page,
  limit,
  total: count,
  pages: Math.ceil(count / limit) || 1,
});

module.exports = { paginate, meta };
