const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../users/user.model');

const splitFullName = (fullName = '') => {
	const normalized = String(fullName).trim().replace(/\s+/g, ' ');
	if (!normalized) {
		return { firstName: 'Admin', lastName: 'User', fullName: '' };
	}

	const [firstName, ...rest] = normalized.split(' ');
	const lastName = rest.join(' ') || 'User';
	return { firstName, lastName, fullName: normalized };
};

const safeGetModel = (name) => {
	try {
		return mongoose.model(name);
	} catch (error) {
		return null;
	}
};

const safeActivityLog = async (req, targetUserId, action, actor, metadata, message, entityType) => {
	try {
		const ActivityLogger = require('../../../old_backend/utils/activityLogger');
		await ActivityLogger.logActivity(targetUserId, action, actor, metadata, message, entityType);
	} catch (error) {
		if (String(process.env.DEBUG_LOGGER || '').toLowerCase() === 'true') {
			console.warn('Activity logger unavailable or failed:', error.message);
		}
	}
};

const safeSendEmail = async (to, subject, html) => {
	try {
		const sendEmail = require('../../../old_backend/utils/email');
		await sendEmail(to, subject, html);
	} catch (error) {
		if (String(process.env.DEBUG_EMAIL || '').toLowerCase() === 'true') {
			console.warn('Email sender unavailable or failed:', error.message);
		}
	}
};

const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_jwt_refresh_secret';

const createAccessToken = (user) => jwt.sign(
	{ userId: user._id, role: user.role },
	JWT_SECRET,
	{ expiresIn: '15m' }
);

const createRefreshToken = (user) => jwt.sign(
	{ userId: user._id },
	JWT_REFRESH_SECRET,
	{ expiresIn: '60d' }
);

async function getCurrentUser(userId) {
	const user = await User.findById(userId).populate('sites');
	if (!user) {
		return { status: 404, body: { success: false, message: 'User not found' } };
	}

	return { status: 200, body: { success: true, data: user } };
}

async function login({ username, password, expectedRole }) {
	try {
		let query = User.findOne({ username }).select('+password');
		const SiteModel = safeGetModel('Site');
		const WarehouseModel = safeGetModel('Warehouse');
		if (SiteModel) query = query.populate('sites', 'siteName location');
		if (WarehouseModel) query = query.populate('warehouses', 'warehouseName location');
		const user = await query;

		if (!user) {
			return { status: 401, body: { success: false, message: 'Invalid username or password' } };
		}

		if (expectedRole && user.role !== expectedRole) {
			return {
				status: 401,
				body: {
					success: false,
					message: `No ${expectedRole} account found with this username`,
				},
			};
		}

		const isMatch = await user.comparePassword(password);
		if (!isMatch) {
			return { status: 401, body: { success: false, message: 'Invalid username or password' } };
		}

		let accessToken;
		let refreshToken;
		try {
			accessToken = createAccessToken(user);
			refreshToken = createRefreshToken(user);
		} catch (err) {
			// Fallback for environments without JWT secrets configured (useful for local testing)
			accessToken = 'dummy-access-token';
			refreshToken = 'dummy-refresh-token';
			if (String(process.env.NODE_ENV).toLowerCase() === 'production') {
				return { status: 500, body: { success: false, message: 'Token creation failed', error: err.message } };
			}
		}

		const extraData = {};
		if (user.role === 'warehouse_manager') {
			extraData.assignedWarehouses = user.assignedWarehouses || [];
		}
		if (user.role === 'supervisor') {
			extraData.assignedSites = user.sites;
		}

		if (user.companyId) {
			const Company = safeGetModel('Company');
			if (Company) {
				const company = await Company.findById(user.companyId);
				if (company) {
					extraData.companyId = company._id;
					extraData.companyName = company.name;
				}
			}
		}

		return {
			status: 200,
			body: {
				success: true,
				accessToken,
				refreshToken,
				user: {
					id: user._id,
					username: user.username,
					role: user.role,
					firstName: user.firstName,
					lastName: user.lastName,
					fullName: user.fullName,
					...extraData,
				},
			},
		};
	} catch (error) {
		return { status: 500, body: { success: false, message: 'Login service error', error: error.message, stack: error.stack } };
	}
}

async function refreshToken(refreshTokenValue) {
	if (!refreshTokenValue) {
		return { status: 401, body: { message: 'Refresh token missing' } };
	}

	const decoded = jwt.verify(refreshTokenValue, process.env.JWT_REFRESH_SECRET);
	const user = await User.findById(decoded.userId);
	if (!user) {
		return { status: 401, body: { message: 'Invalid refresh token' } };
	}

	return { status: 200, body: { accessToken: createAccessToken(user) } };
}

