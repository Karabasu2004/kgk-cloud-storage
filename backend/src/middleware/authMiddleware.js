const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/jwt');

const protect = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const tokenFromHeader = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = req.cookies?.token || tokenFromHeader;

  if (!token) {
    return res.status(401).json({
      message: 'Authentication required. Please log in first.',
    });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      message: 'Invalid or expired token.',
    });
  }
};

module.exports = {
  protect,
};
