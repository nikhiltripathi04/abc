const express = require('express');
const { auth } = require('../middleware/auth');
const inventoryController = require('../controllers/inventory.controller');

const router = express.Router();

router.get('/warehouse-manager/warehouses', auth, inventoryController.getWarehouseManagerWarehouses);
router.get('/warehouse-manager/snapshot', auth, inventoryController.getWarehouseManagerSnapshot);
router.get('/warehouse-manager/requests', auth, inventoryController.getWarehouseManagerRequests);
router.post('/warehouse-manager/requests/:requestId/:action', auth, inventoryController.handleWarehouseManagerRequest);
router.get('/filters/config', auth, inventoryController.getInventoryFilterConfig);
router.put('/filters/config', auth, inventoryController.updateInventoryFilterConfig);

router.get('/items', auth, inventoryController.getInventoryItems);
router.post('/items/prices', auth, inventoryController.getInventoryPricesByIds);
router.get('/items/:itemId/price-history', auth, inventoryController.getItemPriceHistory);
router.post('/items', auth, inventoryController.createInventoryItem);
router.put('/items/:itemId', auth, inventoryController.updateInventoryItem);
router.put('/items/:itemId/price', auth, inventoryController.updateItemPrice);
router.delete('/items/:itemId', auth, inventoryController.deleteInventoryItem);
router.post('/items/import', auth, inventoryController.importInventoryItems);
router.get('/items/export', auth, inventoryController.exportInventoryItems);
router.post('/items/:itemId/request-quantity-change', auth, inventoryController.createQuantityChangeRequest);
router.post('/items/:itemId/request-item-detail-change', auth, inventoryController.createItemDetailChangeRequest);

module.exports = router;
