const authService = require('./auth.service');
const companyService = require('../company/company.service');

const handle = async (res, executor) => {
	const result = await executor();
	return res.status(result.status).json(result.body);
};

exports.getMe = async (req, res, next) => {
	try {
		return await handle(res, () => authService.getCurrentUser(req.user.id));
	} catch (error) {
		return next(error);
	}
};

exports.login = async (req, res, next) => {
	try {
		let parsedBody = req.body;
		if (typeof req.body === 'string') {
			try {
				parsedBody = JSON.parse(req.body);
			} catch (error) {
				parsedBody = {};
			}
		}

		return await handle(res, () => authService.login({
			...(parsedBody || {}),
			query: req.query || {},
			body: parsedBody,
		}));
	} catch (error) {
		return next(error);
	}
};

exports.refreshToken = async (req, res, next) => {
	try {
		return await handle(res, () => authService.refreshToken(req.body.refreshToken));
	} catch (error) {
		return next(error);
	}
};

exports.createSupervisor = async (req, res, next) => {
	try {
		return await handle(res, () => authService.createSupervisor(req, req.body));
	} catch (error) {
		return next(error);
	}
};

exports.getSupervisors = async (req, res, next) => {
	try {
		return await handle(res, () => authService.getSupervisors({
			...req.query,
			selectedFields: req.selectedFields,
		}));
	} catch (error) {
		return next(error);
	}
};

exports.getSupervisorById = async (req, res, next) => {
	try {
		return await handle(res, () => authService.getSupervisorById(req.params.id, req.selectedFields));
	} catch (error) {
		return next(error);
	}
};

exports.createWarehouseManager = async (req, res, next) => {
	try {
		return await handle(res, () => authService.createWarehouseManager(req, req.body));
	} catch (error) {
		return next(error);
	}
};

exports.getWarehouseManagers = async (req, res, next) => {
	try {
		return await handle(res, () => authService.getWarehouseManagers({
			...req.query,
			selectedFields: req.selectedFields,
		}));
	} catch (error) {
		return next(error);
	}
};

exports.deleteWarehouseManager = async (req, res, next) => {
	try {
		return await handle(res, () => authService.deleteWarehouseManager(req, {
			adminId: req.query.adminId,
			managerId: req.params.managerId,
		}));
	} catch (error) {
		return next(error);
	}
};

exports.getAdmins = async (req, res, next) => {
	try {
		return await handle(res, () => authService.getAdmins({
			...req.query,
			selectedFields: req.selectedFields,
		}));
	} catch (error) {
		return next(error);
	}
};

exports.register = async (req, res, next) => {
	try {
		// delegate company-registration to company service
		return await handle(res, () => companyService.registerCompany(req.body));
	} catch (error) {
		return next(error);
	}
};

exports.verifyIdentity = async (req, res, next) => {
	try {
		return await handle(res, () => authService.verifyIdentity(req.body));
	} catch (error) {
		return next(error);
	}
};

exports.resetPassword = async (req, res, next) => {
	try {
		return await handle(res, () => authService.resetPassword(req, req.body));
	} catch (error) {
		return next(error);
	}
};

exports.deleteSupervisor = async (req, res, next) => {
	try {
		return await handle(res, () => authService.deleteSupervisor(req, {
			id: req.params.id,
			adminId: req.query.adminId,
		}));
	} catch (error) {
		return next(error);
	}
};

exports.resetSupervisorPassword = async (req, res, next) => {
	try {
		return await handle(res, () => authService.resetSupervisorPassword(req, {
			id: req.params.id,
			adminId: req.body.adminId,
			newPassword: req.body.newPassword,
		}));
	} catch (error) {
		return next(error);
	}
};

exports.createAdmin = async (req, res, next) => {
	try {
		return await handle(res, () => authService.createAdmin(req, req.body));
	} catch (error) {
		return next(error);
	}
};

exports.getCompanyAdmins = async (req, res, next) => {
	try {
		return await handle(res, () => authService.getCompanyAdmins({
			...req.query,
			selectedFields: req.selectedFields,
		}));
	} catch (error) {
		return next(error);
	}
};

exports.deleteCompanyAdmin = async (req, res, next) => {
	try {
		return await handle(res, () => authService.deleteCompanyAdmin(req, {
			id: req.params.id,
			ownerId: req.query.ownerId,
		}));
	} catch (error) {
		return next(error);
	}
};

exports.changePassword = async (req, res, next) => {
	try {
		return await handle(res, () => authService.changePassword(req, req.body));
	} catch (error) {
		return next(error);
	}
};
