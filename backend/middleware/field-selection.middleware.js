const allowedFieldPattern = /^[a-zA-Z0-9_\-.,\s]+$/;

const selectFields = (req, res, next) => {
  const raw = req.query.fields;
  if (!raw) {
    return next();
  }

  const candidate = String(raw).trim();
  if (!candidate || !allowedFieldPattern.test(candidate)) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_FIELDS_QUERY',
      message: 'Invalid fields query parameter',
    });
  }

  req.selectedFields = candidate
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean)
    .join(' ');

  return next();
};

module.exports = selectFields;