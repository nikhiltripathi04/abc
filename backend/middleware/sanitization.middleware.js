const mongoSanitize = require('express-mongo-sanitize');

const sanitizationMiddleware = [
  mongoSanitize({
    replaceWith: '_',
  }),
];

module.exports = sanitizationMiddleware;