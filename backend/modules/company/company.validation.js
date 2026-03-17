const { Joi } = require('../../middleware/validate.middleware');

const registerCompanySchema = Joi.object({
  username: Joi.string().trim().required(),
  password: Joi.string().min(4).required(),
  email: Joi.string().trim().email().required(),
  phoneNumber: Joi.string().trim().required(),
  firstName: Joi.string().trim().required(),
  lastName: Joi.string().trim().required(),
  companyName: Joi.string().trim().optional(),
  jobTitle: Joi.string().trim().optional(),
  gstin: Joi.string().trim().optional(),
  address: Joi.string().trim().optional(),
});

const createAdminSchema = Joi.object({
  username: Joi.string().trim().required(),
  password: Joi.string().min(4).required(),
  email: Joi.string().trim().email().required(),
  firstName: Joi.string().trim().required(),
  lastName: Joi.string().trim().required(),
  phoneNumber: Joi.string().trim().optional(),
});

module.exports = {
  registerCompanySchema,
  createAdminSchema,
};
