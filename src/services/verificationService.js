const { getFirestore } = require('firebase-admin/firestore');

class VerificationService {
  constructor() {
    this.db = getFirestore();
  }

  /**
   * Normalize document field names to ensure consistency
   * Maps from various formats to the standard camelCase format used in users collection
   */
  normalizeDocumentField(fieldName) {
    const fieldMap = {
      // Snake case to camelCase (from driverDocuments collection)
      'driving_license': 'drivingLicense',
      'aadhaar_card': 'aadhaarCard',
      'aadhaar': 'aadhaarCard',
      'bike_insurance': 'bikeInsurance',
      'insurance': 'bikeInsurance',
      'rc_book': 'rcBook',
      'profile_photo': 'profilePhoto',
      // Already camelCase (pass through)
      'drivingLicense': 'drivingLicense',
      'aadhaarCard': 'aadhaarCard',
      'bikeInsurance': 'bikeInsurance',
      'rcBook': 'rcBook',
      'profilePhoto': 'profilePhoto'
    };
    return fieldMap[fieldName] || fieldName;
  }

  /**
   * Convert camelCase document type to snake_case for driverDocuments collection queries
   */
  toSnakeCase(fieldName) {
    const fieldMap = {
      'drivingLicense': 'driving_license',
      'aadhaarCard': 'aadhaar_card',
      'bikeInsurance': 'bike_insurance',
      'rcBook': 'rc_book',
      'profilePhoto': 'profile_photo'
    };
    return fieldMap[fieldName] || fieldName;
  }

  /**
   * Get all document types that should be verified
   */
  getRequiredDocumentTypes() {
    return ['drivingLicense', 'aadhaarCard', 'bikeInsurance', 'rcBook', 'profilePhoto'];
  }

  /**
   * Calculate verification status based on document statuses
   */
  calculateVerificationStatus(documents) {
    const requiredDocs = this.getRequiredDocumentTypes();
    let verifiedCount = 0;
    let rejectedCount = 0;
    let totalWithDocuments = 0;

    requiredDocs.forEach(docType => {
      const doc = documents[docType];
      if (doc && (doc.url || doc.downloadURL)) {
        totalWithDocuments++;
        const status = doc.verificationStatus || doc.status || 'pending';
        const verified = doc.verified || false;
        
        if (verified || status === 'verified') {
          verifiedCount++;
        } else if (status === 'rejected') {
          rejectedCount++;
        }
      }
    });

    // Determine overall status
    if (totalWithDocuments === 0) {
      return { status: 'pending', verifiedCount, rejectedCount, totalWithDocuments };
    } else if (verifiedCount === totalWithDocuments) {
      return { status: 'verified', verifiedCount, rejectedCount, totalWithDocuments };
    } else if (rejectedCount > 0) {
      return { status: 'rejected', verifiedCount, rejectedCount, totalWithDocuments };
    } else if (verifiedCount > 0 || totalWithDocuments > 0) {
      return { status: 'pending_verification', verifiedCount, rejectedCount, totalWithDocuments };
    } else {
      return { status: 'pending', verifiedCount, rejectedCount, totalWithDocuments };
    }
  }

  /**
   * Normalize documents from different sources
   */
  normalizeDocuments(rawDocuments) {
    const normalized = {};
    const requiredDocs = this.getRequiredDocumentTypes();

    requiredDocs.forEach(docType => {
      // Try multiple field name variations
      const possibleFields = [
        docType,
        docType.replace(/([A-Z])/g, '_$1').toLowerCase(), // camelCase to snake_case
        docType.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
      ];

      let foundDoc = null;
      for (const field of possibleFields) {
        if (rawDocuments[field]) {
          foundDoc = rawDocuments[field];
          break;
        }
      }

      if (foundDoc) {
        normalized[docType] = {
          url: foundDoc.downloadURL || foundDoc.url || '',
          status: foundDoc.verificationStatus || foundDoc.status || 'pending',
          uploadedAt: foundDoc.uploadedAt || '',
          verified: foundDoc.verified || false,
          rejectionReason: foundDoc.rejectionReason || null,
          verifiedAt: foundDoc.verifiedAt || null,
          verifiedBy: foundDoc.verifiedBy || null
        };
      } else {
        normalized[docType] = {
          url: '',
          status: 'pending',
          uploadedAt: '',
          verified: false,
          rejectionReason: null,
          verifiedAt: null,
          verifiedBy: null
        };
      }
    });

    return normalized;
  }

