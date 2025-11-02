const { getFirestore } = require('firebase-admin/firestore');

/**
 * Booking Lock Service - Industry Standard Order Isolation
 * ✅ ZOMATO/PORTER STANDARD: Prevents race conditions and ensures one order per customer
 * ✅ CRITICAL FIX: Now uses Firestore for distributed locking (works across multiple server instances)
 */
class BookingLockService {
  constructor() {
    this.db = null; // Initialize lazily
    this.activeLocks = new Map(); // In-memory cache for fast lookups
    this.lockTimeout = 30000; // 30 seconds lock timeout
    this.lockCollection = 'booking_locks'; // Firestore collection for locks
  }

  /**
   * Get Firestore instance (lazy initialization)
   */
  getDb() {
    if (!this.db) {
      try {
        this.db = getFirestore();
      } catch (error) {
        console.error('❌ [BookingLockService] Failed to get Firestore:', error);
        throw new Error('Firebase not initialized. Please ensure Firebase is initialized before using BookingLockService.');
      }
    }
    return this.db;
  }

  /**
   * Acquire exclusive lock for booking acceptance using Firestore
   * ✅ CRITICAL FIX: Uses Firestore for distributed locking across multiple server instances
   * ✅ ZOMATO STANDARD: Only one driver can accept at a time
   */
  async acquireBookingLock(bookingId, driverId) {
    const db = this.getDb();
    const lockRef = db.collection(this.lockCollection).doc(bookingId);
    const bookingRef = db.collection('bookings').doc(bookingId);
    const now = Date.now();
    const expiresAt = now + this.lockTimeout;

    try {
      // ✅ CRITICAL FIX: Use Firestore transaction to atomically acquire lock AND verify booking state
      await db.runTransaction(async (transaction) => {
        // Get both lock and booking in the same transaction
        const [lockDoc, bookingDoc] = await Promise.all([
          transaction.get(lockRef),
          transaction.get(bookingRef)
        ]);
        
        // ✅ CRITICAL: Verify booking actually exists and is available
        if (!bookingDoc.exists) {
          throw new Error('BOOKING_NOT_FOUND');
        }
        
        const bookingData = bookingDoc.data();
        
        // ✅ CRITICAL: Verify booking is actually pending and not already assigned
        // This prevents false positives from stale locks
        if (bookingData.status !== 'pending') {
          // Booking is already assigned - no need for lock
          console.log(`⚠️ [BookingLock] Booking ${bookingId} status is ${bookingData.status}, not pending`);
          throw new Error('BOOKING_ALREADY_ASSIGNED');
        }
        
        if (bookingData.driverId !== null && bookingData.driverId !== undefined && bookingData.driverId !== '') {
          // Booking already has a driver assigned - no need for lock
          console.log(`⚠️ [BookingLock] Booking ${bookingId} already has driverId: ${bookingData.driverId}`);
          throw new Error('BOOKING_ALREADY_ASSIGNED');
        }
        
        // Now check lock status
        if (lockDoc.exists) {
          const lockData = lockDoc.data();
          const lockTimestamp = lockData.timestamp || 0;
          
          // Check if lock is still valid (not expired)
          if (now - lockTimestamp < this.lockTimeout) {
            // Lock is still active
            if (lockData.driverId !== driverId) {
              // Another driver holds the lock - BUT verify booking is still actually available
              // This handles the case where lock exists but booking wasn't actually accepted
              console.log(`🔒 [BookingLock] Lock already held by driver ${lockData.driverId} for booking ${bookingId}`);
              
              // ✅ CRITICAL: Since we already verified booking is still pending above,
              // and we're checking lock status here, if booking is pending but lock exists,
              // it's likely a stale lock from a failed previous attempt.
              // However, to prevent actual race conditions, we check:
              // - If lock is very recent (< 5 seconds), respect it (might be active attempt)
              // - If lock is older (> 5 seconds), it's likely stale - allow override
              const lockAge = now - lockTimestamp;
              const STALE_LOCK_THRESHOLD = 5000; // 5 seconds
              
              if (lockAge > STALE_LOCK_THRESHOLD && bookingData.status === 'pending' && (!bookingData.driverId || bookingData.driverId === null || bookingData.driverId === '')) {
                // Stale lock detected - booking is still available, override the lock
                console.warn(`⚠️ [BookingLock] Stale lock detected for booking ${bookingId}. Lock age: ${lockAge}ms. Overriding stale lock.`);
                // Delete stale lock and continue
                transaction.delete(lockRef);
              } else {
                // Recent lock or booking might be assigned - respect the lock
                throw new Error('BOOKING_LOCKED');
              }
            }
            // Same driver trying to acquire lock again - refresh timestamp (idempotent)
            console.log(`🔄 [BookingLock] Refreshing lock for booking ${bookingId} by driver ${driverId}`);
          } else {
            // Lock expired, we can acquire it (previous attempt likely failed)
            console.log(`⏰ [BookingLock] Previous lock expired for booking ${bookingId}, acquiring for driver ${driverId}`);
          }
        }
        
        // Acquire/refresh lock in Firestore
        transaction.set(lockRef, {
          driverId,
          timestamp: now,
          expiresAt,
          bookingId,
          acquiredAt: new Date()
        }, { merge: true });
      });

      // Cache in memory for fast lookups
      this.activeLocks.set(bookingId, {
        driverId,
        timestamp: now,
        bookingId
      });

      console.log(`🔒 [BookingLock] Lock acquired for booking ${bookingId} by driver ${driverId}`);
      return true;
    } catch (error) {
      if (error.message === 'BOOKING_LOCKED') {
        throw error;
      }
      console.error(`❌ [BookingLock] Error acquiring lock for booking ${bookingId}:`, error);
      throw new Error(`Failed to acquire booking lock: ${error.message}`);
    }
  }

