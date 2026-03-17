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
  adminId: Joi.string().trim().required(),
  firstName: Joi.string().trim().required(),
  lastName: Joi.string().trim().required(),
});

const createWarehouseManagerSchema = Joi.object({
  username: Joi.string().trim().required(),
  password: Joi.string().min(4).required(),
  adminId: Joi.string().trim().required(),
  firstName: Joi.string().trim().required(),
  lastName: Joi.string().trim().required(),
});

module.exports = {
  createAdminSchema,
  createSupervisorSchema,
  createWarehouseManagerSchema,
};
