const express = require('express');
const router = express.Router();
const { auth } = require('../../middleware/auth');
const controller = require('./notification.controller');

router.get('/', auth, controller.listNotifications);
router.post('/test', auth, controller.sendTestNotification);
router.post('/read', auth, controller.markRead);

module.exports = router;
