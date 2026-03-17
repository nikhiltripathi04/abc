const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const grnController = require('../controllers/grn.controller');

// All routes require authentication - apply to all routes below
router.use(auth);

// Create standalone GRN
router.post('/create', grnController.createGRN);

// Log GRN against an order
router.post('/log/:orderId', grnController.logGRNAgainstOrder);

// Get list of GRNs (with filters)
router.get('/', grnController.getGRNList);

// Get GRN history
router.get('/history', grnController.getGRNHistory);

// Get orders pending receiving (MUST be before /:grnId)
router.get('/pending-receiving', grnController.getPendingReceiving);

// Get GRNs pending authentication (Warehouse Manager only) (MUST be before /:grnId)
router.get('/pending-authentication', grnController.getPendingAuthentication);

// Get single GRN by ID (MUST be AFTER specific routes)
router.get('/:grnId', grnController.getGRNById);

// Authenticate GRN (Warehouse Manager only)
router.put('/:grnId/authenticate', grnController.authenticateGRN);

module.exports = router;
