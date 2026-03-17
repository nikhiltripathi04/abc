const express = require('express');
const authController = require('./auth.controller');
const { auth } = require('../../middleware/auth.middleware');

const router = express.Router();

router.get('/me', auth, authController.getMe);
router.post('/login', authController.login);
router.post('/refresh-token', authController.refreshToken);

router.post('/create-supervisor', authController.createSupervisor);
router.get('/supervisors', authController.getSupervisors);
router.get('/supervisors/:id', auth, authController.getSupervisorById);
router.delete('/supervisors/:id', authController.deleteSupervisor);
router.put('/supervisors/:id/password', authController.resetSupervisorPassword);

router.post('/create-warehouse-manager', authController.createWarehouseManager);
router.get('/warehouse-managers', authController.getWarehouseManagers);
router.delete('/warehouse-managers/:managerId', authController.deleteWarehouseManager);

router.get('/admins', authController.getAdmins);

router.post('/register', authController.register);
router.post('/verify-identity', authController.verifyIdentity);
router.post('/reset-password', authController.resetPassword);
router.post('/create-admin', authController.createAdmin);
router.get('/company-admins', authController.getCompanyAdmins);
router.delete('/company-admins/:id', authController.deleteCompanyAdmin);

router.post('/change-password', authController.changePassword);

module.exports = router;
