const authService = require('./auth.service');

const handle = async (res, executor) => {
	const result = await executor();
	return res.status(result.status).json(result.body);
};

exports.getMe = async (req, res) => {
	try {
		return await handle(res, () => authService.getCurrentUser(req.user.id));
	} catch (error) {
		console.error('GET /auth/me error:', error);
		return res.status(500).json({ success: false, message: 'Failed to fetch user' });
	}
};

exports.login = async (req, res) => {
	try {
		return await handle(res, () => authService.login(req.body));
	} catch (error) {
		console.error('Login error:', error);
		return res.status(500).json({ success: false, message: 'An error occurred during login', error: error.message });
	}
};

exports.refreshToken = async (req, res) => {
	try {
		return await handle(res, () => authService.refreshToken(req.body.refreshToken));
	} catch (error) {
		return res.status(401).json({ code: 'REFRESH_TOKEN_EXPIRED' });
	}
};

exports.createSupervisor = async (req, res) => {
	try {
		return await handle(res, () => authService.createSupervisor(req, req.body));
	} catch (error) {
		console.error('Create supervisor error:', error);
		return res.status(500).json({ success: false, message: 'An error occurred while creating supervisor', error: error.message });
	}
};

exports.getSupervisors = async (req, res) => {
	try {
		return await handle(res, () => authService.getSupervisors(req.query.adminId));
	} catch (error) {
		console.error('Error fetching supervisors:', error);
		return res.status(500).json({ success: false, message: 'Failed to fetch supervisors' });
	}
};

exports.getSupervisorById = async (req, res) => {
	try {
		return await handle(res, () => authService.getSupervisorById(req.params.id));
	} catch (error) {
		console.error('GET /auth/supervisors/:id error:', error);
		return res.status(500).json({ success: false, message: 'Failed to fetch supervisor details' });
	}
};

exports.createWarehouseManager = async (req, res) => {
	try {
		return await handle(res, () => authService.createWarehouseManager(req, req.body));
	} catch (error) {
		console.error('Create warehouse manager error:', error);
		return res.status(500).json({ success: false, message: 'An error occurred while creating warehouse manager', error: error.message });
	}
};

exports.getWarehouseManagers = async (req, res) => {
	try {
		return await handle(res, () => authService.getWarehouseManagers(req.query.adminId));
	} catch (error) {
		console.error('Error fetching warehouse managers:', error);
		return res.status(500).json({ success: false, message: 'Failed to fetch warehouse managers' });
	}
};

exports.deleteWarehouseManager = async (req, res) => {
	try {
		return await handle(res, () => authService.deleteWarehouseManager(req, {
			adminId: req.query.adminId,
			managerId: req.params.managerId,
		}));
	} catch (error) {
		console.error('Delete warehouse manager error:', error);
		return res.status(500).json({ success: false, message: 'Failed to delete warehouse manager', error: error.message });
	}
};

exports.getAdmins = async (req, res) => {
	try {
		return await handle(res, () => authService.getAdmins(req.query.adminId));
	} catch (error) {
		console.error('Error fetching admins:', error);
		return res.status(500).json({ success: false, message: 'Failed to fetch admins' });
	}
};

exports.register = async (req, res) => {
	try {
		return await handle(res, () => authService.registerAdmin(req.body));
	} catch (error) {
		console.error('Registration error:', error);
		if (error.code === 11000) {
			const field = Object.keys(error.keyPattern)[0];
			return res.status(400).json({ success: false, message: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists` });
		}

		return res.status(500).json({ success: false, message: 'An error occurred during registration', error: error.message });
	}
};

exports.verifyIdentity = async (req, res) => {
	try {
		return await handle(res, () => authService.verifyIdentity(req.body));
	} catch (error) {
		console.error('Verify identity error:', error);
		return res.status(500).json({ success: false, message: 'An error occurred during identity verification' });
	}
};

exports.resetPassword = async (req, res) => {
	try {
		return await handle(res, () => authService.resetPassword(req, req.body));
	} catch (error) {
		console.error('Password reset error:', error);
		return res.status(500).json({ success: false, message: 'An error occurred during password reset' });
	}
};

exports.deleteSupervisor = async (req, res) => {
	try {
		return await handle(res, () => authService.deleteSupervisor(req, {
			id: req.params.id,
			adminId: req.query.adminId,
		}));
	} catch (error) {
		console.error('Error deleting supervisor:', error);
		return res.status(500).json({ success: false, message: 'Failed to delete supervisor' });
	}
};

exports.resetSupervisorPassword = async (req, res) => {
	try {
		return await handle(res, () => authService.resetSupervisorPassword(req, {
			id: req.params.id,
			adminId: req.body.adminId,
			newPassword: req.body.newPassword,
		}));
	} catch (error) {
		console.error('Error resetting supervisor password:', error);
		return res.status(500).json({ success: false, message: 'Failed to reset password' });
	}
};

exports.createAdmin = async (req, res) => {
	try {
		return await handle(res, () => authService.createAdmin(req, req.body));
	} catch (error) {
		console.error('Create admin error:', error);
		return res.status(500).json({ success: false, message: 'An error occurred while creating admin', error: error.message });
	}
};

exports.getCompanyAdmins = async (req, res) => {
	try {
		return await handle(res, () => authService.getCompanyAdmins(req.query.ownerId));
	} catch (error) {
		console.error('Error fetching company admins:', error);
		return res.status(500).json({ success: false, message: 'Failed to fetch admins' });
	}
};

exports.deleteCompanyAdmin = async (req, res) => {
	try {
		return await handle(res, () => authService.deleteCompanyAdmin(req, {
			id: req.params.id,
			ownerId: req.query.ownerId,
		}));
	} catch (error) {
		console.error('Error deleting admin:', error);
		return res.status(500).json({ success: false, message: 'Failed to delete admin' });
	}
};

exports.changePassword = async (req, res) => {
	try {
		return await handle(res, () => authService.changePassword(req, req.body));
	} catch (error) {
		console.error('Change password error:', error);
		return res.status(500).json({ success: false, message: 'An error occurred while changing password' });
	}
};