  /**
   * Get comprehensive driver verification data
   */
  async getDriverVerificationData(driverId) {
    try {
      console.log(`🔍 Getting verification data for driver: ${driverId}`);

      // Get driver from users collection
      const driverDoc = await this.db.collection('users').doc(driverId).get();
      if (!driverDoc.exists) {
        throw new Error('Driver not found');
      }

      const driverData = driverDoc.data();
      
      // Get verification request
      const verificationQuery = await this.db.collection('documentVerificationRequests')
        .where('driverId', '==', driverId)
        .orderBy('requestedAt', 'desc')
        .limit(1)
        .get();

      // Get driver documents collection
      const driverDocsQuery = await this.db.collection('driverDocuments')
        .where('driverId', '==', driverId)
        .get();

      console.log(`📊 Found ${driverDocsQuery.docs.length} documents in driverDocuments collection`);
      console.log(`📊 Found ${verificationQuery.docs.length} verification requests`);

      // Initialize documents with all required types
      const requiredDocs = this.getRequiredDocumentTypes();
      const documents = {};
      requiredDocs.forEach(docType => {
        documents[docType] = {
          url: '',
          status: 'pending',
          verificationStatus: 'pending',
          uploadedAt: '',
          verified: false,
          rejectionReason: null,
          verifiedAt: null,
          verifiedBy: null,
          comments: null
        };
      });

      let source = 'empty';

      // 1. Start with user collection documents (baseline)
      const userDocs = driverData.driver?.documents || driverData.documents || {};
      if (Object.keys(userDocs).length > 0) {
        Object.entries(userDocs).forEach(([key, doc]) => {
          const normalizedKey = this.normalizeDocumentField(key);
          if (documents[normalizedKey]) {
            documents[normalizedKey] = {
              ...documents[normalizedKey],
              url: doc.url || doc.downloadURL || '',
              status: doc.status || 'pending',
              verificationStatus: doc.verificationStatus || doc.status || 'pending',
              uploadedAt: doc.uploadedAt || '',
              verified: doc.verified || false,
              rejectionReason: doc.rejectionReason || null,
              verifiedAt: doc.verifiedAt || null,
              verifiedBy: doc.verifiedBy || null,
              comments: doc.comments || null
            };
          }
        });
        source = 'user_collection';
      }

      // 2. Override with driverDocuments collection data (most recent and detailed)
      if (!driverDocsQuery.empty) {
        console.log(`📄 Processing ${driverDocsQuery.docs.length} documents from driverDocuments collection`);
        driverDocsQuery.docs.forEach(doc => {
          const docData = doc.data();
          const docType = this.normalizeDocumentField(docData.documentType || doc.id);
          
          console.log(`📄 Processing document: ${docData.documentType} → ${docType}`);
          
          if (documents[docType] && (docData.uploadDetails?.downloadURL || docData.downloadURL || docData.url)) {
            documents[docType] = {
              ...documents[docType],
              url: docData.uploadDetails?.downloadURL || docData.downloadURL || docData.url,
              status: docData.status || 'uploaded',
              verificationStatus: docData.verification?.status || docData.verificationStatus || 'pending',
              uploadedAt: docData.uploadedAt || docData.createdAt || '',
              verified: docData.verification?.status === 'verified' || docData.verified || false,
              filename: docData.filename || docData.originalName || '',
              rejectionReason: docData.verification?.rejectionReason || docData.rejectionReason || null,
              verifiedAt: docData.verification?.verifiedAt || docData.verifiedAt || null,
              verifiedBy: docData.verification?.verifiedBy || docData.verifiedBy || null,
              comments: docData.verification?.comments || null
            };
            console.log(`✅ Updated ${docType}: ${documents[docType].url ? 'Has URL' : 'No URL'} (${documents[docType].verificationStatus})`);
          }
        });
        source = 'driverDocuments_collection';
      }

      // 3. Override with verification request data where available (admin verification status)
      if (!verificationQuery.empty) {
        console.log(`📋 Processing verification request data`);
        const verificationData = verificationQuery.docs[0].data();
        const verificationDocs = verificationData.documents || {};
        
        Object.entries(verificationDocs).forEach(([key, verificationDoc]) => {
          const normalizedKey = this.normalizeDocumentField(key);
          console.log(`📋 Processing verification doc: ${key} → ${normalizedKey}`);
          if (documents[normalizedKey] && verificationDoc.downloadURL) {
            documents[normalizedKey] = {
              ...documents[normalizedKey],
              url: verificationDoc.downloadURL,
              status: verificationDoc.status || 'uploaded',
              verificationStatus: verificationDoc.verificationStatus || 'pending',
              uploadedAt: verificationDoc.uploadedAt || '',
              verified: verificationDoc.verified || false,
              filename: verificationDoc.filename || '',
              rejectionReason: verificationDoc.rejectionReason || null,
              verifiedAt: verificationDoc.verifiedAt || null,
              verifiedBy: verificationDoc.verifiedBy || null,
              comments: verificationDoc.comments || null
            };
            console.log(`✅ Updated from verification request: ${normalizedKey} (${documents[normalizedKey].verificationStatus})`);
          }
        });
        
        source = 'merged_all_sources';
      }

      // Normalize documents (ensure consistent structure)
      const normalizedDocuments = this.normalizeDocuments(documents);
      
      // Calculate verification status
      const verificationStatus = this.calculateVerificationStatus(normalizedDocuments);
      
      console.log(`📊 Final verification status: ${verificationStatus.status} (${verificationStatus.verifiedCount}/${verificationStatus.totalWithDocuments} verified)`);
      
      return {
        driverId,
        driverName: driverData.name || 'Unknown',
        documents: normalizedDocuments,
        verificationStatus: verificationStatus.status,
        isVerified: verificationStatus.status === 'verified',
        source,
        documentSummary: {
          total: verificationStatus.totalWithDocuments,
          verified: verificationStatus.verifiedCount,
          rejected: verificationStatus.rejectedCount,
          pending: verificationStatus.totalWithDocuments - verificationStatus.verifiedCount - verificationStatus.rejectedCount
        }
      };

    } catch (error) {
      console.error('❌ Error getting driver verification data:', error);
      throw error;
    }
  }

