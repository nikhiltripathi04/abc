const express = require('express');
const userController = require('./user.controller');
const { auth } = require('../../middleware/auth.middleware');

const router = express.Router();

router.post('/save-push-token', auth, userController.savePushToken);
router.post('/clear-push-token', auth, userController.clearPushToken);
router.post('/save-web-push-token', auth, userController.saveWebPushToken);
router.post('/clear-web-push-token', auth, userController.clearWebPushToken);
router.post('/change-password', auth, userController.changePassword);

module.exports = router;
