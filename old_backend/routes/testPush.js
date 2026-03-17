const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const sendPushNotification = require('../utils/sendPushNotification');

router.post('/test-push', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user?.expoPushToken) {
      return res.status(400).json({
        success: false,
        message: 'No Expo push token found for user'
      });
    }

    await sendPushNotification(
      user.expoPushToken,
      'Test Notification 🔔',
      'If you see this, push notifications work!',
      { type: 'TEST' }
    );

    res.json({
      success: true,
      message: 'Push notification sent'
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
