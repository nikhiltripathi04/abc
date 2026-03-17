const Joi = require('joi');
const { ValidationError } = require('../utils/errors');

const validateBody = (schema) => (req, res, next) => {
  if (typeof req.body === 'string') {
    try {
      req.body = JSON.parse(req.body);
    } catch (error) {
      return next(new ValidationError('Request body must be valid JSON', [
        { field: 'body', message: 'Malformed JSON payload' },
      ]));
    }
  }

  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });

  if (error) {
    return next(new ValidationError('Invalid request body', error.details.map((detail) => ({
      field: detail.path.join('.'),
      message: detail.message,
      type: detail.type,
    }))));
  }

  req.body = value;
  next();
};

const validateQuery = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.query, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });

  if (error) {
    return next(new ValidationError('Invalid query params', error.details.map((detail) => ({
      field: detail.path.join('.'),
      message: detail.message,
      type: detail.type,
    }))));
  }

  req.query = value;
  next();
};

const validateParams = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.params, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return next(new ValidationError('Invalid route params', error.details.map((detail) => ({
      field: detail.path.join('.'),
      message: detail.message,
      type: detail.type,
    }))));
  }

  req.params = value;
  next();
};

module.exports = { Joi, validateBody, validateQuery, validateParams };
