const validator = require('validator');

// Input sanitization middleware
const sanitizeInput = (req, res, next) => {
  // Sanitize string inputs
  const sanitizeString = (obj) => {
    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        obj[key] = validator.escape(obj[key].trim());
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitizeString(obj[key]);
      }
    }
  };

  // Sanitize request body
  if (req.body) {
    sanitizeString(req.body);
  }

  // Sanitize query parameters
  if (req.query) {
    sanitizeString(req.query);
  }

  // Sanitize URL parameters
  if (req.params) {
    sanitizeString(req.params);
  }

  next();
};

// Validate and sanitize document verification input
const sanitizeDocumentVerification = (req, res, next) => {
  const { driverId, documentType } = req.params;
  const { comments, rejectionReason } = req.body;

  // Validate driver ID format
  if (driverId && !validator.isAlphanumeric(driverId)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_DRIVER_ID_FORMAT',
        message: 'Driver ID contains invalid characters'
      }
    });
  }

  // Validate document type format
  if (documentType && !validator.isAlpha(documentType.replace(/([A-Z])/g, '_$1').toLowerCase())) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_DOCUMENT_TYPE_FORMAT',
        message: 'Document type contains invalid characters'
      }
    });
  }

  // Sanitize comments and rejection reason
  if (comments) {
    req.body.comments = validator.escape(comments.trim());
  }
  
  if (rejectionReason) {
    req.body.rejectionReason = validator.escape(rejectionReason.trim());
  }

  next();
};

module.exports = {
  sanitizeInput,
  sanitizeDocumentVerification
};
