const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const returnController = require('../controllers/return.controller');

// Apply auth middleware to all routes
router.use(auth);

/**
 * @route   POST /api/returns
 * @desc    Create new return request
 * @access  Supervisor, Admin
 */
router.post('/', returnController.createReturn);

/**
 * @route   GET /api/returns
 * @desc    Get returns with filters (role-based access)
 * @access  Authenticated users
 */
router.get('/', returnController.getReturns);

/**
 * @route   GET /api/returns/:returnId
 * @desc    Get single return by ID
 * @access  Authenticated users
 */
router.get('/:returnId', returnController.getReturnById);

/**
 * @route   PATCH /api/returns/:returnId/approve
 * @desc    Approve return request
 * @access  Warehouse Manager, Admin
 */
router.patch('/:returnId/approve', returnController.approveReturn);

/**
 * @route   PATCH /api/returns/:returnId/reject
 * @desc    Reject return request
 * @access  Warehouse Manager, Admin
 */
router.patch('/:returnId/reject', returnController.rejectReturn);

/**
 * @route   POST /api/returns/:returnId/log-receiving
 * @desc    Log receiving of returned items
 * @access  Warehouse Manager, Admin
 */
router.post('/:returnId/log-receiving', returnController.logReceiving);

/**
 * @route   GET /api/returns/pending-for-warehouse/:warehouseId
 * @desc    Get pending returns for specific warehouse
 * @access  Warehouse Manager, Admin
 */
router.get('/pending-for-warehouse/:warehouseId', returnController.getPendingReturnsForWarehouse);

/**
 * @route   GET /api/returns/site/:siteId
 * @desc    Get returns for specific site
 * @access  Supervisor, Admin
 */
router.get('/site/:siteId', returnController.getReturnsBySite);

module.exports = router;
