const { getFirestore } = require('firebase-admin/firestore');

class VerificationService {
  constructor() {
    this.db = getFirestore();
  }

  /**
   * Normalize document field names to ensure consistency
   */
  normalizeDocumentField(fieldName) {
    const fieldMap = {
      'driving_license': 'drivingLicense',
      'aadhaar_card': 'aadhaarCard',
      'bike_insurance': 'bikeInsurance',
      'rc_book': 'rcBook',
      'profile_photo': 'profilePhoto'
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

      let documents = {};
      let source = 'user_collection';

      if (!verificationQuery.empty) {
        // Use verification request data (most recent)
        const verificationData = verificationQuery.docs[0].data();
        const verificationDocs = verificationData.documents || {};
        
        // Merge with user collection documents
        const userDocs = driverData.driver?.documents || driverData.documents || {};
        documents = { ...userDocs };

        // Override with verification request data where available
        Object.entries(verificationDocs).forEach(([key, verificationDoc]) => {
          if (verificationDoc.downloadURL) {
            const normalizedKey = this.normalizeDocumentField(key);
            documents[normalizedKey] = {
              ...documents[normalizedKey],
              url: verificationDoc.downloadURL,
              verificationStatus: verificationDoc.verificationStatus || 'pending',
              status: verificationDoc.status || 'uploaded',
              filename: verificationDoc.filename,
              uploadedAt: verificationDoc.uploadedAt
            };
          }
        });
        
        source = 'merged_verification_and_user';
      } else {
        // Use user collection documents
        documents = driverData.driver?.documents || driverData.documents || {};
      }

      // Normalize documents
      const normalizedDocuments = this.normalizeDocuments(documents);
      
      // Calculate verification status
      const verificationStatus = this.calculateVerificationStatus(normalizedDocuments);
      
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
        'driver.verificationStatus': verificationData.status,
        'driver.isVerified': verificationData.status === 'verified',
        'isVerified': verificationData.status === 'verified',
        'driver.verifiedDocumentsCount': verificationData.verifiedCount,
        'driver.totalDocumentsCount': verificationData.totalWithDocuments,
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
          status: verificationData.status,
          updatedAt: new Date()
        });
      }

      await batch.commit();
      console.log(`✅ Verification status updated for driver: ${driverId}`);

    } catch (error) {
      console.error('❌ Error updating verification status:', error);
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
