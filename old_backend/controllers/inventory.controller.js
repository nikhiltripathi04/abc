const mongoose = require('mongoose');
const InventoryItem = require('../models/InventoryItem');
const Warehouse = require('../models/Warehouse');
const SupplyRequest = require('../models/SupplyRequest');
const Site = require('../models/Site');
const Company = require('../models/Company');
const { QuantityChangeRequest } = require('../models/QuantityChangeRequest');
const { ItemDetailChangeRequest } = require('../models/ItemDetailChangeRequest');
const ActivityLogger = require('../utils/activityLogger');
const ActivityLog = require('../models/ActivityLog');
const approvalHelper = require('../utils/approvalHelper');
const eventBus = require('../core/eventBus');
const { getIO } = require('../core/socket');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_IMPORT_ITEMS = 1000;
const DEFAULT_FILTER_CONFIG = {
    category: { enabled: true },
    qtyRange: { enabled: true },
    tags: { enabled: true },
    statusToggles: {
        enabled: true,
        options: { active: true, below_min: true, out_of_stock: true }
    }
};

const toNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const normalizeTags = (tags) => {
    if (!tags) return [];
    if (Array.isArray(tags)) {
        return tags.map((t) => String(t).trim()).filter(Boolean);
    }
    return String(tags)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
};

const normalizeText = (value) => String(value || '').trim().replace(/\s+/g, ' ');

const getUserDisplayName = (user) => {
    const fullName = normalizeText(`${user?.firstName || ''} ${user?.lastName || ''}`);
    if (fullName) return fullName;

    const roleFullName = normalizeText(user?.fullName || '');
    if (roleFullName) return roleFullName;

    const explicitName = normalizeText(user?.name || '');
    if (explicitName) return explicitName;

    const username = normalizeText(user?.username || '');
    if (username) return username;

    return 'Unknown User';
};

const normalizeItemNameForMatch = (value) => normalizeText(value).replace(/\s+/g, '').toUpperCase();

const normalizeItemNameForStore = (value) => normalizeText(value).toUpperCase();

const parseNumberLoose = (value, fallback = 0) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    const normalized = String(value).replace(/[^0-9.-]/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const pickFirst = (row, keys) => {
    for (const key of keys) {
        if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
            return row[key];
        }
    }
    return undefined;
};

const normalizeImportRow = (row) => {
    const itemNameRaw = pickFirst(row, ['itemName', 'Item Name', 'ITEM NAME', 'name', 'Name']);
    const locationRaw = pickFirst(row, ['location', 'Location']);
    const categoryRaw = pickFirst(row, ['category', 'Category']);
    const qtyRaw = pickFirst(row, ['availableQty', 'Available Qty', 'quantity', 'Quantity', 'qty', 'Qty']);
    const uomRaw = pickFirst(row, ['uom', 'UOM', 'unit', 'Unit']);
    const minRaw = pickFirst(row, ['minQty', 'Min', 'MIN', 'min', 'Minimum']);
    const maxRaw = pickFirst(row, ['maxQty', 'Max', 'MAX', 'max', 'Maximum']);
    const avgPriceRaw = pickFirst(row, ['currentPrice', 'avgPrice', 'Avg Price', 'entryPrice', 'Entry Price', 'price', 'Price']);
    const totalValueRaw = pickFirst(row, ['totalValue', 'Total Value']);
    const reorderQtyRaw = pickFirst(row, ['reorderQty', 'Reorder Qty', 'Reorder']);
    const uidRaw = pickFirst(row, ['uid', 'UID']);
    const tagsRaw = pickFirst(row, ['tags', 'Tags']);
    const currencyRaw = pickFirst(row, ['currency', 'Currency']);

    const itemNameNormalized = normalizeItemNameForStore(itemNameRaw || '');
    const quantity = Math.max(0, parseNumberLoose(qtyRaw, 0));
    const minQty = Math.max(0, parseNumberLoose(minRaw, 0));
    const maxQty = Math.max(0, parseNumberLoose(maxRaw, 0));
    const reorderQty = Math.max(0, parseNumberLoose(reorderQtyRaw, 0));
    const avgPrice = Math.max(0, parseNumberLoose(avgPriceRaw, 0));
    const totalValue = Math.max(0, parseNumberLoose(totalValueRaw, 0));

    let derivedAvgPrice = avgPrice;
    if (totalValue > 0 && quantity > 0) {
        derivedAvgPrice = totalValue / quantity;
    }

    return {
        uid: uidRaw ? normalizeText(uidRaw).toUpperCase() : undefined,
        itemName: itemNameNormalized,
        itemMatchKey: normalizeItemNameForMatch(itemNameRaw || ''),
        category: normalizeText(categoryRaw || 'General') || 'General',
        location: normalizeText(locationRaw || ''),
        uom: (normalizeText(uomRaw || 'PCS') || 'PCS').toUpperCase(),
        availableQty: quantity,
        minQty,
        maxQty,
        reorderQty,
        avgPrice: derivedAvgPrice,
        currency: normalizeText(currencyRaw || ''),
        tags: normalizeTags(tagsRaw)
    };
};

const getStatusForItem = (item) => {
    if (item.availableQty <= 0) return 'out_of_stock';
    if (item.availableQty < item.minQty) return 'below_min';
    return 'active';
};

const buildClientItem = (item) => ({
    _id: item._id,
    uid: item.uid,
    itemName: item.itemName,
    category: item.category,
    location: item.location,
    uom: item.uom,
    unit: item.uom,
    availableQty: item.availableQty,
    quantity: item.availableQty,
    minQty: item.minQty,
    maxQty: item.maxQty,
    reorderQty: item.reorderQty,
    entryPrice: item.entryPrice,
    currentPrice: item.currentPrice,
    // Persistently calculated weighted average price (from GRN submissions)
    avgPrice: item.avgPrice || item.currentPrice || item.entryPrice || 0,
    totalPrice: item.totalPrice || 0,
    currency: item.currency || '₹',
    tags: item.tags || [],
    isFavorite: !!item.isFavorite,
    isActive: !!item.isActive,
    // totalValue uses avgPrice so the table reflects proper weighted-average valuation
    totalValue: item.availableQty * (item.avgPrice || item.currentPrice || item.entryPrice || 0),
    avgPricePerPiece: item.avgPrice || item.currentPrice || item.entryPrice || 0,
    status: getStatusForItem(item),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
});

const mergeFilterConfig = (raw = {}) => ({
    category: { enabled: raw?.category?.enabled !== false },
    qtyRange: { enabled: raw?.qtyRange?.enabled !== false },
    tags: { enabled: raw?.tags?.enabled !== false },
    statusToggles: {
        enabled: raw?.statusToggles?.enabled !== false,
        options: {
            active: raw?.statusToggles?.options?.active !== false,
            below_min: raw?.statusToggles?.options?.below_min !== false,
            out_of_stock: raw?.statusToggles?.options?.out_of_stock !== false
        }
    }
});

const getCompanyFilterConfig = async (user) => {
    if (!user?.companyId) return DEFAULT_FILTER_CONFIG;
    const company = await Company.findById(user.companyId).select('inventoryFilterConfig');
    return mergeFilterConfig(company?.inventoryFilterConfig || DEFAULT_FILTER_CONFIG);
};

const buildQueryForWarehouseManager = async (user, warehouseId = null) => {
    if (user.role !== 'warehouse_manager') {
        return { error: { code: 403, message: 'Warehouse manager access required' } };
    }

    // Check if manager has any warehouses assigned (including legacy warehouseId)
    const assignedWarehouses = user.assignedWarehouses || [];
    const hasLegacyWarehouse = user.warehouseId ? [user.warehouseId] : [];
    const allWarehouses = [...assignedWarehouses, ...hasLegacyWarehouse];

    if (allWarehouses.length === 0) {
        return { error: { code: 403, message: 'User is not assigned to any warehouse' } };
    }

    // If a specific warehouseId is requested, verify access
    if (warehouseId) {
        const hasAccess = allWarehouses.some((wId) => wId.toString() === warehouseId.toString());
        if (!hasAccess) {
            return { error: { code: 403, message: 'User is not assigned to this warehouse' } };
        }

        const warehouse = await Warehouse.findById(warehouseId);
        if (!warehouse) {
            return { error: { code: 404, message: 'Warehouse not found' } };
        }

        return { warehouse };
    }

    // If no specific warehouse requested, return the first assigned warehouse
    // (for legacy endpoints that expect a single warehouse)
    const warehouse = await Warehouse.findById(allWarehouses[0]);
    if (!warehouse) {
        return { error: { code: 404, message: 'Assigned warehouse not found' } };
    }

    return { warehouse };
};

