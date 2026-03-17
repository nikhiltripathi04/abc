class PaginationHelper {
  static normalize(options = {}) {
    const page = Math.max(parseInt(options.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(options.limit, 10) || 10, 1), 100);
    return {
      page,
      limit,
      skip: (page - 1) * limit,
    };
  }

  static buildMeta(page, limit, total) {
    const totalPages = Math.max(Math.ceil(total / limit), 1);
    return {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  }
}

module.exports = PaginationHelper;