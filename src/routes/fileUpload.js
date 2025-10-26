const express = require('express');
const multer = require('multer');
const { getStorage } = require('firebase-admin/storage');
const { getFirestore } = require('firebase-admin/firestore');
const router = express.Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

/**
 * @route POST /api/file-upload/driver-document
 * @desc Upload driver document via backend proxy
 * @access Private (Driver)
 */
router.post('/driver-document', upload.single('document'), async (req, res) => {
  try {
    console.log('📤 [BACKEND PROXY] Driver document upload request received');
    
    const { driverId, documentType } = req.body;
    const file = req.file;

    // Validate file
    if (!file) {
      console.log('❌ [BACKEND PROXY] No file provided');
      return res.status(400).json({
        success: false,
        error: 'No file provided'
      });
    }

    // Validate required fields
    if (!driverId || !documentType) {
      console.log('❌ [BACKEND PROXY] Missing required fields:', { driverId, documentType });
      return res.status(400).json({
        success: false,
        error: 'Driver ID and document type are required'
      });
    }

    // Validate document type - Support both formats for compatibility
    const validDocumentTypes = ['driving_license', 'profile_photo', 'aadhaar_card', 'bike_insurance', 'rc_book'];
    const validDocumentTypesCamel = ['drivingLicense', 'profilePhoto', 'aadhaarCard', 'bikeInsurance', 'rcBook'];
    
    if (!validDocumentTypes.includes(documentType) && !validDocumentTypesCamel.includes(documentType)) {
      console.log('❌ [BACKEND PROXY] Invalid document type:', documentType);
      return res.status(400).json({
        success: false,
        error: `Invalid document type. Must be one of: ${validDocumentTypes.join(', ')}`
      });
    }

    // Normalize document type to snake_case for storage path
    let normalizedDocType = documentType;
    if (validDocumentTypesCamel.includes(documentType)) {
      normalizedDocType = documentType.replace(/([A-Z])/g, '_$1').toLowerCase();
    }

    console.log('📤 [BACKEND PROXY] Uploading document:', { driverId, documentType, fileSize: file.size });

    // Get Firebase Storage instance
    const bucket = getStorage().bucket();
    
    // Generate unique filename
    const timestamp = Date.now();
    const fileName = `${timestamp}_${normalizedDocType}.jpg`;
    const filePath = `drivers/${driverId}/documents/${normalizedDocType}/${fileName}`;
    
    console.log('📤 [BACKEND PROXY] File path:', filePath);
    
    // Create file reference
    const fileRef = bucket.file(filePath);
    
    // Upload file
    await fileRef.save(file.buffer, {
      metadata: {
        contentType: file.mimetype,
        customMetadata: {
          driverId: driverId,
          documentType: documentType,
          uploadedAt: new Date().toISOString(),
          uploadedBy: 'backend_proxy',
          originalFileName: file.originalname || fileName
        }
      }
    });

    console.log('✅ [BACKEND PROXY] File uploaded to Firebase Storage');

    // Get download URL
    const [downloadURL] = await fileRef.getSignedUrl({
      action: 'read',
      expires: '03-01-2500' // Far future date
    });

    // Update user document in Firestore
    try {
      const db = getFirestore();
      const userRef = db.collection('users').doc(driverId);
      
      // Update both document type formats for compatibility
      const updateData = {
        [`documents.${normalizedDocType}`]: {
          fileName: fileName,
          filePath: filePath,
          downloadURL: downloadURL,
          uploadedAt: new Date().toISOString(),
          status: 'uploaded',
          uploadedBy: 'backend_proxy'
        },
        [`driver.documents.${normalizedDocType}`]: {
          fileName: fileName,
          filePath: filePath,
          downloadURL: downloadURL,
          uploadedAt: new Date().toISOString(),
          status: 'uploaded',
          uploadedBy: 'backend_proxy'
        },
        updatedAt: new Date()
      };

      await userRef.update(updateData);
      
      console.log('✅ [BACKEND PROXY] User document updated in Firestore');
    } catch (firestoreError) {
      console.error('⚠️ [BACKEND PROXY] Error updating Firestore:', firestoreError);
      // Don't fail the upload for Firestore errors
    }

    console.log('✅ [BACKEND PROXY] Driver document upload completed successfully');

    res.json({
      success: true,
      data: {
        fileName: fileName,
        filePath: filePath,
        downloadURL: downloadURL,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        documentType: documentType,
        driverId: driverId
      }
    });

  } catch (error) {
    console.error('❌ [BACKEND PROXY] Error uploading driver document:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload document',
      details: error.message
    });
  }
});