  /**
   * Release booking lock from both Firestore and memory
   */
  async releaseBookingLock(bookingId, driverId) {
    const db = this.getDb();
    const lockRef = db.collection(this.lockCollection).doc(bookingId);

    try {
      // Use transaction to ensure we only release our own lock
      await db.runTransaction(async (transaction) => {
        const lockDoc = await transaction.get(lockRef);
        
        if (lockDoc.exists) {
          const lockData = lockDoc.data();
          
          // Only release if this driver owns the lock
          if (lockData.driverId === driverId) {
            transaction.delete(lockRef);
          } else {
            console.log(`⚠️ [BookingLock] Attempted to release lock owned by different driver for booking ${bookingId}`);
          }
        }
      });

      // Remove from memory cache
      if (this.activeLocks.has(bookingId)) {
        const cachedLock = this.activeLocks.get(bookingId);
        if (cachedLock.driverId === driverId) {
          this.activeLocks.delete(bookingId);
        }
      }

      console.log(`🔓 [BookingLock] Lock released for booking ${bookingId} by driver ${driverId}`);
      return true;
    } catch (error) {
      console.error(`❌ [BookingLock] Error releasing lock for booking ${bookingId}:`, error);
      // Still try to remove from memory cache
      this.activeLocks.delete(bookingId);
      return false;
    }
  }

  /**
   * Check if booking is locked (checks both Firestore and memory cache)
   */
  async isBookingLocked(bookingId) {
    // First check memory cache (faster)
    const cachedLock = this.activeLocks.get(bookingId);
    if (cachedLock) {
      const now = Date.now();
      if (now - cachedLock.timestamp < this.lockTimeout) {
        return true;
      } else {
        // Expired in cache, remove it
        this.activeLocks.delete(bookingId);
      }
    }

    // Check Firestore for authoritative lock status
    try {
      const db = this.getDb();
      const lockRef = db.collection(this.lockCollection).doc(bookingId);
      const lockDoc = await lockRef.get();

      if (lockDoc.exists) {
        const lockData = lockDoc.data();
        const now = Date.now();
        const lockTimestamp = lockData.timestamp || 0;

        if (now - lockTimestamp < this.lockTimeout) {
          // Still locked, update cache
          this.activeLocks.set(bookingId, {
            driverId: lockData.driverId,
            timestamp: lockTimestamp,
            bookingId
          });
          return true;
        } else {
          // Lock expired, delete it
          await lockRef.delete();
          return false;
        }
      }

      return false;
    } catch (error) {
      console.error(`❌ [BookingLock] Error checking lock status for booking ${bookingId}:`, error);
      return false; // Fail open - if we can't check, assume not locked
    }
  }

  /**
   * Get lock owner (from memory cache or Firestore)
   */
  async getLockOwner(bookingId) {
    // Check memory cache first
    const cachedLock = this.activeLocks.get(bookingId);
    if (cachedLock) {
      const now = Date.now();
      if (now - cachedLock.timestamp < this.lockTimeout) {
        return cachedLock.driverId;
      }
    }

    // Check Firestore
    try {
      const db = this.getDb();
      const lockRef = db.collection(this.lockCollection).doc(bookingId);
      const lockDoc = await lockRef.get();

      if (lockDoc.exists) {
        const lockData = lockDoc.data();
        const now = Date.now();
        const lockTimestamp = lockData.timestamp || 0;

        if (now - lockTimestamp < this.lockTimeout) {
          return lockData.driverId;
        }
      }
    } catch (error) {
      console.error(`❌ [BookingLock] Error getting lock owner for booking ${bookingId}:`, error);
    }

    return null;
  }

  /**
   * Clean up expired locks from both Firestore and memory
   */
  async cleanupExpiredLocks() {
    const db = this.getDb();
    const now = Date.now();
    let cleanedCount = 0;

    try {
      // Clean up memory cache
      for (const [bookingId, lock] of this.activeLocks.entries()) {
        if (now - lock.timestamp >= this.lockTimeout) {
          this.activeLocks.delete(bookingId);
          cleanedCount++;
        }
      }

      // Clean up Firestore locks
      const locksSnapshot = await db.collection(this.lockCollection)
        .where('expiresAt', '<', now)
        .get();

      const batch = db.batch();
      locksSnapshot.forEach(doc => {
        batch.delete(doc.ref);
        cleanedCount++;
      });

      if (locksSnapshot.size > 0) {
        await batch.commit();
      }

      if (cleanedCount > 0) {
        console.log(`🧹 [BookingLock] Cleaned up ${cleanedCount} expired locks`);
      }
    } catch (error) {
      console.error('❌ [BookingLock] Error cleaning up expired locks:', error);
    }
  }

  /**
   * Force release lock (admin only) - removes from both Firestore and memory
   */
  async forceReleaseLock(bookingId) {
    const db = this.getDb();
    const lockRef = db.collection(this.lockCollection).doc(bookingId);

    try {
      // Remove from Firestore
      await lockRef.delete();

      // Remove from memory cache
      this.activeLocks.delete(bookingId);

      console.log(`🔓 [BookingLock] Force released lock for booking ${bookingId}`);
      return true;
    } catch (error) {
      console.error(`❌ [BookingLock] Error force releasing lock for booking ${bookingId}:`, error);
      // Still try to remove from memory
      this.activeLocks.delete(bookingId);
      return false;
    }
  }
}

module.exports = BookingLockService;
