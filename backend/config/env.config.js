const Joi = require('joi');

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const runtimeEnv = process.env.NODE_ENV || 'development';
const isProduction = runtimeEnv === 'production';
const devJwtSecret = 'dev_jwt_secret_change_me_at_least_32_chars';
const devRefreshSecret = 'dev_jwt_refresh_secret_change_me_32_chars';

const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
  MONGODB_URI: Joi.string().uri().default('mongodb://localhost:27017/construction-management'),
  REDIS_URL: Joi.string().uri().allow('').optional(),
  JWT_SECRET: isProduction
    ? Joi.string().min(32).required()
    : Joi.string().min(16).default(devJwtSecret),
  JWT_REFRESH_SECRET: isProduction
    ? Joi.string().min(32).required()
    : Joi.string().min(16).default(devRefreshSecret),
  ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000,http://localhost:3001'),
  DEBUG_REQUESTS: Joi.alternatives().try(Joi.boolean(), Joi.string()).optional(),
}).unknown();

const { error, value } = envSchema.validate(process.env, {
  abortEarly: false,
  convert: true,
});

if (error) {
  throw new Error(`Environment validation error: ${error.message}`);
}

if (!isProduction) {
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = value.JWT_SECRET;
    console.warn('[env] JWT_SECRET is missing; using development fallback secret.');
  }

  if (!process.env.JWT_REFRESH_SECRET) {
    process.env.JWT_REFRESH_SECRET = value.JWT_REFRESH_SECRET;
    console.warn('[env] JWT_REFRESH_SECRET is missing; using development fallback secret.');
  }
}

const allowedOrigins = String(value.ALLOWED_ORIGINS)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

module.exports = {
  env: value.NODE_ENV,
  isProduction: value.NODE_ENV === 'production',
  isTest: value.NODE_ENV === 'test',
  port: value.PORT,
  mongodb: {
    uri: value.MONGODB_URI,
  },
  redis: {
    url: value.REDIS_URL,
  },
  jwt: {
    secret: value.JWT_SECRET,
    refreshSecret: value.JWT_REFRESH_SECRET,
    accessExpiresIn: '15m',
    refreshExpiresIn: '60d',
  },
  cors: {
    allowedOrigins,
  },
};