const buildInventoryScope = async (req, options = {}) => {
    const { requireWarehouseForAdmin = false } = options;
    const user = req.user;

    if (user.role === 'warehouse_manager') {
        const warehouseId = req.query.warehouseId || req.body.warehouseId || req.params.warehouseId;
        return buildQueryForWarehouseManager(user, warehouseId);
    }

    if (!['admin', 'company_owner', 'supervisor'].includes(user.role)) {
        return { error: { code: 403, message: 'Inventory access denied' } };
    }

    const warehouseId = req.query.warehouseId || req.body.warehouseId || req.params.warehouseId;
    if (!warehouseId) {
        if (requireWarehouseForAdmin) {
            return { error: { code: 400, message: 'warehouseId is required' } };
        }
        return { warehouse: null };
    }

    const warehouse = await Warehouse.findById(warehouseId);
    if (!warehouse) {
        return { error: { code: 404, message: 'Warehouse not found' } };
    }

    const warehouseCompanyId = warehouse.companyId ? warehouse.companyId.toString() : null;
    const requesterCompanyId = user.companyId ? user.companyId.toString() : null;
    if (warehouseCompanyId && requesterCompanyId && warehouseCompanyId !== requesterCompanyId) {
        return { error: { code: 403, message: 'Warehouse does not belong to your company' } };
    }

    return { warehouse };
};

const generateItemUid = async (warehouseId) => {
    let warehouse = await Warehouse.findByIdAndUpdate(
        warehouseId,
        { $inc: { itemCounter: 1 } },
        { new: true }
    );

    if (!warehouse) {
        throw new Error('Warehouse not found');
    }

    // Auto-assign warehouseNumber if missing (warehouses created before this field was added)
    if (!warehouse.warehouseNumber) {
        const lastNumbered = await Warehouse.findOne(
            { _id: { $ne: warehouseId }, warehouseNumber: { $exists: true, $ne: null } }
        ).sort({ warehouseNumber: -1 });
        const nextNumber = lastNumbered ? lastNumbered.warehouseNumber + 1 : 1;
        warehouse = await Warehouse.findByIdAndUpdate(
            warehouseId,
            { $set: { warehouseNumber: nextNumber } },
            { new: true }
        );
    }

    const warehouseNumber = warehouse.warehouseNumber;
    const counter = warehouse.itemCounter;
    const counterPart = String(counter).padStart(5, '0');

    return `ITEM-${warehouseNumber}${counterPart}`;
};

const syncInventoryItemToWarehouseSupply = (warehouse, item) => {
    const existingSupplyIndex = warehouse.supplies.findIndex((s) => {
        return normalizeItemNameForMatch(s.itemName) === normalizeItemNameForMatch(item.itemName);
    });

    const mappedSupply = {
        itemName: item.itemName,
        quantity: item.availableQty,
        unit: item.uom,
        currency: item.currency || '₹',
        entryPrice: item.entryPrice || 0,
        currentPrice: item.currentPrice || item.entryPrice || 0,
        addedBy: item.updatedBy || item.createdBy
    };

    if (existingSupplyIndex >= 0) {
        warehouse.supplies[existingSupplyIndex].itemName = mappedSupply.itemName;
        warehouse.supplies[existingSupplyIndex].quantity = mappedSupply.quantity;
        warehouse.supplies[existingSupplyIndex].unit = mappedSupply.unit;
        warehouse.supplies[existingSupplyIndex].currency = mappedSupply.currency;
        warehouse.supplies[existingSupplyIndex].entryPrice = mappedSupply.entryPrice;
        warehouse.supplies[existingSupplyIndex].currentPrice = mappedSupply.currentPrice;
    } else {
        warehouse.supplies.push(mappedSupply);
    }
};

const persistWarehouseSupplies = async (warehouse) => {
    await Warehouse.updateOne(
        { _id: warehouse._id },
        { $set: { supplies: warehouse.supplies } }
    );
};

// Cache to avoid checking seeding on every request
const warehouseSeededCache = new Map();

const ensureInventorySeededFromWarehouseSupplies = async (warehouse, user) => {
    const warehouseIdStr = warehouse._id.toString();

    // Check cache first
    if (warehouseSeededCache.has(warehouseIdStr)) {
        return;
    }

    const count = await InventoryItem.countDocuments({ warehouseId: warehouse._id });

    // Cache the result - warehouse has inventory
    if (count > 0) {
        warehouseSeededCache.set(warehouseIdStr, true);
        return;
    }

    // No supplies to seed
    if (!warehouse.supplies || warehouse.supplies.length === 0) {
        warehouseSeededCache.set(warehouseIdStr, true);
        return;
    }

    const rows = [];
    for (const supply of warehouse.supplies) {
        rows.push({
            warehouseId: warehouse._id,
            companyId: warehouse.companyId || user.companyId,
            uid: await generateItemUid(warehouse._id),
            itemName: supply.itemName,
            category: 'General',
            location: warehouse.location || '',
            uom: supply.unit || 'pcs',
            availableQty: toNumber(supply.quantity, 0),
            minQty: 0,
            maxQty: 0,
            reorderQty: 0,
            entryPrice: toNumber(supply.entryPrice, 0),
            currentPrice: toNumber(supply.currentPrice || supply.entryPrice, 0),
            currency: supply.currency || '₹',
            createdBy: user._id,
            updatedBy: user._id
        });
    }
    if (rows.length) {
        await InventoryItem.insertMany(rows);
    }

    // Mark as seeded
    warehouseSeededCache.set(warehouseIdStr, true);
};

