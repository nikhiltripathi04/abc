const Joi = require('joi');

const validateBody = (schema) => (req, res, next) => {
  if (typeof req.body === 'string') {
    try {
      req.body = JSON.parse(req.body);
    } catch (error) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Request body must be valid JSON',
        fields: [{ field: 'body', reason: 'Malformed JSON payload' }],
      });
    }
  }

  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Invalid request body',
      fields: error.details.map((detail) => ({
        field: detail.path.join('.'),
        reason: detail.message,
      })),
    });
  }

  req.body = value;
  next();
};

module.exports = { Joi, validateBody };
