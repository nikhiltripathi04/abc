const Joi = require('joi');
const { ValidationError } = require('../utils/errors');

const normalizeJoiMessage = (message) => String(message || '').replace(/\"/g, '');

const formatValidationDetails = (details = []) => details.map((detail) => ({
  field: detail.path.join('.') || 'body',
  message: normalizeJoiMessage(detail.message),
  type: detail.type,
}));

const buildValidationSummary = (details = [], scope = 'request') => {
  if (!details.length) {
    return `Invalid ${scope}`;
  }

  const first = details[0];
  const field = first.path.join('.') || scope;
  const message = normalizeJoiMessage(first.message);
  return `Invalid ${scope}: ${field} ${message.replace(new RegExp(`^${field}\\s*`, 'i'), '')}`.trim();
};

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
    const fields = formatValidationDetails(error.details);
    return next(new ValidationError(buildValidationSummary(error.details, 'request body'), fields));
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
    const fields = formatValidationDetails(error.details);
    return next(new ValidationError(buildValidationSummary(error.details, 'query params'), fields));
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
    const fields = formatValidationDetails(error.details);
    return next(new ValidationError(buildValidationSummary(error.details, 'route params'), fields));
  }

  req.params = value;
  next();
};

module.exports = { Joi, validateBody, validateQuery, validateParams };