async function createSupervisor(req, { username, password, adminId, fullName }) {
	if (!username || !password || !adminId) {
		return {
			status: 400,
			body: { success: false, message: 'Username, password, and adminId are required' },
		};
	}

	const admin = await User.findOne({ _id: adminId, role: 'admin' });
	if (!admin) {
		return {
			status: 403,
			body: { success: false, message: 'Unauthorized: Only admins can create supervisors' },
		};
	}

	const normalizedUsername = username.toLowerCase().trim();
	const existingUser = await User.findOne({ username: normalizedUsername });
	if (existingUser) {
		return { status: 400, body: { success: false, message: 'Username already exists' } };
	}

	const normalizedName = splitFullName(fullName || '');
	const supervisor = new User({
		username: normalizedUsername,
		password,
		role: 'supervisor',
		firstName: normalizedName.firstName,
		lastName: normalizedName.lastName,
		fullName: normalizedName.fullName,
		createdBy: adminId,
		companyId: admin.companyId || admin._id,
		company: admin.companyId || admin._id,
		sites: [],
	});
	await supervisor.save();

	await safeActivityLog(req, supervisor._id, 'supervisor_created', admin, {
		supervisorUsername: supervisor.username,
		createdBy: adminId,
	}, `Supervisor "${supervisor.username}" created by admin`, 'User');

	const io = req.app.get('io');
	if (io) {
		io.emit('supervisors:updated', { action: 'create', supervisorId: supervisor._id });
	}

	return {
		status: 201,
		body: {
			success: true,
			message: 'Supervisor account created successfully',
			data: {
				id: supervisor._id,
				username: supervisor.username,
				role: supervisor.role,
			},
		},
	};
}

async function getSupervisors(adminId) {
	if (!adminId) {
		return { status: 400, body: { success: false, message: 'Admin ID is required' } };
	}

	const admin = await User.findById(adminId);
	let query = { role: 'supervisor', createdBy: adminId };

	if (admin && admin.companyId) {
		query = { role: 'supervisor', companyId: admin.companyId };
	}

	const supervisors = await User.find(query)
		.select('username _id assignedSites')
		.populate('assignedSites', 'siteName');

	return {
		status: 200,
		body: { success: true, count: supervisors.length, data: supervisors },
	};
}

async function getSupervisorById(supervisorId) {
	const supervisor = await User.findById(supervisorId)
		.populate('assignedSites', 'siteName location')
		.populate('companyId', 'name');

	if (!supervisor || supervisor.role !== 'supervisor') {
		return { status: 404, body: { success: false, message: 'Supervisor not found' } };
	}

	return { status: 200, body: { success: true, data: supervisor } };
}

async function createWarehouseManager(req, { username, password, adminId, fullName }) {
	if (!username || !password || !adminId) {
		return {
			status: 400,
			body: { success: false, message: 'Username, password, and adminId are required' },
		};
	}

	const admin = await User.findOne({ _id: adminId, role: { $in: ['admin', 'company_owner'] } });
	if (!admin) {
		return {
			status: 403,
			body: { success: false, message: 'Unauthorized: Only admins can create warehouse managers' },
		};
	}

	const normalizedUsername = username.toLowerCase().trim();
	const existingUser = await User.findOne({ username: normalizedUsername });
	if (existingUser) {
		return { status: 400, body: { success: false, message: 'Username already exists' } };
	}

	const normalizedNameWM = splitFullName(fullName || '');
	const warehouseManager = new User({
		username: normalizedUsername,
		password,
		role: 'warehouse_manager',
		firstName: normalizedNameWM.firstName,
		lastName: normalizedNameWM.lastName,
		fullName: normalizedNameWM.fullName,
		createdBy: adminId,
		companyId: admin.companyId || admin._id,
		company: admin.companyId || admin._id,
		assignedWarehouses: [],
	});
	await warehouseManager.save();

	await safeActivityLog(req, warehouseManager._id, 'warehouse_manager_created', admin, {
		managerUsername: warehouseManager.username,
		createdBy: adminId,
	}, `Warehouse manager "${warehouseManager.username}" created by admin`, 'User');

	const io = req.app.get('io');
	if (io) {
		io.emit('warehouse-managers:updated', { action: 'create', managerId: warehouseManager._id });
	}

	return {
		status: 201,
		body: {
			success: true,
			message: 'Warehouse manager account created successfully',
			data: {
				id: warehouseManager._id,
				username: warehouseManager.username,
				role: warehouseManager.role,
			},
		},
	};
}

