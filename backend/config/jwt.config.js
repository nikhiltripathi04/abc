const config = require('./env.config');

const { secret, refreshSecret } = config.jwt;

if (!secret || !refreshSecret) {
  throw new Error('FATAL: JWT secrets must be defined in environment variables');
}

if (config.isProduction && (secret.length < 32 || refreshSecret.length < 32)) {
  throw new Error('JWT secrets must be at least 32 characters in production');
}

module.exports = {
  JWT_SECRET: secret,
  JWT_REFRESH_SECRET: refreshSecret,
  ACCESS_TOKEN_EXPIRES_IN: config.jwt.accessExpiresIn,
  REFRESH_TOKEN_EXPIRES_IN: config.jwt.refreshExpiresIn,
};