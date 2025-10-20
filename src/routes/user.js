const express = require('express');
const multer = require('multer');
const { getStorage } = require('firebase-admin/storage');
const { getFirestore } = require('firebase-admin/firestore');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit for profile pictures
  },
  fileFilter: (req, file, cb) => {
    // Accept only images
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  },
});

/**
 * @route POST /api/user/profile-picture
 * @desc Upload user profile picture to Firebase Storage
 * @access Private (Authenticated users)
 */
router.post('/profile-picture', authenticateToken, upload.single('profilePicture'), async (req, res) => {
  try {
    console.log('📸 [PROFILE_PICTURE] Upload request received');
    
    const { uid: userId } = req.user;
    const file = req.file;

    // Validate file
    if (!file) {
      console.log('❌ [PROFILE_PICTURE] No file provided');
      return res.status(400).json({
        success: false,
        error: 'No file provided'
      });
    }

    console.log('📸 [PROFILE_PICTURE] Uploading for user:', userId, 'File size:', file.size);

    // Get Firebase Storage instance
    const bucket = getStorage().bucket();
    
    // Generate unique filename
    const timestamp = Date.now();
    const fileExtension = file.originalname.split('.').pop() || 'jpg';
    const fileName = `${timestamp}_profile.${fileExtension}`;
    const filePath = `users/${userId}/profile/${fileName}`;
    
    console.log('📸 [PROFILE_PICTURE] Storage path:', filePath);
    
    // Create file reference
    const fileRef = bucket.file(filePath);
    
    // Upload file
    await fileRef.save(file.buffer, {
      metadata: {
        contentType: file.mimetype,
        customMetadata: {
          userId: userId,
          uploadedAt: new Date().toISOString(),
          uploadedBy: 'user',
          originalFileName: file.originalname || fileName
        }
      }
    });

    console.log('✅ [PROFILE_PICTURE] File uploaded to Firebase Storage');

    // Make file publicly accessible
    await fileRef.makePublic();
    
    // Get public URL
    const downloadURL = `https://storage.googleapis.com/${bucket.name}/${filePath}`;

    console.log('✅ [PROFILE_PICTURE] Public URL generated:', downloadURL);

    // Update user document in Firestore
    try {
      const db = getFirestore();
      const userRef = db.collection('users').doc(userId);
      
      // Update all relevant profile picture fields for consistency
      await userRef.update({
        profilePicture: downloadURL,
        'customer.profilePhoto': downloadURL,
        'profile.photo': downloadURL,
        photoURL: downloadURL,
        updatedAt: new Date()
      });
      
      console.log('✅ [PROFILE_PICTURE] User document updated in Firestore');
    } catch (firestoreError) {
      console.error('⚠️ [PROFILE_PICTURE] Error updating Firestore:', firestoreError);
      // Don't fail the upload for Firestore errors, photo is already uploaded
    }

    console.log('✅ [PROFILE_PICTURE] Profile picture upload completed successfully');

    res.json({
      success: true,
      message: 'Profile picture updated successfully',
      data: {
        profilePicture: downloadURL,
        fileName: fileName,
        filePath: filePath,
        size: file.size,
        uploadedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ [PROFILE_PICTURE] Error uploading profile picture:', error);
    
    // Handle specific multer errors
    if (error.message === 'Only image files are allowed!') {
      return res.status(400).json({
        success: false,
        error: 'Only image files are allowed',
        details: 'Please upload a JPEG, PNG, or WebP image'
      });
    }
    
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File too large',
        details: 'Profile picture must be less than 5MB'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to upload profile picture',
      details: error.message
    });
  }
});

/**
 * @route GET /api/user/profile
 * @desc Get user profile including profile picture
 * @access Private (Authenticated users)
 */
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const db = getFirestore();
    
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    const userData = userDoc.data();
    
    // Return profile with all possible profile picture fields
    res.json({
      success: true,
      data: {
        name: userData.name || userData.displayName || '',
        phone: userData.phone || userData.phoneNumber || '',
        email: userData.email || '',
        profilePicture: userData.profilePicture || userData.photoURL || userData.customer?.profilePhoto || userData.profile?.photo || null,
        createdAt: userData.createdAt,
        updatedAt: userData.updatedAt
      }
    });
    
  } catch (error) {
    console.error('❌ Error fetching user profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch profile',
      details: error.message
    });
  }
});

/**
 * @route PUT /api/user/profile
 * @desc Update user profile (name, etc)
 * @access Private (Authenticated users)
 */
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const { name, phone } = req.body;
    const db = getFirestore();
    
    const updateData = {
      updatedAt: new Date()
    };
    
    if (name !== undefined) {
      updateData.name = name;
      updateData.displayName = name;
    }
    
    if (phone !== undefined) {
      updateData.phone = phone;
      updateData.phoneNumber = phone;
    }
    
    await db.collection('users').doc(userId).update(updateData);
    
    console.log('✅ User profile updated:', userId);
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: updateData
    });
    
  } catch (error) {
    console.error('❌ Error updating user profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update profile',
      details: error.message
    });
  }
});

module.exports = router;
