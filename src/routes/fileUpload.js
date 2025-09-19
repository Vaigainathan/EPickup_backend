const express = require('express');
const multer = require('multer');
const FileUploadService = require('../services/fileUploadService');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
const fileUploadService = new FileUploadService();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
    files: 1 // Only allow 1 file at a time
  },
  fileFilter: (req, file, cb) => {
    // Check file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and PDF files are allowed.'), false);
    }
  }
});

/**
 * @route POST /api/file-upload/upload
 * @desc Upload a driver document
 * @access Private (Driver)
 */
router.post('/upload', 
  requireRole(['driver']),
  upload.single('document'),
  async (req, res) => {
    try {
      const { documentType, documentUrl, documentNumber } = req.body;
      const driverId = req.user.uid;

      if (!documentType) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'DOCUMENT_TYPE_REQUIRED',
            message: 'Document type is required'
          }
        });
      }

      // Handle direct file upload
      if (req.file) {
        // Validate file before processing
        const validation = fileUploadService.validateFile(req.file, documentType);
        if (!validation.isValid) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'FILE_VALIDATION_FAILED',
              message: 'File validation failed',
              details: validation.errors,
              warnings: validation.warnings
            }
          });
        }

        // Upload document
        const result = await fileUploadService.uploadDocument(
          req.file,
          documentType,
          driverId,
          {
            originalName: req.file.originalname,
            uploadedBy: driverId,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
          }
        );

        res.status(201).json(result);
      } 
      // Handle document URL registration (from mobile app)
      else if (documentUrl) {
        const result = await fileUploadService.registerDocumentFromUrl(
          driverId,
          documentType,
          documentUrl,
          documentNumber
        );

        res.status(201).json(result);
      } else {
        return res.status(400).json({
          success: false,
          error: {
            code: 'NO_FILE_OR_URL_PROVIDED',
            message: 'Either a file or document URL must be provided'
          }
        });
      }

    } catch (error) {
      console.error('Document upload error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'UPLOAD_FAILED',
          message: error.message
        }
      });
    }
  }
);

/**
 * @route GET /api/file-upload/documents/:driverId
 * @desc Get driver's documents
 * @access Private (Driver, Admin)
 */
router.get('/documents/:driverId', 
  requireRole(['driver', 'admin']),
  async (req, res) => {
    try {
      const { driverId } = req.params;
      const { documentType } = req.query;

      // Drivers can only access their own documents
      if (req.user.role === 'driver' && req.user.uid !== driverId) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCESS_DENIED',
            message: 'You can only access your own documents'
          }
        });
      }

      const documents = await fileUploadService.getDriverDocuments(driverId, documentType);

      res.json({
        success: true,
        data: {
          documents,
          total: documents.length
        }
      });

    } catch (error) {
      console.error('Get documents error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'DOCUMENTS_RETRIEVAL_FAILED',
          message: error.message
        }
      });
    }
  }
);

/**
 * @route GET /api/file-upload/documents
 * @desc Get current user's documents
 * @access Private (Driver)
 */
router.get('/documents', 
  requireRole(['driver']),
  async (req, res) => {
    try {
      const driverId = req.user.uid;
      const { documentType } = req.query;

      const documents = await fileUploadService.getDriverDocuments(driverId, documentType);

      res.json({
        success: true,
        data: {
          documents,
          total: documents.length
        }
      });

    } catch (error) {
      console.error('Get documents error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'DOCUMENTS_RETRIEVAL_FAILED',
          message: error.message
        }
      });
    }
  }
);

/**
 * @route POST /api/file-upload/verify/:documentId
 * @desc Verify a document (Admin only)
 * @access Private (Admin)
 */
router.post('/verify/:documentId', 
  requireRole(['admin']),
  async (req, res) => {
    try {
      const { documentId } = req.params;
      const { status, comments, rejectionReason } = req.body;
      const adminId = req.user.uid;

      if (!status || !['verified', 'rejected'].includes(status)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_STATUS',
            message: 'Status must be either "verified" or "rejected"'
          }
        });
      }

      if (status === 'rejected' && !rejectionReason) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'REJECTION_REASON_REQUIRED',
            message: 'Rejection reason is required when rejecting a document'
          }
        });
      }

      const result = await fileUploadService.verifyDocument(
        documentId,
        adminId,
        status,
        comments,
        rejectionReason
      );

      res.json(result);

    } catch (error) {
      console.error('Document verification error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'VERIFICATION_FAILED',
          message: error.message
        }
      });
    }
  }
);

