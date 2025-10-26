const { getFirestore } = require('firebase-admin/firestore');

/**
 * Booking Lock Service - Industry Standard Order Isolation
 * ✅ ZOMATO/PORTER STANDARD: Prevents race conditions and ensures one order per customer
 */
class BookingLockService {
  constructor() {
    this.db = null; // Initialize lazily
    this.activeLocks = new Map(); // In-memory lock tracking
    this.lockTimeout = 30000; // 30 seconds lock timeout
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
   * Acquire exclusive lock for booking acceptance
   * ✅ ZOMATO STANDARD: Only one driver can accept at a time
   */
  async acquireBookingLock(bookingId, driverId) {
    const lockKey = `booking_${bookingId}`;
    const now = Date.now();

    // Check if lock already exists and is still valid
    if (this.activeLocks.has(lockKey)) {
      const lock = this.activeLocks.get(lockKey);
      if (now - lock.timestamp < this.lockTimeout) {
        throw new Error('BOOKING_LOCKED');
      }
      // Lock expired, remove it
      this.activeLocks.delete(lockKey);
    }

    // Acquire lock
    this.activeLocks.set(lockKey, {
      driverId,
      timestamp: now,
      bookingId
    });

    console.log(`🔒 [BookingLock] Lock acquired for booking ${bookingId} by driver ${driverId}`);
    return true;
  }

  /**
   * Release booking lock
   */
  async releaseBookingLock(bookingId, driverId) {
    const lockKey = `booking_${bookingId}`;
    const lock = this.activeLocks.get(lockKey);

    if (lock && lock.driverId === driverId) {
      this.activeLocks.delete(lockKey);
      console.log(`🔓 [BookingLock] Lock released for booking ${bookingId} by driver ${driverId}`);
      return true;
    }

    return false;
  }

  /**
   * Check if booking is locked
   */
  isBookingLocked(bookingId) {
    const lockKey = `booking_${bookingId}`;
    const lock = this.activeLocks.get(lockKey);
    
    if (!lock) return false;
    
    const now = Date.now();
    if (now - lock.timestamp >= this.lockTimeout) {
      // Lock expired
      this.activeLocks.delete(lockKey);
      return false;
    }
    
    return true;
  }

  /**
   * Get lock owner
   */
  getLockOwner(bookingId) {
    const lockKey = `booking_${bookingId}`;
    const lock = this.activeLocks.get(lockKey);
    return lock ? lock.driverId : null;
  }

  /**
   * Clean up expired locks
   */
  cleanupExpiredLocks() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, lock] of this.activeLocks.entries()) {
      if (now - lock.timestamp >= this.lockTimeout) {
        this.activeLocks.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 [BookingLock] Cleaned up ${cleanedCount} expired locks`);
    }
  }

  /**
   * Force release lock (admin only)
   */
  async forceReleaseLock(bookingId) {
    const lockKey = `booking_${bookingId}`;
    const lock = this.activeLocks.get(lockKey);
    
    if (lock) {
      this.activeLocks.delete(lockKey);
      console.log(`🔓 [BookingLock] Force released lock for booking ${bookingId}`);
      return true;
    }
    
    return false;
  }
}

module.exports = BookingLockService;
