const Redis = require('ioredis');
const config = require('../config/env.config');
const logger = require('../utils/logger');

class CacheService {
  constructor() {
    this.DEFAULT_TTL = 3600;
    this.client = null;

    if (!config.redis.url) {
      const message = 'REDIS_URL is not configured, cache service will run in no-op mode';
      if (config.isProduction) {
        logger.warn(message);
      } else {
        logger.info(message);
      }
      return;
    }

    this.client = new Redis(config.redis.url, {
      retryStrategy: (times) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
    });

    this.client.on('connect', () => logger.info('Redis connected'));
    this.client.on('error', (err) => logger.warn('Redis unavailable, cache skipped', { error: err.message }));
  }

  isEnabled() {
    return Boolean(this.client);
  }

  async get(key) {
    if (!this.client) return null;
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.warn('Cache get failed', { key, error: error.message });
      return null;
    }
  }

  async set(key, value, ttl = this.DEFAULT_TTL) {
    if (!this.client) return false;
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttl);
      return true;
    } catch (error) {
      logger.warn('Cache set failed', { key, error: error.message });
      return false;
    }
  }

  async del(key) {
    if (!this.client) return false;
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      logger.warn('Cache delete failed', { key, error: error.message });
      return false;
    }
  }

  async invalidatePattern(pattern) {
    if (!this.client) return false;

    try {
      let cursor = '0';
      const matchedKeys = [];

      do {
        const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys && keys.length) {
          matchedKeys.push(...keys);
        }
      } while (cursor !== '0');

      if (matchedKeys.length > 0) {
        await this.client.del(matchedKeys);
      }

      return true;
    } catch (error) {
      logger.warn('Cache pattern invalidation failed', { pattern, error: error.message });
      return false;
    }
  }

  async wrap(key, fetcher, ttl = this.DEFAULT_TTL) {
    const cached = await this.get(key);
    if (cached !== null) {
      return cached;
    }

    const data = await fetcher();
    if (data !== null && data !== undefined) {
      await this.set(key, data, ttl);
    }
    return data;
  }
}

module.exports = new CacheService();