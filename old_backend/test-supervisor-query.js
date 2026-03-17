const mongoose = require('mongoose');
require('dotenv').config({ path: 'backend/.env' });
const User = require('./models/User');
const Site = require('./models/Site');

async function testQuery() {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/conerp');
        const supervisorId = '6994623bf47889e5a1b4c40a';
        console.log('Finding sites for supervisor:', supervisorId);

        const supervisorSites = await Site.find({ supervisors: supervisorId });
        console.log('Found sites:', supervisorSites.length);

        if (supervisorSites.length > 0) {
            const adminIds = supervisorSites.map(s => s.adminId).filter(id => id);
            console.log('Mapped adminIds:', adminIds);
        } else {
            console.log('No sites found. Checking if user exists...');
            const user = await User.findById(supervisorId);
            console.log('User found:', !!user, user ? user.role : 'N/A');
        }
    } catch (err) {
        console.error('Test Failed:', err);
    } finally {
        mongoose.disconnect();
    }
}
testQuery();