async function getWarehouseManagers(adminId) {
	if (!adminId) {
		return { status: 400, body: { success: false, message: 'Admin ID is required' } };
	}

	const admin = await User.findById(adminId);
	let query = { role: 'warehouse_manager', createdBy: adminId };

	if (admin && admin.companyId) {
		query = { role: 'warehouse_manager', companyId: admin.companyId };
	}

	const managers = await User.find(query)
		.select('username _id assignedWarehouses fullName')
		.populate('assignedWarehouses', 'warehouseName');

	return {
		status: 200,
		body: { success: true, count: managers.length, data: managers },
	};
}

async function deleteWarehouseManager(req, { adminId, managerId }) {
	if (!adminId) {
		return { status: 400, body: { success: false, message: 'Admin ID is required' } };
	}

	const admin = await User.findOne({ _id: adminId, role: { $in: ['admin', 'company_owner'] } });
	if (!admin) {
		return {
			status: 403,
			body: { success: false, message: 'Unauthorized: Only admins can delete warehouse managers' },
		};
	}

	const manager = await User.findOne({ _id: managerId, role: 'warehouse_manager' });
	if (!manager) {
		return { status: 404, body: { success: false, message: 'Warehouse manager not found' } };
	}

	if (admin.companyId && manager.companyId && admin.companyId.toString() !== manager.companyId.toString()) {
		return { status: 403, body: { success: false, message: 'Cannot delete manager from another company' } };
	}

	const Warehouse = safeGetModel('Warehouse');
	if (Warehouse) {
		await Warehouse.updateMany({ managers: managerId }, { $pull: { managers: managerId } });
	}

	await User.deleteOne({ _id: managerId });

	await safeActivityLog(req, managerId, 'warehouse_manager_deleted', admin, {
		managerId,
		managerUsername: manager.username,
	}, `Warehouse manager "${manager.username}" deleted by admin`, 'User');

	const io = req.app.get('io');
	if (io) {
		io.emit('warehouse-managers:updated', { action: 'delete', managerId });
	}

	return { status: 200, body: { success: true, message: 'Warehouse manager deleted successfully' } };
}

async function getAdmins(adminId) {
	if (!adminId) {
		return { status: 400, body: { success: false, message: 'Admin ID is required' } };
	}

	const requestor = await User.findById(adminId);
	if (!requestor || requestor.role !== 'admin') {
		return { status: 403, body: { success: false, message: 'Unauthorized' } };
	}

	const query = { role: 'admin' };
	if (requestor.companyId) {
		query.companyId = requestor.companyId;
	}

	const admins = await User.find(query)
		.select('username _id firstName lastName fullName role')
		.sort({ firstName: 1 });

	return { status: 200, body: { success: true, count: admins.length, data: admins } };
}

async function registerAdmin({ username, password, email, phoneNumber, firmName, jobTitle }) {
	if (!username || !password || !email || !phoneNumber) {
		return {
			status: 400,
			body: {
				success: false,
				message: 'Please provide username, password, email, and phone number',
			},
		};
	}

	const existingUsername = await User.findOne({ username });
	if (existingUsername) {
		return {
			status: 400,
			body: { success: false, message: 'Username already exists', errorType: 'USERNAME_EXISTS' },
		};
	}

	const existingEmail = await User.findOne({ email });
	if (existingEmail) {
		return {
			status: 400,
			body: { success: false, message: 'Email already exists', errorType: 'EMAIL_EXISTS' },
		};
	}

	const user = new User({
		username,
		password,
		email,
		phoneNumber,
		firmName: firmName || '',
		jobTitle: jobTitle || 'Owner',
		role: 'company_owner',
		firstName: 'Admin',
		lastName: username,
	});
	await user.save();

	// For company owners created via registration, set a companyId so downstream admin/staff creation can reference a company.
	if (user.role === 'company_owner') {
		// Ensure both company and companyId fields are set for compatibility across code paths
		if (!user.company) user.company = user._id;
		if (!user.companyId) user.companyId = user._id;
		await user.save();
	}

	return {
		status: 201,
		body: {
			success: true,
			message: 'Admin account created successfully',
			data: { id: user._id, username: user.username, email: user.email, role: user.role },
		},
	};
}

