const rateLimit = require('express-rate-limit');
const RedisStoreImport = require('rate-limit-redis');
const Redis = require('ioredis');
const config = require('../config/env.config');
const logger = require('../utils/logger');

const RedisStore = RedisStoreImport.RedisStore || RedisStoreImport.default || RedisStoreImport;

const createStore = (prefix) => {
  if (!config.redis.url) {
    return undefined;
  }

  const redis = new Redis(config.redis.url, {
    maxRetriesPerRequest: 3,
    // Allow commands to queue briefly during initial connect to avoid startup race errors.
    enableOfflineQueue: true,
  });

  redis.on('error', (error) => {
    logger.warn('Rate limiter Redis unavailable, using in-memory store', { error: error.message });
  });

  return new RedisStore({
    sendCommand: async (...args) => {
      if (redis.status !== 'ready') {
        try {
          await redis.connect();
        } catch (error) {
          // Connection may already be in progress/open; command execution below will determine success.
        }
      }
      return redis.call(...args);
    },
    prefix,
  });
};

// Strict rate limiting for authentication endpoints
const authLimiter = rateLimit({
  store: createStore('rl:auth:'),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many login attempts. Please try again after 15 minutes.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins
  passOnStoreError: true,
});

// General API rate limiting
const apiLimiter = rateLimit({
  store: createStore('rl:api:'),
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
});

module.exports = { authLimiter, apiLimiter };
