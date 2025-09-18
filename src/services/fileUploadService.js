const sharp = require('sharp');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getFirebaseApp, getFirestore, getStorage } = require('./firebase');

class FileUploadService {
  constructor() {
    // Check if Firebase is available
    try {
      this.firebaseApp = getFirebaseApp();
      this.isAvailable = !!this.firebaseApp;
    } catch (error) {
      console.warn('⚠️ Firebase not available for FileUploadService:', error.message);
      this.isAvailable = false;
    }
    
    // Supported file types and their configurations
    this.supportedTypes = {
      'image/jpeg': { ext: '.jpg', maxSize: 5 * 1024 * 1024 }, // 5MB
      'image/png': { ext: '.png', maxSize: 5 * 1024 * 1024 }, // 5MB
      'image/webp': { ext: '.webp', maxSize: 5 * 1024 * 1024 }, // 5MB
      'application/pdf': { ext: '.pdf', maxSize: 10 * 1024 * 1024 } // 10MB
    };

    // Document types and their requirements
    this.documentTypes = {
      'driving_license': {
        required: true,
        maxSize: 5 * 1024 * 1024, // 5MB
        allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
        dimensions: { minWidth: 800, minHeight: 600 },
        description: 'Driver\'s driving license'
      },
      'aadhaar_card': {
        required: true,
        maxSize: 5 * 1024 * 1024, // 5MB
        allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
        dimensions: { minWidth: 800, minHeight: 600 },
        description: 'Driver\'s Aadhaar card'
      },
      'bike_insurance': {
        required: true,
        maxSize: 10 * 1024 * 1024, // 10MB
        allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
        dimensions: { minWidth: 800, minHeight: 600 },
        description: 'Vehicle insurance document'
      },
      'rc_book': {
        required: true,
        maxSize: 10 * 1024 * 1024, // 10MB
        allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
        dimensions: { minWidth: 800, minHeight: 600 },
        description: 'Vehicle registration certificate'
      },
      'profile_photo': {
        required: true,
        maxSize: 3 * 1024 * 1024, // 3MB
        allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
        dimensions: { minWidth: 400, minHeight: 400, aspectRatio: 1 },
        description: 'Driver\'s profile photograph'
      }
    };

    // Image processing configurations
    this.imageConfig = {
      quality: 85,
      maxWidth: 1920,
      maxHeight: 1080,
      thumbnailSize: 300,
      watermark: false // Can be enabled for security
    };
  }

  get db() {
    if (!this.isAvailable) {
      throw new Error('Firebase is not available. Firestore operations are not available.');
    }
    return getFirestore();
  }

  get storage() {
    if (!this.isAvailable) {
      throw new Error('Firebase is not available. Storage operations are not available.');
    }
    return getStorage();
  }

  get bucket() {
    if (!this.isAvailable) {
      throw new Error('Firebase is not available. Storage bucket operations are not available.');
    }
    return this.storage.bucket();
  }

