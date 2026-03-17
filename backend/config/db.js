const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const mongoURI =
            process.env.MONGODB_URI || 'mongodb://localhost:27017/construction-management';

        await mongoose.connect(mongoURI);

        console.log('✅ MongoDB connected successfully');

        // CONNECTION EVENT LISTENERS
        mongoose.connection.on('connected', () => {
            console.log('📦 MongoDB connection established');
        });

        mongoose.connection.on('error', (err) => {
            console.error('❌ MongoDB connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            console.warn('⚠️ MongoDB disconnected');
        });

        // Handle app termination (important for production)
        process.on('SIGINT', async () => {
            await mongoose.connection.close();
            console.log('🔌 MongoDB connection closed due to app termination');
            process.exit(0);
        });

    } catch (error) {
        console.error('❌ MongoDB connection failed:', error);
        process.exit(1);
    }
};

module.exports = connectDB;