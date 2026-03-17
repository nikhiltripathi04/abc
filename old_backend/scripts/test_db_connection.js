const mongoose = require('mongoose');
require('dotenv').config();

const uri = process.env.MONGODB_URI;

console.log('---------------------------------------------------');
console.log('🧪 Testing MongoDB Connection');
console.log('---------------------------------------------------');

if (!uri) {
    console.error('❌ MONGODB_URI is missing in .env file');
    process.exit(1);
}

// Mask password for display
const maskedUri = uri.replace(/(:)([^:@]+)(@)/, '$1*****$3');
console.log(`📡 URI: ${maskedUri}`);

mongoose.connect(uri)
    .then(() => {
        console.log('✅ Connection Sucessful!');
        console.log('   The credentials in .env are CORRECT.');
        process.exit(0);
    })
    .catch(err => {
        console.error('❌ Connection Failed!');
        console.error('---------------------------------------------------');
        console.error('Error Name:', err.name);
        console.error('Error Code:', err.code);
        console.error('Error Message:', err.message);
        console.error('---------------------------------------------------');

        if (err.message.includes('bad auth')) {
            console.log('💡 DIAGNOSIS: Invalid Username or Password');
            console.log('   1. Check if the username "nikhiltripathi" is correct.');
            console.log('   2. Reset the password in MongoDB Atlas > Database Access.');
            console.log('   3. Update .env with the new password.');
        } else if (err.message.includes('ECONNREFUSED')) {
            console.log('💡 DIAGNOSIS: Server Unreachable');
            console.log('   Check connectivity or if the server is running.');
        } else if (err.code === 8000) {
            console.log('💡 DIAGNOSIS: Atlas Error (Likely IP not whitelisted or Bad Auth)');
            console.log('   Check MongoDB Atlas > Network Access > Allow current IP.');
        }

        process.exit(1);
    });
