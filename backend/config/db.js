const mongoose = require('mongoose');
const config = require('./env.config');

const connectDB = async () => {
    try {
        const options = {
            maxPoolSize: 10,
            minPoolSize: 2,
            socketTimeoutMS: 45000,
            serverSelectionTimeoutMS: 5000,
            family: 4,
            retryWrites: true,
            retryReads: true,
        };

        await mongoose.connect(config.mongodb.uri, options);

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