// Get all warehouses assigned to the warehouse manager
exports.getWarehouseManagerWarehouses = async (req, res) => {
    try {
        const user = req.user;
        if (user.role !== 'warehouse_manager') {
            return res.status(403).json({ success: false, message: 'Warehouse manager access required' });
        }

        // Get all assigned warehouses (including legacy warehouseId)
        const assignedWarehouses = user.assignedWarehouses || [];
        const hasLegacyWarehouse = user.warehouseId ? [user.warehouseId] : [];
        const allWarehouseIds = [...assignedWarehouses, ...hasLegacyWarehouse];

        if (allWarehouseIds.length === 0) {
            return res.json({ success: true, data: [] });
        }

        // Fetch warehouse details
        const warehouses = await Warehouse.find({ _id: { $in: allWarehouseIds } })
            .select('_id warehouseName location')
            .lean();

        return res.json({ success: true, data: warehouses });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.getWarehouseManagerSnapshot = async (req, res) => {
    try {
        // Support optional warehouseId parameter to view specific warehouse
        const requestedWarehouseId = req.query.warehouseId;
        const scoped = await buildQueryForWarehouseManager(req.user, requestedWarehouseId);
        if (scoped.error) {
            return res.status(scoped.error.code).json({ success: false, message: scoped.error.message });
        }
        const { warehouse } = scoped;
        await ensureInventorySeededFromWarehouseSupplies(warehouse, req.user);

        const [items, pendingRequests] = await Promise.all([
            InventoryItem.find({ warehouseId: warehouse._id }).select('availableQty entryPrice currentPrice'),
            SupplyRequest.countDocuments({ warehouseId: warehouse._id, status: 'pending' })
        ]);

        const inventoryValue = items.reduce((sum, item) => {
            const unitPrice = item.currentPrice || item.entryPrice || 0;
            return sum + (item.availableQty || 0) * unitPrice;
        }, 0);

        return res.json({
            success: true,
            data: {
                warehouse: {
                    _id: warehouse._id,
                    warehouseName: warehouse.warehouseName,
                    location: warehouse.location
                },
                snapshot: {
                    totalItems: items.length,
                    inventoryValue,
                    pendingRequests
                }
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.getInventoryItems = async (req, res) => {
    try {
        const scoped = await buildInventoryScope(req, { requireWarehouseForAdmin: false });
        if (scoped.error) {
            return res.status(scoped.error.code).json({ success: false, message: scoped.error.message });
        }
        const { warehouse } = scoped;
        if (warehouse) {
            await ensureInventorySeededFromWarehouseSupplies(warehouse, req.user);
        }

        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_LIMIT));
        const skip = (page - 1) * limit;

        const {
            search = '',
            sortBy = 'uid',
            sortOrder = 'asc',
            sort,
            category,
            status,
            minQty,
            maxQty,
            tags
        } = req.query;

        const query = warehouse ? { warehouseId: warehouse._id } : { companyId: req.user.companyId };
        const andConditions = [];

        if (search) {
            const regex = new RegExp(search.trim(), 'i');
            andConditions.push({ $or: [{ itemName: regex }, { uid: regex }, { category: regex }, { location: regex }] });
        }

        if (category) {
            const categoryList = String(category).split(',').map((c) => c.trim()).filter(Boolean);
            if (categoryList.length) query.category = { $in: categoryList };
        }

        if (tags) {
            const tagList = normalizeTags(tags);
            if (tagList.length) query.tags = { $in: tagList };
        }

        const qtyMin = minQty !== undefined ? toNumber(minQty, null) : null;
        const qtyMax = maxQty !== undefined ? toNumber(maxQty, null) : null;
        if (qtyMin !== null || qtyMax !== null) {
            query.availableQty = {};
            if (qtyMin !== null) query.availableQty.$gte = qtyMin;
            if (qtyMax !== null) query.availableQty.$lte = qtyMax;
        }

        if (status) {
            const statuses = String(status).split(',').map((v) => v.trim()).filter(Boolean);
            const statusOr = [];
            if (statuses.includes('out_of_stock')) {
                statusOr.push({ availableQty: { $lte: 0 } });
            }
            if (statuses.includes('below_min')) {
                statusOr.push({
                    $and: [
                        { availableQty: { $gt: 0 } },
                        { $expr: { $lt: ['$availableQty', '$minQty'] } }
                    ]
                });
            }
            if (statuses.includes('active')) {
                statusOr.push({
                    $and: [
                        { availableQty: { $gt: 0 } },
                        { $expr: { $gte: ['$availableQty', '$minQty'] } }
                    ]
                });
            }
            if (statusOr.length) {
                andConditions.push({ $or: statusOr });
            }
        }

        if (andConditions.length) {
            query.$and = andConditions;
        }

        const sortableColumns = new Set([
            'itemName',
            'uid',
            'category',
            'availableQty',
            'currentPrice',
            'entryPrice',
            'totalValue',
            'updatedAt'
        ]);
        const parsedSorts = String(sort || '')
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
            .map((entry) => {
                const [field, dir] = entry.split(':');
                const direction = String(dir || '').toLowerCase() === 'desc' ? -1 : 1;
                return sortableColumns.has(field) ? { field, direction } : null;
            })
            .filter(Boolean);

        if (parsedSorts.length === 0) {
            const fallbackField = sortableColumns.has(sortBy) ? sortBy : 'uid';
            const fallbackDirection = String(sortOrder).toLowerCase() === 'desc' ? -1 : 1;
            parsedSorts.push({ field: fallbackField, direction: fallbackDirection });
        }

        const hasTotalValueSort = parsedSorts.some((s) => s.field === 'totalValue');
        const dbSort = { isFavorite: -1 };
        for (const s of parsedSorts) {
            if (s.field === 'totalValue') {
                dbSort.totalValueComputed = s.direction;
            } else {
                dbSort[s.field] = s.direction;
            }
        }
        dbSort._id = 1;

        let items = [];
        if (hasTotalValueSort) {
            const pipeline = [
                { $match: query },
                {
                    $addFields: {
                        totalValueComputed: {
                            $multiply: [
                                '$availableQty',
                                { $ifNull: ['$currentPrice', { $ifNull: ['$entryPrice', 0] }] }
                            ]
                        }
                    }
                },
                { $sort: dbSort },
                { $skip: skip },
                { $limit: limit }
            ];
            items = await InventoryItem.aggregate(pipeline);
        } else {
            items = await InventoryItem.find(query)
                .sort(dbSort)
                .skip(skip)
                .limit(limit);
        }

        // Only fetch filters when explicitly requested (first load or filter drawer open)
        const shouldFetchFilters = req.query.includeFilters === 'true';

        let categories = [];
        let distinctTags = [];
        let filterConfig = DEFAULT_FILTER_CONFIG;

        if (shouldFetchFilters) {
            const filterQuery = warehouse ? { warehouseId: warehouse._id } : { companyId: req.user.companyId };
            [categories, distinctTags, filterConfig] = await Promise.all([
                InventoryItem.distinct('category', filterQuery),
                InventoryItem.distinct('tags', filterQuery),
                getCompanyFilterConfig(req.user)
            ]);
        } else {
            filterConfig = await getCompanyFilterConfig(req.user);
        }

        const total = await InventoryItem.countDocuments(query);

        return res.json({
            success: true,
            data: {
                items: items.map(buildClientItem),
                filters: {
                    config: filterConfig,
                    options: shouldFetchFilters ? {
                        categories: categories.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b))),
                        tags: distinctTags.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b))),
                        status: ['active', 'below_min', 'out_of_stock']
                    } : {
                        categories: [],
                        tags: [],
                        status: ['active', 'below_min', 'out_of_stock']
                    }
                },
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.getInventoryPricesByIds = async (req, res) => {
    try {
        const scoped = await buildInventoryScope(req, { requireWarehouseForAdmin: true });
        if (scoped.error) {
            return res.status(scoped.error.code).json({ success: false, message: scoped.error.message });
        }
        const { warehouse } = scoped;
        await ensureInventorySeededFromWarehouseSupplies(warehouse, req.user);

        const itemIds = Array.isArray(req.body.itemIds) ? req.body.itemIds : [];
        const normalizedIds = itemIds
            .map((id) => String(id || '').trim())
            .filter((id) => mongoose.isValidObjectId(id));

        if (normalizedIds.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const items = await InventoryItem.find({
            warehouseId: warehouse._id,
            _id: { $in: normalizedIds }
        }).select('_id itemName currentPrice entryPrice currency').lean();

        const data = items.map((item) => ({
            _id: item._id,
            itemName: item.itemName,
            currentPrice: item.currentPrice || 0,
            entryPrice: item.entryPrice || 0,
            currency: item.currency || '₹'
        }));

        return res.json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.getInventoryFilterConfig = async (req, res) => {
    try {
        if (!req.user?.companyId) {
            return res.status(400).json({ success: false, message: 'Company scope missing' });
        }
        const config = await getCompanyFilterConfig(req.user);
        return res.json({ success: true, data: config });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateInventoryFilterConfig = async (req, res) => {
    try {
        if (!['admin', 'company_owner'].includes(req.user?.role)) {
            return res.status(403).json({ success: false, message: 'Only admins can customize inventory filters' });
        }
        if (!req.user?.companyId) {
            return res.status(400).json({ success: false, message: 'Company scope missing' });
        }

        const incoming = req.body?.config || {};
        const nextConfig = mergeFilterConfig({
            category: { enabled: incoming?.category?.enabled },
            qtyRange: { enabled: incoming?.qtyRange?.enabled },
            tags: { enabled: incoming?.tags?.enabled },
            statusToggles: {
                enabled: incoming?.statusToggles?.enabled,
                options: {
                    active: incoming?.statusToggles?.options?.active,
                    below_min: incoming?.statusToggles?.options?.below_min,
                    out_of_stock: incoming?.statusToggles?.options?.out_of_stock
                }
            }
        });

        await Company.findByIdAndUpdate(
            req.user.companyId,
            { $set: { inventoryFilterConfig: nextConfig } },
            { new: true }
        );
        return res.json({ success: true, data: nextConfig });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.createInventoryItem = async (req, res) => {
    try {
        const scoped = await buildInventoryScope(req, { requireWarehouseForAdmin: true });
        if (scoped.error) {
            return res.status(scoped.error.code).json({ success: false, message: scoped.error.message });
        }
        const { warehouse } = scoped;
        const actorName = getUserDisplayName(req.user);

        const {
            itemName,
            category,
            location,
            uom,
            availableQty,
            minQty,
            maxQty,
            reorderQty,
            entryPrice,
            currentPrice,
            currency,
            tags
        } = req.body;

        if (!itemName || !uom) {
            return res.status(400).json({ success: false, message: 'itemName and uom are required' });
        }

        const normalizedItemName = normalizeItemNameForStore(itemName);
        if (!normalizedItemName || normalizedItemName.length < 3) {
            return res.status(400).json({ success: false, message: 'itemName must be at least 3 characters' });
        }

        const existingItems = await InventoryItem.find({ warehouseId: warehouse._id }).select('itemName');
        const duplicateByName = existingItems.find(
            (existingItem) => normalizeItemNameForMatch(existingItem.itemName) === normalizeItemNameForMatch(normalizedItemName)
        );
        if (duplicateByName) {
            return res.status(409).json({ success: false, message: 'Item exists already' });
        }

        const uid = req.body.uid || (await generateItemUid(warehouse._id));
        const duplicateUid = await InventoryItem.findOne({ warehouseId: warehouse._id, uid });
        if (duplicateUid) {
            return res.status(400).json({ success: false, message: `UID "${uid}" already exists` });
        }

        const item = await InventoryItem.create({
            warehouseId: warehouse._id,
            companyId: warehouse.companyId || req.user.companyId,
            uid,
            itemName: normalizedItemName,
            category: normalizeText(category || 'General') || 'General',
            location: normalizeText(location || ''),
            uom: (normalizeText(uom || 'PCS') || 'PCS').toUpperCase(),
            availableQty: Math.max(0, toNumber(availableQty, 0)),
            minQty: Math.max(0, toNumber(minQty, 0)),
            maxQty: Math.max(0, toNumber(maxQty, 0)),
            reorderQty: Math.max(0, toNumber(reorderQty, 0)),
            entryPrice: Math.max(0, toNumber(entryPrice, 0)),
            currentPrice: Math.max(0, toNumber(currentPrice, toNumber(entryPrice, 0))),
            currency: currency || '₹',
            tags: normalizeTags(tags),
            createdBy: req.user._id,
            updatedBy: req.user._id
        });

        syncInventoryItemToWarehouseSupply(warehouse, item);
        await persistWarehouseSupplies(warehouse);

        await ActivityLogger.logActivity(
            warehouse._id,
            'supply_added',
            req.user,
            {
                uid: item.uid,
                itemName: item.itemName,
                quantity: item.availableQty,
                unit: item.uom,
                category: item.category,
                currency: item.currency,
                entryPrice: item.entryPrice
            },
            `${actorName} created inventory item "${item.itemName}" (${item.uid})`,
            'Warehouse'
        );

        eventBus.emit('INVENTORY_ITEM_CREATED', {
            companyId: warehouse.companyId || req.user.companyId,
            warehouseId: warehouse._id,
            warehouseName: warehouse.warehouseName,
            itemId: item._id,
            itemName: item.itemName,
            referenceId: item._id
        });

        if (item.availableQty < item.minQty) {
            eventBus.emit('STOCK_LOW', {
                companyId: warehouse.companyId || req.user.companyId,
                warehouseId: warehouse._id,
                warehouseName: warehouse.warehouseName,
                itemId: item._id,
                itemName: item.itemName,
                availableQty: item.availableQty,
                minQty: item.minQty
            });
        }

        const io = getIO();
        if (io) io.to(`warehouse:${warehouse._id}`).emit('inventory:item_created', buildClientItem(item));

        return res.status(201).json({ success: true, data: buildClientItem(item) });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateInventoryItem = async (req, res) => {
    try {
        const scoped = await buildInventoryScope(req, { requireWarehouseForAdmin: true });
        if (scoped.error) {
            return res.status(scoped.error.code).json({ success: false, message: scoped.error.message });
        }
        const { warehouse } = scoped;
        const actorName = getUserDisplayName(req.user);

        const item = await InventoryItem.findOne({ _id: req.params.itemId, warehouseId: warehouse._id });
        if (!item) {
            return res.status(404).json({ success: false, message: 'Inventory item not found' });
        }

        const previousMinQty = item.minQty;
        const previousMaxQty = item.maxQty;
        const previousReorderQty = item.reorderQty;
        const previousLocation = normalizeText(item.location || '');
        const previousTags = JSON.stringify([...(item.tags || [])].sort());
        const previousItemName = item.itemName || '';
        const previousCategory = item.category || '';
        const previousUom = item.uom || '';

        const allowedFields = [
            'itemName',
            'category',
            'location',
            'uom',
            'minQty',
            'maxQty',
            'reorderQty',
            'tags',
            'isFavorite',
            'isActive',
            'currency'
        ];

        for (const field of allowedFields) {
            if (req.body[field] === undefined) continue;
            if (field === 'tags') {
                item.tags = normalizeTags(req.body.tags);
            } else if (['minQty', 'maxQty', 'reorderQty'].includes(field)) {
                item[field] = Math.max(0, toNumber(req.body[field], item[field]));
            } else if (field === 'isFavorite' || field === 'isActive') {
                item[field] = !!req.body[field];
            } else if (field === 'itemName') {
                const normalizedItemName = normalizeItemNameForStore(req.body.itemName);
                if (!normalizedItemName || normalizedItemName.length < 3) {
                    return res.status(400).json({ success: false, message: 'itemName must be at least 3 characters' });
                }
                const existingItems = await InventoryItem.find({
                    warehouseId: warehouse._id,
                    _id: { $ne: item._id }
                }).select('itemName');
                const duplicateByName = existingItems.find(
                    (existingItem) => normalizeItemNameForMatch(existingItem.itemName) === normalizeItemNameForMatch(normalizedItemName)
                );
                if (duplicateByName) {
                    return res.status(409).json({ success: false, message: 'Item exists already' });
                }
                item.itemName = normalizedItemName;
            } else if (field === 'uom') {
                item.uom = (normalizeText(req.body.uom || item.uom || 'PCS') || 'PCS').toUpperCase();
            } else if (field === 'category') {
                item.category = normalizeText(req.body.category || item.category || 'General') || 'General';
            } else if (field === 'location') {
                item.location = normalizeText(req.body.location || '');
            } else {
                item[field] = req.body[field];
            }
        }

        item.updatedBy = req.user._id;
        await item.save();

        syncInventoryItemToWarehouseSupply(warehouse, item);
        await persistWarehouseSupplies(warehouse);

        const nextLocation = normalizeText(item.location || '');
        const locationChanged = previousLocation !== nextLocation;
        const locationFrom = previousLocation || 'Unassigned';
        const locationTo = nextLocation || 'Unassigned';

        const minChanged = previousMinQty !== item.minQty;
        const maxChanged = previousMaxQty !== item.maxQty;
        const reorderChanged = previousReorderQty !== item.reorderQty;
        const minMaxChanged = minChanged || maxChanged;

        let message = `${actorName} updated inventory item "${item.itemName}" (${item.uid})`;
        let minMaxMessage = `${actorName} updated inventory thresholds for "${item.itemName}" (${item.uid})`;
        const reorderMessage = `${actorName} updated "${item.itemName}" reorder qty`;

        if (locationChanged) {
            message = `${actorName} updated location for "${item.itemName}" (${item.uid}) from "${locationFrom}" to "${locationTo}"`;
        } else if (minChanged && maxChanged && reorderChanged) {
            message = `${actorName} updated "${item.itemName}" min from ${previousMinQty} to ${item.minQty}, max from ${previousMaxQty} to ${item.maxQty}, and reorder qty from ${previousReorderQty} to ${item.reorderQty}`;
            minMaxMessage = `${actorName} updated "${item.itemName}" min from ${previousMinQty} to ${item.minQty} and max from ${previousMaxQty} to ${item.maxQty}`;
        } else if (minChanged && maxChanged) {
            message = `${actorName} updated "${item.itemName}" min from ${previousMinQty} to ${item.minQty} and max from ${previousMaxQty} to ${item.maxQty}`;
            minMaxMessage = message;
        } else if (minChanged && reorderChanged) {
            message = `${actorName} updated "${item.itemName}" min qty from ${previousMinQty} to ${item.minQty} and reorder qty from ${previousReorderQty} to ${item.reorderQty}`;
            minMaxMessage = `${actorName} updated "${item.itemName}" min qty from ${previousMinQty} to ${item.minQty}`;
        } else if (maxChanged && reorderChanged) {
            message = `${actorName} updated "${item.itemName}" max qty from ${previousMaxQty} to ${item.maxQty} and reorder qty from ${previousReorderQty} to ${item.reorderQty}`;
            minMaxMessage = `${actorName} updated "${item.itemName}" max qty from ${previousMaxQty} to ${item.maxQty}`;
        } else if (minChanged) {
            message = `${actorName} updated "${item.itemName}" min qty from ${previousMinQty} to ${item.minQty}`;
            minMaxMessage = message;
        } else if (maxChanged) {
            message = `${actorName} updated "${item.itemName}" max qty from ${previousMaxQty} to ${item.maxQty}`;
            minMaxMessage = message;
        } else if (reorderChanged) {
            message = reorderMessage;
        }

        if (minMaxChanged) {
            await ActivityLogger.logActivity(
                warehouse._id,
                'min_max_updated',
                req.user,
                {
                    uid: item.uid,
                    itemName: item.itemName,
                    oldMinQty: previousMinQty,
                    previousMinQty,
                    oldMaxQty: previousMaxQty,
                    previousMaxQty,
                    newMinQty: item.minQty,
                    newMaxQty: item.maxQty
                },
                minMaxMessage,
                'Warehouse'
            );
        }

        if (reorderChanged) {
            await ActivityLogger.logActivity(
                warehouse._id,
                'reorder_qty_updated',
                req.user,
                {
                    uid: item.uid,
                    itemName: item.itemName,
                    oldReorderQty: previousReorderQty,
                    previousReorderQty,
                    newReorderQty: item.reorderQty
                },
                reorderMessage,
                'Warehouse'
            );
        }

        const currentTags = JSON.stringify([...(item.tags || [])].sort());
        const tagsChanged = previousTags !== currentTags;
        const itemNameChanged = previousItemName !== (item.itemName || '');
        const categoryChanged = previousCategory !== (item.category || '');
        const uomChanged = previousUom !== (item.uom || '');
        const onlyTagsOrSilentChanged = tagsChanged && !itemNameChanged && !categoryChanged && !locationChanged && !uomChanged;

        if (!minMaxChanged && !reorderChanged && !onlyTagsOrSilentChanged) {
            await ActivityLogger.logActivity(
                warehouse._id,
                'supply_updated',
                req.user,
                {
                    uid: item.uid,
                    itemName: item.itemName
                },
                message,
                'Warehouse'
            );
        }

        const io = getIO();
        if (io) io.to(`warehouse:${warehouse._id}`).emit('inventory:item_updated', buildClientItem(item));

        return res.json({ success: true, data: buildClientItem(item) });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateItemPrice = async (req, res) => {
    try {
        const scoped = await buildInventoryScope(req, { requireWarehouseForAdmin: true });
        if (scoped.error) {
            return res.status(scoped.error.code).json({ success: false, message: scoped.error.message });
        }
        const { warehouse } = scoped;
        const actorName = getUserDisplayName(req.user);
        const item = await InventoryItem.findOne({ _id: req.params.itemId, warehouseId: warehouse._id });
        if (!item) {
            return res.status(404).json({ success: false, message: 'Inventory item not found' });
        }

        const newPrice = toNumber(req.body.currentPrice, null);
        if (newPrice === null || newPrice < 0) {
            return res.status(400).json({ success: false, message: 'Valid currentPrice is required' });
        }

        item.currentPrice = newPrice;
        if (req.body.currency) item.currency = req.body.currency;
        item.updatedBy = req.user._id;
        await item.save();

        syncInventoryItemToWarehouseSupply(warehouse, item);
        await persistWarehouseSupplies(warehouse);

        await ActivityLogger.logActivity(
            warehouse._id,
            'supply_updated',
            req.user,
            {
                uid: item.uid,
                itemName: item.itemName,
                currentPrice: item.currentPrice,
                currency: item.currency
            },
            `${actorName} updated current price for "${item.itemName}" (${item.uid})`,
            'Warehouse'
        );

        const io = getIO();
        if (io) io.to(`warehouse:${warehouse._id}`).emit('inventory:item_updated', buildClientItem(item));

        return res.json({ success: true, data: buildClientItem(item) });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.getItemPriceHistory = async (req, res) => {
    try {
        const { itemId } = req.params;
        if (!mongoose.isValidObjectId(itemId)) {
            return res.status(400).json({ success: false, message: 'Invalid itemId' });
        }

        const item = await InventoryItem.findById(itemId)
            .select('itemName uid warehouseId companyId currency currentPrice entryPrice')
            .lean();
        if (!item) {
            return res.status(404).json({ success: false, message: 'Inventory item not found' });
        }

        const user = req.user;
        if (!user?.companyId) {
            return res.status(403).json({ success: false, message: 'User is not mapped to a company' });
        }

        if (user.role === 'warehouse_manager') {
            const scoped = await buildQueryForWarehouseManager(user, item.warehouseId);
            if (scoped.error) {
                return res.status(scoped.error.code).json({ success: false, message: scoped.error.message });
            }
        } else if (!['admin', 'company_owner', 'supervisor'].includes(user.role)) {
            return res.status(403).json({ success: false, message: 'Inventory access denied' });
        }

        if (item.companyId && String(item.companyId) !== String(user.companyId)) {
            return res.status(403).json({ success: false, message: 'Item does not belong to your company' });
        }

        const monthsRaw = Number(req.query.months || 6);
        const months = Number.isFinite(monthsRaw) ? Math.max(1, Math.min(24, monthsRaw)) : 6;
        const since = new Date();
        since.setMonth(since.getMonth() - months);

        const historyLogs = await ActivityLog.find({
            companyId: item.companyId,
            targetModel: 'Warehouse',
            targetId: item.warehouseId,
            action: { $in: ['supply_added', 'supply_updated'] },
            timestamp: { $gte: since },
            $and: [
                { $or: [{ 'details.uid': item.uid }, { 'details.itemName': item.itemName }] },
                { $or: [{ 'details.currentPrice': { $exists: true } }, { 'details.entryPrice': { $exists: true } }] }
            ]
        }).sort({ timestamp: 1 }).lean();

        const history = historyLogs.map((log) => {
            const rawPrice = log?.details?.currentPrice ?? log?.details?.entryPrice ?? 0;
            return {
                price: Math.max(0, toNumber(rawPrice, 0)),
                currency: log?.details?.currency || item.currency || '₹',
                timestamp: log?.timestamp,
                source: log?.action,
                performedByName: log?.performedByName || ''
            };
        });

        return res.json({
            success: true,
            data: {
                itemId: item._id,
                itemName: item.itemName,
                uid: item.uid,
                months,
                history
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.deleteInventoryItem = async (req, res) => {
    try {
        const scoped = await buildInventoryScope(req, { requireWarehouseForAdmin: true });
        if (scoped.error) {
            return res.status(scoped.error.code).json({ success: false, message: scoped.error.message });
        }
        const { warehouse } = scoped;
        const actorName = getUserDisplayName(req.user);
        const item = await InventoryItem.findOne({ _id: req.params.itemId, warehouseId: warehouse._id });
        if (!item) {
            return res.status(404).json({ success: false, message: 'Inventory item not found' });
        }

        await InventoryItem.deleteOne({ _id: item._id });
        warehouse.supplies = warehouse.supplies.filter(
            (supply) => String(supply.itemName || '').trim().toLowerCase() !== String(item.itemName || '').trim().toLowerCase()
        );
        await persistWarehouseSupplies(warehouse);

        await ActivityLogger.logActivity(
            warehouse._id,
            'supply_deleted',
            req.user,
            {
                uid: item.uid,
                itemName: item.itemName
            },
            `${actorName} deleted inventory item "${item.itemName}" (${item.uid})`,
            'Warehouse'
        );

        const io = getIO();
        if (io) io.to(`warehouse:${warehouse._id}`).emit('inventory:item_deleted', { itemId: item._id.toString() });

        return res.json({ success: true, message: 'Inventory item deleted successfully' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.importInventoryItems = async (req, res) => {
    try {
        const scoped = await buildInventoryScope(req, { requireWarehouseForAdmin: true });
        if (scoped.error) {
            return res.status(scoped.error.code).json({ success: false, message: scoped.error.message });
        }
        const { warehouse } = scoped;
        const actorName = getUserDisplayName(req.user);

        const items = Array.isArray(req.body.items) ? req.body.items : [];
        if (!items.length) {
            return res.status(400).json({ success: false, message: 'items array is required' });
        }
        if (items.length > MAX_IMPORT_ITEMS) {
            return res.status(400).json({
                success: false,
                message: `Too many items. Maximum ${MAX_IMPORT_ITEMS} items allowed per import.`
            });
        }

        const existingItems = await InventoryItem.find({ warehouseId: warehouse._id });
        const byName = new Map(
            existingItems.map((item) => [normalizeItemNameForMatch(item.itemName), item])
        );

        let created = 0;
        let updated = 0;
        let skippedQuantityChanges = 0;
        const errors = [];

        for (let i = 0; i < items.length; i += 1) {
            const row = items[i] || {};
            const normalized = normalizeImportRow(row);

            if (!normalized.itemName) {
                errors.push({ row: i + 1, error: 'Missing itemName' });
                continue;
            }
            if (normalized.itemName.length < 3) {
                errors.push({ row: i + 1, error: 'itemName must be at least 3 characters' });
                continue;
            }
            if (normalized.maxQty > 0 && normalized.minQty > normalized.maxQty) {
                errors.push({ row: i + 1, error: 'Invalid stock levels: minQty cannot be greater than maxQty' });
                continue;
            }

            const existing = byName.get(normalized.itemMatchKey);
            if (existing) {
                if (
                    row.quantity !== undefined ||
                    row.availableQty !== undefined ||
                    row['Quantity'] !== undefined ||
                    row['Available Qty'] !== undefined
                ) {
                    skippedQuantityChanges += 1;
                }
                const effectiveQtyForPrice = Math.max(0, toNumber(existing.availableQty, 0));
                let effectivePrice = normalized.avgPrice || existing.currentPrice || existing.entryPrice || 0;
                if (effectiveQtyForPrice <= 0 && normalized.avgPrice > 0) {
                    effectivePrice = normalized.avgPrice;
                }

                existing.itemName = normalized.itemName;
                existing.category = normalized.category || existing.category;
                existing.location = normalized.location;
                existing.uom = normalized.uom || existing.uom;
                existing.minQty = normalized.minQty;
                existing.maxQty = normalized.maxQty;
                existing.reorderQty = normalized.reorderQty;
                existing.currentPrice = effectivePrice;
                existing.entryPrice = effectivePrice;
                existing.currency = normalized.currency || existing.currency;
                existing.tags = normalized.tags;
                existing.updatedBy = req.user._id;
                await existing.save();
                syncInventoryItemToWarehouseSupply(warehouse, existing);
                updated += 1;
                continue;
            }
            const createPrice = normalized.avgPrice;

            const createdItem = await InventoryItem.create({
                warehouseId: warehouse._id,
                companyId: warehouse.companyId || req.user.companyId,
                uid: normalized.uid || (await generateItemUid(warehouse._id)),
                itemName: normalized.itemName,
                category: normalized.category || 'General',
                location: normalized.location,
                uom: normalized.uom,
                availableQty: normalized.availableQty,
                minQty: normalized.minQty,
                maxQty: normalized.maxQty,
                reorderQty: normalized.reorderQty,
                entryPrice: createPrice,
                currentPrice: createPrice,
                currency: normalized.currency || req.body.currency || '₹',
                tags: normalized.tags,
                createdBy: req.user._id,
                updatedBy: req.user._id
            });
            syncInventoryItemToWarehouseSupply(warehouse, createdItem);
            byName.set(normalized.itemMatchKey, createdItem);
            created += 1;
        }

        await persistWarehouseSupplies(warehouse);

        await ActivityLogger.logActivity(
            warehouse._id,
            'supply_updated',
            req.user,
            { created, updated, skippedQuantityChanges, rows: items.length },
            `${actorName} imported inventory data (${created} created, ${updated} updated, ${skippedQuantityChanges} qty changes skipped)`,
            'Warehouse'
        );

        return res.json({
            success: true,
            message: 'Import processed successfully',
            data: { created, updated, skippedQuantityChanges, errors }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.exportInventoryItems = async (req, res) => {
    try {
        const scoped = await buildInventoryScope(req, { requireWarehouseForAdmin: true });
        if (scoped.error) {
            return res.status(scoped.error.code).json({ success: false, message: scoped.error.message });
        }
        const { warehouse } = scoped;

        const query = { warehouseId: warehouse._id };

        if (req.query.selectAll === 'true') {
            // Include search/filter params logic similar to list items
            const searchTerm = req.query.search ? normalizeText(req.query.search) : '';
            if (searchTerm) {
                const searchRegex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
                query.$or = [
                    { itemName: searchRegex },
                    { uid: searchRegex },
                    { category: searchRegex },
                    { location: searchRegex }
                ];
            }

            if (req.query.category) {
                const categories = req.query.category.split(',').map(c => normalizeText(c)).filter(Boolean);
                if (categories.length > 0) {
                    query.category = { $in: categories.map(c => new RegExp(`^${c}$`, 'i')) };
                }
            }

            if (req.query.tags) {
                const tags = req.query.tags.split(',').map(t => normalizeText(t)).filter(Boolean);
                if (tags.length > 0) {
                    query.tags = { $in: tags.map(t => new RegExp(`^${t}$`, 'i')) };
                }
            }

            if (req.query.minQty !== undefined || req.query.maxQty !== undefined) {
                query.availableQty = {};
                if (req.query.minQty !== undefined && req.query.minQty !== '') query.availableQty.$gte = Number(req.query.minQty);
                if (req.query.maxQty !== undefined && req.query.maxQty !== '') query.availableQty.$lte = Number(req.query.maxQty);
            }

            if (req.query.status) {
                const statusFilters = req.query.status.split(',').filter(Boolean);
                if (statusFilters.length > 0) {
                    const statusConditions = [];
                    if (statusFilters.includes('out_of_stock')) statusConditions.push({ availableQty: { $lte: 0 } });
                    if (statusFilters.includes('below_min')) {
                        statusConditions.push({
                            $expr: {
                                $and: [
                                    { $gt: ['$availableQty', 0] },
                                    { $lt: ['$availableQty', '$minQty'] },
                                    { $gt: ['$minQty', 0] }
                                ]
                            }
                        });
                    }
                    if (statusFilters.includes('active')) {
                        statusConditions.push({
                            $expr: {
                                $or: [
                                    { $gte: ['$availableQty', '$minQty'] },
                                    { $eq: ['$minQty', 0] }
                                ]
                            }
                        });
                        statusConditions.push({ availableQty: { $gt: 0 } });
                    }
                    if (statusConditions.length > 0) {
                        if (query.$and) {
                            query.$and.push({ $or: statusConditions });
                        } else {
                            query.$and = [{ $or: statusConditions }];
                        }
                    }
                }
            }

            // Apply excluded IDs
            const excludedIds = normalizeTags(req.query.excludedIds);
            if (excludedIds.length > 0) {
                const validObjectIds = excludedIds.filter(id => mongoose.isValidObjectId(id)).map(id => new mongoose.Types.ObjectId(id));
                if (validObjectIds.length > 0) {
                    query._id = { $nin: validObjectIds };
                }
            }
        } else {
            // Apply explicitly selected IDs
            const selectedIds = normalizeTags(req.query.selectedIds);
            if (selectedIds.length > 0) {
                query._id = { $in: selectedIds.filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id)) };
            }
        }

        const items = await InventoryItem.find(query).sort({ updatedAt: -1 });
        return res.json({
            success: true,
            data: items.map((item) => ({
                uid: item.uid,
                itemName: item.itemName,
                category: item.category,
                location: item.location,
                uom: item.uom,
                availableQty: item.availableQty,
                minQty: item.minQty,
                maxQty: item.maxQty,
                reorderQty: item.reorderQty,
                entryPrice: item.entryPrice,
                currentPrice: item.currentPrice,
                currency: item.currency,
                tags: item.tags,
                status: getStatusForItem(item)
            }))
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.getWarehouseManagerRequests = async (req, res) => {
    try {
        const requestedWarehouseId = req.query.warehouseId;
        const scoped = await buildQueryForWarehouseManager(req.user, requestedWarehouseId);
        if (scoped.error) {
            return res.status(scoped.error.code).json({ success: false, message: scoped.error.message });
        }
        const { warehouse } = scoped;

        const requests = await SupplyRequest.find({ warehouseId: warehouse._id })
            .sort({ createdAt: -1 })
            .populate('siteId', 'siteName');

        return res.json({
            success: true,
            data: requests.map((request) => ({
                ...request.toObject(),
                transferQuantity: request.transferredQuantity || 0
            }))
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.handleWarehouseManagerRequest = async (req, res) => {
    try {
        const scoped = await buildQueryForWarehouseManager(req.user);
        if (scoped.error) {
            return res.status(scoped.error.code).json({ success: false, message: scoped.error.message });
        }
        const { warehouse } = scoped;
        const actorName = getUserDisplayName(req.user);
        const { requestId, action } = req.params;

        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ success: false, message: 'Unsupported action' });
        }

        const supplyRequest = await SupplyRequest.findOne({ _id: requestId, warehouseId: warehouse._id });
        if (!supplyRequest) {
            return res.status(404).json({ success: false, message: 'Supply request not found' });
        }

        if (supplyRequest.status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Request already processed' });
        }

        if (action === 'reject') {
            supplyRequest.status = 'rejected';
            supplyRequest.handledBy = req.user._id;
            supplyRequest.handledByName = actorName;
            supplyRequest.handledAt = new Date();
            supplyRequest.reason = req.body.reason || 'Rejected by warehouse manager';
            await supplyRequest.save();

            await ActivityLogger.logActivity(
                warehouse._id,
                'supply_request_rejected',
                req.user,
                {
                    itemName: supplyRequest.itemName,
                    requestedQuantity: supplyRequest.requestedQuantity,
                    unit: supplyRequest.unit,
                    siteName: supplyRequest.siteName
                },
                `${actorName} rejected supply request for ${supplyRequest.itemName}`,
                'Warehouse'
            );

            return res.json({ success: true, message: 'Supply request rejected successfully' });
        }

        const transferQuantity = Math.max(0, toNumber(req.body.transferQuantity, 0));
        if (!transferQuantity) {
            return res.status(400).json({ success: false, message: 'transferQuantity is required for approval' });
        }

        let item = await InventoryItem.findOne({
            warehouseId: warehouse._id,
            itemName: new RegExp(`^${String(supplyRequest.itemName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
        });

        if (!item) {
            return res.status(404).json({ success: false, message: 'Inventory item not found in warehouse' });
        }

        if (item.availableQty < transferQuantity) {
            return res.status(400).json({
                success: false,
                message: `Insufficient quantity. Available: ${item.availableQty} ${item.uom}`
            });
        }

        const site = await Site.findById(supplyRequest.siteId);
        if (!site) {
            return res.status(404).json({ success: false, message: 'Site not found' });
        }

        item.availableQty -= transferQuantity;
        item.updatedBy = req.user._id;
        await item.save();

        if (item.availableQty < item.minQty) {
            eventBus.emit('STOCK_LOW', {
                companyId: warehouse.companyId || req.user.companyId,
                warehouseId: warehouse._id,
                warehouseName: warehouse.warehouseName,
                itemId: item._id,
                itemName: item.itemName,
                availableQty: item.availableQty,
                minQty: item.minQty
            });
        }

        syncInventoryItemToWarehouseSupply(warehouse, item);
        await persistWarehouseSupplies(warehouse);

        const siteSupplyIndex = site.supplies.findIndex(
            (s) => String(s.itemName || '').trim().toLowerCase() === String(supplyRequest.itemName || '').trim().toLowerCase()
        );

        if (siteSupplyIndex >= 0) {
            site.supplies[siteSupplyIndex].quantity = toNumber(site.supplies[siteSupplyIndex].quantity, 0) + transferQuantity;
            site.supplies[siteSupplyIndex].unit = item.uom;
            site.supplies[siteSupplyIndex].cost = item.currentPrice || item.entryPrice || 0;
            site.supplies[siteSupplyIndex].status = 'priced';
            site.supplies[siteSupplyIndex].pricedBy = req.user._id;
            site.supplies[siteSupplyIndex].pricedByName = actorName;
            site.supplies[siteSupplyIndex].pricedAt = new Date();
        } else {
            site.supplies.push({
                itemName: item.itemName,
                quantity: transferQuantity,
                cost: item.currentPrice || item.entryPrice || 0,
                unit: item.uom,
                status: 'priced',
                addedBy: req.user._id,
                addedByName: actorName,
                pricedBy: req.user._id,
                pricedByName: actorName,
                pricedAt: new Date()
            });
        }

        supplyRequest.status = 'approved';
        supplyRequest.transferredQuantity = transferQuantity;
        supplyRequest.handledBy = req.user._id;
        supplyRequest.handledByName = actorName;
        supplyRequest.handledAt = new Date();
        await Promise.all([supplyRequest.save(), site.save()]);

        await ActivityLogger.logActivity(
            warehouse._id,
            'supply_request_approved',
            req.user,
            {
                itemName: item.itemName,
                transferredQuantity: transferQuantity,
                unit: item.uom,
                remainingQty: item.availableQty
            },
            `${actorName} approved transfer of ${transferQuantity} ${item.uom} for "${item.itemName}"`,
            'Warehouse'
        );

        const ioApprove = getIO();
        if (ioApprove) ioApprove.to(`warehouse:${warehouse._id}`).emit('inventory:item_updated', buildClientItem(item));

        return res.json({
            success: true,
            message: 'Supply request approved successfully',
            data: {
                transferQuantity,
                remainingWarehouseQuantity: item.availableQty
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * POST /api/inventory/items/:itemId/request-quantity-change
 * Create a quantity change request
 */
exports.createQuantityChangeRequest = async (req, res) => {
    try {
        const { itemId } = req.params;
        const { updatedQuantity, reason, comments } = req.body;
        const userId = req.user._id;
        const userName = getUserDisplayName(req.user);
        const userRole = req.user.role || 'warehouse_manager';
        const companyId = req.user.companyId;

        // Validate input
        if (!updatedQuantity && updatedQuantity !== 0) {
            return res.status(400).json({ error: 'Updated quantity is required' });
        }

        if (Number(updatedQuantity) < 0) {
            return res.status(400).json({ error: 'Quantity cannot be negative' });
        }

        if (!reason || !reason.trim()) {
            return res.status(400).json({ error: 'Reason is required' });
        }

        // Fetch the inventory item
        const item = await InventoryItem.findById(itemId);
        if (!item) {
            return res.status(404).json({ error: 'Inventory item not found' });
        }

        // Verify the user has access to this warehouse
        const warehouseId = item.warehouseId;
        const warehouse = await Warehouse.findById(warehouseId);
        if (!warehouse) {
            return res.status(404).json({ error: 'Warehouse not found' });
        }

        if (warehouse.companyId.toString() !== companyId.toString()) {
            return res.status(403).json({ error: 'Not authorized to request changes for this warehouse' });
        }

        // ADMIN / COMPANY OWNER → DIRECT UPDATE (no approval flow)
        if (req.user.role === 'admin' || req.user.role === 'company_owner') {
            const oldQty = item.availableQty;
            const newQty = Number(updatedQuantity);

            item.availableQty = newQty;
            item.updatedBy = req.user._id;
            await item.save();

            syncInventoryItemToWarehouseSupply(warehouse, item);
            await persistWarehouseSupplies(warehouse);

            if (item.availableQty < item.minQty) {
                eventBus.emit('STOCK_LOW', {
                    companyId,
                    warehouseId: item.warehouseId,
                    warehouseName: warehouse.warehouseName,
                    itemId: item._id,
                    itemName: item.itemName,
                    availableQty: item.availableQty,
                    minQty: item.minQty
                });
            }

            await ActivityLogger.logActivity(
                item.warehouseId,
                'quantity_updated_directly',
                req.user,
                {
                    itemId: item._id,
                    itemName: item.itemName,
                    oldQty,
                    newQty
                },
                `${userName} directly updated quantity for "${item.itemName}" from ${oldQty} to ${newQty}`,
                'Warehouse'
            );

            const ioQtyUpdate = getIO();
            if (ioQtyUpdate) ioQtyUpdate.to(`warehouse:${item.warehouseId}`).emit('inventory:item_updated', buildClientItem(item));

            return res.status(200).json({
                success: true,
                message: 'Quantity updated successfully'
            });
        }

        // Create the quantity change request
        const quantityChangeRequest = new QuantityChangeRequest({
            itemId: item._id,
            itemName: item.itemName,
            warehouseId: warehouseId,
            companyId: companyId,
            requestedBy: userId,
            requestedByName: userName,
            requestedByRole: userRole,
            originalQuantity: item.availableQty,
            updatedQuantity: Number(updatedQuantity),
            reason: reason.trim(),
            status: 'pending',
            timeline: [
                approvalHelper.createApprovalTimeline('quantity_change_requested', userId, userName, {
                    originalQty: item.availableQty,
                    requestedQty: Number(updatedQuantity),
                    difference: Number(updatedQuantity) - item.availableQty,
                    reason: reason.trim(),
                    comments: comments || '',
                    note: `Requested quantity change from ${item.availableQty} to ${updatedQuantity}`
                })
            ]
        });

        await quantityChangeRequest.save();
        eventBus.emit('QUANTITY_CHANGE_REQUESTED', {
            companyId,
            requestedBy: userId,
            itemName: item.itemName,
            referenceId: quantityChangeRequest._id
        });

        const ioQtyReq = getIO();
        if (ioQtyReq) {
            ioQtyReq.to(`warehouse:${warehouseId}`).emit('quantity_change:status', {
                itemId: item._id,
                itemName: item.itemName,
                itemUid: item.uid,
                status: 'requested',
                originalQuantity: item.availableQty,
                requestedQuantity: Number(updatedQuantity),
                requestedByName: userName,
                requestId: quantityChangeRequest._id,
            });
        }

        // Log activity
        await ActivityLogger.logActivity(
            warehouseId,
            'quantity_change_requested',
            req.user,
            {
                itemId: item._id,
                itemName: item.itemName,
                itemUid: item.uid,
                originalQty: item.availableQty,
                requestedQty: Number(updatedQuantity),
                difference: Number(updatedQuantity) - item.availableQty,
                reason: reason.trim()
            },
            `${userName} requested quantity change for "${item.itemName}" from ${item.availableQty} to ${updatedQuantity}`,
            'Warehouse'
        );

        res.status(201).json({
            success: true,
            message: 'Quantity change request created successfully',
            request: quantityChangeRequest
        });
    } catch (error) {
        console.error('Error in createQuantityChangeRequest:', error);
        res.status(500).json({
            error: error.message || 'Failed to create quantity change request'
        });
    }
};

/**
 * POST /api/inventory/items/:itemId/request-item-detail-change
 * Request a change to item details (name, location, category, uom)
 * Admin/Company Owner: direct update. Warehouse Manager: creates approval request.
 */
exports.createItemDetailChangeRequest = async (req, res) => {
    try {
        const { itemId } = req.params;
        const { updatedItemName, updatedLocation, updatedCategory, updatedUom, reason } = req.body;
        const userId = req.user._id;
        const userName = getUserDisplayName(req.user);
        const userRole = req.user.role || 'warehouse_manager';
        const companyId = req.user.companyId;

        if (!reason || !String(reason).trim()) {
            return res.status(400).json({ error: 'Reason is required' });
        }

        // Fetch the inventory item
        const item = await InventoryItem.findById(itemId);
        if (!item) {
            return res.status(404).json({ error: 'Inventory item not found' });
        }

        // Verify access
        const warehouse = await Warehouse.findById(item.warehouseId);
        if (!warehouse) {
            return res.status(404).json({ error: 'Warehouse not found' });
        }
        if (warehouse.companyId.toString() !== companyId.toString()) {
            return res.status(403).json({ error: 'Not authorized to request changes for this warehouse' });
        }

        // Normalise incoming values — fall back to original if not provided
        const newItemName = (updatedItemName !== undefined && updatedItemName !== null) ? String(updatedItemName).trim() : item.itemName;
        const newLocation = (updatedLocation !== undefined && updatedLocation !== null) ? String(updatedLocation).trim() : (item.location || '');
        const newCategory = (updatedCategory !== undefined && updatedCategory !== null) ? String(updatedCategory).trim() : (item.category || '');
        const newUom = (updatedUom !== undefined && updatedUom !== null) ? String(updatedUom).trim() : (item.uom || '');

        // Ensure at least one field actually changed
        const changed = (
            newItemName !== item.itemName ||
            newLocation !== (item.location || '') ||
            newCategory !== (item.category || '') ||
            newUom !== (item.uom || '')
        );
        if (!changed) {
            return res.status(400).json({ error: 'At least one field must be different from the current value' });
        }

        // Build human-readable change description
        const changeLines = [];
        if (newItemName !== item.itemName) changeLines.push(`Item Name: ${item.itemName} → ${newItemName}`);
        if (newLocation !== (item.location || '')) changeLines.push(`Location: ${item.location || '(none)'} → ${newLocation}`);
        if (newCategory !== (item.category || '')) changeLines.push(`Category: ${item.category || '(none)'} → ${newCategory}`);
        if (newUom !== (item.uom || '')) changeLines.push(`UOM: ${item.uom || '(none)'} → ${newUom}`);
        const changeDescription = changeLines.join(' | ');

        // ADMIN / COMPANY OWNER → DIRECT UPDATE (no approval flow)
        if (req.user.role === 'admin' || req.user.role === 'company_owner') {
            if (newItemName) item.itemName = newItemName;
            if (newLocation !== undefined) item.location = newLocation;
            if (newCategory !== undefined) item.category = newCategory;
            if (newUom !== undefined) item.uom = newUom;
            item.updatedBy = userId;
            await item.save();

            await ActivityLogger.logActivity(
                item.warehouseId,
                'item_details_updated',
                req.user,
                {
                    itemId: item._id,
                    itemName: item.itemName,
                    uid: item.uid,
                    itemUid: item.uid,
                    changeDescription
                },
                `${userName} directly updated item details for "${item.itemName}" [${item.uid}]`,
                'Warehouse'
            );

            return res.status(200).json({
                success: true,
                message: 'Item details updated successfully'
            });
        }

        // WAREHOUSE MANAGER → Create approval request
        const detailChangeRequest = new ItemDetailChangeRequest({
            itemId: item._id,
            warehouseId: item.warehouseId,
            companyId,
            requestedBy: userId,
            requestedByName: userName,
            requestedByRole: userRole,
            originalItemName: item.itemName,
            originalLocation: item.location || '',
            originalCategory: item.category || '',
            originalUom: item.uom || '',
            updatedItemName: newItemName,
            updatedLocation: newLocation,
            updatedCategory: newCategory,
            updatedUom: newUom,
            reason: String(reason).trim(),
            status: 'pending',
            timeline: [
                approvalHelper.createApprovalTimeline('item_detail_change_requested', userId, userName, {
                    changeDescription,
                    reason: String(reason).trim(),
                    note: `Requested item detail change: ${changeDescription}`
                })
            ]
        });

        await detailChangeRequest.save();

        eventBus.emit('ITEM_DETAIL_CHANGE_REQUESTED', {
            companyId,
            requestedBy: userId,
            itemName: item.itemName,
            referenceId: detailChangeRequest._id
        });

        const ioDetailReq = getIO();
        if (ioDetailReq) {
            ioDetailReq.to(`warehouse:${item.warehouseId}`).emit('item_detail_change:status', {
                itemId: item._id,
                itemName: item.itemName,
                itemUid: item.uid,
                status: 'requested',
                changeDescription,
                requestedByName: userName,
                requestId: detailChangeRequest._id,
            });
        }

        await ActivityLogger.logActivity(
            item.warehouseId,
            'item_detail_change_requested',
            req.user,
            {
                itemId: item._id,
                itemName: item.itemName,
                itemUid: item.uid,
                changeDescription,
                reason: String(reason).trim()
            },
            `${userName} requested item detail change for "${item.itemName}": ${changeDescription}`,
            'Warehouse'
        );

        return res.status(201).json({
            success: true,
            message: 'Item detail change request created successfully',
            request: detailChangeRequest
        });
    } catch (error) {
        console.error('Error in createItemDetailChangeRequest:', error);
        res.status(500).json({
            error: error.message || 'Failed to create item detail change request'
        });
    }
};
