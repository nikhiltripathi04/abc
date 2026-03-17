const express = require('express');
const { auth } = require('../middleware/auth');
const orderController = require('../controllers/order.controller');

const router = express.Router();

router.post('/', auth, orderController.createOrder);
router.get('/', auth, orderController.listOrders);
router.get('/meta/sites', auth, orderController.getOrderMetaSites);
router.get('/meta/warehouses', auth, orderController.getOrderMetaWarehouses);
router.get('/summary/cards', auth, orderController.getOrderSummaryCards);
router.get('/:orderId', auth, orderController.getOrderById);
router.put('/:orderId', auth, orderController.updateDraftOrder);
router.post('/:orderId/submit', auth, orderController.submitOrder);
router.post('/:orderId/approve', auth, orderController.approveOrder);
router.post('/:orderId/reject', auth, orderController.rejectOrder);
router.post('/:orderId/dispatch', auth, orderController.dispatchOrder);
router.post('/:orderId/receive', auth, orderController.receiveOrder);
router.post('/:orderId/cancel', auth, orderController.cancelOrder);

module.exports = router;
