const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cron = require('node-cron');

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}
console.log('🔐 JWT ENV CHECK:', {
    NODE_ENV: process.env.NODE_ENV,
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
});


// Import routes
const authRoutes = require('./routes/auth');
const siteRoutes = require('./routes/sites');
const warehouseRoutes = require('./routes/warehouses');
const staffRoutes = require('./routes/staff');
const attendanceRoutes = require('./routes/attendance');
const messageRoutes = require('./routes/messages');
const companyRoutes = require('./routes/company');
const contactRoutes = require("./routes/contact");
const inventoryRoutes = require('./routes/inventory');
const orderRoutes = require('./routes/orders');
const approvalRoutes = require('./routes/approvals');
const grnRoutes = require('./routes/grn');
const salesRoutes = require('./routes/sales');
const returnsRoutes = require('./routes/returns');
const jwt = require('jsonwebtoken');
const userRoutes = require('./routes/user.routes');
const notificationRoutes = require('./modules/notification/notification.routes');


const app = express();
const http = require('http');
const socketIo = require('socket.io');
const server = http.createServer(app);
const { setIO } = require('./core/socket');

// Initialize Socket.io
const io = socketIo(server, {
    cors: {
        origin: "*", // In production, replace with your frontend URL
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]
    }
});

// Make io accessible to our router
app.set('io', io);
setIO(io);

// Socket.io connection handler
// io.on('connection', (socket) => {
//     console.log('New client connected:', socket.id);

//     socket.on('disconnect', () => {
//         console.log('Client disconnected:', socket.id);
//     });
// });


io.on('connection', (socket) => {
    console.log('Client Connected:', socket.id);

    socket.on('join', (room) => {
        socket.join(room);
        console.log(`Socket ${socket.id} joined room: ${room}`);
    });

    socket.on('leave', (room) => {
        socket.leave(room);
        console.log(`Socket ${socket.id} left room: ${room}`);
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});





// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased limit for base64 images
app.use(express.urlencoded({ limit: '50mb', extended: true }));
if (String(process.env.DEBUG_REQUESTS || '').toLowerCase() === 'true'
    || String(process.env.DEBUG_REQUESTS || '') === '1') {
    app.use((req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
            const durationMs = Date.now() - start;
            console.log(`[REQ] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms)`);
        });
        next();
    });
}


// Routes
app.use('/api/auth', authRoutes);
app.use('/api/sites', siteRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/grn', grnRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/returns', returnsRoutes);
app.use('/api/users', userRoutes);
app.use('/api/notifications', notificationRoutes);
//app.use('/api/test', require('./routes/testpush'));

// Initialize notification event bridge
require('./modules/notification/notification.eventBridge');
require('./jobs/notification.worker');



// Basic route for testing
app.get('/', (req, res) => {
    res.json({
        message: 'Construction Management API is running!',
        endpoints: {
            auth: '/api/auth',
            sites: '/api/sites',
            warehouse: '/api/warehouses'
        }
    });
});

// Create default users
const createDefaultUsers = async () => {
    try {
        const User = require('./models/User');
        const Company = require('./models/Company');

        // Check if default company exists
        let company = await Company.findOne({ name: 'Default Construction Co' });

        if (!company) {
            company = new Company({
                name: 'Default Construction Co',
                email: 'contact@defaultconstruction.com',
                phoneNumber: '1234567890',
                gstin: '22AAAAA0000A1Z5',
                address: '123 Construction Ave, Builder City'
            });
            await company.save();
            console.log('✅ Default company created');
        }

        // Check if admin exists
        const adminExists = await User.findOne({ username: 'admin' });

        if (!adminExists) {
            // Let the pre-save hook handle password hashing
            const admin = new User({
                username: 'admin',
                password: 'admin123',  // Don't hash here - let the pre-save hook do it
                role: 'admin',
                email: 'admin@example.com',
                phoneNumber: '1234567890',
                firstName: 'System',
                lastName: 'Admin',
                companyId: company._id
            });
            await admin.save();
            console.log('✅ Default admin created: username=admin, password=admin123');
        } else {
            console.log('ℹ️  Admin user already exists');
        }

    } catch (error) {
        console.error('❌ Error creating default users:', error);
    }
};



// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/construction-management')
    .then(() => {
        console.log('✅ Connected to MongoDB');

        require('./jobs/checkoutReminder.cron');

        // Create default admin user
        createDefaultUsers();

        // Schedule daily cleanup of old attendance photos (runs at 2 AM every day)
        const Attendance = require('./models/Attendance');

        // Run cleanup on startup as well (in case server was down at 2 AM)
        const runCleanup = async () => {
            console.log('🧹 Running startup attendance photo cleanup...');
            try {
                const result = await Attendance.cleanupOldPhotos();
                console.log(`✅ Cleaned up ${result.modifiedCount} old photos`);

                const Message = require('./models/Message');
                const msgResult = await Message.cleanupOldVideos();
                console.log(`✅ Cleaned up ${msgResult.modifiedCount} old videos`);
            } catch (error) {
                console.error('❌ Error during startup cleanup:', error);
            }
        };
        runCleanup();

        cron.schedule('0 2 * * *', async () => {
            console.log('🧹 Running scheduled attendance photo cleanup...');
            try {
                const result = await Attendance.cleanupOldPhotos();
                console.log(`✅ Cleaned up ${result.modifiedCount} old photos`);

                const Message = require('./models/Message');
                const msgResult = await Message.cleanupOldVideos();
                console.log(`✅ Cleaned up ${msgResult.modifiedCount} old videos`);
            } catch (error) {
                console.error('❌ Error during scheduled cleanup:', error);
            }
        });
        console.log('⏰ Scheduled daily photo cleanup job (2 AM)');

        // Start server only after DB connection
        const PORT = process.env.PORT || 3000;
        server.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
            console.log(`📍 API URL: http://localhost:${PORT}`);
            console.log('📋 Available endpoints:');
            console.log('   GET  http://localhost:' + PORT + '/');
            console.log('   POST http://localhost:' + PORT + '/api/auth/login');
            console.log('   GET  http://localhost:' + PORT + '/api/sites');
            console.log('   POST http://localhost:' + PORT + '/api/warehouses');
            console.log('   POST http://localhost:' + PORT + '/api/staff');
            console.log('   POST http://localhost:' + PORT + '/api/attendance');
            console.log('💾 Body parser limit: 50mb (for attendance photos)');
        });
    })
    .catch(err => {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    });

// Handle unhandled routes
app.use('*', (req, res) => {
    console.log("404 handler called for:", req.method, req.originalUrl);
    res.status(404).json({
        success: false,
        message: `Route ${req.originalUrl} not found`
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('💥 Server Error:', err.message);
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: 'Something went wrong!',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});
