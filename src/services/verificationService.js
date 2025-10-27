const admin = require('firebase-admin');

class VerificationService {
  constructor() {
    this.db = null;
  }

  /**
   * Initialize Firestore database connection
   */
  getDb() {
    try {
      // Check if already initialized
      if (this.db && typeof this.db.collection === 'function') {
        return this.db;
      }

      // Try to get Firestore from existing app
      if (admin.apps && admin.apps.length > 0) {
        console.log('📊 [VerificationService] Attempting to get Firestore from existing app');
        this.db = admin.firestore();
        
        // Verify it's functional
        if (this.db && typeof this.db.collection === 'function') {
          console.log('✅ [VerificationService] Firestore initialized successfully');
          return this.db;
        }
      }

      // If still null, try explicit initialization
      console.log('⚠️ [VerificationService] Firestore returned null, retrying...');
      if (admin.apps && admin.apps.length > 0) {
        this.db = admin.firestore();
      }

      if (!this.db || typeof this.db.collection !== 'function') {
        throw new Error('Firestore instance is null after retry');
      }

      return this.db;
    } catch (error) {
      console.error('❌ [VerificationService] Failed to get Firestore:', error);
      console.error('❌ [VerificationService] Error details:', {
        message: error.message,
        stack: error.stack,
        firebaseApps: admin.apps ? admin.apps.length : 0
      });
      this.db = null;
      throw error;
    }
  }

  /**
   * Get database instance (safe - returns null on error)
   */
  getDbSafe() {
    try {
      return this.getDb();
    } catch {
      console.error('⚠️ [VerificationService] Database instance is null - returning null for graceful fallback');
      return null;
    }
  }

  /**
   * Get comprehensive verification data for a driver
   */
  async getDriverVerificationData(driverId) {
    const db = this.getDbSafe();
    
    if (!db) {
      console.warn('⚠️ [VerificationService] Firestore not available, skipping verification data');
      return null;
    }

    try {
      console.log('🔍 Getting verification data for driver:', driverId);

      // Fetch user document
      const userDoc = await db.collection('users').doc(driverId).get();
      
      if (!userDoc.exists) {
        console.log('⚠️ [VerificationService] User not found:', driverId);
        return null;
      }

      const userData = userDoc.data();
      
      // ✅ Documents are stored in Firebase Storage: drivers/{driverId}/documents/{type}/
      // ✅ Verification status is stored in Firestore: users/{driverId}.driver.documents.{type}
      
      // Get documents from user collection
      const documents = userData.driver?.documents || {};
      
      console.log('📄 Available document keys:', Object.keys(documents));

      // Count verified documents
      const requiredDocs = ['drivingLicense', 'aadhaarCard', 'bikeInsurance', 'rcBook', 'profilePhoto'];
      let verifiedCount = 0;
      let totalCount = 0;

      requiredDocs.forEach(docType => {
        const camelKey = docType;
        const snakeCaseKey = docType.replace(/([A-Z])/g, '_$1').toLowerCase();
        // Try both camelCase and snake_case keys
        const doc = documents[camelKey] || documents[snakeCaseKey];

        if (doc) {
          const hasUrl = (doc.url || doc.downloadURL) && (doc.url !== '' || doc.downloadURL !== '');
          
          // Check if document is verified (even if URL is empty, it might still be verified)
          const isVerified = doc.verified === true || doc.status === 'verified' || doc.verificationStatus === 'verified';
          
          if (hasUrl || isVerified) {
            // Document exists with either URL or verification status
            totalCount++;
            
            if (isVerified) {
              verifiedCount++;
              console.log(`✅ Document verified: ${docType} (key: ${documents[camelKey] ? camelKey : snakeCaseKey}, hasUrl: ${hasUrl ? 'yes' : 'no'})`);
            } else {
              console.log(`⏳ Document not verified: ${docType} (key: ${documents[camelKey] ? camelKey : snakeCaseKey})`);
            }
          }
        } else {
          console.log(`❌ Document not found: ${docType}`);
        }
      });
      
      console.log(`📊 Document count summary: ${verifiedCount} verified out of ${totalCount} total`);

      // Determine status
      let verificationStatus;
      if (totalCount === 0) {
        verificationStatus = 'pending';
      } else if (verifiedCount === 0) {
        verificationStatus = 'pending_verification';
      } else if (verifiedCount < totalCount) {
        verificationStatus = 'pending_verification';
      } else {
        verificationStatus = 'verified';
      }

      // Check for admin approval
      if (userData.driver?.verificationStatus === 'approved' && verifiedCount === totalCount) {
        verificationStatus = 'approved';
      }

      return {
        verificationStatus,
        verifiedDocumentsCount: verifiedCount,
        totalDocumentsCount: totalCount,
        isVerified: verificationStatus === 'verified' || verificationStatus === 'approved',
        documents: documents
      };
    } catch (error) {
      console.error('❌ [VerificationService] Error fetching verification data:', error);
      return null;
    }
  }

