/**
 * One-time migration: assign warehouseNumber to all existing warehouses
 * that don't have one yet.
 *
 * Run with:  node scripts/migrate_warehouse_numbers.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Warehouse = require('../models/Warehouse');

async function run() {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/construction-management');
    console.log('Connected to MongoDB');

    // Find warehouses without a warehouseNumber, ordered by creation date
    const warehouses = await Warehouse.find(
        { warehouseNumber: { $exists: false } }
    ).sort({ createdAt: 1 });

    if (warehouses.length === 0) {
        console.log('All warehouses already have a warehouseNumber. Nothing to do.');
        await mongoose.disconnect();
        return;
    }

    // Find the highest existing warehouseNumber so we don't collide
    const lastNumbered = await Warehouse.findOne(
        { warehouseNumber: { $exists: true, $ne: null } }
    ).sort({ warehouseNumber: -1 });

    let next = lastNumbered ? lastNumbered.warehouseNumber + 1 : 1;

    for (const wh of warehouses) {
        await Warehouse.findByIdAndUpdate(wh._id, { $set: { warehouseNumber: next } });
        console.log(`  ${wh.warehouseName} → warehouseNumber: ${next}`);
        next += 1;
    }

    console.log(`Done. Assigned numbers to ${warehouses.length} warehouse(s).`);
    await mongoose.disconnect();
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