async function verifyIdentity({ username, email, phoneNumber }) {
	if (!username || !email || !phoneNumber) {
		return {
			status: 400,
			body: { success: false, message: 'Username, email, and phone number are required' },
		};
	}

	const admin = await User.findOne({ username, role: 'admin' });
	if (!admin) {
		return {
			status: 404,
			body: { success: false, message: 'No matching admin account found. Please check your information.' },
		};
	}

	if (admin.email !== email || admin.phoneNumber !== phoneNumber) {
		return {
			status: 401,
			body: { success: false, message: 'Email or phone number does not match our records' },
		};
	}

	return { status: 200, body: { success: true, message: 'Identity verified successfully' } };
}

async function resetPassword(req, { username, newPassword }) {
	if (!username || !newPassword) {
		return {
			status: 400,
			body: { success: false, message: 'Username and new password are required' },
		};
	}

	const admin = await User.findOne({ username, role: 'admin' });
	if (!admin) {
		return { status: 404, body: { success: false, message: 'Admin account not found' } };
	}

	admin.password = newPassword;
	await admin.save();

	await safeActivityLog(req, admin._id, 'password_reset', admin, { username }, `Password reset for admin "${username}"`, 'User');

	return { status: 200, body: { success: true, message: 'Password reset successfully' } };
}

async function deleteSupervisor(req, { id, adminId }) {
	if (!adminId) {
		return { status: 400, body: { success: false, message: 'Admin ID is required' } };
	}

	const admin = await User.findOne({ _id: adminId, role: 'admin' });
	if (!admin) {
		return { status: 403, body: { success: false, message: 'Unauthorized' } };
	}

	const supervisor = await User.findOne({ _id: id, role: 'supervisor' });
	if (!supervisor) {
		return { status: 404, body: { success: false, message: 'Supervisor not found' } };
	}

	const isCreator = supervisor.createdBy?.toString() === adminId;
	const isSameCompany = admin.companyId && supervisor.companyId
		&& admin.companyId.toString() === supervisor.companyId.toString();

	if (!isCreator && !isSameCompany) {
		return {
			status: 403,
			body: { success: false, message: 'Unauthorized: You can only delete supervisors from your company' },
		};
	}

	const companyId = supervisor.companyId;
	const supervisorUsername = supervisor.username;

	await User.findByIdAndDelete(id);

	await safeActivityLog(req, id, 'SUPERVISOR_DELETED', admin, {
		supervisorUsername,
		supervisorId: id,
		companyId,
	}, `Supervisor "${supervisorUsername}" deleted by ${admin.username}`, 'User');

	const io = req.app.get('io');
	if (io) {
		io.emit('supervisors:updated', { action: 'delete', supervisorId: id });
	}

	return { status: 200, body: { success: true, message: 'Supervisor deleted successfully' } };
}

async function resetSupervisorPassword(req, { id, adminId, newPassword }) {
	if (!adminId || !newPassword) {
		return { status: 400, body: { success: false, message: 'Admin ID and new password are required' } };
	}

	const admin = await User.findOne({ _id: adminId, role: 'admin' });
	if (!admin) {
		return {
			status: 403,
			body: { success: false, message: 'Unauthorized: Only admins can reset passwords' },
		};
	}

	const supervisor = await User.findOne({ _id: id, role: 'supervisor' });
	if (!supervisor || (admin.companyId && supervisor.companyId.toString() !== admin.companyId.toString())) {
		return { status: 404, body: { success: false, message: 'Supervisor not found or unauthorized' } };
	}

	supervisor.password = newPassword;
	await supervisor.save();

	await safeActivityLog(req, supervisor._id, 'supervisor_password_reset', admin, {
		supervisorUsername: supervisor.username,
		adminId,
	}, `Supervisor "${supervisor.username}" password reset by admin`, 'User');

	return { status: 200, body: { success: true, message: 'Password updated successfully' } };
}

