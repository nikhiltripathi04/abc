const express = require('express');
const router = express.Router();
const approvalController = require('../controllers/approval.controller');
const { auth } = require('../middleware/auth');

// Dashboard endpoints
router.get('/dashboard', auth, approvalController.getDashboard);
router.get('/dashboard/filters', auth, approvalController.getFilterOptions);

// Quantity change endpoints
router.get('/quantity-changes/pending', auth, approvalController.getPendingQuantityChanges);
router.get('/quantity-changes/:id', auth, approvalController.getQuantityChangeDetails);
router.post('/quantity-changes/:id/approve', auth, approvalController.approveQuantityChange);
router.post('/quantity-changes/:id/reject', auth, approvalController.rejectQuantityChange);

// Item change endpoints (combined quantity + detail changes) — must be before /:id wildcard
router.get('/item-changes', auth, approvalController.getPendingItemChanges);
router.get('/item-detail-changes/:id', auth, approvalController.getItemDetailChangeDetails);
router.post('/item-detail-changes/:id/approve', auth, approvalController.approveItemDetailChange);
router.post('/item-detail-changes/:id/reject', auth, approvalController.rejectItemDetailChange);

// [BACKORDER DISABLED] Backorder endpoints
// router.get('/backorders/list', auth, approvalController.getBackorders);
// router.get('/backorders/:id', auth, approvalController.getBackorderDetail);
// router.post('/backorders/:id/approve', auth, approvalController.approveBackorder);
// router.post('/:itemId/create-backorder', auth, approvalController.createBackorderFromApproval);

// Wildcard /:id must come LAST to avoid shadowing named routes above
router.get('/:id', auth, approvalController.getApprovalDetails);

// Item approval endpoints
router.post('/:orderId/approve-item', auth, approvalController.approveItem);
router.post('/:orderId/reject-item', auth, approvalController.rejectItem);
router.patch('/:orderId/items/:itemId', auth, approvalController.updateItemSettings);
router.post('/:orderId/bulk-approve', auth, approvalController.bulkApproveItems);
router.post('/:orderId/bulk-reject', auth, approvalController.bulkRejectItems);

module.exports = router;
