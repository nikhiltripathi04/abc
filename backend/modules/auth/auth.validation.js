const { Joi } = require('../../middleware/validate.middleware');

const createAdminSchema = Joi.object({
  username: Joi.string().trim().required(),
  password: Joi.string().min(4).required(),
  email: Joi.string().trim().email().required(),
  firstName: Joi.string().trim().required(),
  lastName: Joi.string().trim().required(),
  phoneNumber: Joi.string().trim().optional(),
  authAdminId: Joi.string().trim().required(),
});

const createSupervisorSchema = Joi.object({
  username: Joi.string().trim().required(),
  password: Joi.string().min(4).required(),
  firstName: Joi.string().trim().required(),
  lastName: Joi.string().trim().required(),
});

const createWarehouseManagerSchema = Joi.object({
  username: Joi.string().trim().required(),
  password: Joi.string().min(4).required(),
  firstName: Joi.string().trim().required(),
  lastName: Joi.string().trim().required(),
});

const registerSchema = Joi.object({
  username: Joi.string().trim().required(),
  password: Joi.string().min(4).required(),
  email: Joi.string().trim().email().required(),
  phoneNumber: Joi.string().trim().required(),
  firstName: Joi.string().trim().required(),
  lastName: Joi.string().trim().required(),
  jobTitle: Joi.string().trim().optional(),
  companyName: Joi.string().trim().optional(),
  gstin: Joi.string().trim().allow('').optional(),
  address: Joi.string().trim().allow('').optional(),
});

const resetPasswordSchema = Joi.object({
  username: Joi.string().trim().required(),
  newPassword: Joi.string().min(4).required(),
});

const changePasswordSchema = Joi.object({
  userId: Joi.string().trim().required(),
  oldPassword: Joi.string().required(),
  newPassword: Joi.string().min(4).required(),
});

module.exports = {
  createAdminSchema,
  createSupervisorSchema,
  createWarehouseManagerSchema,
  registerSchema,
  resetPasswordSchema,
  changePasswordSchema,
};
