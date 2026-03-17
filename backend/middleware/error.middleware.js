const ApiResponse = require('../utils/response.util');
const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  if (err.isOperational) {
    logger.warn('Request validation/operation error', {
      message: err.message,
      code: err.code,
      statusCode: err.statusCode,
      path: req.originalUrl,
      method: req.method,
      ip: req.ip,
      fields: err.fields,
    });

    return res.status(err.statusCode).json(
      ApiResponse.error(err.message, err.code, err.statusCode, err.fields)
    );
  }

  logger.error('Unhandled request error', {
    message: err.message,
    stack: err.stack,
    path: req.originalUrl,
    method: req.method,
    ip: req.ip,
  });

  if (err.name === 'ValidationError') {
    const fields = Object.keys(err.errors).map((key) => ({
      field: key,
      message: err.errors[key].message,
    }));
    return res.status(400).json(ApiResponse.validationError(fields));
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    return res.status(409).json(
      ApiResponse.error(`${field} already exists`, 'DUPLICATE_KEY', 409)
    );
  }

  if (err.name === 'CastError') {
    return res.status(400).json(
      ApiResponse.error(`Invalid ${err.path}: ${err.value}`, 'INVALID_ID', 400)
    );
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json(ApiResponse.error('Invalid token', 'INVALID_TOKEN', 401));
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json(ApiResponse.error('Token expired', 'TOKEN_EXPIRED', 401));
  }

  return res.status(500).json(
    ApiResponse.error(
      process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message,
      'INTERNAL_ERROR',
      500
    )
  );
};

const notFoundHandler = (req, res) => {
  res.status(404).json(ApiResponse.notFound(`Route ${req.originalUrl}`));
};

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { errorHandler, notFoundHandler, asyncHandler };