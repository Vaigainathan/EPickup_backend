const { getFirestore } = require('firebase-admin/firestore');

class VerificationService {
  constructor() {
    this.db = null; // Initialize lazily
  }

  /**
   * Get Firestore instance (lazy initialization)
   */
  getDb() {
    if (!this.db) {
      try {
        this.db = getFirestore();
      } catch (error) {
        console.error('❌ [VerificationService] Failed to get Firestore:', error);
        throw new Error('Firebase not initialized. Please ensure Firebase is initialized before using VerificationService.');
      }
    }
    return this.db;
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
      'rc': 'rcBook',
      'profile_photo': 'profilePhoto',
      'profile': 'profilePhoto',
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
      'aadhaar': 'aadhaar_card',
      'bikeInsurance': 'bike_insurance',
      'insurance': 'bike_insurance',
      'rcBook': 'rc_book',
      'rc': 'rc_book',
      'profilePhoto': 'profile_photo',
      'profile': 'profile_photo'
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

    console.log('📊 [VERIFICATION] Calculating status for documents:', Object.keys(documents));

    requiredDocs.forEach(docType => {
      const doc = documents[docType];
      if (doc && (doc.url || doc.downloadURL)) {
        totalWithDocuments++;
        const status = doc.verificationStatus || doc.status || 'pending';
        const verified = doc.verified || false;
        
        console.log(`📄 [VERIFICATION] ${docType}: status=${status}, verified=${verified}, hasUrl=${!!(doc.url || doc.downloadURL)}`);
        
        if (verified || status === 'verified') {
          verifiedCount++;
        } else if (status === 'rejected') {
          rejectedCount++;
        }
      } else {
        console.log(`📄 [VERIFICATION] ${docType}: No document uploaded`);
      }
    });

    // Determine overall status
    let finalStatus;
    if (totalWithDocuments === 0) {
      finalStatus = 'pending';
    } else if (verifiedCount === totalWithDocuments) {
      finalStatus = 'verified';
    } else if (rejectedCount > 0) {
      finalStatus = 'rejected';
    } else if (verifiedCount > 0 || totalWithDocuments > 0) {
      finalStatus = 'pending_verification';
    } else {
      finalStatus = 'pending';
    }

    console.log(`✅ [VERIFICATION] Final status: ${finalStatus} (${verifiedCount}/${totalWithDocuments} verified, ${rejectedCount} rejected)`);

    return { status: finalStatus, verifiedCount, rejectedCount, totalWithDocuments };
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
      const db = this.getDb();
      const driverDoc = await db.collection('users').doc(driverId).get();
      if (!driverDoc.exists) {
        throw new Error('Driver not found');
      }

      const driverData = driverDoc.data();
      
      // Get verification request (simplified query to avoid index issues)
      let verificationQuery;
      try {
        verificationQuery = await db.collection('documentVerificationRequests')
          .where('driverId', '==', driverId)
          .get();
        
        // Sort by requestedAt in memory to avoid index requirement
        if (!verificationQuery.empty) {
          const sortedDocs = verificationQuery.docs.sort((a, b) => {
            const aTime = a.data().requestedAt?.toDate?.() || new Date(0);
            const bTime = b.data().requestedAt?.toDate?.() || new Date(0);
            return bTime - aTime; // Descending order
          });
          verificationQuery = { docs: sortedDocs.slice(0, 1), empty: false };
        }
      } catch (indexError) {
        console.warn('⚠️ Firestore index error for verification requests, skipping:', indexError.message);
        verificationQuery = { docs: [], empty: true };
      }

      // Get driver documents collection
      const driverDocsQuery = await db.collection('driverDocuments')
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
          if (documents[normalizedKey] && verificationDoc.downloadURL) {
            documents[normalizedKey] = {
              ...documents[normalizedKey],
              url: verificationDoc.downloadURL,
              // CRITICAL FIX: Preserve verification status from verification request
              status: verificationDoc.verificationStatus || verificationDoc.status || 'uploaded',
              verificationStatus: verificationDoc.verificationStatus || verificationDoc.status || 'pending',
              uploadedAt: verificationDoc.uploadedAt || '',
              verified: verificationDoc.verified || verificationDoc.verificationStatus === 'verified' || false,
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
      
      // Calculate verification status from documents
      const documentVerificationStatus = this.calculateVerificationStatus(normalizedDocuments);
      
      // Check driver data verification status
      let dataEntryStatus = 'pending';
      let hasVehicleDetails = false;
      
      if (driverData.driver?.vehicleDetails || driverData.vehicleDetails) {
        hasVehicleDetails = true;
        // Check if there's a driver data entry
        try {
          const db = this.getDb();
          const dataEntryQuery = await db.collection('driverDataEntries')
            .where('driverId', '==', driverId)
            .orderBy('submittedAt', 'desc')
            .limit(1)
            .get();
          
          if (!dataEntryQuery.empty) {
            const latestEntry = dataEntryQuery.docs[0].data();
            dataEntryStatus = latestEntry.status || 'pending_verification';
            console.log(`📊 Driver data entry status: ${dataEntryStatus}`);
          }
        } catch (error) {
          console.warn('⚠️ Could not check driver data entry status:', error.message);
        }
      }
      
      // Check if user's DRIVER verification status is already set to approved/verified
      const userVerificationStatus = driverData.driver?.verificationStatus;
      // CRITICAL FIX: Don't use isVerified field - it means phone/email verified, not documents
      const userDocumentsApproved = driverData.driver?.documentsApproved === true;
      
      // Determine final verification status considering both documents and data entry
      let finalVerificationStatus = documentVerificationStatus;
      
      // If user's DOCUMENTS are explicitly approved by admin, use that status
      if (userVerificationStatus === 'approved' || userVerificationStatus === 'verified' || userDocumentsApproved) {
        finalVerificationStatus = {
          status: 'approved',
          verifiedCount: finalVerificationStatus.verifiedCount,
          rejectedCount: finalVerificationStatus.rejectedCount,
          totalWithDocuments: finalVerificationStatus.totalWithDocuments
        };
        console.log(`📊 Using driver document verification status: approved (admin approved)`);
      } 
      // If driver data entry is rejected, driver is rejected
      else if (dataEntryStatus === 'rejected') {
        finalVerificationStatus = {
          status: 'rejected',
          verifiedCount: finalVerificationStatus.verifiedCount,
          rejectedCount: finalVerificationStatus.rejectedCount,
          totalWithDocuments: finalVerificationStatus.totalWithDocuments
        };
        console.log(`📊 Driver data entry rejected, setting status to rejected`);
      }
      // If driver data entry is pending verification, set to pending_verification
      else if (dataEntryStatus === 'pending_verification') {
        finalVerificationStatus = {
          status: 'pending_verification',
          verifiedCount: finalVerificationStatus.verifiedCount,
          rejectedCount: finalVerificationStatus.rejectedCount,
          totalWithDocuments: finalVerificationStatus.totalWithDocuments
        };
        console.log(`📊 Driver data entry pending verification`);
      }
      // If driver data entry is approved and documents are verified, driver is verified
      else if (dataEntryStatus === 'approved' && documentVerificationStatus.status === 'verified') {
        finalVerificationStatus = {
          status: 'verified',
          verifiedCount: finalVerificationStatus.verifiedCount,
          rejectedCount: finalVerificationStatus.rejectedCount,
          totalWithDocuments: finalVerificationStatus.totalWithDocuments
        };
        console.log(`📊 Driver data approved and documents verified`);
      }
      // Otherwise use document verification status
      else {
        console.log(`📊 Using document verification status: ${finalVerificationStatus.status} (${finalVerificationStatus.verifiedCount}/${finalVerificationStatus.totalWithDocuments} verified)`);
      }
      
      const verificationStatus = finalVerificationStatus;
      
      return {
        driverId,
        driverName: driverData.name || 'Unknown',
        documents: normalizedDocuments,
        verificationStatus: verificationStatus.status,
        isVerified: verificationStatus.status === 'verified' || verificationStatus.status === 'approved',
        overallProgress: verificationStatus.status === 'approved' ? 100 : 
                        verificationStatus.status === 'verified' ? 100 :
                        verificationStatus.totalWithDocuments > 0 ? 
                          Math.round((verificationStatus.verifiedCount / verificationStatus.totalWithDocuments) * 100) : 0,
        source,
        hasVehicleDetails,
        dataEntryStatus,
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
    const db = this.getDb();
    const batch = db.batch();
    
    try {
      console.log(`🔄 Updating verification status for driver: ${driverId}`);

      // Update user collection
      const driverRef = db.collection('users').doc(driverId);
      batch.update(driverRef, {
        'driver.verificationStatus': verificationData.status,
        'driver.isVerified': verificationData.status === 'verified',
        'isVerified': verificationData.status === 'verified',
        'driver.verifiedDocumentsCount': verificationData.verifiedCount,
        'driver.totalDocumentsCount': verificationData.totalWithDocuments,
        updatedAt: new Date()
      });

      // Get current driver data to check welcome bonus status
      const driverDoc = await driverRef.get();
      const driverData = driverDoc.exists ? driverDoc.data() : {};
      const welcomeBonusGiven = driverData?.driver?.welcomeBonusGiven || false;
      
      // Update real-time verification status collection for live updates
      const verificationStatusRef = db.collection('driverVerificationStatus').doc(driverId);
      batch.set(verificationStatusRef, {
        driverId,
        verificationStatus: verificationData.status,
        isVerified: verificationData.status === 'verified',
        documentSummary: {
          total: verificationData.totalWithDocuments,
          verified: verificationData.verifiedCount,
          rejected: verificationData.rejectedCount,
          pending: verificationData.totalWithDocuments - verificationData.verifiedCount - verificationData.rejectedCount
        },
        lastUpdated: new Date(),
        canStartWorking: verificationData.status === 'verified',
        welcomeBonusEligible: verificationData.status === 'verified' && !welcomeBonusGiven
      }, { merge: true });

      // Update verification request if exists
      const verificationQuery = await db.collection('documentVerificationRequests')
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
      console.log(`✅ Verification status updated for driver: ${driverId} - ${verificationData.status} (${verificationData.verifiedCount}/${verificationData.totalWithDocuments})`);

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
      
      const db = this.getDb();
      const batch = db.batch();
      const driverRef = db.collection('users').doc(driverId);
      
      // Get current driver data
      const driverDoc = await driverRef.get();
      if (!driverDoc.exists) {
        throw new Error('Driver not found');
      }
      
      const driverData = driverDoc.data();
      const documents = driverData.driver?.documents || driverData.documents || {};
      
      // Normalize document type
      const normalizedDocType = this.normalizeDocumentField(documentType);
      
      // CRITICAL FIX: Always update documents in users collection, even if not present
      // This ensures the Driver App can read the verification status
      if (!documents[normalizedDocType]) {
        documents[normalizedDocType] = {
          url: '', // Will be populated from other sources
          status: 'pending',
          uploadedAt: '',
          verified: false
        };
      }
      
      // Update specific document in users collection with BOTH field names for compatibility
      documents[normalizedDocType] = {
        ...documents[normalizedDocType],
        status: status === 'verified' ? 'verified' : 'rejected',
        verificationStatus: status === 'verified' ? 'verified' : 'rejected', // Admin App field
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

      // Update driverDocuments collection (avoid composite index by filtering in memory)
      const snakeCaseDocType = this.toSnakeCase(documentType);
      const driverDocsQuery = await db.collection('driverDocuments')
        .where('driverId', '==', driverId)
        .get();

      if (!driverDocsQuery.empty) {
        // Filter by documentType in memory to avoid composite index requirement
        const matchingDocs = driverDocsQuery.docs.filter(doc => {
          const docData = doc.data();
          return docData.documentType === snakeCaseDocType;
        });

        matchingDocs.forEach(doc => {
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
      
      // Update verification request if exists (get most recent request regardless of status)
      const verificationQuery = await db.collection('documentVerificationRequests')
        .where('driverId', '==', driverId)
        .get();

      if (!verificationQuery.empty) {
        // Find the most recent verification request in memory
        const sortedDocs = verificationQuery.docs.sort((a, b) => {
          const aTime = a.data().requestedAt?.toDate?.() || new Date(0);
          const bTime = b.data().requestedAt?.toDate?.() || new Date(0);
          return bTime - aTime; // Descending order (most recent first)
        });
        
        const verificationDoc = sortedDocs[0];
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
      
      // Send WebSocket notification to driver
      await this.sendVerificationNotification(driverId, documentType, status, verificationStatus);
      
      // Send specific rejection notification if document was rejected
      if (status === 'rejected') {
        await this.sendDocumentRejectionNotification(driverId, documentType, rejectionReason, verificationStatus);
      }
      
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
   * Send verification notification to driver via WebSocket
   */
  async sendVerificationNotification(driverId, documentType, status, verificationStatus) {
    try {
      console.log(`📡 Attempting to send verification notification to driver: ${driverId}`);
      const { sendToUser } = require('./socket');
      
      if (!sendToUser) {
        console.error('❌ sendToUser function not available');
        return;
      }
      
      // Send enhanced document-specific notification
      const notificationSent = sendToUser(driverId, 'document_verification_update', {
        type: 'document_verification',
        documentType,
        status: status === 'verified' ? 'verified' : 'rejected',
        verificationStatus: verificationStatus.status,
        isVerified: verificationStatus.status === 'verified',
        documentSummary: {
          total: verificationStatus.totalWithDocuments,
          verified: verificationStatus.verifiedCount,
          rejected: verificationStatus.rejectedCount,
          pending: verificationStatus.totalWithDocuments - verificationStatus.verifiedCount - verificationStatus.rejectedCount
        },
        message: status === 'verified' 
          ? `✅ Your ${documentType} has been verified successfully!`
          : `❌ Your ${documentType} was rejected. Please check the reason and re-upload.`,
        title: status === 'verified' ? 'Document Verified' : 'Document Rejected',
        priority: 'high',
        actionRequired: status === 'rejected',
        nextSteps: status === 'rejected' 
          ? ['Review rejection reason', 'Re-upload document with improvements']
          : verificationStatus.status === 'verified' 
            ? ['All documents verified!', 'You can now start working']
            : ['Continue uploading remaining documents'],
        timestamp: new Date().toISOString()
      });

      console.log(`📡 Document notification sent: ${notificationSent}`);

      // If all documents are verified, send completion notification
      if (verificationStatus.status === 'verified') {
        const completionSent = sendToUser(driverId, 'verification_complete', {
          type: 'verification_status',
          status: 'verified',
          message: '🎉 Congratulations! All your documents have been verified successfully! You can now start taking orders and earn money.',
          title: 'Verification Complete!',
          priority: 'high',
          actionRequired: false,
          nextSteps: [
            'Top-up your wallet to start accepting rides',
            'Complete rides to earn commission',
            'Check your earnings in the wallet section'
          ],
          welcomeBonus: {
            amount: 0,
            currency: 'INR',
            eligible: false,
            message: 'No welcome bonus - Top-up required to start working'
          },
          documentSummary: {
            total: verificationStatus.totalWithDocuments,
            verified: verificationStatus.verifiedCount,
            rejected: verificationStatus.rejectedCount,
            pending: 0
          },
          timestamp: new Date().toISOString()
        });
        console.log(`📡 Completion notification sent: ${completionSent}`);
      }

      console.log(`📡 Verification notification sent to driver ${driverId}: ${status}`);
    } catch (error) {
      console.error('❌ Failed to send verification notification:', error);
    }
  }

  /**
   * Send welcome bonus notification to driver
   */
  async sendWelcomeBonusNotification(driverId, amount) {
    try {
      console.log(`🎁 Sending welcome bonus notification to driver: ${driverId}`);
      const { sendToUser } = require('./socket');
      
      if (!sendToUser) {
        console.error('❌ sendToUser function not available');
        return;
      }
      
      // Send welcome bonus notification
      const notificationSent = sendToUser(driverId, 'welcome_bonus_credited', {
        type: 'welcome_bonus',
        amount: amount,
        currency: 'INR',
        message: `🎉 Congratulations! You've received ₹${amount} welcome bonus for completing verification!`,
        title: 'Welcome Bonus Credited!',
        priority: 'high',
        actionRequired: false,
        nextSteps: ['Check your wallet balance', 'Start accepting rides'],
        timestamp: new Date().toISOString()
      });

      console.log(`🎁 Welcome bonus notification sent: ${notificationSent}`);

      // Also send push notification
      await this.sendPushNotification(driverId, {
        title: 'Welcome Bonus Credited!',
        body: `You've received ₹${amount} welcome bonus for completing verification!`,
        data: {
          type: 'welcome_bonus',
          amount: amount.toString(),
          driverId: driverId
        }
      });

    } catch (error) {
      console.error('❌ Failed to send welcome bonus notification:', error);
    }
  }

  /**
   * Send document rejection notification to driver
   */
  async sendDocumentRejectionNotification(driverId, documentType, rejectionReason, verificationStatus) {
    try {
      console.log(`❌ Sending document rejection notification to driver: ${driverId}`);
      const { sendToUser } = require('./socket');
      
      if (!sendToUser) {
        console.error('❌ sendToUser function not available');
        return;
      }
      
      // Send document rejection notification
      const notificationSent = sendToUser(driverId, 'document_rejected', {
        type: 'document_rejection',
        documentType: documentType,
        rejectionReason: rejectionReason,
        message: `❌ Your ${documentType} was rejected. Reason: ${rejectionReason || 'Please check the document quality and re-upload.'}`,
        title: 'Document Rejected',
        priority: 'high',
        actionRequired: true,
        nextSteps: [
          'Review the rejection reason',
          'Check document quality and clarity',
          'Re-upload the document with improvements',
          'Ensure all information is clearly visible'
        ],
        documentSummary: {
          total: verificationStatus.totalWithDocuments,
          verified: verificationStatus.verifiedCount,
          rejected: verificationStatus.rejectedCount,
          pending: verificationStatus.totalWithDocuments - verificationStatus.verifiedCount - verificationStatus.rejectedCount
        },
        timestamp: new Date().toISOString()
      });

      console.log(`❌ Document rejection notification sent: ${notificationSent}`);

      // Also send push notification
      await this.sendPushNotification(driverId, {
        title: 'Document Rejected',
        body: `Your ${documentType} was rejected. Tap to view details and re-upload.`,
        data: {
          type: 'document_rejection',
          documentType: documentType,
          rejectionReason: rejectionReason,
          driverId: driverId
        }
      });

      // Store rejection history
      await this.storeRejectionHistory(driverId, documentType, rejectionReason);

    } catch (error) {
      console.error('❌ Failed to send document rejection notification:', error);
    }
  }

  /**
   * Store document rejection history
   */
  async storeRejectionHistory(driverId, documentType, rejectionReason) {
    try {
      const db = this.getDb();
      const rejectionRef = db.collection('driverDocumentsRejections').doc();
      await rejectionRef.set({
        id: rejectionRef.id,
        driverId: driverId,
        documentType: documentType,
        rejectionReason: rejectionReason,
        rejectedAt: new Date(),
        status: 'pending_reupload',
        createdAt: new Date()
      });
      
      console.log(`📝 Rejection history stored for driver: ${driverId}, document: ${documentType}`);
    } catch (error) {
      console.error('❌ Failed to store rejection history:', error);
    }
  }

  /**
   * Send push notification to driver
   */
  async sendPushNotification(driverId, notification) {
    try {
      const pushNotificationService = require('./pushNotificationService');
      await pushNotificationService.sendToDriver(driverId, notification);
    } catch (error) {
      console.error('❌ Failed to send push notification:', error);
    }
  }

  /**
   * Approve a driver
   */
  async approveDriver(driverId, adminNotes, adminId) {
    try {
      console.log(`✅ Approving driver: ${driverId}`);
      
      const db = this.getDb();
      const batch = db.batch();
      const driverRef = db.collection('users').doc(driverId);
      
      // Driver reference for batch operations
      
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
      const verificationQuery = await db.collection('documentVerificationRequests')
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
      
      // Initialize points wallet with 0 points (no welcome bonus)
      const pointsService = require('./walletService');
      await pointsService.createOrGetPointsWallet(driverId, 0);
      
      // Update driver to require top-up
      await driverRef.update({
        'driver.requiresTopUp': true,
        'driver.pointsWalletId': driverId,
        'driver.lastTopUpDate': null,
        'driver.welcomeBonusGiven': false, // No welcome bonus
        'driver.welcomeBonusAmount': 0
      });

      console.log(`✅ Driver approved: ${driverId} (points wallet initialized, top-up required)`);
      
      return {
        success: true,
        message: 'Driver approved successfully - Top-up required to start working',
        data: {
          driverId,
          status: 'approved',
          approvedAt: new Date(),
          approvedBy: adminId,
          requiresTopUp: true,
          welcomeBonusAmount: 0
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
      
      const db = this.getDb();
      const batch = db.batch();
      const driverRef = db.collection('users').doc(driverId);
      
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
      const verificationQuery = await db.collection('documentVerificationRequests')
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

      const db = this.getDb();
      const driversSnapshot = await db.collection('users')
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

// Use lazy initialization to avoid Firebase initialization issues
let verificationServiceInstance = null;

function getVerificationService() {
  if (!verificationServiceInstance) {
    verificationServiceInstance = new VerificationService();
  }
  return verificationServiceInstance;
}

// Export a proxy object that creates the instance only when methods are called
const lazyVerificationService = new Proxy({}, {
  get(target, prop) {
    const instance = getVerificationService();
    return instance[prop];
  }
});

module.exports = lazyVerificationService;
module.exports.VerificationService = VerificationService;
module.exports.getVerificationService = getVerificationService;
