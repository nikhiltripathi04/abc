const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cron = require('node-cron');
const connectDB = require('./config/db');

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
console.log('🔐 JWT ENV CHECK:', {
    NODE_ENV: process.env.NODE_ENV,
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
});

const app = express();
const http = require('http');
const socketIo = require('socket.io');
const authRoutes = require('./modules/auth/auth.routes');
const userRoutes = require('./modules/users/user.routes');
const companyRoutes = require('./modules/company/company.routes');
const server = http.createServer(app);
// const { setIO } = require('./core/socket');

// INITIALIZE SOCKET.IO
const io = socketIo(server, {
    cors: {
        origin: "*", // In production, replace with your frontend URL
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]
    }
});

// MAKE IO ACCESSIBLE TO OUR ROUTER
app.set('io', io);
// setIO(io);

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

// MIDDLEWARE
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

// BASIC ROUTE FOR TESTING
app.get('/', (req, res) => {
    res.json({
        message: 'Construction Management API is running!',
        endpoints: {
            auth: '/api/auth',
            users: '/api/users',
            company: '/api/company'
        }
    });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/company', companyRoutes);

// CONNECT DATABASE
connectDB();

// START SERVER
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 API URL: http://localhost:${PORT}`);
    console.log('📋 Available endpoints:');
    console.log('   GET  http://localhost:' + PORT + '/');
    console.log('   POST http://localhost:' + PORT + '/api/auth/login');
    console.log('   GET  http://localhost:' + PORT + '/api/auth/me');
    console.log('   POST http://localhost:' + PORT + '/api/users/save-push-token');
    console.log('   POST http://localhost:' + PORT + '/api/company/register');
    console.log('   POST http://localhost:' + PORT + '/api/company/create-admin');
    console.log('   GET  http://localhost:' + PORT + '/api/company/admins');
    console.log('   DELETE http://localhost:' + PORT + '/api/company/admins/:id');
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