const mongoose = require('mongoose');
const User = require('../users/user.model');
const Company = require('./company.model');
const PaginationHelper = require('../../utils/pagination.util');
const cacheService = require('../../services/cache.service');

const resolveProjection = (defaultProjection, selectedFields) => selectedFields || defaultProjection;

async function registerCompany(payload) {
	const { username, password, email, phoneNumber, firstName, lastName, jobTitle, companyName, gstin, address } = payload;
	if (!username || !password || !email || !phoneNumber || !firstName || !lastName) {
		return { status: 400, body: { success: false, message: 'Please provide username, password, email, phone number, first name, and last name' } };
	}

	const existingUsername = await User.findOne({ username });
	if (existingUsername) {
		return { status: 400, body: { success: false, message: 'Username already exists', errorType: 'USERNAME_EXISTS' } };
	}

	const existingEmail = await User.findOne({ email });
	if (existingEmail) {
		return { status: 400, body: { success: false, message: 'Email already exists', errorType: 'EMAIL_EXISTS' } };
	}

	// Create company
	const companyDoc = new Company({
		name: companyName || username,
		email: email,
		phoneNumber: phoneNumber,
		gstin: gstin || '',
		address: address || '',
	});

	try {
		// If gstin missing or invalid, skip validation to allow registration flow; keep required validation for later updates
		if (!gstin) {
			await companyDoc.save({ validateBeforeSave: false });
		} else {
			await companyDoc.save();
		}
	} catch (error) {
		return { status: 500, body: { success: false, message: 'Failed to create company', error: error.message } };
	}

	// Create company owner user
	const ownerFirstName = String(firstName).trim();
	const ownerLastName = String(lastName).trim();
	const user = new User({
		username,
		password,
		email,
		phoneNumber,
		jobTitle: jobTitle || 'Owner',
		role: 'company_owner',
		firstName: ownerFirstName,
		lastName: ownerLastName,
		fullName: `${ownerFirstName} ${ownerLastName}`,
		companyId: companyDoc._id,
		company: companyDoc._id,
	});

	try {
		await user.save();
	} catch (error) {
		// rollback company if user save fails
		try { await Company.deleteOne({ _id: companyDoc._id }); } catch (e) {}
		return { status: 500, body: { success: false, message: 'Failed to create user', error: error.message } };
	}

	return { status: 201, body: { success: true, message: 'Company and owner created successfully', data: { companyId: companyDoc._id, ownerId: user._id } } };
}


const safeActivityLog = async (req, targetUserId, action, actor, metadata, message, entityType) => {
	if (process.env.NODE_ENV === 'test' || String(process.env.DISABLE_EXTERNAL_SIDE_EFFECTS) === 'true') {
		return;
	}

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
	if (process.env.NODE_ENV === 'test' || String(process.env.DISABLE_EXTERNAL_SIDE_EFFECTS) === 'true') {
		return;
	}

	try {
		const sendEmail = require('../../../old_backend/utils/email');
		await sendEmail(to, subject, html);
	} catch (error) {
		if (String(process.env.DEBUG_EMAIL || '').toLowerCase() === 'true') {
			console.warn('Email sender unavailable or failed:', error.message);
		}
	}
};

