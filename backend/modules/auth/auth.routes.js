const express = require('express');
const authController = require('./auth.controller');
const { auth } = require('../../middleware/auth.middleware');
const { validateBody } = require('../../middleware/validate.middleware');
const { createAdminSchema, createSupervisorSchema, createWarehouseManagerSchema } = require('./auth.validation');

const router = express.Router();

router.get('/me', auth, authController.getMe);
router.post('/login', express.text({ type: '*/*' }), authController.login);
router.post('/refresh-token', authController.refreshToken);

router.post('/create-supervisor', express.text({ type: '*/*' }), validateBody(createSupervisorSchema), authController.createSupervisor);
router.get('/supervisors', authController.getSupervisors);
router.get('/supervisors/:id', auth, authController.getSupervisorById);
router.delete('/supervisors/:id', authController.deleteSupervisor);
router.put('/supervisors/:id/password', authController.resetSupervisorPassword);

router.post('/create-warehouse-manager', express.text({ type: '*/*' }), validateBody(createWarehouseManagerSchema), authController.createWarehouseManager);
router.get('/warehouse-managers', authController.getWarehouseManagers);
router.delete('/warehouse-managers/:managerId', authController.deleteWarehouseManager);

router.get('/admins', authController.getAdmins);

router.post('/register', authController.register);
router.post('/verify-identity', authController.verifyIdentity);
router.post('/reset-password', authController.resetPassword);
router.post('/create-admin', express.text({ type: '*/*' }), validateBody(createAdminSchema), authController.createAdmin);
router.get('/company-admins', authController.getCompanyAdmins);
router.delete('/company-admins/:id', authController.deleteCompanyAdmin);

router.post('/change-password', authController.changePassword);

module.exports = router;