  /**
   * Update driver verification status in all relevant collections
   */
  async updateDriverVerificationStatus(driverId, verificationData) {
    const batch = this.db.batch();
    
    try {
      console.log(`🔄 Updating verification status for driver: ${driverId}`);

      // Update user collection
      const driverRef = this.db.collection('users').doc(driverId);
      batch.update(driverRef, {
        'driver.verificationStatus': verificationData.verificationStatus,
        'driver.isVerified': verificationData.isVerified,
        'isVerified': verificationData.isVerified,
        'driver.verifiedDocumentsCount': verificationData.documentSummary.verified,
        'driver.totalDocumentsCount': verificationData.documentSummary.total,
        updatedAt: new Date()
      });

      // Update verification request if exists
      const verificationQuery = await this.db.collection('documentVerificationRequests')
        .where('driverId', '==', driverId)
        .where('status', '==', 'pending')
        .limit(1)
        .get();

      if (!verificationQuery.empty) {
        const verificationDoc = verificationQuery.docs[0];
        batch.update(verificationDoc.ref, {
          status: verificationData.verificationStatus,
          updatedAt: new Date()
        });
      }

      await batch.commit();
      console.log(`✅ Verification status updated for driver: ${driverId} - ${verificationData.verificationStatus} (${verificationData.documentSummary.verified}/${verificationData.documentSummary.total})`);

    } catch (error) {
      console.error('❌ Error updating verification status:', error);
      throw error;
    }
  }