  /**
   * Upload and process a document file
   * @param {Object} file - Multer file object
   * @param {string} documentType - Type of document being uploaded
   * @param {string} driverId - ID of the driver
   * @param {Object} metadata - Additional metadata
   * @returns {Object} Upload result with file details
   */
  async uploadDocument(file, documentType, driverId, metadata = {}) {
    try {
      // Validate document type
      if (!this.documentTypes[documentType]) {
        throw new Error(`Invalid document type: ${documentType}`);
      }

      const docConfig = this.documentTypes[documentType];

      // Validate file type
      if (!docConfig.allowedTypes.includes(file.mimetype)) {
        throw new Error(`File type ${file.mimetype} not allowed for ${documentType}`);
      }

      // Validate file size
      if (file.size > docConfig.maxSize) {
        throw new Error(`File size exceeds maximum allowed size for ${documentType}`);
      }

      // Generate unique filename
      const fileId = uuidv4();
      const timestamp = Date.now();
      const fileExtension = this.supportedTypes[file.mimetype].ext;
      const filename = `${documentType}_${driverId}_${timestamp}_${fileId}${fileExtension}`;

      // Process file based on type
      let processedFile = file;
      let thumbnailPath = null;

      if (file.mimetype.startsWith('image/')) {
        // Process image files
        const imageProcessingResult = await this.processImage(file, docConfig);
        processedFile = imageProcessingResult.file;
        thumbnailPath = imageProcessingResult.thumbnailPath;
      }

      // Upload to Firebase Storage
      const uploadResult = await this.uploadToStorage(
        processedFile,
        filename,
        documentType,
        driverId,
        metadata
      );

      // Create document record in Firestore
      const documentRecord = await this.createDocumentRecord(
        driverId,
        documentType,
        filename,
        uploadResult,
        thumbnailPath,
        metadata
      );

      // Update driver's document status
      await this.updateDriverDocumentStatus(driverId, documentType, 'uploaded');

      return {
        success: true,
        message: 'Document uploaded successfully',
        data: {
          documentId: documentRecord.id,
          filename: filename,
          originalName: file.originalname,
          size: processedFile.size,
          type: documentType,
          status: 'uploaded',
          uploadUrl: uploadResult.downloadURL,
          thumbnailUrl: thumbnailPath ? uploadResult.thumbnailURL : null,
          uploadedAt: new Date(),
          metadata: metadata
        }
      };

    } catch (error) {
      console.error('Document upload failed:', error);
      throw new Error(`Document upload failed: ${error.message}`);
    }
  }

  /**
   * Process image files (resize, compress, create thumbnail)
   * @param {Object} file - Original file object
   * @param {Object} docConfig - Document configuration
   * @returns {Object} Processed file and thumbnail path
   */
  async processImage(file, docConfig) {
    try {
      const image = sharp(file.buffer);
      const metadata = await image.metadata();

      // Validate image dimensions
      if (docConfig.dimensions.minWidth && metadata.width < docConfig.dimensions.minWidth) {
        throw new Error(`Image width must be at least ${docConfig.dimensions.minWidth}px`);
      }
      if (docConfig.dimensions.minHeight && metadata.height < docConfig.dimensions.minHeight) {
        throw new Error(`Image height must be at least ${docConfig.dimensions.minHeight}px`);
      }

      // Check aspect ratio for profile photos
      if (docConfig.dimensions.aspectRatio) {
        const currentRatio = metadata.width / metadata.height;
        const tolerance = 0.1;
        if (Math.abs(currentRatio - docConfig.dimensions.aspectRatio) > tolerance) {
          throw new Error(`Image must have a ${docConfig.dimensions.aspectRatio}:1 aspect ratio`);
        }
      }

      // Resize if necessary
      if (metadata.width > this.imageConfig.maxWidth || metadata.height > this.imageConfig.maxHeight) {
        image.resize(this.imageConfig.maxWidth, this.imageConfig.maxHeight, {
          fit: 'inside',
          withoutEnlargement: true
        });
      }

      // Compress and optimize
      const processedBuffer = await image
        .jpeg({ quality: this.imageConfig.quality })
        .png({ quality: this.imageConfig.quality })
        .webp({ quality: this.imageConfig.quality })
        .toBuffer();

      // Create thumbnail
      const thumbnailBuffer = await sharp(file.buffer)
        .resize(this.imageConfig.thumbnailSize, this.imageConfig.thumbnailSize, {
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ quality: 80 })
        .toBuffer();

      // Create thumbnail file object
      const thumbnailFile = {
        ...file,
        buffer: thumbnailBuffer,
        size: thumbnailBuffer.length,
        originalname: `thumb_${file.originalname}`
      };

      return {
        file: {
          ...file,
          buffer: processedBuffer,
          size: processedBuffer.length
        },
        thumbnailPath: thumbnailFile
      };

    } catch (error) {
      console.error('Image processing failed:', error);
      throw new Error(`Image processing failed: ${error.message}`);
    }
  }

