const User = require('./user.model');

async function savePushToken(userId, expoPushToken) {
	if (!expoPushToken) {
		return { status: 400, body: { success: false, message: 'Expo push token is required' } };
	}

	await User.findByIdAndUpdate(userId, { expoPushToken }, { new: true });
	return { status: 200, body: { success: true, message: 'Expo push token saved successfully' } };
}

async function clearPushToken(userId) {
	await User.findByIdAndUpdate(userId, { expoPushToken: null }, { new: true });
	return { status: 200, body: { success: true, message: 'Expo push token cleared successfully' } };
}

async function saveWebPushToken(userId, fcmWebToken) {
	if (!fcmWebToken) {
		return { status: 400, body: { success: false, message: 'FCM web push token is required' } };
	}

	await User.findByIdAndUpdate(userId, { $addToSet: { fcmWebTokens: fcmWebToken } }, { new: true });
	return { status: 200, body: { success: true, message: 'Web push token saved successfully' } };
}

async function clearWebPushToken(userId, fcmWebToken) {
	if (!fcmWebToken) {
		return { status: 400, body: { success: false, message: 'FCM web push token is required' } };
	}

	await User.findByIdAndUpdate(userId, { $pull: { fcmWebTokens: fcmWebToken } }, { new: true });
	return { status: 200, body: { success: true, message: 'Web push token cleared successfully' } };
}

async function changePassword(userId, currentPassword, newPassword) {
	if (!currentPassword || !newPassword) {
		return {
			status: 400,
			body: { success: false, message: 'Current and new password are required' },
		};
	}

	if (newPassword.length < 6) {
		return {
			status: 400,
			body: { success: false, message: 'New password must be at least 6 characters' },
		};
	}

	const user = await User.findById(userId);
	if (!user) {
		return { status: 404, body: { success: false, message: 'User not found' } };
	}

	const isMatch = await user.comparePassword(currentPassword);
	if (!isMatch) {
		return { status: 400, body: { success: false, message: 'Current password is incorrect' } };
	}

	user.password = newPassword;
	await user.save();

	return { status: 200, body: { success: true, message: 'Password updated successfully' } };
}

module.exports = {
	savePushToken,
	clearPushToken,
	saveWebPushToken,
	clearWebPushToken,
	changePassword,
};
