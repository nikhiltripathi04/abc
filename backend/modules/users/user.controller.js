const userService = require('./user.service');

const handle = async (res, executor) => {
	const result = await executor();
	return res.status(result.status).json(result.body);
};

exports.savePushToken = async (req, res) => {
	try {
		return await handle(res, () => userService.savePushToken(req.user._id, req.body.expoPushToken));
	} catch (error) {
		console.error('Save push token error:', error);
		return res.status(500).json({ success: false, message: 'Internal server error' });
	}
};

exports.clearPushToken = async (req, res) => {
	try {
		return await handle(res, () => userService.clearPushToken(req.user._id));
	} catch (error) {
		console.error('Clear push token error:', error);
		return res.status(500).json({ success: false, message: 'Internal server error' });
	}
};

exports.saveWebPushToken = async (req, res) => {
	try {
		return await handle(res, () => userService.saveWebPushToken(req.user._id, req.body.fcmWebToken));
	} catch (error) {
		console.error('Save web push token error:', error);
		return res.status(500).json({ success: false, message: 'Internal server error' });
	}
};

exports.clearWebPushToken = async (req, res) => {
	try {
		return await handle(res, () => userService.clearWebPushToken(req.user._id, req.body.fcmWebToken));
	} catch (error) {
		console.error('Clear web push token error:', error);
		return res.status(500).json({ success: false, message: 'Internal server error' });
	}
};

exports.changePassword = async (req, res) => {
	try {
		return await handle(res, () => userService.changePassword(req.user._id, req.body.currentPassword, req.body.newPassword));
	} catch (error) {
		console.error('Change password error:', error);
		return res.status(500).json({ success: false, message: 'Internal server error' });
	}
};
