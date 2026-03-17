const companyService = require('./company.service');

const handle = async (res, executor) => {
  const result = await executor();
  return res.status(result.status).json(result.body);
};

exports.register = async (req, res) => {
  try {
    return await handle(res, () => companyService.registerCompany(req.body));
  } catch (error) {
    console.error('Company registration error:', error);
    return res.status(500).json({ success: false, message: 'An error occurred during company registration', error: error.message });
  }
};

exports.createAdmin = async (req, res) => {
  try {
    return await handle(res, () => companyService.createAdmin(req, req.body));
  } catch (error) {
    console.error('Create admin error:', error);
    return res.status(500).json({ success: false, message: 'An error occurred while creating admin', error: error.message });
  }
};

exports.getCompanyAdmins = async (req, res) => {
  try {
    return await handle(res, () => companyService.getCompanyAdmins({
      ownerId: req.user.id,
      page: req.query.page,
      limit: req.query.limit,
      selectedFields: req.selectedFields,
    }));
  } catch (error) {
    console.error('Error fetching company admins:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch admins' });
  }
};

exports.deleteCompanyAdmin = async (req, res) => {
  try {
    return await handle(res, () => companyService.deleteCompanyAdmin(req, {
      id: req.params.id,
      ownerId: req.user.id,
    }));
  } catch (error) {
    console.error('Error deleting company admin:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete admin', error: error.message });
  }
};
