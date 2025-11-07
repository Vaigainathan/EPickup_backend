const { getFirestore, Timestamp } = require('../services/firebase');

/**
 * Work Slots Service
 * Manages the new gig slot system with 2-hour blocks
 */

class WorkSlotsService {
  constructor() {
    this.db = null; // Initialize lazily
    // CRITICAL: Track ongoing generation to prevent concurrent requests
    this.ongoingGenerations = new Map(); // driverId -> timestamp
  }

  /**
   * Get Firestore instance (lazy initialization)
   */
  getDb() {
    if (!this.db) {
      try {
        this.db = getFirestore();
      } catch (error) {
        console.error('❌ [WorkSlotsService] Failed to get Firestore:', error);
        throw new Error('Firebase not initialized. Please ensure Firebase is initialized before using WorkSlotsService.');
      }
    }
    return this.db;
  }

  /**
   * Generate daily work slots for a driver
   * Creates 8 slots: 7-9 AM, 9-11 AM, 11-1 PM, 1-3 PM, 3-5 PM, 5-7 PM, 7-9 PM, 9-11 PM
   */
  async generateDailySlots(driverId, date = new Date(), options = {}) {
    try {
      const {
        startOfDay,
        endOfDay,
        timezoneOffsetMinutes = 0,
        dateKey,
        localDateParts
      } = options;

      const offsetMinutes = Number.isFinite(Number(timezoneOffsetMinutes))
        ? Number(timezoneOffsetMinutes)
        : 0;

      const baseReferenceDate = startOfDay ? new Date(startOfDay) : new Date(date);
      if (Number.isNaN(baseReferenceDate.getTime())) {
        throw new Error('Invalid date supplied for slot generation');
      }

      const generationStart = startOfDay ? new Date(startOfDay) : new Date(baseReferenceDate);
      if (!startOfDay) {
        generationStart.setHours(0, 0, 0, 0);
      }

      const generationEnd = endOfDay ? new Date(endOfDay) : new Date(baseReferenceDate);
      if (!endOfDay) {
        generationEnd.setHours(23, 59, 59, 999);
      }

      const slotDateKey = dateKey || baseReferenceDate.toISOString().split('T')[0];

      console.log(
        `🔄 [WORK_SLOTS] Generating daily slots for driver: ${driverId}, dateKey: ${slotDateKey}, tzOffset: ${offsetMinutes}`
      );
      
      // CRITICAL: Initialize database connection first
      const db = this.getDb();
      if (!db) {
        throw new Error('Failed to initialize Firestore database connection');
      }
      
      // CRITICAL: Check if generation is already in progress for this driver
      if (this.ongoingGenerations.has(driverId)) {
        const ongoingStart = this.ongoingGenerations.get(driverId);
        const elapsed = Date.now() - ongoingStart;
        
        if (elapsed < 5000) { // If started less than 5 seconds ago
          console.warn(`⚠️ [WORK_SLOTS] Generation already in progress for driver ${driverId} (started ${elapsed}ms ago)`);
          return {
            success: false,
            error: {
              code: 'GENERATION_IN_PROGRESS',
              message: 'Slot generation already in progress for this driver',
              details: 'Please wait for the current generation to complete'
            }
          };
        } else {
          // If stuck for more than 5 seconds, allow new attempt
          console.warn(`⚠️ [WORK_SLOTS] Previous generation stuck for ${elapsed}ms, allowing retry`);
          this.ongoingGenerations.delete(driverId);
        }
      }
      
      // Mark generation as in progress
      this.ongoingGenerations.set(driverId, Date.now());
      
      // ✅ CRITICAL FIX: Atomic slot generation with state preservation
      // ✅ INDUSTRY STANDARD: Preserve selections during slot regeneration
      const existingQuery = db.collection('workSlots')
        .where('driverId', '==', driverId)
        .where('startTime', '>=', Timestamp.fromDate(generationStart))
        .where('startTime', '<=', Timestamp.fromDate(generationEnd));

      const existingSnapshot = await existingQuery.get();
      
      // ✅ FIX: Store selected slots from existing data before deleting
      // Use a more robust preservation strategy based on time ranges (not just slotId)
      const preservedSelections = new Map(); // timeRange -> { isSelected, selectedAt }
      
      if (!existingSnapshot.empty) {
        console.log(`📋 [WORK_SLOTS] Preserving selection state from ${existingSnapshot.size} existing slots`);
        const now = new Date();
        
        existingSnapshot.forEach(doc => {
          const slotData = doc.data();
          // ✅ CRITICAL FIX #3: Only preserve selection if slot was selected AND not cleared recently
          // Check if slot was selected AND has a recent selectedAt timestamp (not stale)
          if (slotData.isSelected === true && slotData.selectedAt) {
            const selectedAt = slotData.selectedAt.toDate();
            const hoursSinceSelection = (now.getTime() - selectedAt.getTime()) / (1000 * 60 * 60);
            
            // ✅ Only preserve if selection was made recently (within last 24 hours) to avoid stale data
            // This prevents old selections from being restored after user clears them
            if (hoursSinceSelection < 24) {
              // Use time range as key for more reliable matching (slotId format may change)
              const startHour = slotData.startTime.toDate().getHours();
              const endHour = slotData.endTime.toDate().getHours();
              const timeRangeKey = `${startHour}-${endHour}`;
              
              preservedSelections.set(timeRangeKey, {
                isSelected: true,
                selectedAt: slotData.selectedAt || null,
                slotId: slotData.slotId || doc.id // Also preserve original slotId for reference
              });
              console.log(`✅ [WORK_SLOTS] Preserving selection for slot: ${slotData.label} (${timeRangeKey})`);
            } else {
              console.log(`⚠️ [WORK_SLOTS] Skipping stale selection for slot: ${slotData.label} (selected ${hoursSinceSelection.toFixed(1)} hours ago)`);
            }
          } else if (slotData.isSelected === true && !slotData.selectedAt) {
            // Slot marked as selected but no selectedAt timestamp - might be default/stale
            // Only preserve if it was updated recently (updatedAt check)
            if (slotData.updatedAt) {
              const updatedAt = slotData.updatedAt.toDate();
              const hoursSinceUpdate = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60);
              
              // Only preserve if updated within last 1 hour (very recent activity)
              if (hoursSinceUpdate < 1) {
                const startHour = slotData.startTime.toDate().getHours();
                const endHour = slotData.endTime.toDate().getHours();
                const timeRangeKey = `${startHour}-${endHour}`;
                
                preservedSelections.set(timeRangeKey, {
                  isSelected: true,
                  selectedAt: Timestamp.now(), // Use current time as fallback
                  slotId: slotData.slotId || doc.id
                });
                console.log(`⚠️ [WORK_SLOTS] Preserving selection without selectedAt for slot: ${slotData.label} (${timeRangeKey})`);
              } else {
                console.log(`⚠️ [WORK_SLOTS] Skipping stale selection (no selectedAt, updated ${hoursSinceUpdate.toFixed(1)} hours ago) for slot: ${slotData.label}`);
              }
            } else {
              console.log(`⚠️ [WORK_SLOTS] Skipping selection without selectedAt or updatedAt for slot: ${slotData.label}`);
            }
          }
        });
        
        // Now delete existing slots (atomic operation)
        console.log(`🗑️ [WORK_SLOTS] Deleting ${existingSnapshot.size} existing slots to prevent duplicates`);
        const deleteBatch = db.batch();
        existingSnapshot.forEach(doc => {
          deleteBatch.delete(doc.ref);
        });
        await deleteBatch.commit();
        console.log(`✅ [WORK_SLOTS] Deleted ${existingSnapshot.size} existing slots`);
      } else {
        console.log('ℹ️ [WORK_SLOTS] No existing slots found, creating new ones');
      }

      const slots = [];
      const slotConfigs = [
        { start: 7, end: 9, label: '7–9 AM' },
        { start: 9, end: 11, label: '9–11 AM' },
        { start: 11, end: 13, label: '11 AM–1 PM' },
        { start: 13, end: 15, label: '1–3 PM' },
        { start: 15, end: 17, label: '3–5 PM' },
        { start: 17, end: 19, label: '5–7 PM' },
        { start: 19, end: 21, label: '7–9 PM' },
        { start: 21, end: 23, label: '9–11 PM' }
      ];

      for (const config of slotConfigs) {
        let startTime;
        let endTime;

        if (localDateParts) {
          const { year, month, day } = localDateParts;
          const startUtc =
            Date.UTC(year, month - 1, day, config.start, 0, 0, 0) +
            offsetMinutes * 60 * 1000;
          const endUtc =
            Date.UTC(year, month - 1, day, config.end, 0, 0, 0) +
            offsetMinutes * 60 * 1000;

          startTime = new Date(startUtc);
          endTime = new Date(endUtc);
        } else {
          startTime = new Date(baseReferenceDate);
          startTime.setHours(config.start, 0, 0, 0);

          endTime = new Date(baseReferenceDate);
          endTime.setHours(config.end, 0, 0, 0);
        }

        const slotId = `${driverId}_${slotDateKey}_${config.start}-${config.end}`;
        
        console.log(`🔍 [WORK_SLOTS] Creating slot: ${config.label} (${config.start}-${config.end})`);
        
        // ✅ CRITICAL FIX: Match preserved selection by time range (more reliable than slotId)
        const timeRangeKey = `${config.start}-${config.end}`;
        const preservedSelection = preservedSelections.get(timeRangeKey);
        const wasSelected = preservedSelection?.isSelected === true;
        
        const slot = {
          slotId,
          startTime: Timestamp.fromDate(startTime),
          endTime: Timestamp.fromDate(endTime),
          label: config.label,
          status: 'available',
          isSelected: wasSelected, // ✅ FIX: Preserve selection state
          selectedAt: wasSelected ? (preservedSelection.selectedAt || Timestamp.now()) : null, // ✅ FIX: Preserve selectedAt timestamp
          driverId,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        };

        slots.push(slot);
        console.log(`✅ [WORK_SLOTS] Slot added to batch: ${config.label}${wasSelected ? ' (selected preserved)' : ''}`);
      }
      
      console.log(`📊 [WORK_SLOTS] Total slots prepared for batch write: ${slots.length}`);

      // Batch write all slots
      const batch = db.batch();
      slots.forEach((slot, index) => {
        const slotRef = db.collection('workSlots').doc(slot.slotId);
        batch.set(slotRef, slot);
        console.log(`📝 [WORK_SLOTS] Batch item ${index + 1}/${slots.length}: ${slot.label}`);
      });

      await batch.commit();
      
      console.log(`✅ [WORK_SLOTS] Generated ${slots.length} slots successfully`);
      console.log(`📋 [WORK_SLOTS] Slot labels: ${slots.map(s => s.label).join(', ')}`);
      
      // CRITICAL: Clear the generation lock
      this.ongoingGenerations.delete(driverId);
      
      return {
        success: true,
        message: 'Daily slots generated successfully',
        slots: slots.length,
        data: slots
      };

    } catch (error) {
      console.error('Error generating daily slots:', error);
      
      // CRITICAL: Clear the generation lock on error
      this.ongoingGenerations.delete(driverId);
      
      return {
        success: false,
        error: {
          code: 'SLOT_GENERATION_ERROR',
          message: 'Failed to generate daily slots',
          details: error.message
        }
      };
    }
  }

  /**
   * Get slots for a specific driver and date
   */
  async getDriverSlots(driverId, date = new Date(), options = {}) {
    try {
      // Initialize database connection
      const db = this.getDb();
      if (!db) {
        throw new Error('Failed to initialize Firestore database connection');
      }

      const {
        startOfDay,
        endOfDay,
        dateKey,
        timezoneOffsetMinutes = 0,
        localDateParts
      } = options;

      const queryStart = startOfDay ? new Date(startOfDay) : new Date(date);
      if (!startOfDay) {
        queryStart.setHours(0, 0, 0, 0);
      }

      const queryEnd = endOfDay ? new Date(endOfDay) : new Date(date);
      if (!endOfDay) {
        queryEnd.setHours(23, 59, 59, 999);
      }

      const logDateKey = dateKey || queryStart.toISOString().split('T')[0];

      console.log(
        `🔍 [GET_DRIVER_SLOTS] Fetching slots for driver: ${driverId}, dateKey: ${logDateKey}, tzOffset: ${timezoneOffsetMinutes}, localParts: ${
          localDateParts ? JSON.stringify(localDateParts) : 'n/a'
        }`
      );

      const query = db.collection('workSlots')
        .where('driverId', '==', driverId)
        .where('startTime', '>=', Timestamp.fromDate(queryStart))
        .where('startTime', '<=', Timestamp.fromDate(queryEnd))
        .orderBy('startTime', 'asc');

      const snapshot = await query.get();
      const slots = [];

      snapshot.forEach(doc => {
        const slotData = doc.data();
        slots.push({
          id: doc.id,
          ...slotData
        });
        console.log(`📥 [GET_DRIVER_SLOTS] Retrieved slot: ${slotData.label}`);
      });

      console.log(`✅ [GET_DRIVER_SLOTS] Total slots retrieved: ${slots.length}`);
      console.log(`📋 [GET_DRIVER_SLOTS] Slot labels: ${slots.map(s => s.label).join(', ')}`);

      return {
        success: true,
        message: 'Driver slots retrieved successfully',
        data: slots
      };

    } catch (error) {
      console.error('Error getting driver slots:', error);
      return {
        success: false,
        error: {
          code: 'SLOT_RETRIEVAL_ERROR',
          message: 'Failed to retrieve driver slots',
          details: error.message
        }
      };
    }
  }

  /**
   * Update slot status
   */
  async updateSlotStatus(slotId, status, driverId) {
    try {
      // Initialize database connection
      const db = this.getDb();
      if (!db) {
        throw new Error('Failed to initialize Firestore database connection');
      }

      const validStatuses = ['available', 'booked', 'completed'];
      if (!validStatuses.includes(status)) {
        return {
          success: false,
          error: {
            code: 'INVALID_STATUS',
            message: 'Invalid slot status',
            details: `Status must be one of: ${validStatuses.join(', ')}`
          }
        };
      }

      const slotRef = db.collection('workSlots').doc(slotId);
      const slotDoc = await slotRef.get();

      if (!slotDoc.exists) {
        return {
          success: false,
          error: {
            code: 'SLOT_NOT_FOUND',
            message: 'Slot not found',
            details: 'The specified slot does not exist'
          }
        };
      }

      const slotData = slotDoc.data();
      if (slotData.driverId !== driverId) {
        return {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Unauthorized access',
            details: 'You can only update your own slots'
          }
        };
      }

      await slotRef.update({
        status,
        updatedAt: Timestamp.now()
      });

      return {
        success: true,
        message: 'Slot status updated successfully',
        data: {
          slotId,
          status,
          updatedAt: new Date().toISOString()
        }
      };

    } catch (error) {
      console.error('Error updating slot status:', error);
      return {
        success: false,
        error: {
          code: 'SLOT_UPDATE_ERROR',
          message: 'Failed to update slot status',
          details: error.message
        }
      };
    }
  }

  /**
   * 🔥 NEW: Update slot selection (driver selects/deselects slots)
   * ✅ INDUSTRY STANDARD: Comprehensive validation including online status and active bookings
   */
  async updateSlotSelection(slotId, isSelected, driverId) {
    try {
      // Initialize database connection
      const db = this.getDb();
      if (!db) {
        throw new Error('Failed to initialize Firestore database connection');
      }

      const slotRef = db.collection('workSlots').doc(slotId);
      const slotDoc = await slotRef.get();

      if (!slotDoc.exists) {
        return {
          success: false,
          error: {
            code: 'SLOT_NOT_FOUND',
            message: 'Slot not found',
            details: 'The specified slot does not exist'
          }
        };
      }

      const slotData = slotDoc.data();
      if (slotData.driverId !== driverId) {
        return {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Unauthorized access',
            details: 'You can only update your own slots'
          }
        };
      }

      // ✅ CRITICAL FIX #1: Check if driver is online BEFORE allowing deselection
      // ✅ INDUSTRY STANDARD: Drivers cannot modify slots while online (prevents workflow conflicts)
      // ✅ CRITICAL FIX #4: Always fetch FRESH driver status from database to avoid stale state
      if (!isSelected) {
        // Trying to deselect - check driver status (ALWAYS fetch fresh from DB)
        const userDoc = await db.collection('users').doc(driverId).get();
        if (!userDoc.exists) {
          return {
            success: false,
            error: {
              code: 'DRIVER_NOT_FOUND',
              message: 'Driver not found',
              details: 'Driver profile does not exist'
            }
          };
        }

        const driverData = userDoc.data();
        const isDriverOnline = driverData?.driver?.isOnline === true;
        
        // ✅ CRITICAL FIX #4: Log actual database state for debugging
        console.log(`🔍 [SLOT_SELECTION] Driver ${driverId} online status from DB:`, {
          isOnline: isDriverOnline,
          timestamp: new Date().toISOString(),
          driverDataKeys: Object.keys(driverData || {})
        });

        // ✅ VALIDATION RULE 1: Block deselection if driver is online
        if (isDriverOnline) {
          console.log(`❌ [SLOT_SELECTION] Driver ${driverId} attempted to deselect slot while online`);
          return {
            success: false,
            error: {
              code: 'DRIVER_ONLINE_CANNOT_DESELECT',
              message: 'Cannot deselect slot',
              details: 'You cannot deselect slots while online. Please go offline first to modify your slot selections.'
            }
          };
        }

        // ✅ VALIDATION RULE 2: Block deselection if driver has active booking
        // ✅ INDUSTRY STANDARD: Active booking exemption - driver must complete order
        const activeBookingStatuses = [
          'driver_assigned', 
          'accepted', 
          'driver_enroute', 
          'driver_arrived', 
          'picked_up', 
          'in_transit', 
          'at_dropoff',
          'delivered', // Driver still at dropoff, needs to collect payment
          'money_collection'
        ];
        
        const activeBookingQuery = db.collection('bookings')
          .where('driverId', '==', driverId)
          .where('status', 'in', activeBookingStatuses)
          .limit(1);
        
        const activeBookingSnapshot = await activeBookingQuery.get();
        
        if (!activeBookingSnapshot.empty) {
          const activeBooking = activeBookingSnapshot.docs[0].data();
          console.log(`❌ [SLOT_SELECTION] Driver ${driverId} attempted to deselect slot with active booking:`, {
            bookingId: activeBookingSnapshot.docs[0].id,
            status: activeBooking.status
          });
          
          return {
            success: false,
            error: {
              code: 'ACTIVE_BOOKING_CANNOT_DESELECT',
              message: 'Cannot deselect slot',
              details: `You have an active booking (${activeBooking.status}). Please complete it before modifying your slot selections.`
            }
          };
        }
      }

      // ✅ VALIDATION RULE 3: Time-based validation
      // Allow selecting slots that have started (for current day) - enables mid-session join
      // But prevent deselecting slots that are currently active
      const now = new Date();
      const slotStartTime = slotData.startTime.toDate();
      const slotEndTime = slotData.endTime.toDate();
      
      // ✅ CRITICAL FIX #2: Prevent selecting slots that have already ended
      if (isSelected && now > slotEndTime) {
        console.log(`❌ [SLOT_SELECTION] Driver ${driverId} attempted to select slot that has already ended`);
        return {
          success: false,
          error: {
            code: 'SLOT_ALREADY_ENDED',
            message: 'Cannot select slot',
            details: 'This slot has already ended. You can only select current or future slots.'
          }
        };
      }
      
      // Block deselection if slot is currently active (started but not ended)
      if (now >= slotStartTime && now <= slotEndTime && !isSelected) {
        console.log(`❌ [SLOT_SELECTION] Driver ${driverId} attempted to deselect currently active slot`);
        return {
          success: false,
          error: {
            code: 'SLOT_CURRENTLY_ACTIVE',
            message: 'Cannot deselect slot',
            details: 'This slot is currently active and cannot be cancelled. Please wait for the slot to end.'
          }
        };
      }
      
      // ✅ VALIDATION RULE 4: Prevent deselecting slots that have started (even if ended)
      // Reason: Historical data integrity - slots that were active should remain selected
      if (!isSelected && now >= slotStartTime) {
        // Slot has started (may or may not have ended)
        // Allow only if slot has clearly ended AND driver is offline AND no active booking
        // (Already validated above - if we reach here, driver is offline and no active booking)
        
        // ✅ CRITICAL FIX: Only check grace period if slot has actually ENDED
        // Previous logic incorrectly blocked future slots (negative time difference)
        if (now > slotEndTime) {
          // Slot has ended - apply grace period
          const slotEndedAgo = now.getTime() - slotEndTime.getTime();
          if (slotEndedAgo < 60000 && slotEndedAgo >= 0) { // Less than 1 minute ago AND positive (actually ended)
            return {
              success: false,
              error: {
                code: 'SLOT_JUST_ENDED',
                message: 'Cannot deselect slot',
                details: 'This slot just ended. Please wait a moment before deselecting it.'
              }
            };
          }
          // Slot ended more than 1 minute ago - allow deselection
        } else {
          // Slot hasn't ended yet - this is handled by VALIDATION RULE 3 above
          // But if we reach here, it means slot started but not ended (currently active)
          // This should already be blocked by rule 3, but adding safety check
          if (now >= slotStartTime && now <= slotEndTime) {
            // This case should not reach here (rule 3 handles it), but safety check
            return {
              success: false,
              error: {
                code: 'SLOT_CURRENTLY_ACTIVE',
                message: 'Cannot deselect slot',
                details: 'This slot is currently active and cannot be cancelled.'
              }
            };
          }
        }
      }

      // ✅ FIX: Track when slot was selected (for validation - can go online if selected before it started)
      const updateData = {
        isSelected: isSelected,
        updatedAt: Timestamp.now()
      };
      
      // If selecting, record when it was selected
      if (isSelected) {
        updateData.selectedAt = Timestamp.now();
        console.log(`✅ [SLOT_SELECTION] Driver ${driverId} selected slot ${slotId}`);
      } else {
        // If deselecting, clear selectedAt timestamp
        updateData.selectedAt = null;
        console.log(`✅ [SLOT_SELECTION] Driver ${driverId} deselected slot ${slotId}`);
      }

      await slotRef.update(updateData);

      return {
        success: true,
        message: `Slot ${isSelected ? 'selected' : 'deselected'} successfully`,
        data: {
          slotId,
          isSelected,
          updatedAt: new Date().toISOString()
        }
      };

    } catch (error) {
      console.error('Error updating slot selection:', error);
      return {
        success: false,
        error: {
          code: 'SLOT_SELECTION_ERROR',
          message: 'Failed to update slot selection',
          details: error.message
        }
      };
    }
  }

  /**
   * 🔥 NEW: Batch update slot selections
   * ✅ INDUSTRY STANDARD: Comprehensive validation for batch operations
   */
  async batchUpdateSlotSelections(slotIds, isSelected, driverId) {
    try {
      // Initialize database connection
      const db = this.getDb();
      if (!db) {
        throw new Error('Failed to initialize Firestore database connection');
      }

      // ✅ CRITICAL FIX: Validate driver status BEFORE processing any slots
      // Prevents partial updates if validation fails mid-batch
      if (!isSelected) {
        // Trying to deselect - check driver status first
        const userDoc = await db.collection('users').doc(driverId).get();
        if (!userDoc.exists) {
          return {
            success: false,
            error: {
              code: 'DRIVER_NOT_FOUND',
              message: 'Driver not found',
              details: 'Driver profile does not exist'
            }
          };
        }

        const driverData = userDoc.data();
        const isDriverOnline = driverData?.driver?.isOnline === true;

        // ✅ VALIDATION RULE 1: Block batch deselection if driver is online
        if (isDriverOnline) {
          console.log(`❌ [BATCH_SLOT_SELECTION] Driver ${driverId} attempted batch deselection while online`);
          return {
            success: false,
            error: {
              code: 'DRIVER_ONLINE_CANNOT_DESELECT',
              message: 'Cannot deselect slots',
              details: 'You cannot deselect slots while online. Please go offline first to modify your slot selections.'
            }
          };
        }

        // ✅ VALIDATION RULE 2: Block batch deselection if driver has active booking
        const activeBookingStatuses = [
          'driver_assigned', 
          'accepted', 
          'driver_enroute', 
          'driver_arrived', 
          'picked_up', 
          'in_transit', 
          'at_dropoff',
          'delivered',
          'money_collection'
        ];
        
        const activeBookingQuery = db.collection('bookings')
          .where('driverId', '==', driverId)
          .where('status', 'in', activeBookingStatuses)
          .limit(1);
        
        const activeBookingSnapshot = await activeBookingQuery.get();
        
        if (!activeBookingSnapshot.empty) {
          const activeBookingData = activeBookingSnapshot.docs[0].data();
          console.log(`❌ [BATCH_SLOT_SELECTION] Driver ${driverId} attempted batch deselection with active booking:`, {
            bookingId: activeBookingSnapshot.docs[0].id,
            status: activeBookingData.status
          });
          
          return {
            success: false,
            error: {
              code: 'ACTIVE_BOOKING_CANNOT_DESELECT',
              message: 'Cannot deselect slots',
              details: `You have an active booking. Please complete it before modifying your slot selections.`
            }
          };
        }
      }

      const batch = db.batch();
      const results = [];
      const errors = [];

      for (const slotId of slotIds) {
        const slotRef = db.collection('workSlots').doc(slotId);
        const slotDoc = await slotRef.get();

        if (!slotDoc.exists || slotDoc.data().driverId !== driverId) {
          errors.push({ slotId, error: 'Slot not found or unauthorized' });
          continue; // Skip invalid slots
        }

        const slotData = slotDoc.data();
        const now = new Date();
        const slotStartTime = slotData.startTime.toDate();
        const slotEndTime = slotData.endTime.toDate();
        
        // ✅ CRITICAL FIX #2: Prevent selecting slots that have already ended
        if (isSelected && now > slotEndTime) {
          errors.push({ slotId, error: 'Slot already ended' });
          continue; // Skip selection of past slots
        }
        
        // ✅ VALIDATION RULE 3: Time-based validation per slot
        // Block deselection if slot is currently active (started but not ended)
        if (now >= slotStartTime && now <= slotEndTime && !isSelected) {
          errors.push({ slotId, error: 'Slot currently active' });
          continue; // Skip deselection of currently active slots
        }

        // ✅ VALIDATION RULE 4: Prevent deselecting slots that just ended (grace period)
        // ✅ CRITICAL FIX: Only check grace period if slot has actually ENDED
        if (!isSelected && now >= slotStartTime) {
          // Only apply grace period check if slot has actually ended
          if (now > slotEndTime) {
            const slotEndedAgo = now.getTime() - slotEndTime.getTime();
            if (slotEndedAgo < 60000 && slotEndedAgo >= 0) { // Less than 1 minute ago AND positive (actually ended)
              errors.push({ slotId, error: 'Slot just ended' });
              continue;
            }
          }
          // If slot hasn't ended yet, it's currently active - already handled by rule 3 above
        }

        // ✅ FIX: Track when slot was selected
        const updateData = {
          isSelected: isSelected,
          updatedAt: Timestamp.now()
        };
        
        if (isSelected) {
          updateData.selectedAt = Timestamp.now();
        } else {
          updateData.selectedAt = null;
        }
        
        batch.update(slotRef, updateData);
        results.push(slotId);
      }

      // Only commit if we have at least one valid update
      if (results.length > 0) {
        await batch.commit();
        console.log(`✅ [BATCH_SLOT_SELECTION] Driver ${driverId} batch ${isSelected ? 'selected' : 'deselected'} ${results.length} slots`);
        
        if (errors.length > 0) {
          console.warn(`⚠️ [BATCH_SLOT_SELECTION] ${errors.length} slots could not be updated:`, errors);
        }
      } else {
        // All slots failed validation
        return {
          success: false,
          error: {
            code: 'NO_SLOTS_UPDATED',
            message: 'No slots updated',
            details: errors.length > 0 
              ? `All slots failed validation: ${errors.map(e => e.error).join(', ')}`
              : 'No valid slots found for batch update'
          }
        };
      }

      return {
        success: true,
        message: `${results.length} slots updated successfully${errors.length > 0 ? `, ${errors.length} failed` : ''}`,
        data: {
          updatedSlots: results,
          failedSlots: errors,
          count: results.length,
          failedCount: errors.length
        }
      };

    } catch (error) {
      console.error('Error batch updating slot selections:', error);
      return {
        success: false,
        error: {
          code: 'BATCH_SELECTION_ERROR',
          message: 'Failed to batch update slot selections',
          details: error.message
        }
      };
    }
  }

  /**
   * Get available slots for booking (for customers)
   */
  async getAvailableSlots(date = new Date(), limit = 50) {
    try {
      // Initialize database connection
      const db = this.getDb();
      if (!db) {
        throw new Error('Failed to initialize Firestore database connection');
      }

      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const query = db.collection('workSlots')
        .where('status', '==', 'available')
        .where('startTime', '>=', Timestamp.fromDate(startOfDay))
        .where('startTime', '<=', Timestamp.fromDate(endOfDay))
        .orderBy('startTime', 'asc')
        .limit(limit);

      const snapshot = await query.get();
      const slots = [];

      snapshot.forEach(doc => {
        slots.push({
          id: doc.id,
          ...doc.data()
        });
      });

      return {
        success: true,
        message: 'Available slots retrieved successfully',
        data: slots
      };

    } catch (error) {
      console.error('Error getting available slots:', error);
      return {
        success: false,
        error: {
          code: 'AVAILABLE_SLOTS_ERROR',
          message: 'Failed to retrieve available slots',
          details: error.message
        }
      };
    }
  }

  /**
   * Book a slot (change status to 'booked')
   */
  async bookSlot(slotId, customerId) {
    try {
      // Initialize database connection
      const db = this.getDb();
      if (!db) {
        throw new Error('Failed to initialize Firestore database connection');
      }

      const slotRef = db.collection('workSlots').doc(slotId);
      const slotDoc = await slotRef.get();

      if (!slotDoc.exists) {
        return {
          success: false,
          error: {
            code: 'SLOT_NOT_FOUND',
            message: 'Slot not found',
            details: 'The specified slot does not exist'
          }
        };
      }

      const slotData = slotDoc.data();
      if (slotData.status !== 'available') {
        return {
          success: false,
          error: {
            code: 'SLOT_NOT_AVAILABLE',
            message: 'Slot not available',
            details: `Slot is currently ${slotData.status}`
          }
        };
      }

      await slotRef.update({
        status: 'booked',
        customerId,
        bookedAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });

      return {
        success: true,
        message: 'Slot booked successfully',
        data: {
          slotId,
          driverId: slotData.driverId,
          customerId,
          bookedAt: new Date().toISOString()
        }
      };

    } catch (error) {
      console.error('Error booking slot:', error);
      return {
        success: false,
        error: {
          code: 'SLOT_BOOKING_ERROR',
          message: 'Failed to book slot',
          details: error.message
        }
      };
    }
  }

  /**
   * Generate slots for all active drivers (admin function)
   */
  async generateSlotsForAllDrivers(date = new Date()) {
    try {
      // Initialize database connection
      const db = this.getDb();
      if (!db) {
        throw new Error('Failed to initialize Firestore database connection');
      }

      const driversQuery = db.collection('users')
        .where('userType', '==', 'driver')
        .where('isActive', '==', true);

      const driversSnapshot = await driversQuery.get();
      const results = [];

      for (const driverDoc of driversSnapshot.docs) {
        const driverId = driverDoc.id;
        const result = await this.generateDailySlots(driverId, date);
        results.push({
          driverId,
          ...result
        });
      }

      return {
        success: true,
        message: 'Slots generated for all active drivers',
        data: results
      };

    } catch (error) {
      console.error('Error generating slots for all drivers:', error);
      return {
        success: false,
        error: {
          code: 'BULK_SLOT_GENERATION_ERROR',
          message: 'Failed to generate slots for all drivers',
          details: error.message
        }
      };
    }
  }

  /**
   * Delete old slots (cleanup function)
   */
  async deleteOldSlots(daysOld = 7) {
    try {
      // Initialize database connection
      const db = this.getDb();
      if (!db) {
        throw new Error('Failed to initialize Firestore database connection');
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const query = db.collection('workSlots')
        .where('startTime', '<', Timestamp.fromDate(cutoffDate));

      const snapshot = await query.get();
      const batch = db.batch();

      snapshot.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();

      return {
        success: true,
        message: 'Old slots deleted successfully',
        deletedCount: snapshot.size
      };

    } catch (error) {
      console.error('Error deleting old slots:', error);
      return {
        success: false,
        error: {
          code: 'SLOT_DELETION_ERROR',
          message: 'Failed to delete old slots',
          details: error.message
        }
      };
    }
  }
}

module.exports = new WorkSlotsService();