  /**
   * Upload file to Firebase Storage
   * @param {Object} file - File object to upload
   * @param {string} filename - Name for the file
   * @param {string} documentType - Type of document
   * @param {string} driverId - Driver ID
   * @param {Object} metadata - Additional metadata
   * @returns {Object} Upload result
   */
  async uploadToStorage(file, filename, documentType, driverId, metadata = {}) {
    try {
      const filePath = `drivers/${driverId}/documents/${documentType}/${filename}`;
      const fileRef = this.bucket.file(filePath);

      // Set file metadata
      const fileMetadata = {
        metadata: {
          contentType: file.mimetype,
          driverId: driverId,
          documentType: documentType,
          originalName: file.originalname,
          uploadedAt: new Date().toISOString(),
          ...metadata
        }
      };

      // Upload file
      await fileRef.save(file.buffer, fileMetadata);

      // Make file publicly readable (or implement signed URLs for security)
      await fileRef.makePublic();

      // Get download URL
      const downloadURL = `https://storage.googleapis.com/${this.bucket.name}/${filePath}`;

      // Upload thumbnail if exists
      let thumbnailURL = null;
      if (file.thumbnailPath) {
        const thumbnailPath = `drivers/${driverId}/documents/${documentType}/thumbnails/${filename}`;
        const thumbnailRef = this.bucket.file(thumbnailPath);
        
        await thumbnailRef.save(file.thumbnailPath.buffer, {
          metadata: {
            contentType: 'image/jpeg',
            driverId: driverId,
            documentType: documentType,
            isThumbnail: true
          }
        });
        
        await thumbnailRef.makePublic();
        thumbnailURL = `https://storage.googleapis.com/${this.bucket.name}/${thumbnailPath}`;
      }

      return {
        downloadURL,
        thumbnailURL,
        filePath,
        size: file.size,
        contentType: file.mimetype
      };

    } catch (error) {
      console.error('Storage upload failed:', error);
      throw new Error(`Storage upload failed: ${error.message}`);
    }
  }