async function createAdmin(req, payload) {
	const {
		username,
		password,
		email,
		firstName,
		lastName,
		phoneNumber,
	} = payload;

	const owner = await User.findOne({ _id: req.user?._id, role: 'company_owner' });
	if (!owner) {
		return {
			status: 403,
			body: { success: false, message: 'Unauthorized: Only company owners can create admins' },
		};
	}

	const ownerCompanyId = owner.company || owner.companyId;
	if (!ownerCompanyId) {
		return {
			status: 400,
			body: { success: false, message: 'Owner is not linked to a company' },
		};
	}

	const existingUser = await User.findOne({ $or: [{ username }, { email }] });
	if (existingUser) {
		return { status: 400, body: { success: false, message: 'Username or email already exists' } };
	}

	const adminFirstName = firstName;
	const adminLastName = lastName;

	const newAdmin = new User({
		username,
		password,
		email,
		firstName: adminFirstName,
		lastName: adminLastName,
		fullName: `${adminFirstName} ${adminLastName}`,
		phoneNumber: phoneNumber || '0000000000',
		role: 'admin',
		companyId: ownerCompanyId,
		company: ownerCompanyId,
		createdBy: owner._id,
	});
	await newAdmin.save();

	await safeActivityLog(req, newAdmin._id, 'admin_created', owner, {
		newAdminUsername: newAdmin.username,
		role: 'admin',
	}, `New admin "${newAdmin.username}" created by company owner`, 'User');

	const emailSubject = 'Welcome to ConERP - Admin Account Created';
	const emailHtml = `
			<h1>Welcome to ConERP, ${adminFirstName} ${adminLastName}!</h1>
			<p>Your admin account has been successfully created.</p>
			<p><strong>Username:</strong> ${username}</p>
			<p><strong>Password:</strong> ${password}</p>
			<p>Please login and change your password immediately.</p>
			<br>
			<p>Best regards,<br>ConERP Team</p>
		`;
	safeSendEmail(email, emailSubject, emailHtml);

	await Promise.all([
		cacheService.invalidatePattern(`companyAdmins:${ownerCompanyId}:*`),
		cacheService.invalidatePattern(`admins:company:${ownerCompanyId}:*`),
		cacheService.del(`user:${newAdmin._id}`),
	]);

	return {
		status: 201,
		body: {
			success: true,
			message: 'Admin account created successfully',
			data: { id: newAdmin._id, username: newAdmin.username, role: newAdmin.role },
		},
	};
}

async function getCompanyAdmins(params) {
	const ownerId = (params && typeof params === 'object') ? params.ownerId : params;
	const page = (params && typeof params === 'object') ? params.page : undefined;
	const limit = (params && typeof params === 'object') ? params.limit : undefined;
	const selectedFields = (params && typeof params === 'object') ? params.selectedFields : undefined;

	const owner = await User.findById(ownerId);
	if (!owner || owner.role !== 'company_owner') {
		return { status: 403, body: { success: false, message: 'Unauthorized' } };
	}

	const ownerCompanyId = owner.company || owner.companyId;
	if (!ownerCompanyId) {
		return { status: 400, body: { success: false, message: 'Owner is not linked to a company' } };
	}

	const filter = { role: 'admin', company: ownerCompanyId };
	const { skip, page: safePage, limit: safeLimit } = PaginationHelper.normalize({ page, limit });
	const projection = resolveProjection('username email fullName firstName lastName phoneNumber _id createdAt', selectedFields);
	const cacheKey = `companyAdmins:${ownerCompanyId}:p:${safePage}:l:${safeLimit}:f:${projection}`;
	const result = await cacheService.wrap(cacheKey, async () => {
		const [admins, total] = await Promise.all([
			User.find(filter)
				.select(projection)
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(safeLimit)
				.lean(),
			User.countDocuments(filter),
		]);

		return {
			data: admins,
			pagination: PaginationHelper.buildMeta(safePage, safeLimit, total),
		};
	}, 300);

	return {
		status: 200,
		body: {
			success: true,
			...result,
		},
	};
}

async function deleteCompanyAdmin(req, { id, ownerId }) {
	const owner = await User.findById(ownerId);
	if (!owner || owner.role !== 'company_owner') {
		return { status: 403, body: { success: false, message: 'Unauthorized' } };
	}

	const ownerCompanyId = owner.company || owner.companyId;
	if (!ownerCompanyId) {
		return { status: 400, body: { success: false, message: 'Owner is not linked to a company' } };
	}

	const adminToDelete = await User.findOne({ _id: id, role: 'admin' });
	if (!adminToDelete) {
		return { status: 404, body: { success: false, message: 'Admin not found' } };
	}

	if (!adminToDelete.company || adminToDelete.company.toString() !== ownerCompanyId.toString()) {
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

	await Promise.all([
		cacheService.invalidatePattern(`companyAdmins:${ownerCompanyId}:*`),
		cacheService.invalidatePattern(`admins:company:${ownerCompanyId}:*`),
		cacheService.del(`user:${id}`),
	]);

	return { status: 200, body: { success: true, message: 'Admin deleted successfully' } };
}

module.exports = { registerCompany, createAdmin, getCompanyAdmins, deleteCompanyAdmin };