/**
 * @route GET /api/file-upload/drivers/:driverId/documents
 * @desc Get all driver documents via backend proxy
 * @access Private (Driver/Admin)
 */
router.get('/drivers/:driverId/documents', async (req, res) => {
  try {
    console.log('📥 [BACKEND PROXY] Getting driver documents for:', req.params.driverId);
    
    const { driverId } = req.params;

    if (!driverId) {
      return res.status(400).json({
        success: false,
        error: 'Driver ID is required'
      });
    }

    // Get Firebase Storage instance
    const bucket = getStorage().bucket();
    
    // List all files in the driver's documents folder
    const [files] = await bucket.getFiles({
      prefix: `drivers/${driverId}/documents/`,
    });

    const documents = {};

    for (const file of files) {
      try {
        // Get download URL
        const [downloadURL] = await file.getSignedUrl({
          action: 'read',
          expires: '03-01-2500'
        });

        // Get file metadata
        const [metadata] = await file.getMetadata();
        
        // Extract document type from path
        const pathParts = file.name.split('/');
        const documentType = pathParts[pathParts.length - 2]; // Second to last part

        documents[documentType] = {
          fileName: file.name.split('/').pop(),
          filePath: file.name,
          downloadURL: downloadURL,
          size: metadata.size,
          uploadedAt: metadata.timeCreated,
          contentType: metadata.contentType,
          customMetadata: metadata.customMetadata || {}
        };
      } catch (fileError) {
        console.error(`❌ [BACKEND PROXY] Error processing file ${file.name}:`, fileError);
      }
    }

    console.log('✅ [BACKEND PROXY] Retrieved documents:', Object.keys(documents));

    res.json({
      success: true,
      data: {
        driverId: driverId,
        documents: documents,
        totalDocuments: Object.keys(documents).length
      }
    });

  } catch (error) {
    console.error('❌ [BACKEND PROXY] Error getting driver documents:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get documents',
      details: error.message
    });
  }
});

/**
 * @route GET /api/file-upload/driver-document/:driverId/:documentType
 * @desc Get specific driver document via backend proxy
 * @access Private (Driver/Admin)
 */
router.get('/driver-document/:driverId/:documentType', async (req, res) => {
  try {
    console.log('📥 [BACKEND PROXY] Getting specific document:', req.params);
    
    const { driverId, documentType } = req.params;

    if (!driverId || !documentType) {
      return res.status(400).json({
        success: false,
        error: 'Driver ID and document type are required'
      });
    }

    // Get Firebase Storage instance
    const bucket = getStorage().bucket();
    
    // List files in the specific document type folder
    const [files] = await bucket.getFiles({
      prefix: `drivers/${driverId}/documents/${documentType}/`,
      maxResults: 1 // Get the latest file
    });

    if (files.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    const file = files[0];
    
    // Get download URL
    const [downloadURL] = await file.getSignedUrl({
      action: 'read',
      expires: '03-01-2500'
    });

    // Get file metadata
    const [metadata] = await file.getMetadata();

    console.log('✅ [BACKEND PROXY] Retrieved document:', documentType);

    res.json({
      success: true,
      data: {
        fileName: file.name.split('/').pop(),
        filePath: file.name,
        downloadURL: downloadURL,
        size: metadata.size,
        uploadedAt: metadata.timeCreated,
        contentType: metadata.contentType,
        documentType: documentType,
        driverId: driverId,
        customMetadata: metadata.customMetadata || {}
      }
    });

  } catch (error) {
    console.error('❌ [BACKEND PROXY] Error getting driver document:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get document',
      details: error.message
    });
  }
});

/**
 * @route POST /api/file-upload/customer-document
 * @desc Upload customer document via backend proxy
 * @access Private (Customer)
 */
