const jwt = require('jsonwebtoken');
const User = require('../modules/users/user.model');
const { JWT_SECRET } = require('../config/jwt.config');
const { AuthenticationError, AuthorizationError } = require('../utils/errors');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      console.log('Middleware: No token provided');
      return next(new AuthenticationError('No token provided'));
    }

    const debugAuth = String(process.env.DEBUG_AUTH || '').toLowerCase() === 'true'
      || String(process.env.DEBUG_AUTH || '') === '1';
    if (debugAuth) {
      console.log('--- Auth Middleware Debug ---');
      // console.log('Token:', token); // Commented to avoid clutter
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    if (debugAuth) {
      console.log('Decoded Payload:', JSON.stringify(decoded));
      const now = Math.floor(Date.now() / 1000);
      console.log(`Current Time (sec): ${now}`);
      console.log(`Token Exp (sec):    ${decoded.exp}`);
      console.log(`Time Remaining:     ${decoded.exp - now} seconds`);

      if (decoded.exp < now) {
        console.log('❌ Token IS EXPIRED (logic check)'); 
        // Note: jwt.verify usually throws specific error for this, but logging just in case
      } else {
        console.log('✅ Token is Valid');
      }
    }

    const user = await User.findById(decoded.userId);

    if (!user) {
      console.log('Middleware: User not found for ID:', decoded.userId);
      return next(new AuthenticationError('Invalid token'));
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Middleware Error:', error.message);
    return next(error);
  }
};

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return next(new AuthorizationError('Admin access required'));
  }
  next();
};

module.exports = { auth, adminOnly }; 
