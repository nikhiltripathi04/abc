const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Warehouse = require('../models/Warehouse');
const InventoryItem = require('../models/InventoryItem');

const CSV_PATH = path.join(__dirname, '..', 'inventory_800_items_real_categories.csv');

function parseCsvLine(line) {
    const out = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (ch === ',' && !inQuotes) {
            out.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }
    out.push(current.trim());
    return out;
}

function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function parseBoolean(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'y'].includes(normalized);
}

async function main() {
    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI is missing in backend/.env');
    }

    const warehouseArg = process.argv[2] || 'warehouse1';
    await mongoose.connect(process.env.MONGODB_URI);

    const warehouses = await Warehouse.find().lean();
    const targetWarehouse = warehouses.find((w) => {
        const name = String(w.warehouseName || '').toLowerCase();
        return (
            name === String(warehouseArg).toLowerCase() ||
            name === 'warehouse1' ||
            name === 'warehouse 1' ||
            name === '1' ||
            String(w._id) === warehouseArg
        );
    });

    if (!targetWarehouse) {
        throw new Error(`Warehouse not found for "${warehouseArg}"`);
    }

    const csvRaw = fs.readFileSync(CSV_PATH, 'utf-8');
    const lines = csvRaw.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) {
        throw new Error('CSV does not contain data rows');
    }

    const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
    const idx = (name) => headers.indexOf(name.toLowerCase());

    const requiredHeaders = [
        'category',
        'uid',
        'item name',
        'available qty',
        'uom',
        'min',
        'max',
        'avg price',
        'reorder qty',
        'favourite'
    ];

    for (const h of requiredHeaders) {
        if (idx(h) === -1) {
            throw new Error(`Missing required CSV header: "${h}"`);
        }
    }

    const parsedItems = [];
    for (let i = 1; i < lines.length; i += 1) {
        const cols = parseCsvLine(lines[i]);
        const category = cols[idx('category')] || 'General';
        const uid = cols[idx('uid')];
        const itemName = cols[idx('item name')];
        const availableQty = Math.max(0, toNumber(cols[idx('available qty')], 0));
        const uom = cols[idx('uom')] || 'pcs';
        const minQty = Math.max(0, toNumber(cols[idx('min')], 0));
        const maxQty = Math.max(0, toNumber(cols[idx('max')], 0));
        const avgPrice = Math.max(0, toNumber(cols[idx('avg price')], 0));
        const reorderQty = Math.max(0, toNumber(cols[idx('reorder qty')], 0));
        const isFavorite = parseBoolean(cols[idx('favourite')]);

        if (!uid || !itemName) continue;

        parsedItems.push({
            warehouseId: targetWarehouse._id,
            companyId: targetWarehouse.companyId,
            uid,
            itemName: itemName.trim(),
            category: category.trim(),
            location: '',
            uom: uom.trim(),
            availableQty,
            minQty,
            maxQty,
            reorderQty,
            entryPrice: avgPrice,
            currentPrice: avgPrice,
            currency: '₹',
            tags: [],
            isFavorite,
            isActive: availableQty > 0
        });
    }

    if (parsedItems.length === 0) {
        throw new Error('No valid rows parsed from CSV');
    }

    // Upsert inventory items by UID for this warehouse.
    for (const item of parsedItems) {
        await InventoryItem.updateOne(
            { warehouseId: targetWarehouse._id, uid: item.uid },
            { $set: item },
            { upsert: true }
        );
    }

    // Sync warehouse embedded supplies to match seeded inventory for compatibility.
    const updatedWarehouse = await Warehouse.findById(targetWarehouse._id);
    updatedWarehouse.supplies = parsedItems.map((item) => ({
        itemName: item.itemName,
        quantity: item.availableQty,
        unit: item.uom,
        currency: item.currency,
        entryPrice: item.entryPrice,
        currentPrice: item.currentPrice
    }));
    await updatedWarehouse.save();

    console.log(
        JSON.stringify(
            {
                success: true,
                warehouseId: String(targetWarehouse._id),
                warehouseName: targetWarehouse.warehouseName,
                rowsParsed: parsedItems.length,
                message: 'CSV seeded into InventoryItem and Warehouse.supplies'
            },
            null,
            2
        )
    );

    await mongoose.disconnect();
}

main().catch(async (error) => {
    console.error(error.message || error);
    try {
        await mongoose.disconnect();
    } catch (_e) {
        // no-op
    }
    process.exit(1);
});