router.post('/customer-document', upload.single('document'), async (req, res) => {
  try {
    console.log('📤 [BACKEND PROXY] Customer document upload request received');
    
    const { customerId, documentType } = req.body;
    const file = req.file;

    // Validate file
    if (!file) {
      console.log('❌ [BACKEND PROXY] No file provided');
      return res.status(400).json({
        success: false,
        error: 'No file provided'
      });
    }

    // Validate required fields
    if (!customerId || !documentType) {
      console.log('❌ [BACKEND PROXY] Missing required fields:', { customerId, documentType });
      return res.status(400).json({
        success: false,
        error: 'Customer ID and document type are required'
      });
    }

    // Validate document type
    const validDocumentTypes = ['profile_photo', 'id_proof', 'address_proof'];
    if (!validDocumentTypes.includes(documentType)) {
      console.log('❌ [BACKEND PROXY] Invalid document type:', documentType);
      return res.status(400).json({
        success: false,
        error: `Invalid document type. Must be one of: ${validDocumentTypes.join(', ')}`
      });
    }

    console.log('📤 [BACKEND PROXY] Uploading customer document:', { customerId, documentType, fileSize: file.size });

    // Get Firebase Storage instance
    const bucket = getStorage().bucket();
    
    // Generate unique filename
    const timestamp = Date.now();
    const fileName = `${timestamp}_${documentType}.jpg`;
    const filePath = `customers/${customerId}/documents/${documentType}/${fileName}`;
    
    console.log('📤 [BACKEND PROXY] File path:', filePath);
    
    // Create file reference
    const fileRef = bucket.file(filePath);
    
    // Upload file
    await fileRef.save(file.buffer, {
      metadata: {
        contentType: file.mimetype,
        customMetadata: {
          customerId: customerId,
          documentType: documentType,
          uploadedAt: new Date().toISOString(),
          uploadedBy: 'backend_proxy',
          originalFileName: file.originalname || fileName
        }
      }
    });

    console.log('✅ [BACKEND PROXY] Customer file uploaded to Firebase Storage');

    // Get download URL
    const [downloadURL] = await fileRef.getSignedUrl({
      action: 'read',
      expires: '03-01-2500' // Far future date
    });

    // Update user document in Firestore
    try {
      const db = getFirestore();
      const userRef = db.collection('users').doc(customerId);
      
      await userRef.update({
        [`documents.${documentType}`]: {
          fileName: fileName,
          filePath: filePath,
          downloadURL: downloadURL,
          uploadedAt: new Date().toISOString(),
          status: 'uploaded',
          uploadedBy: 'backend_proxy'
        },
        updatedAt: new Date()
      });
      
      console.log('✅ [BACKEND PROXY] Customer user document updated in Firestore');
    } catch (firestoreError) {
      console.error('⚠️ [BACKEND PROXY] Error updating Firestore:', firestoreError);
      // Don't fail the upload for Firestore errors
    }

    console.log('✅ [BACKEND PROXY] Customer document upload completed successfully');

    res.json({
      success: true,
      data: {
        fileName: fileName,
        filePath: filePath,
        downloadURL: downloadURL,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        documentType: documentType,
        customerId: customerId
      }
    });

  } catch (error) {
    console.error('❌ [BACKEND PROXY] Error uploading customer document:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload document',
      details: error.message
    });
  }
});

/**
 * @route GET /api/file-upload/customer-documents/:customerId
 * @desc Get all customer documents via backend proxy
 * @access Private (Customer/Admin)
 */
router.get('/customer-documents/:customerId', async (req, res) => {
  try {
    console.log('📥 [BACKEND PROXY] Getting customer documents for:', req.params.customerId);
    
    const { customerId } = req.params;

    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'Customer ID is required'
      });
    }

    // Get Firebase Storage instance
    const bucket = getStorage().bucket();
    
    // List all files in the customer's documents folder
    const [files] = await bucket.getFiles({
      prefix: `customers/${customerId}/documents/`,
    });

    const documents = {};

    for (const file of files) {
      try {
        // Get download URL
        const [downloadURL] = await file.getSignedUrl({
          action: 'read',
          expires: '03-01-2500'
        });

        // Get file metadata
        const [metadata] = await file.getMetadata();
        
        // Extract document type from path
        const pathParts = file.name.split('/');
        const documentType = pathParts[pathParts.length - 2]; // Second to last part

        documents[documentType] = {
          fileName: file.name.split('/').pop(),
          filePath: file.name,
          downloadURL: downloadURL,
          size: metadata.size,
          uploadedAt: metadata.timeCreated,
          contentType: metadata.contentType,
          customMetadata: metadata.customMetadata || {}
        };
      } catch (fileError) {
        console.error(`❌ [BACKEND PROXY] Error processing file ${file.name}:`, fileError);
      }
    }

    console.log('✅ [BACKEND PROXY] Retrieved customer documents:', Object.keys(documents));

    res.json({
      success: true,
      data: {
        customerId: customerId,
        documents: documents,
        totalDocuments: Object.keys(documents).length
      }
    });

  } catch (error) {
    console.error('❌ [BACKEND PROXY] Error getting customer documents:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get documents',
      details: error.message
    });
  }
});

module.exports = router;