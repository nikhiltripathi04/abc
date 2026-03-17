const express = require('express');
const authController = require('./auth.controller');
const { auth } = require('../../middleware/auth.middleware');
const { validateBody } = require('../../middleware/validate.middleware');
const selectFields = require('../../middleware/field-selection.middleware');
const {
	createAdminSchema,
	createSupervisorSchema,
	createWarehouseManagerSchema,
	registerSchema,
	resetPasswordSchema,
	changePasswordSchema,
} = require('./auth.validation');

const router = express.Router();

router.get('/me', auth, authController.getMe);
const { authLimiter } = require('../../middleware/rate-limit.middleware');
router.post('/login', authLimiter, express.text({ type: '*/*' }), authController.login);
router.post('/refresh-token', authLimiter, authController.refreshToken);

router.post('/create-supervisor', auth, express.text({ type: '*/*' }), validateBody(createSupervisorSchema), authController.createSupervisor);
router.get('/supervisors', selectFields, authController.getSupervisors);
router.get('/supervisors/:id', auth, selectFields, authController.getSupervisorById);
router.delete('/supervisors/:id', authController.deleteSupervisor);
router.put('/supervisors/:id/password', authController.resetSupervisorPassword);

router.post('/create-warehouse-manager', auth, express.text({ type: '*/*' }), validateBody(createWarehouseManagerSchema), authController.createWarehouseManager);
router.get('/warehouse-managers', selectFields, authController.getWarehouseManagers);
router.delete('/warehouse-managers/:managerId', authController.deleteWarehouseManager);

router.get('/admins', selectFields, authController.getAdmins);

router.post('/register', express.text({ type: '*/*' }), validateBody(registerSchema), authController.register);
router.post('/verify-identity', authController.verifyIdentity);
router.post('/reset-password', express.text({ type: '*/*' }), validateBody(resetPasswordSchema), authController.resetPassword);
router.post('/create-admin', express.text({ type: '*/*' }), validateBody(createAdminSchema), authController.createAdmin);
router.get('/company-admins', selectFields, authController.getCompanyAdmins);
router.delete('/company-admins/:id', authController.deleteCompanyAdmin);

router.post('/change-password', express.text({ type: '*/*' }), validateBody(changePasswordSchema), authController.changePassword);

module.exports = router;