  /**
   * Verify a driver document
   */
  async verifyDriverDocument(driverId, documentType, status, comments, rejectionReason, adminId) {
    try {
      console.log(`📄 Verifying document ${documentType} for driver: ${driverId}`);
      
      const batch = this.db.batch();
      const driverRef = this.db.collection('users').doc(driverId);
      
      // Get current driver data
      const driverDoc = await driverRef.get();
      if (!driverDoc.exists) {
        throw new Error('Driver not found');
      }
      
      const driverData = driverDoc.data();
      const documents = driverData.driver?.documents || driverData.documents || {};
      
      // Normalize document type
      const normalizedDocType = this.normalizeDocumentField(documentType);
      
      // Update specific document in users collection
      if (documents[normalizedDocType]) {
        documents[normalizedDocType] = {
          ...documents[normalizedDocType],
          status: status === 'verified' ? 'verified' : 'rejected',
          verified: status === 'verified',
          verifiedAt: new Date(),
          verifiedBy: adminId,
          verificationComments: comments || null,
          rejectionReason: status === 'rejected' ? rejectionReason : null
        };
        
        // Update driver's documents
        batch.update(driverRef, {
          'driver.documents': documents,
          updatedAt: new Date()
        });
      }

      // Update driverDocuments collection (use snake_case for query)
      const snakeCaseDocType = this.toSnakeCase(documentType);
      const driverDocsQuery = await this.db.collection('driverDocuments')
        .where('driverId', '==', driverId)
        .where('documentType', '==', snakeCaseDocType)
        .get();

      if (!driverDocsQuery.empty) {
        driverDocsQuery.docs.forEach(doc => {
          batch.update(doc.ref, {
            'verification.status': status === 'verified' ? 'verified' : 'rejected',
            'verification.verifiedBy': adminId,
            'verification.verifiedAt': new Date(),
            'verification.comments': comments || null,
            'verification.rejectionReason': status === 'rejected' ? rejectionReason : null,
            verificationStatus: status === 'verified' ? 'verified' : 'rejected',
            verified: status === 'verified',
            verifiedAt: new Date(),
            verifiedBy: adminId,
            updatedAt: new Date()
          });
        });
      }
      
      // Update verification request if exists
      const verificationQuery = await this.db.collection('documentVerificationRequests')
        .where('driverId', '==', driverId)
        .where('status', '==', 'pending')
        .limit(1)
        .get();

      if (!verificationQuery.empty) {
        const verificationDoc = verificationQuery.docs[0];
        const verificationData = verificationDoc.data();
        
        if (verificationData.documents && verificationData.documents[normalizedDocType]) {
          verificationData.documents[normalizedDocType] = {
            ...verificationData.documents[normalizedDocType],
            verificationStatus: status === 'verified' ? 'verified' : 'rejected',
            verified: status === 'verified',
            verifiedAt: new Date(),
            verifiedBy: adminId,
            verificationComments: comments || null,
            rejectionReason: status === 'rejected' ? rejectionReason : null
          };
          
          batch.update(verificationDoc.ref, {
            documents: verificationData.documents,
            updatedAt: new Date()
          });
        }
      }
      
      await batch.commit();
      
      // Recalculate overall verification status
      const normalizedDocuments = this.normalizeDocuments(documents);
      const verificationStatus = this.calculateVerificationStatus(normalizedDocuments);
      await this.updateDriverVerificationStatus(driverId, verificationStatus);
      
      console.log(`✅ Document ${documentType} ${status} for driver: ${driverId}`);
      
      return {
        success: true,
        message: `Document ${status} successfully`,
        data: {
          driverId,
          documentType: normalizedDocType,
          status,
          verificationStatus: verificationStatus.status,
          isVerified: verificationStatus.status === 'verified',
          documentSummary: {
            total: verificationStatus.totalWithDocuments,
            verified: verificationStatus.verifiedCount,
            rejected: verificationStatus.rejectedCount,
            pending: verificationStatus.totalWithDocuments - verificationStatus.verifiedCount - verificationStatus.rejectedCount
          },
          verifiedAt: new Date(),
          verifiedBy: adminId
        }
      };

    } catch (error) {
      console.error('❌ Error verifying document:', error);
      throw error;
    }
  }

