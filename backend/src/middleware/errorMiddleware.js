const notFoundHandler = (req, res) => {
  res.status(404).json({
    message: `Route not found: ${req.originalUrl}`,
  });
};

const errorHandler = (error, req, res, next) => {
  const statusCode = error.statusCode || 500;
  const isProduction = process.env.NODE_ENV === 'production';

  if (statusCode >= 500) {
    console.error('[API] Request failed.', {
      method: req.method,
      path: req.path,
      statusCode,
      errorName: error.name || 'Error',
    });
  }

  res.status(statusCode).json({
    message: isProduction && statusCode >= 500
      ? 'Something went wrong on the server.'
      : error.message || 'Something went wrong on the server.',
  });
};

module.exports = {
  notFoundHandler,
  errorHandler,
};
