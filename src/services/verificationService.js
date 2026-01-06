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
          
          // ✅ CRITICAL: Check multiple verification status fields for compatibility
          const isVerified = doc.verified === true || 
                            doc.status === 'verified' || 
                            doc.verificationStatus === 'verified' ||
                            doc.verificationStatus === 'approved';
          
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

      // ✅ CRITICAL FIX: Determine status based on documents (source of truth)
      // Documents are the source of truth - calculate status strictly from document verification
      let verificationStatus;
      const requiredDocsCount = requiredDocs.length;
      
      // ✅ CRITICAL: Check for rejected documents first
      let rejectedCount = 0;
      requiredDocs.forEach(docType => {
        const camelKey = docType;
        const snakeCaseKey = docType.replace(/([A-Z])/g, '_$1').toLowerCase();
        const doc = documents[camelKey] || documents[snakeCaseKey];
        if (doc && (doc.url || doc.downloadURL)) {
          const isRejected = doc.status === 'rejected' || 
                           doc.verificationStatus === 'rejected' ||
                           doc.rejected === true;
          if (isRejected) {
            rejectedCount++;
          }
        }
      });
      
      // ✅ CRITICAL: Calculate status strictly from documents (source of truth)
      if (totalCount === 0) {
        // No documents uploaded at all
        verificationStatus = 'not_uploaded';
      } else if (rejectedCount > 0) {
        // Any document rejected → driver is rejected
        verificationStatus = 'rejected';
      } else if (verifiedCount === requiredDocsCount && totalCount === requiredDocsCount) {
        // ✅ CRITICAL: ALL required documents are uploaded AND verified → driver is verified
        verificationStatus = 'verified';
      } else if (totalCount < requiredDocsCount) {
        // Some documents uploaded but not all required documents
        verificationStatus = 'pending_verification';
      } else if (verifiedCount < requiredDocsCount) {
        // All documents uploaded but not all verified
        verificationStatus = 'pending_verification';
      } else {
        // Fallback
        verificationStatus = 'pending_verification';
      }

      // ✅ CRITICAL: Preserve 'approved' status only if all documents are verified
      // 'approved' is a special status that means verified + admin approved
      if (userData.driver?.verificationStatus === 'approved' && verifiedCount === requiredDocsCount && totalCount === requiredDocsCount) {
        verificationStatus = 'approved';
      }

      // ✅ CRITICAL: isVerified is ONLY true if verificationStatus is 'verified' or 'approved'
      // This ensures consistency - driver is only verified if ALL documents are verified
      const isVerified = verificationStatus === 'verified' || verificationStatus === 'approved';

      return {
        verificationStatus,
        verifiedDocumentsCount: verifiedCount,
        totalDocumentsCount: totalCount,
        requiredDocumentsCount: requiredDocsCount,
        isVerified: isVerified,
        documents: documents
      };
    } catch (error) {
      console.error('❌ [VerificationService] Error fetching verification data:', error);
      return null;
    }
  }

  /**
   * Update driver verification status
   * ✅ CRITICAL FIX: Ensures both nested and top-level isVerified are set
   * ✅ CRITICAL: isVerified is ONLY true if ALL documents are verified
   */
  async updateDriverVerificationStatus(driverId, verificationData) {
    const db = this.getDbSafe();
    
    if (!db) {
      console.warn('⚠️ [VerificationService] Firestore not available');
      return { success: false, error: 'Database not available' };
    }

    try {
      // ✅ CRITICAL: isVerified should ONLY be true if verificationStatus is 'verified' or 'approved'
      // This ensures consistency - driver is only verified if ALL documents are verified
      const isVerified = verificationData.verificationStatus === 'verified' || 
                        verificationData.verificationStatus === 'approved';
      
      const updates = {
        'driver.verificationStatus': verificationData.verificationStatus,
        'driver.isVerified': isVerified, // ✅ CRITICAL: Only true if status is 'verified'
        'isVerified': isVerified, // ✅ CRITICAL: Also set top-level isVerified for dashboard consistency
        'driver.verifiedDocumentsCount': verificationData.verifiedDocumentsCount || 0,
        'driver.totalDocumentsCount': verificationData.totalDocumentsCount || 0,
        'driver.lastVerificationUpdate': admin.firestore.FieldValue.serverTimestamp()
      };

      await db.collection('users').doc(driverId).update(updates);
      
      console.log(`✅ [VerificationService] Updated driver ${driverId} verification status: ${verificationData.verificationStatus}, isVerified: ${isVerified}`);
      
      // ✅ CRITICAL FIX: Invalidate document status cache so driver app sees verification immediately
      try {
        const { invalidateUserCache } = require('../middleware/cache');
        invalidateUserCache(driverId);
        console.log('✅ [VerificationService] Document status cache invalidated for driver:', driverId);
      } catch (cacheError) {
        console.warn('⚠️ [VerificationService] Could not invalidate document status cache:', cacheError?.message);
      }
      
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
      
      // ✅ CRITICAL FIX: Also update documentVerificationRequests collection
      // This is where the admin dashboard reads document status from, so it MUST be updated
      try {
        const verificationRequestsQuery = db.collection('documentVerificationRequests')
          .where('driverId', '==', driverId)
          .orderBy('createdAt', 'desc')
          .limit(1);
        
        const verificationRequestsSnapshot = await verificationRequestsQuery.get();
        
        if (!verificationRequestsSnapshot.empty) {
          const latestRequest = verificationRequestsSnapshot.docs[0];
          const requestData = latestRequest.data();
          const requestDocuments = requestData.documents || {};
          
          // Update the specific document in the verification request
          // Handle both camelCase and snake_case document keys
          // documentType comes from admin (e.g., "drivingLicense")
          // normalizedType is snake_case (e.g., "driving_license")
          
          // Try to find the document in the request (could be camelCase, snake_case, or any variation)
          let foundDocKey = null;
          
          // First try exact matches
          if (requestDocuments[documentType]) {
            foundDocKey = documentType; // camelCase from admin
          } else if (requestDocuments[normalizedType]) {
            foundDocKey = normalizedType; // snake_case
          } else {
            // Try to find any variation by normalizing both sides
            const normalizeKey = (key) => key.toLowerCase().replace(/[_-]/g, '');
            const normalizedSearchKey = normalizeKey(normalizedType);
            
            for (const key of Object.keys(requestDocuments)) {
              if (normalizeKey(key) === normalizedSearchKey) {
                foundDocKey = key;
                break;
              }
            }
          }
          
          if (foundDocKey) {
            const verificationRequestUpdates = {
              [`documents.${foundDocKey}.verificationStatus`]: status,
              [`documents.${foundDocKey}.status`]: status,
              [`documents.${foundDocKey}.verified`]: status === 'verified',
              [`documents.${foundDocKey}.verifiedAt`]: admin.firestore.FieldValue.serverTimestamp(),
              [`documents.${foundDocKey}.verifiedBy`]: adminId,
              [`documents.${foundDocKey}.comments`]: comments || null,
              'updatedAt': admin.firestore.FieldValue.serverTimestamp()
            };
            
            if (status === 'rejected') {
              verificationRequestUpdates[`documents.${foundDocKey}.rejectionReason`] = rejectionReason || null;
            }
            
            await latestRequest.ref.update(verificationRequestUpdates);
            console.log(`✅ [VerificationService] Updated document in documentVerificationRequests: ${foundDocKey} with status: ${status}`);
          } else {
            console.warn(`⚠️ [VerificationService] Document ${documentType} (${normalizedType}) not found in documentVerificationRequests`);
          }
        } else {
          console.warn(`⚠️ [VerificationService] No verification request found for driver ${driverId}`);
        }
      } catch (verificationRequestError) {
        console.error(`❌ [VerificationService] Error updating documentVerificationRequests:`, verificationRequestError);
        // Don't fail the whole operation if this update fails
      }
      
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

      // ✅ CRITICAL FIX: Invalidate document status cache so driver app sees verification immediately
      try {
        const { invalidateUserCache } = require('../middleware/cache');
        invalidateUserCache(driverId);
        console.log('✅ [VerificationService] Document status cache invalidated for driver:', driverId);
      } catch (cacheError) {
        console.warn('⚠️ [VerificationService] Could not invalidate document status cache:', cacheError?.message);
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
      // ✅ CORE FIX: Update driver verification status (both nested AND top-level for consistency)
      const updates = {
        'driver.verificationStatus': 'approved',
        'driver.isVerified': true,
        'isVerified': true, // ✅ CORE FIX: Also set top-level isVerified for dashboard consistency
        'driver.approvedAt': admin.firestore.FieldValue.serverTimestamp(),
        'driver.approvedBy': adminId
      };

      if (comments) {
        updates['driver.adminNotes'] = comments;
      }

      await db.collection('users').doc(driverId).update(updates);
      
      // ✅ CRITICAL FIX: Update documentVerificationRequests collection to mark as approved
      // This ensures the driver can request verification again if needed
      const verificationRequestsQuery = db.collection('documentVerificationRequests')
        .where('driverId', '==', driverId)
        .where('status', '==', 'pending')
        .orderBy('requestedAt', 'desc')
        .limit(1);
      
      const verificationRequestsSnapshot = await verificationRequestsQuery.get();
      
      if (!verificationRequestsSnapshot.empty) {
        const latestRequest = verificationRequestsSnapshot.docs[0];
        await latestRequest.ref.update({
          status: 'approved',
          reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
          reviewedBy: adminId,
          reviewNotes: comments || null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`✅ [VerificationService] Updated verification request ${latestRequest.id} to approved`);
      }
      
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
      // ✅ CRITICAL FIX: Update driver verification status
      const updates = {
        'driver.verificationStatus': 'rejected',
        'driver.isVerified': false,
        'driver.rejectedAt': admin.firestore.FieldValue.serverTimestamp(),
        'driver.rejectedBy': adminId,
        'driver.rejectionReason': reason
      };

      await db.collection('users').doc(driverId).update(updates);
      
      // ✅ CRITICAL FIX: Update documentVerificationRequests collection to mark as rejected
      // This ensures the driver can request verification again if needed
      const verificationRequestsQuery = db.collection('documentVerificationRequests')
        .where('driverId', '==', driverId)
        .where('status', '==', 'pending')
        .orderBy('requestedAt', 'desc')
        .limit(1);
      
      const verificationRequestsSnapshot = await verificationRequestsQuery.get();
      
      if (!verificationRequestsSnapshot.empty) {
        const latestRequest = verificationRequestsSnapshot.docs[0];
        await latestRequest.ref.update({
          status: 'rejected',
          reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
          reviewedBy: adminId,
          reviewNotes: reason || null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`✅ [VerificationService] Updated verification request ${latestRequest.id} to rejected`);
      }
      
      return { success: true };
    } catch (error) {
      console.error('❌ [VerificationService] Error rejecting driver:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new VerificationService();