  /**
   * Create document record in Firestore
   * @param {string} driverId - Driver ID
   * @param {string} documentType - Type of document
   * @param {string} filename - Filename
   * @param {Object} uploadResult - Upload result from storage
   * @param {string} thumbnailPath - Thumbnail path
   * @param {Object} metadata - Additional metadata
   * @returns {Object} Created document record
   */
  async createDocumentRecord(driverId, documentType, filename, uploadResult, thumbnailPath, metadata = {}) {
    try {
      const documentData = {
        driverId,
        documentType,
        filename,
        originalName: metadata.originalName || filename,
        status: 'uploaded',
        verificationStatus: 'pending',
        uploadDetails: {
          downloadURL: uploadResult.downloadURL,
          thumbnailURL: uploadResult.thumbnailURL,
          filePath: uploadResult.filePath,
          size: uploadResult.size,
          contentType: uploadResult.contentType
        },
        metadata: {
          ...metadata,
          uploadedAt: new Date()
        },
        verification: {
          status: 'pending',
          verifiedBy: null,
          verifiedAt: null,
          comments: null,
          rejectionReason: null
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Create document in driverDocuments collection
      const docRef = await this.db.collection('driverDocuments').add(documentData);
      
      // Also create/update verification request for admin dashboard
      await this.createOrUpdateVerificationRequest(driverId, documentType, documentData);
      
      return {
        id: docRef.id,
        ...documentData
      };

    } catch (error) {
      console.error('Document record creation failed:', error);
      throw new Error(`Document record creation failed: ${error.message}`);
    }
  }

  /**
   * Create or update verification request for admin dashboard
   * @param {string} driverId - Driver ID
   * @param {string} documentType - Document type
   * @param {Object} documentData - Document data
   */
  async createOrUpdateVerificationRequest(driverId, documentType, documentData) {
    try {
      // Get driver information
      const driverDoc = await this.db.collection('users').doc(driverId).get();
      if (!driverDoc.exists) {
        console.warn(`Driver ${driverId} not found for verification request`);
        return;
      }

      const driverData = driverDoc.data();
      
      // Check if verification request already exists
      const existingRequestQuery = await this.db.collection('documentVerificationRequests')
        .where('driverId', '==', driverId)
        .where('status', '==', 'pending')
        .limit(1)
        .get();

      const verificationRequestData = {
        driverId,
        driverName: driverData.name || 'Unknown Driver',
        driverPhone: driverData.phone || 'Unknown Phone',
        documents: {
          [documentType]: {
            documentId: documentData.id || 'pending',
            filename: documentData.filename,
            downloadURL: documentData.uploadDetails.downloadURL,
            thumbnailURL: documentData.uploadDetails.thumbnailURL,
            uploadedAt: documentData.metadata.uploadedAt,
            status: 'uploaded',
            verificationStatus: 'pending'
          }
        },
        status: 'pending',
        requestedAt: new Date(),
        updatedAt: new Date()
      };

      if (existingRequestQuery.empty) {
        // Create new verification request
        await this.db.collection('documentVerificationRequests').add(verificationRequestData);
        console.log(`Created new verification request for driver ${driverId}`);
      } else {
        // Update existing verification request
        const existingRequest = existingRequestQuery.docs[0];
        const existingData = existingRequest.data();
        
        // Merge documents
        const updatedDocuments = {
          ...existingData.documents,
          [documentType]: {
            documentId: documentData.id || 'pending',
            filename: documentData.filename,
            downloadURL: documentData.uploadDetails.downloadURL,
            thumbnailURL: documentData.uploadDetails.thumbnailURL,
            uploadedAt: documentData.metadata.uploadedAt,
            status: 'uploaded',
            verificationStatus: 'pending'
          }
        };

        await existingRequest.ref.update({
          documents: updatedDocuments,
          updatedAt: new Date()
        });
        console.log(`Updated verification request for driver ${driverId}`);
      }

    } catch (error) {
      console.error('Failed to create/update verification request:', error);
      // Don't throw error as this is not critical for upload success
    }
  }

  /**
   * Register document from URL (for mobile app uploads)
   * @param {string} driverId - Driver ID
   * @param {string} documentType - Document type
   * @param {string} documentUrl - Document URL
   * @param {string} documentNumber - Document number (optional)
   * @returns {Object} Registration result
   */
  async registerDocumentFromUrl(driverId, documentType, documentUrl, documentNumber = null) {
    try {
      // Validate document type
      if (!this.documentTypes[documentType]) {
        throw new Error(`Invalid document type: ${documentType}`);
      }

      // Generate unique filename
      const fileId = uuidv4();
      const timestamp = Date.now();
      const filename = `${documentType}_${driverId}_${timestamp}_${fileId}.jpg`;

      let downloadURL = documentUrl;
      let fileSize = 0;
      let contentType = 'image/jpeg';

      // Handle base64 data URLs
      if (documentUrl.startsWith('data:')) {
        console.log('📤 Processing base64 data URL for document upload');
        
        // Extract base64 data and content type
        const matches = documentUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          contentType = matches[1];
          const base64Data = matches[2];
          const buffer = Buffer.from(base64Data, 'base64');
          fileSize = buffer.length;
          
          console.log(`📤 Base64 data extracted: ${fileSize} bytes, type: ${contentType}`);
          
          // Upload to Firebase Storage
          if (this.isAvailable) {
            try {
              const storage = getStorage();
              const bucket = storage.bucket();
              const filePath = `driver-documents/${driverId}/${documentType}/${filename}`;
              const file = bucket.file(filePath);
              
              await file.save(buffer, {
                metadata: {
                  contentType: contentType,
                  metadata: {
                    driverId,
                    documentType,
                    originalName: filename,
                    uploadedAt: new Date().toISOString(),
                    uploadSource: 'mobile_app'
                  }
                }
              });
              
              // Make file publicly readable
              await file.makePublic();
              
              // Get download URL
              downloadURL = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
              console.log(`✅ Document uploaded to Firebase Storage: ${downloadURL}`);
              
            } catch (storageError) {
              console.error('❌ Firebase Storage upload failed:', storageError);
              // Continue with data URL as fallback
              console.log('⚠️ Using data URL as fallback');
            }
          } else {
            console.warn('⚠️ Firebase Storage not available, using data URL');
          }
        } else {
          throw new Error('Invalid data URL format');
        }
      }

      // Create document record
      const documentData = {
        driverId,
        documentType,
        filename,
        originalName: filename,
        status: 'uploaded',
        verificationStatus: 'pending',
        uploadDetails: {
          downloadURL: downloadURL,
          thumbnailURL: null,
          filePath: `driver-documents/${driverId}/${documentType}/${filename}`,
          size: fileSize,
          contentType: contentType
        },
        metadata: {
          documentNumber,
          uploadedAt: new Date(),
          uploadSource: 'mobile_app'
        },
        verification: {
          status: 'pending',
          verifiedBy: null,
          verifiedAt: null,
          comments: null,
          rejectionReason: null
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Create document in driverDocuments collection
      const docRef = await this.db.collection('driverDocuments').add(documentData);
      
      // Also create/update verification request for admin dashboard
      await this.createOrUpdateVerificationRequest(driverId, documentType, {
        id: docRef.id,
        ...documentData
      });

      // Update driver's document status
      await this.updateDriverDocumentStatus(driverId, documentType, 'uploaded');

      return {
        success: true,
        message: 'Document registered successfully',
        data: {
          documentId: docRef.id,
          filename: filename,
          originalName: filename,
          type: documentType,
          status: 'uploaded',
          uploadUrl: documentUrl,
          uploadedAt: new Date(),
          metadata: {
            documentNumber,
            uploadSource: 'mobile_app'
          }
        }
      };

    } catch (error) {
      console.error('Document registration failed:', error);
      throw new Error(`Document registration failed: ${error.message}`);
    }
  }

  /**
   * Update driver's document status
   * @param {string} driverId - Driver ID
   * @param {string} documentType - Document type
   * @param {string} status - New status
   */
  async updateDriverDocumentStatus(driverId, documentType, status) {
    try {
      const driverRef = this.db.collection('users').doc(driverId);
      
      await driverRef.update({
        [`driver.documents.${documentType}.status`]: status,
        [`driver.documents.${documentType}.updatedAt`]: new Date(),
        'updatedAt': new Date()
      });

    } catch (error) {
      console.error('Driver document status update failed:', error);
      // Don't throw error as this is not critical for upload success
    }
  }

  /**
   * Get driver's documents
   * @param {string} driverId - Driver ID
   * @param {string} documentType - Optional document type filter
   * @returns {Array} Array of documents
   */
  async getDriverDocuments(driverId, documentType = null) {
    try {
      let query = this.db.collection('driverDocuments')
        .where('driverId', '==', driverId)
        .orderBy('createdAt', 'desc');

      if (documentType) {
        query = query.where('documentType', '==', documentType);
      }

      const snapshot = await query.get();
      const documents = [];

      snapshot.forEach(doc => {
        documents.push({
          id: doc.id,
          ...doc.data()
        });
      });

      return documents;

    } catch (error) {
      console.error('Failed to get driver documents:', error);
      throw new Error(`Failed to get driver documents: ${error.message}`);
    }
  }

  /**
   * Verify a document (admin function)
   * @param {string} documentId - Document ID
   * @param {string} adminId - Admin ID performing verification
   * @param {string} status - Verification status (approved/rejected)
   * @param {string} comments - Verification comments
   * @param {string} rejectionReason - Reason for rejection if applicable
   * @returns {Object} Verification result
   */
  async verifyDocument(documentId, adminId, status, comments = null, rejectionReason = null) {
    try {
      const documentRef = this.db.collection('driverDocuments').doc(documentId);
      const documentDoc = await documentRef.get();

      if (!documentDoc.exists) {
        throw new Error('Document not found');
      }

      const documentData = documentDoc.data();
      const updateData = {
        verificationStatus: status,
        verification: {
          status,
          verifiedBy: adminId,
          verifiedAt: new Date(),
          comments,
          rejectionReason
        },
        status: status === 'approved' ? 'verified' : 'rejected',
        updatedAt: new Date()
      };

      // Update document record
      await documentRef.update(updateData);

      // Update driver's document status
      await this.updateDriverDocumentStatus(
        documentData.driverId,
        documentData.documentType,
        status === 'approved' ? 'verified' : 'rejected'
      );

      // Check if all required documents are verified
      if (status === 'approved') {
        await this.checkDriverVerificationStatus(documentData.driverId);
      }

      // Send notification to driver
      await this.sendVerificationNotification(
        documentData.driverId,
        documentData.documentType,
        status,
        comments
      );

      return {
        success: true,
        message: `Document ${status} successfully`,
        data: {
          documentId,
          status,
          verifiedBy: adminId,
          verifiedAt: new Date()
        }
      };

    } catch (error) {
      console.error('Document verification failed:', error);
      throw new Error(`Document verification failed: ${error.message}`);
    }
  }

  /**
   * Check if driver has all required documents verified
   * @param {string} driverId - Driver ID
   */
  async checkDriverVerificationStatus(driverId) {
    try {
      const requiredDocuments = Object.keys(this.documentTypes).filter(
        type => this.documentTypes[type].required
      );

      const documents = await this.getDriverDocuments(driverId);
      const verifiedDocuments = documents.filter(
        doc => doc.verificationStatus === 'approved' && requiredDocuments.includes(doc.documentType)
      );

      if (verifiedDocuments.length === requiredDocuments.length) {
        // All required documents are verified
        await this.updateDriverVerificationStatus(driverId, 'verified');
      }

    } catch (error) {
      console.error('Failed to check driver verification status:', error);
    }
  }

  /**
   * Update driver's overall verification status
   * @param {string} driverId - Driver ID
   * @param {string} status - New verification status
   */
  async updateDriverVerificationStatus(driverId, status) {
    try {
      const driverRef = this.db.collection('users').doc(driverId);
      
      await driverRef.update({
        'driver.verificationStatus': status,
        'driver.verifiedAt': status === 'verified' ? new Date() : null,
        'updatedAt': new Date()
      });

    } catch (error) {
      console.error('Driver verification status update failed:', error);
    }
  }

  /**
   * Send verification notification to driver
   * @param {string} driverId - Driver ID
   * @param {string} documentType - Document type
   * @param {string} status - Verification status
   * @param {string} comments - Verification comments
   */
  async sendVerificationNotification(driverId, documentType, status, comments) { // eslint-disable-line no-unused-vars
    try {
      // This would integrate with your notification service
      // For now, we'll just log it
      console.log(`Sending ${status} notification to driver ${driverId} for ${documentType}`);
      
      // Example integration:
      // const notificationService = require('./notificationService');
      // await notificationService.sendComprehensiveNotification(
      //   driverId,
      //   'document_verification',
      //   {
      //     documentType,
      //     status,
      //     comments
      //   }
      // );

    } catch (error) {
      console.error('Failed to send verification notification:', error);
    }
  }

  /**
   * Delete a document
   * @param {string} documentId - Document ID
   * @param {string} adminId - Admin ID performing deletion
   * @returns {Object} Deletion result
   */
  async deleteDocument(documentId, adminId) {
    try {
      const documentRef = this.db.collection('driverDocuments').doc(documentId);
      const documentDoc = await documentRef.get();

      if (!documentDoc.exists) {
        throw new Error('Document not found');
      }

      const documentData = documentDoc.data();

      // Delete from Firebase Storage
      await this.deleteFromStorage(documentData.uploadDetails.filePath);
      if (documentData.uploadDetails.thumbnailURL) {
        const thumbnailPath = documentData.uploadDetails.filePath.replace(
          documentData.filename,
          `thumbnails/${documentData.filename}`
        );
        await this.deleteFromStorage(thumbnailPath);
      }

      // Delete from Firestore
      await documentRef.delete();

      // Update driver's document status
      await this.updateDriverDocumentStatus(
        documentData.driverId,
        documentData.documentType,
        'deleted'
      );

      return {
        success: true,
        message: 'Document deleted successfully',
        data: {
          documentId,
          deletedAt: new Date(),
          deletedBy: adminId
        }
      };

    } catch (error) {
      console.error('Document deletion failed:', error);
      throw new Error(`Document deletion failed: ${error.message}`);
    }
  }

  /**
   * Delete file from Firebase Storage
   * @param {string} filePath - File path in storage
   */
  async deleteFromStorage(filePath) {
    try {
      const fileRef = this.bucket.file(filePath);
      await fileRef.delete();
    } catch (error) {
      console.error('Failed to delete file from storage:', error);
    }
  }

  /**
   * Get document statistics
   * @param {Object} filters - Optional filters
   * @returns {Object} Statistics data
   */
  async getDocumentStatistics(filters = {}) {
    try {
      let query = this.db.collection('driverDocuments');

      // Apply filters
      if (filters.documentType) {
        query = query.where('documentType', '==', filters.documentType);
      }
      if (filters.status) {
        query = query.where('status', '==', filters.status);
      }
      if (filters.verificationStatus) {
        query = query.where('verificationStatus', '==', filters.verificationStatus);
      }

      const snapshot = await query.get();
      const documents = [];

      snapshot.forEach(doc => {
        documents.push(doc.data());
      });

      // Calculate statistics
      const stats = {
        total: documents.length,
        byStatus: {},
        byDocumentType: {},
        byVerificationStatus: {},
        averageSize: 0,
        totalSize: 0
      };

      documents.forEach(doc => {
        // Count by status
        stats.byStatus[doc.status] = (stats.byStatus[doc.status] || 0) + 1;
        
        // Count by document type
        stats.byDocumentType[doc.documentType] = (stats.byDocumentType[doc.documentType] || 0) + 1;
        
        // Count by verification status
        stats.byVerificationStatus[doc.verificationStatus] = (stats.byVerificationStatus[doc.verificationStatus] || 0) + 1;
        
        // Calculate size statistics
        if (doc.uploadDetails && doc.uploadDetails.size) {
          stats.totalSize += doc.uploadDetails.size;
        }
      });

      if (documents.length > 0) {
        stats.averageSize = Math.round(stats.totalSize / documents.length);
      }

      return stats;

    } catch (error) {
      console.error('Failed to get document statistics:', error);
      throw new Error(`Failed to get document statistics: ${error.message}`);
    }
  }

  /**
   * Clean up expired or invalid documents
   * @param {number} maxAge - Maximum age in milliseconds (default: 30 days)
   * @returns {Object} Cleanup result
   */
  async cleanupExpiredDocuments(maxAge = 30 * 24 * 60 * 60 * 1000) {
    try {
      const cutoffDate = new Date(Date.now() - maxAge);
      
      const snapshot = await this.db.collection('driverDocuments')
        .where('createdAt', '<', cutoffDate)
        .where('status', 'in', ['pending', 'rejected'])
        .get();

      const documentsToDelete = [];
      snapshot.forEach(doc => {
        documentsToDelete.push({
          id: doc.id,
          ...doc.data()
        });
      });

      let deletedCount = 0;
      for (const doc of documentsToDelete) {
        try {
          await this.deleteDocument(doc.id, 'system_cleanup');
          deletedCount++;
        } catch (error) {
          console.error(`Failed to delete document ${doc.id}:`, error);
        }
      }

      return {
        success: true,
        message: `Cleanup completed. Deleted ${deletedCount} documents.`,
        data: {
          deletedCount,
          totalFound: documentsToDelete.length,
          cutoffDate: cutoffDate
        }
      };

    } catch (error) {
      console.error('Document cleanup failed:', error);
      throw new Error(`Document cleanup failed: ${error.message}`);
    }
  }

  /**
   * Generate signed URL for secure document access
   * @param {string} filePath - File path in storage
   * @param {number} expirationTime - Expiration time in seconds (default: 1 hour)
   * @returns {string} Signed URL
   */
  async generateSignedUrl(filePath, expirationTime = 3600) {
    try {
      const fileRef = this.bucket.file(filePath);
      const [signedUrl] = await fileRef.getSignedUrl({
        action: 'read',
        expires: Date.now() + (expirationTime * 1000)
      });

      return signedUrl;

    } catch (error) {
      console.error('Failed to generate signed URL:', error);
      throw new Error(`Failed to generate signed URL: ${error.message}`);
    }
  }

  /**
   * Validate file before upload
   * @param {Object} file - File object to validate
   * @param {string} documentType - Document type
   * @returns {Object} Validation result
   */
  validateFile(file, documentType) {
    const errors = [];
    const warnings = [];

    // Check if document type is supported
    if (!this.documentTypes[documentType]) {
      errors.push(`Document type '${documentType}' is not supported`);
      return { isValid: false, errors, warnings };
    }

    const docConfig = this.documentTypes[documentType];

    // Check file type
    if (!docConfig.allowedTypes.includes(file.mimetype)) {
      errors.push(`File type '${file.mimetype}' is not allowed for ${documentType}`);
    }

    // Check file size
    if (file.size > docConfig.maxSize) {
      errors.push(`File size ${(file.size / 1024 / 1024).toFixed(2)}MB exceeds maximum allowed size ${(docConfig.maxSize / 1024 / 1024).toFixed(2)}MB`);
    }

    // Check if file is empty
    if (file.size === 0) {
      errors.push('File is empty');
    }

    // Check filename
    if (!file.originalname || file.originalname.trim() === '') {
      warnings.push('File has no original name');
    }

    // Check for potentially malicious file extensions
    const dangerousExtensions = ['.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs'];
    const fileExtension = path.extname(file.originalname || '').toLowerCase();
    if (dangerousExtensions.includes(fileExtension)) {
      errors.push(`File extension '${fileExtension}' is not allowed for security reasons`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      recommendations: this.generateRecommendations(file, docConfig)
    };
  }

  /**
   * Generate recommendations for file optimization
   * @param {Object} file - File object
   * @param {Object} docConfig - Document configuration
   * @returns {Array} Array of recommendations
   */
  generateRecommendations(file, docConfig) {
    const recommendations = [];

    // File size recommendations
    if (file.size > docConfig.maxSize * 0.8) {
      recommendations.push('File size is close to limit. Consider compressing the image.');
    }

    // Image format recommendations
    if (file.mimetype === 'image/png' && file.size > 2 * 1024 * 1024) {
      recommendations.push('PNG files can be large. Consider converting to JPEG for better compression.');
    }

    // Quality recommendations
    if (file.mimetype.startsWith('image/')) {
      recommendations.push('Image will be automatically optimized for web delivery.');
    }

    return recommendations;
  }

  /**
   * Get document verification queue
   * @param {Object} filters - Optional filters
   * @param {number} limit - Number of documents to return
   * @param {number} offset - Offset for pagination
   * @returns {Object} Queue data with pagination
   */
  async getVerificationQueue(filters = {}, limit = 20, offset = 0) {
    try {
      let query = this.db.collection('driverDocuments')
        .where('verificationStatus', '==', 'pending')
        .orderBy('createdAt', 'asc');

      // Apply additional filters
      if (filters.documentType) {
        query = query.where('documentType', '==', filters.documentType);
      }
      if (filters.driverId) {
        query = query.where('driverId', '==', filters.driverId);
      }

      // Get total count
      const countSnapshot = await query.get();
      const total = countSnapshot.size;

      // Apply pagination
      query = query.limit(limit).offset(offset);
      const snapshot = await query.get();

      const documents = [];
      snapshot.forEach(doc => {
        documents.push({
          id: doc.id,
          ...doc.data()
        });
      });

      return {
        documents,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
          totalPages: Math.ceil(total / limit)
        }
      };

    } catch (error) {
      console.error('Failed to get verification queue:', error);
      throw new Error(`Failed to get verification queue: ${error.message}`);
    }
  }
}

module.exports = FileUploadService;
    