const express = require('express');
const router = express.Router();
const controller = require('./company.controller');
const { auth } = require('../../middleware/auth.middleware');
const { validateBody } = require('../../middleware/validate.middleware');
const selectFields = require('../../middleware/field-selection.middleware');
const { registerCompanySchema, createAdminSchema } = require('./company.validation');

router.post('/register', express.text({ type: '*/*' }), validateBody(registerCompanySchema), controller.register);
router.post('/create-admin', auth, express.text({ type: '*/*' }), validateBody(createAdminSchema), controller.createAdmin);
router.get('/admins', auth, selectFields, controller.getCompanyAdmins);
router.delete('/admins/:id', auth, controller.deleteCompanyAdmin);

module.exports = router;