  /**
   * Update driver verification status
   */
  async updateDriverVerificationStatus(driverId, verificationData) {
    const db = this.getDbSafe();
    
    if (!db) {
      console.warn('⚠️ [VerificationService] Firestore not available');
      return { success: false, error: 'Database not available' };
    }

    try {
      const updates = {
        'driver.verificationStatus': verificationData.verificationStatus,
        'driver.isVerified': verificationData.isVerified || false,
        'driver.verifiedDocumentsCount': verificationData.verifiedDocumentsCount || 0,
        'driver.totalDocumentsCount': verificationData.totalDocumentsCount || 0,
        'driver.lastVerificationUpdate': admin.firestore.FieldValue.serverTimestamp()
      };

      await db.collection('users').doc(driverId).update(updates);
      
      console.log('✅ [VerificationService] Updated driver verification status:', driverId);
      
      return { success: true };
    } catch (error) {
      console.error('❌ [VerificationService] Error updating verification status:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Verify a specific driver document
   */
  async verifyDriverDocument(driverId, documentType, status, comments, rejectionReason, adminId) {
    const db = this.getDbSafe();
    
    if (!db) {
      console.warn('⚠️ [VerificationService] Firestore not available');
      return { success: false, error: 'Database not available' };
    }

    try {
      // ✅ CRITICAL FIX: Normalize document type to snake_case
      // Admin sends camelCase (e.g., "drivingLicense") but documents are stored in snake_case (e.g., "driving_license")
      const normalizedType = documentType.replace(/([A-Z])/g, '_$1').toLowerCase();
      console.log(`🔧 [VerificationService] Normalizing document type: ${documentType} → ${normalizedType}`);
      
      // Update document status using normalized type at driver.documents.{type}
      const docPath = `driver.documents.${normalizedType}`;
      const updates = {
        [`${docPath}.verified`]: status === 'verified',
        [`${docPath}.status`]: status,
        [`${docPath}.verificationStatus`]: status,
        [`${docPath}.verifiedAt`]: admin.firestore.FieldValue.serverTimestamp(),
        [`${docPath}.verifiedBy`]: adminId,
        [`${docPath}.comments`]: comments || null
      };

      if (status === 'rejected') {
        updates[`${docPath}.rejectionReason`] = rejectionReason || null;
      }

      console.log(`📝 [VerificationService] Updating document: ${docPath} with status: ${status}`);
      console.log(`📝 [VerificationService] Updates:`, JSON.stringify(updates, null, 2));
      
      await db.collection('users').doc(driverId).update(updates);
      
      // ✅ Log the update for debugging
      const updatedDoc = await db.collection('users').doc(driverId).get();
      const updatedData = updatedDoc.data();
      console.log(`✅ [VerificationService] Updated document in Firestore:`, {
        path: docPath,
        status,
        verified: updatedData?.driver?.documents?.[normalizedType]?.verified,
        verifiedAt: updatedData?.driver?.documents?.[normalizedType]?.verifiedAt
      });

      // Recalculate overall status
      const verificationData = await this.getDriverVerificationData(driverId);
      if (verificationData) {
        await this.updateDriverVerificationStatus(driverId, verificationData);
      }

      console.log('✅ [VerificationService] Document verified:', driverId, documentType, status);
      
      return { success: true, verificationData };
    } catch (error) {
      console.error('❌ [VerificationService] Error verifying document:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Sync all drivers' verification status
   */
  async syncAllDriversVerificationStatus() {
    const db = this.getDbSafe();
    
    if (!db) {
      console.warn('⚠️ [VerificationService] Firestore not available');
      return { success: false, count: 0 };
    }

    try {
      const driversSnapshot = await db.collection('users')
        .where('userType', '==', 'driver')
        .get();

      let syncedCount = 0;
      
      for (const doc of driversSnapshot.docs) {
        const verificationData = await this.getDriverVerificationData(doc.id);
        if (verificationData) {
          await this.updateDriverVerificationStatus(doc.id, verificationData);
          syncedCount++;
        }
      }

      console.log('✅ [VerificationService] Synced verification status for', syncedCount, 'drivers');
      
      return { success: true, count: syncedCount };
    } catch (error) {
      console.error('❌ [VerificationService] Error syncing verification status:', error);
      return { success: false, count: 0, error: error.message };
    }
  }

  /**
   * Approve driver
   */
  async approveDriver(driverId, comments, adminId) {
    const db = this.getDbSafe();
    
    if (!db) {
      return { success: false, error: 'Database not available' };
    }

    try {
      const updates = {
        'driver.verificationStatus': 'approved',
        'driver.isVerified': true,
        'driver.approvedAt': admin.firestore.FieldValue.serverTimestamp(),
        'driver.approvedBy': adminId
      };

      if (comments) {
        updates['driver.adminNotes'] = comments;
      }

      await db.collection('users').doc(driverId).update(updates);
      
      return { success: true };
    } catch (error) {
      console.error('❌ [VerificationService] Error approving driver:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Reject driver
   */
  async rejectDriver(driverId, reason, adminId) {
    const db = this.getDbSafe();
    
    if (!db) {
      return { success: false, error: 'Database not available' };
    }

    try {
      const updates = {
        'driver.verificationStatus': 'rejected',
        'driver.isVerified': false,
        'driver.rejectedAt': admin.firestore.FieldValue.serverTimestamp(),
        'driver.rejectedBy': adminId,
        'driver.rejectionReason': reason
      };

      await db.collection('users').doc(driverId).update(updates);
      
      return { success: true };
    } catch (error) {
      console.error('❌ [VerificationService] Error rejecting driver:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new VerificationService();
