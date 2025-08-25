const multer = require('multer');
const sharp = require('sharp');
const { getStorage } = require('./firebase');
const path = require('path');
const crypto = require('crypto');

class EnhancedFileUploadService {
  constructor() {
    try {
      this.storage = getStorage();
      this.bucket = this.storage.bucket(process.env.FIREBASE_STORAGE_BUCKET || process.env.STORAGE_BUCKET);
      this.maxFileSize = parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024; // 5MB
      this.allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      this.isAvailable = true;
    } catch (error) {
      console.warn('⚠️ Firebase Storage not available:', error.message);
      this.isAvailable = false;
      this.maxFileSize = parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024; // 5MB
      this.allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    }
  }

  configureMulter() {
    const storage = multer.memoryStorage();
    return multer({
      storage,
      limits: {
        fileSize: this.maxFileSize,
      },
      fileFilter: (req, file, cb) => {
        if (this.allowedTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'));
        }
      }
    });
  }

  async processAndUploadImage(file, userId, type = 'profile') {
    try {
      // Process image with Sharp
      const processedImage = await sharp(file.buffer)
        .resize(400, 400, { fit: 'cover' })
        .jpeg({ quality: 85 })
        .toBuffer();

      // Generate unique filename
      const timestamp = Date.now();
      const randomString = crypto.randomBytes(8).toString('hex');
      const filename = `${type}/${userId}/${timestamp}-${randomString}.jpg`;
      
      if (!this.isAvailable) {
        // Return mock data when Firebase Storage is not available
        console.warn('⚠️ Firebase Storage not available, returning mock upload data');
        return {
          filename,
          url: `https://mock-storage.example.com/${filename}`,
          size: processedImage.length,
          originalName: file.originalname,
          mock: true
        };
      }
      
      // Upload to Firebase Storage
      const fileRef = this.bucket.file(filename);
      await fileRef.save(processedImage, {
        metadata: {
          contentType: 'image/jpeg',
          metadata: {
            userId,
            type,
            originalName: file.originalname,
            uploadedAt: new Date().toISOString(),
            processed: true
          }
        }
      });

      // Get public URL
      const [url] = await fileRef.getSignedUrl({
        action: 'read',
        expires: '03-01-2500' // Far future expiration
      });

      // Store file metadata in Firestore (if available)
      try {
        const db = require('./firebase').getFirestore();
        await db.collection('fileUploads').doc(filename).set({
          userId,
          type,
          filename,
          url,
          size: processedImage.length,
          originalName: file.originalname,
          uploadedAt: new Date(),
          status: 'active'
        });
      } catch (firestoreError) {
        console.warn('⚠️ Firestore not available for file metadata:', firestoreError.message);
      }

      return {
        filename,
        url,
        size: processedImage.length,
        originalName: file.originalname
      };

    } catch (error) {
      console.error('Error processing and uploading image:', error);
      throw error;
    }
  }

  async deleteFile(filename) {
    try {
      if (!this.isAvailable) {
        console.warn('⚠️ Firebase Storage not available, returning mock delete success');
        return { success: true, message: 'File deleted successfully (mock)', mock: true };
      }

      // Delete from Firebase Storage
      await this.bucket.file(filename).delete();

      // Update metadata in Firestore (if available)
      try {
        const db = require('./firebase').getFirestore();
        await db.collection('fileUploads').doc(filename).update({
          status: 'deleted',
          deletedAt: new Date()
        });
      } catch (firestoreError) {
        console.warn('⚠️ Firestore not available for file metadata update:', firestoreError.message);
      }

      return { success: true, message: 'File deleted successfully' };
    } catch (error) {
      console.error('Error deleting file:', error);
      throw error;
    }
  }

  async getFileMetadata(filename) {
    try {
      const db = require('./firebase').getFirestore();
      const fileDoc = await db.collection('fileUploads').doc(filename).get();
      
      if (!fileDoc.exists) {
        return null;
      }

      return fileDoc.data();
    } catch (error) {
      console.error('Error getting file metadata:', error);
      throw error;
    }
  }

  async getUserFiles(userId, type = 'profile') {
    try {
      const db = require('./firebase').getFirestore();
      const filesQuery = await db
        .collection('fileUploads')
        .where('userId', '==', userId)
        .where('type', '==', type)
        .where('status', '==', 'active')
        .orderBy('uploadedAt', 'desc')
        .get();

      return filesQuery.docs.map(doc => doc.data());
    } catch (error) {
      console.error('Error getting user files:', error);
      throw error;
    }
  }

  async cleanupOrphanedFiles() {
    try {
      const db = require('./firebase').getFirestore();
      
      // Find files that are marked as deleted but still exist in storage
      const deletedFiles = await db
        .collection('fileUploads')
        .where('status', '==', 'deleted')
        .get();

      const batch = db.batch();
      let deletedCount = 0;

      for (const doc of deletedFiles.docs) {
        const fileData = doc.data();
        try {
          await this.bucket.file(fileData.filename).delete();
          batch.delete(doc.ref);
          deletedCount++;
        } catch (error) {
          console.warn(`Failed to delete orphaned file: ${fileData.filename}`, error);
        }
      }

      await batch.commit();
      return deletedCount;
    } catch (error) {
      console.error('Error cleaning up orphaned files:', error);
      throw error;
    }
  }

  async validateFile(file) {
    const errors = [];

    // Check file size
    if (file.size > this.maxFileSize) {
      errors.push(`File size must be less than ${this.maxFileSize / (1024 * 1024)}MB`);
    }

    // Check file type
    if (!this.allowedTypes.includes(file.mimetype)) {
      errors.push(`File type must be one of: ${this.allowedTypes.join(', ')}`);
    }

    // Check if file is actually an image
    try {
      const metadata = await sharp(file.buffer).metadata();
      if (!metadata.width || !metadata.height) {
        errors.push('File must be a valid image');
      }
    } catch (error) {
      errors.push('File must be a valid image');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  async generateThumbnail(file, size = 150) {
    try {
      const thumbnail = await sharp(file.buffer)
        .resize(size, size, { fit: 'cover' })
        .jpeg({ quality: 70 })
        .toBuffer();

      return thumbnail;
    } catch (error) {
      console.error('Error generating thumbnail:', error);
      throw error;
    }
  }
}

module.exports = new EnhancedFileUploadService();

    // Check if file is actually an image
    try {
      const metadata = await sharp(file.buffer).metadata();
      if (!metadata.width || !metadata.height) {
        errors.push('File must be a valid image');
      }
    } catch (error) {
      errors.push('File must be a valid image');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  async generateThumbnail(file, size = 150) {
    try {
      const thumbnail = await sharp(file.buffer)
        .resize(size, size, { fit: 'cover' })
        .jpeg({ quality: 70 })
        .toBuffer();

      return thumbnail;
    } catch (error) {
      console.error('Error generating thumbnail:', error);
      throw error;
    }
  }
}

module.exports = new EnhancedFileUploadService();
