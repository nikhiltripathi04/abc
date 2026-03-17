const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const connectDB = require('./config/db');

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const config = require('./config/env.config');
const logger = require('./utils/logger');
const { corsOptions } = require('./config/cors.config');
const sanitizationMiddleware = require('./middleware/sanitization.middleware');
const { errorHandler, notFoundHandler } = require('./middleware/error.middleware');
const { apiLimiter } = require('./middleware/rate-limit.middleware');

const http = require('http');
const socketIo = require('socket.io');
const authRoutes = require('./modules/auth/auth.routes');
const userRoutes = require('./modules/users/user.routes');
const companyRoutes = require('./modules/company/company.routes');
const createApp = () => {
    const app = express();
    const server = http.createServer(app);

    const io = socketIo(server, {
        cors: {
            origin: corsOptions.origin,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
            credentials: true,
        },
    });

    app.set('io', io);

    io.on('connection', (socket) => {
        logger.info('Client connected', { socketId: socket.id });

        socket.on('join', (room) => socket.join(room));
        socket.on('leave', (room) => socket.leave(room));
        socket.on('disconnect', () => logger.info('Client disconnected', { socketId: socket.id }));
    });

    app.use(helmet());
    app.use(morgan('combined', { stream: logger.stream }));
    app.use(cors(corsOptions));
    app.use(sanitizationMiddleware);
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ limit: '50mb', extended: true }));
    app.use('/api', apiLimiter);

    if (String(process.env.DEBUG_REQUESTS || '').toLowerCase() === 'true'
        || String(process.env.DEBUG_REQUESTS || '') === '1') {
        app.use((req, res, next) => {
            const start = Date.now();
            res.on('finish', () => {
                const durationMs = Date.now() - start;
                logger.debug('Request debug', { method: req.method, path: req.originalUrl, status: res.statusCode, durationMs });
            });
            next();
        });
    }

    app.get('/', (req, res) => {
        res.json({
            message: 'Construction Management API is running!',
            endpoints: {
                auth: '/api/auth',
                users: '/api/users',
                company: '/api/company',
            },
        });
    });

    app.use('/api/auth', authRoutes);
    app.use('/api/users', userRoutes);
    app.use('/api/company', companyRoutes);
    app.use('*', notFoundHandler);
    app.use(errorHandler);

    return { app, server };
};

const { app, server } = createApp();

let isStarted = false;
const startServer = async () => {
    if (isStarted) {
        return server;
    }

    await connectDB();

    await new Promise((resolve) => {
        server.listen(config.port, () => {
            logger.info(`Server running on port ${config.port}`);
            logger.info(`API URL: http://localhost:${config.port}`);
            isStarted = true;
            resolve();
        });
    });

    return server;
};

if (require.main === module) {
    startServer().catch((error) => {
        logger.error('Failed to start server', { error: error.message });
        process.exit(1);
    });
}

module.exports = { app, server, startServer };