/**
 * @route DELETE /api/file-upload/documents/:documentId
 * @desc Delete a document
 * @access Private (Admin)
 */
router.delete('/documents/:documentId', 
  requireRole(['admin']),
  async (req, res) => {
    try {
      const { documentId } = req.params;
      const adminId = req.user.uid;

      const result = await fileUploadService.deleteDocument(documentId, adminId);

      res.json(result);

    } catch (error) {
      console.error('Document deletion error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'DELETION_FAILED',
          message: error.message
        }
      });
    }
  }
);

/**
 * @route GET /api/file-upload/verification-queue
 * @desc Get documents pending verification
 * @access Private (Admin)
 */
router.get('/verification-queue', 
  requireRole(['admin']),
  async (req, res) => {
    try {
      const { limit = 20, offset = 0, documentType, driverId } = req.query;

      const queue = await fileUploadService.getVerificationQueue(
        { documentType, driverId },
        parseInt(limit),
        parseInt(offset)
      );

      res.json({
        success: true,
        data: queue
      });

    } catch (error) {
      console.error('Get verification queue error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'QUEUE_RETRIEVAL_FAILED',
          message: error.message
        }
      });
    }
  }
);

/**
 * @route GET /api/file-upload/statistics
 * @desc Get document statistics
 * @access Private (Admin)
 */
router.get('/statistics', 
  requireRole(['admin']),
  async (req, res) => {
    try {
      const { documentType, status, verificationStatus } = req.query;

      const filters = {};
      if (documentType) filters.documentType = documentType;
      if (status) filters.status = status;
      if (verificationStatus) filters.verificationStatus = verificationStatus;

      const stats = await fileUploadService.getDocumentStatistics(filters);

      res.json({
        success: true,
        data: stats
      });

    } catch (error) {
      console.error('Get statistics error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'STATISTICS_RETRIEVAL_FAILED',
          message: error.message
        }
      });
    }
  }
);

/**
 * @route POST /api/file-upload/cleanup
 * @desc Clean up expired documents
 * @access Private (Admin)
 */
router.post('/cleanup', 
  requireRole(['admin']),
  async (req, res) => {
    try {
      const { maxAge } = req.body;
      const maxAgeMs = maxAge ? parseInt(maxAge) * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;

      const result = await fileUploadService.cleanupExpiredDocuments(maxAgeMs);

      res.json(result);

    } catch (error) {
      console.error('Document cleanup error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'CLEANUP_FAILED',
          message: error.message
        }
      });
    }
  }
);

/**
 * @route GET /api/file-upload/signed-url/:documentId
 * @desc Generate signed URL for secure document access
 * @access Private (Driver, Admin)
 */
router.get('/signed-url/:documentId', 
  requireRole(['driver', 'admin']),
  async (req, res) => {
    try {
      const { documentId } = req.params;
      const { expirationTime = 3600 } = req.query;

      // Get document details
      const documents = await fileUploadService.getDriverDocuments();
      const document = documents.find(doc => doc.id === documentId);

      if (!document) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'DOCUMENT_NOT_FOUND',
            message: 'Document not found'
          }
        });
      }

      // Check access permissions
      if (req.user.role === 'driver' && document.driverId !== req.user.uid) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCESS_DENIED',
            message: 'You can only access your own documents'
          }
        });
      }

      const signedUrl = await fileUploadService.generateSignedUrl(
        document.uploadDetails.filePath,
        parseInt(expirationTime)
      );

      res.json({
        success: true,
        data: {
          signedUrl,
          expiresIn: parseInt(expirationTime),
          documentId
        }
      });

    } catch (error) {
      console.error('Generate signed URL error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'SIGNED_URL_GENERATION_FAILED',
          message: error.message
        }
      });
    }
  }
);

/**
 * @route POST /api/file-upload/validate
 * @desc Validate a file before upload
 * @access Private (Driver)
 */
router.post('/validate', 
  requireRole(['driver']),
  upload.single('document'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'NO_FILE_PROVIDED',
            message: 'No file provided'
          }
        });
      }

      const { documentType } = req.body;

      if (!documentType) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'DOCUMENT_TYPE_REQUIRED',
            message: 'Document type is required'
          }
        });
      }

      const validation = fileUploadService.validateFile(req.file, documentType);

      res.json({
        success: true,
        data: validation
      });

    } catch (error) {
      console.error('File validation error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: error.message
        }
      });
    }
  }
);

// Health check moved to server.js to avoid authentication middleware

module.exports = router;
