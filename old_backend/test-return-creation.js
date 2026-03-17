const mongoose = require('mongoose');
require('dotenv').config({ path: '.env' });
const { createReturn } = require('./controllers/return.controller');
const User = require('./models/User');
const Site = require('./models/Site');
const Warehouse = require('./models/Warehouse');

async function runTest() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/construction-management');

        const user = await User.findOne({ role: 'supervisor' });
        if (!user) {
            console.log('No supervisor found');
            return;
        }

        let site = await Site.findOne({ supervisors: user._id });
        if (!site) {
            site = await Site.findOne();
        }

        const warehouse = await Warehouse.findOne();

        if (!site || !warehouse) {
            console.log('Missing data:', 'site:', !!site, 'warehouse:', !!warehouse);
            return;
        }

        const itemName = site.supplies && site.supplies.length > 0 ? site.supplies[0].itemName : 'TestItem';
        const unit = site.supplies && site.supplies.length > 0 ? site.supplies[0].unit : 'pcs';

        const req = {
            user: user,
            body: {
                siteId: site._id.toString(),
                warehouseId: warehouse._id.toString(),
                sourceType: 'site_supply',
                returnReason: 'damaged',
                returnNotes: 'test notes',
                items: [{
                    itemName: itemName,
                    requestedReturnQty: 1,
                    uom: unit,
                    reasonForReturn: 'damaged',
                    itemRemarks: 'test remarks'
                }]
            }
        };

        const res = {
            status: function (code) {
                this.statusCode = code;
                return this;
            },
            json: function (data) {
                console.log('Server responded with:', this.statusCode);
                console.log(JSON.stringify(data, null, 2));
            }
        };

        console.log('Executing createReturn...');
        await createReturn(req, res);

    } catch (err) {
        console.error('Uncaught Exception:', err);
    } finally {
        mongoose.disconnect();
    }
}
runTest();