  /**
   * Approve a driver
   */
  async approveDriver(driverId, adminNotes, adminId) {
    try {
      console.log(`✅ Approving driver: ${driverId}`);
      
      const batch = this.db.batch();
      const driverRef = this.db.collection('users').doc(driverId);
      
      // Update driver status
      batch.update(driverRef, {
        'driver.verificationStatus': 'approved',
        'driver.isVerified': true,
        'isVerified': true,
        'driver.approvedAt': new Date(),
        'driver.approvedBy': adminId,
        'driver.adminNotes': adminNotes || null,
        updatedAt: new Date()
      });

      // Update verification request if exists
      const verificationQuery = await this.db.collection('documentVerificationRequests')
        .where('driverId', '==', driverId)
        .where('status', '==', 'pending')
        .limit(1)
        .get();

      if (!verificationQuery.empty) {
        const verificationDoc = verificationQuery.docs[0];
        batch.update(verificationDoc.ref, {
          status: 'approved',
          reviewedAt: new Date(),
          reviewedBy: adminId,
          reviewNotes: adminNotes || null,
          updatedAt: new Date()
        });
      }

      await batch.commit();
      
      // Initialize wallet if needed
      const driverDoc = await driverRef.get();
      const driverData = driverDoc.data();
      
      if (!driverData.driver?.wallet) {
        await driverRef.update({
          'driver.wallet': {
            balance: 500,
            currency: 'INR',
            lastUpdated: new Date(),
            transactions: []
          }
        });
      }

      console.log(`✅ Driver approved: ${driverId}`);
      
      return {
        success: true,
        message: 'Driver approved successfully',
        data: {
          driverId,
          status: 'approved',
          approvedAt: new Date(),
          approvedBy: adminId
        }
      };

    } catch (error) {
      console.error('❌ Error approving driver:', error);
      throw error;
    }
  }

  /**
   * Reject a driver
   */
  async rejectDriver(driverId, reason, adminId) {
    try {
      console.log(`❌ Rejecting driver: ${driverId}`);
      
      const batch = this.db.batch();
      const driverRef = this.db.collection('users').doc(driverId);
      
      // Update driver status
      batch.update(driverRef, {
        'driver.verificationStatus': 'rejected',
        'driver.isVerified': false,
        'isVerified': false,
        'driver.rejectedAt': new Date(),
        'driver.rejectedBy': adminId,
        'driver.rejectionReason': reason,
        updatedAt: new Date()
      });

      // Update verification request if exists
      const verificationQuery = await this.db.collection('documentVerificationRequests')
        .where('driverId', '==', driverId)
        .where('status', '==', 'pending')
        .limit(1)
        .get();

      if (!verificationQuery.empty) {
        const verificationDoc = verificationQuery.docs[0];
        batch.update(verificationDoc.ref, {
          status: 'rejected',
          reviewedAt: new Date(),
          reviewedBy: adminId,
          rejectionReason: reason,
          updatedAt: new Date()
        });
      }

      await batch.commit();
      
      console.log(`❌ Driver rejected: ${driverId}`);
      
      return {
        success: true,
        message: 'Driver rejected successfully',
        data: {
          driverId,
          status: 'rejected',
          rejectedAt: new Date(),
          rejectedBy: adminId,
          rejectionReason: reason
        }
      };

    } catch (error) {
      console.error('❌ Error rejecting driver:', error);
      throw error;
    }
  }

  /**
   * Sync all drivers verification status
   */
  async syncAllDriversVerificationStatus() {
    try {
      console.log('🔄 Syncing verification status for all drivers...');

      const driversSnapshot = await this.db.collection('users')
        .where('userType', '==', 'driver')
        .get();

      const results = [];
      let successCount = 0;
      let errorCount = 0;

      for (const driverDoc of driversSnapshot.docs) {
        try {
          const driverData = driverDoc.data();
          const documents = driverData.driver?.documents || driverData.documents || {};
          const normalizedDocuments = this.normalizeDocuments(documents);
          const verificationStatus = this.calculateVerificationStatus(normalizedDocuments);

          // Update driver if status changed
          const currentStatus = driverData.driver?.verificationStatus || 'pending';
          if (verificationStatus.status !== currentStatus) {
            await this.updateDriverVerificationStatus(driverDoc.id, verificationStatus);
            
            results.push({
              driverId: driverDoc.id,
              driverName: driverData.name || 'Unknown',
              oldStatus: currentStatus,
              newStatus: verificationStatus.status,
              success: true
            });
          } else {
            results.push({
              driverId: driverDoc.id,
              driverName: driverData.name || 'Unknown',
              status: verificationStatus.status,
              success: true,
              noChange: true
            });
          }

          successCount++;

        } catch (error) {
          results.push({
            driverId: driverDoc.id,
            driverName: 'Unknown',
            error: error.message,
            success: false
          });
          errorCount++;
        }
      }

      console.log(`✅ Sync completed: ${successCount} successful, ${errorCount} errors`);

      return {
        totalDrivers: driversSnapshot.size,
        successCount,
        errorCount,
        results
      };

    } catch (error) {
      console.error('❌ Error syncing all drivers verification status:', error);
      throw error;
    }
  }
}

module.exports = new VerificationService();