async function createAdmin(req, payload) {
	const {
		username,
		password,
		email,
		fullName,
		firstName,
		lastName,
		phoneNumber,
		authAdminId,
	} = payload;

	if (!username || !password || !email || !authAdminId) {
		return {
			status: 400,
			body: { success: false, message: 'Username, password, email, and creator ID are required' },
		};
	}

	const owner = await User.findOne({ _id: authAdminId, role: 'company_owner' });
	if (!owner) {
		return {
			status: 403,
			body: { success: false, message: 'Unauthorized: Only company owners can create admins' },
		};
	}

	const existingUser = await User.findOne({ $or: [{ username }, { email }] });
	if (existingUser) {
		return { status: 400, body: { success: false, message: 'Username or email already exists' } };
	}

	const incomingFullName = String(fullName || '').trim() || [firstName, lastName].filter(Boolean).join(' ').trim();
	const normalizedName = splitFullName(incomingFullName);

	const newAdmin = new User({
		username,
		password,
		email,
		firstName: normalizedName.firstName,
		lastName: normalizedName.lastName,
		fullName: normalizedName.fullName,
		phoneNumber: phoneNumber || '0000000000',
		role: 'admin',
		companyId: owner._id,
		company: owner._id,
		createdBy: owner._id,
	});
	await newAdmin.save();

	await safeActivityLog(req, newAdmin._id, 'admin_created', owner, {
		newAdminUsername: newAdmin.username,
		role: 'admin',
	}, `New admin "${newAdmin.username}" created by company owner`, 'User');

	const emailSubject = 'Welcome to ConERP - Admin Account Created';
	const emailHtml = `
			<h1>Welcome to ConERP, ${normalizedName.fullName || normalizedName.firstName}!</h1>
			<p>Your admin account has been successfully created.</p>
			<p><strong>Username:</strong> ${username}</p>
			<p><strong>Password:</strong> ${password}</p>
			<p>Please login and change your password immediately.</p>
			<br>
			<p>Best regards,<br>ConERP Team</p>
		`;
	safeSendEmail(email, emailSubject, emailHtml);

	return {
		status: 201,
		body: {
			success: true,
			message: 'Admin account created successfully',
			data: { id: newAdmin._id, username: newAdmin.username, role: newAdmin.role },
		},
	};
}

async function getCompanyAdmins(ownerId) {
	if (!ownerId) {
		return { status: 400, body: { success: false, message: 'Owner ID is required' } };
	}

	const owner = await User.findById(ownerId);
	if (!owner || owner.role !== 'company_owner') {
		return { status: 403, body: { success: false, message: 'Unauthorized' } };
	}

	const admins = await User.find({ role: 'admin', companyId: owner.companyId })
		.select('username email fullName firstName lastName phoneNumber _id createdAt')
		.sort({ createdAt: -1 });

	return { status: 200, body: { success: true, data: admins } };
}

async function deleteCompanyAdmin(req, { id, ownerId }) {
	if (!ownerId) {
		return { status: 400, body: { success: false, message: 'Owner ID is required' } };
	}

	const owner = await User.findById(ownerId);
	if (!owner || owner.role !== 'company_owner') {
		return { status: 403, body: { success: false, message: 'Unauthorized' } };
	}

	const adminToDelete = await User.findOne({ _id: id, role: 'admin' });
	if (!adminToDelete) {
		return { status: 404, body: { success: false, message: 'Admin not found' } };
	}

	if (adminToDelete.companyId.toString() !== owner.companyId.toString()) {
		return {
			status: 403,
			body: { success: false, message: 'Unauthorized: Cannot delete admin from another company' },
		};
	}

	await User.findByIdAndDelete(id);

	await safeActivityLog(req, id, 'admin_deleted', owner, {
		deletedAdminUsername: adminToDelete.username,
		deletedBy: ownerId,
	}, `Admin "${adminToDelete.username}" deleted by company owner`, 'User');

	return { status: 200, body: { success: true, message: 'Admin deleted successfully' } };
}

async function changePassword(req, { userId, oldPassword, newPassword }) {
	if (!userId || !oldPassword || !newPassword) {
		return {
			status: 400,
			body: { success: false, message: 'User ID, old password, and new password are required' },
		};
	}

	const user = await User.findById(userId);
	if (!user) {
		return { status: 404, body: { success: false, message: 'User not found' } };
	}

	const isMatch = await user.comparePassword(oldPassword);
	if (!isMatch) {
		return { status: 401, body: { success: false, message: 'Incorrect current password' } };
	}

	user.password = newPassword;
	await user.save();

	await safeActivityLog(req, user._id, 'password_changed', req.user || user, {}, `Password changed for user "${user.username}"`, 'User');

	return { status: 200, body: { success: true, message: 'Password changed successfully' } };
}

module.exports = {
	getCurrentUser,
	login,
	refreshToken,
	createSupervisor,
	getSupervisors,
	getSupervisorById,
	createWarehouseManager,
	getWarehouseManagers,
	deleteWarehouseManager,
	getAdmins,
	registerAdmin,
	verifyIdentity,
	resetPassword,
	deleteSupervisor,
	resetSupervisorPassword,
	createAdmin,
	getCompanyAdmins,
	deleteCompanyAdmin,
	changePassword,
};
