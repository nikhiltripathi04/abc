const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { auth } = require('../middleware/auth');

// Save / update Expo push token
router.post('/save-push-token', auth, async (req, res) => {
    try {
        const { expoPushToken } = req.body;

        if (!expoPushToken) {
            return res.status(400).json({
                success: false,
                message: 'Expo push token is required'
            });
        }

        await User.findByIdAndUpdate(
            req.user._id,
            { expoPushToken },
            { new: true }
        );

        console.log(`✅ Push token saved for user ${req.user._id}`);

        res.json({
            success: true,
            message: 'Expo push token saved successfully'
        });

    } catch (error) {
        console.error('Save push token error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Clear Expo push token on logout
router.post('/clear-push-token', auth, async (req, res) => {
    try {
        await User.findByIdAndUpdate(
            req.user._id,
            { expoPushToken: null },
            { new: true }
        );

        res.json({
            success: true,
            message: 'Expo push token cleared successfully'
        });

    } catch (error) {
        console.error('Clear push token error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Save / update Web push token (FCM)
router.post('/save-web-push-token', auth, async (req, res) => {
    try {
        const { fcmWebToken } = req.body;

        if (!fcmWebToken) {
            return res.status(400).json({
                success: false,
                message: 'FCM web push token is required'
            });
        }

        await User.findByIdAndUpdate(
            req.user._id,
            { $addToSet: { fcmWebTokens: fcmWebToken } },
            { new: true }
        );

        console.log(`✅ Web push token saved for user ${req.user._id}`);

        res.json({
            success: true,
            message: 'Web push token saved successfully'
        });

    } catch (error) {
        console.error('Save web push token error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Clear Web push token on logout
router.post('/clear-web-push-token', auth, async (req, res) => {
    try {
        const { fcmWebToken } = req.body;

        if (!fcmWebToken) {
            return res.status(400).json({
                success: false,
                message: 'FCM web push token is required'
            });
        }

        await User.findByIdAndUpdate(
            req.user._id,
            { $pull: { fcmWebTokens: fcmWebToken } },
            { new: true }
        );

        res.json({
            success: true,
            message: 'Web push token cleared successfully'
        });

    } catch (error) {
        console.error('Clear web push token error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Change password (authenticated user)
router.post('/change-password', auth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'Current and new password are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
        }

        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: 'Current password is incorrect' });
        }

        user.password = newPassword; // pre-save hook will hash it
        await user.save();

        res.json({ success: true, message: 'Password updated successfully' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

module.exports = router;
