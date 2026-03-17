const express = require('express');
const { auth } = require('../middleware/auth');
const salesController = require('../controllers/sales.controller');

const router = express.Router();

router.post('/requests', auth, salesController.createSalesRequest);
router.get('/requests', auth, salesController.listSalesRequests);
router.get('/requests/:id', auth, salesController.getSalesRequestById);
router.put('/requests/:id', auth, salesController.updateDraft);
router.delete('/requests/:id', auth, salesController.deleteDraft);
router.post('/requests/:id/submit', auth, salesController.submitDraft);
router.put('/requests/:id/admin-edit', auth, salesController.adminEditRequest);
router.post('/requests/:id/approve', auth, salesController.approveRequest);
router.post('/requests/:id/reject', auth, salesController.rejectRequest);
router.post('/requests/:id/generate-invoice', auth, salesController.generateInvoicePdf);
router.get('/summary/cards', auth, salesController.getSalesSummaryCards);
router.get('/recent', auth, salesController.getRecentSalesRequests);

module.exports = router;
