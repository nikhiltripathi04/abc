const config = require('./env.config');

const ALLOWED_ORIGINS = config.cors.allowedOrigins;

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  optionsSuccessStatus: 200,
  maxAge: 86400,
};

module.exports = { corsOptions, ALLOWED_ORIGINS };