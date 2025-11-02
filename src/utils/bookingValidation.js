/**
 * Booking Validation Utilities
 * Comprehensive validation for booking state, especially driverId field
 */

/**
 * Check if a booking is available for driver acceptance
 * Handles ALL possible driverId values: null, undefined, '', whitespace, 0, false, etc.
 * 
 * @param {Object} bookingData - Booking data from Firestore
 * @param {string} requestingDriverId - Driver ID trying to accept the booking
 * @returns {Object} Validation result
 */
function isBookingAvailableForDriver(bookingData, requestingDriverId) {
  const validation = {
    isAvailable: false,
    reason: '',
    driverIdValue: bookingData.driverId,
    driverIdType: typeof bookingData.driverId,
    status: bookingData.status,
    isPending: false,
    hasDriverAssigned: false,
    driverIdMatches: false
  };

  // Check status first
  if (bookingData.status !== 'pending') {
    validation.reason = `Booking status is '${bookingData.status}', not 'pending'`;
    validation.isAvailable = false;
    return validation;
  }
  validation.isPending = true;

  // ✅ COMPREHENSIVE driverId validation
  // Handle ALL possible values: null, undefined, '', 0, false, whitespace, etc.
  const driverId = bookingData.driverId;
  
  // Normalize driverId - handle all falsy and edge cases
  let normalizedDriverId = null;
  
  if (driverId === null || driverId === undefined) {
    // Explicitly null or undefined - no driver assigned
    normalizedDriverId = null;
  } else if (typeof driverId === 'string') {
    // String - check if it's empty or whitespace
    const trimmed = driverId.trim();
    if (trimmed === '' || trimmed.length === 0) {
      normalizedDriverId = null; // Empty string = no driver
    } else {
      normalizedDriverId = trimmed;
    }
  } else if (typeof driverId === 'number') {
    // Number (edge case - shouldn't happen but handle it)
    if (driverId === 0) {
      normalizedDriverId = null; // 0 = no driver
    } else {
      normalizedDriverId = String(driverId);
    }
  } else if (typeof driverId === 'boolean') {
    // Boolean (edge case - shouldn't happen)
    normalizedDriverId = null; // false/true = no driver
  } else if (driverId && typeof driverId === 'object') {
    // Object (edge case - shouldn't happen)
    normalizedDriverId = null; // Invalid type
  } else {
    // Any other type
    normalizedDriverId = null;
  }

  // Check if a driver is assigned
  validation.hasDriverAssigned = normalizedDriverId !== null;
  
  if (validation.hasDriverAssigned) {
    // Driver is assigned - check if it's the requesting driver (idempotent accept)
    validation.driverIdMatches = normalizedDriverId === requestingDriverId;
    
    if (validation.driverIdMatches) {
      // Same driver trying to accept again - allow it (idempotent)
      validation.isAvailable = true;
      validation.reason = 'Booking already assigned to this driver (idempotent accept)';
      return validation;
    } else {
      // Different driver assigned
      validation.isAvailable = false;
      validation.reason = `Booking already assigned to driver: ${normalizedDriverId}`;
      return validation;
    }
  } else {
    // No driver assigned - booking is available
    validation.isAvailable = true;
    validation.reason = 'Booking is available for acceptance';
    return validation;
  }
}

/**
 * Normalize driverId value for consistent comparison
 * Converts all "no driver" representations to null
 * 
 * @param {any} driverId - driverId value from Firestore
 * @returns {string|null} Normalized driverId (string if assigned, null if not)
 */
function normalizeDriverId(driverId) {
  if (driverId === null || driverId === undefined) {
    return null;
  }
  
  if (typeof driverId === 'string') {
    const trimmed = driverId.trim();
    return trimmed === '' ? null : trimmed;
  }
  
  if (typeof driverId === 'number' && driverId === 0) {
    return null;
  }
  
  if (typeof driverId === 'boolean') {
    return null;
  }
  
  if (driverId && typeof driverId === 'object') {
    return null;
  }
  
  // Convert to string for other types (shouldn't happen)
  return String(driverId).trim() || null;
}

/**
 * Check if driverId indicates "no driver assigned"
 * Returns true if driverId is null, undefined, empty string, whitespace, etc.
 * 
 * @param {any} driverId - driverId value to check
 * @returns {boolean} True if no driver is assigned
 */
function isDriverIdEmpty(driverId) {
  return normalizeDriverId(driverId) === null;
}

/**
 * Validate booking can be accepted by driver
 * Comprehensive validation with detailed error messages
 * 
 * @param {Object} bookingData - Booking data from Firestore
 * @param {string} driverId - Driver ID trying to accept
 * @returns {Object} { valid: boolean, error: string|null, details: Object }
 */
function validateBookingAcceptance(bookingData, driverId) {
  const details = {
    bookingId: bookingData.id,
    status: bookingData.status,
    driverId: bookingData.driverId,
    driverIdType: typeof bookingData.driverId,
    requestingDriverId: driverId,
    normalizedDriverId: normalizeDriverId(bookingData.driverId),
    isDriverIdEmpty: isDriverIdEmpty(bookingData.driverId)
  };

  // Check if booking exists
  if (!bookingData) {
    return {
      valid: false,
      error: 'BOOKING_NOT_FOUND',
      message: 'Booking data is missing',
      details
    };
  }

  // Check status
  if (bookingData.status !== 'pending') {
    // Special case: if already assigned to this driver with status 'driver_assigned', allow it (idempotent)
    const normalized = normalizeDriverId(bookingData.driverId);
    if (normalized === driverId && bookingData.status === 'driver_assigned') {
      return {
        valid: true,
        error: null,
        message: 'Booking already assigned to this driver (idempotent accept)',
        details: { ...details, isIdempotent: true }
      };
    }
    
    return {
      valid: false,
      error: 'BOOKING_ALREADY_ASSIGNED',
      message: `Booking status is '${bookingData.status}', not 'pending'`,
      details
    };
  }

  // Check driverId
  const normalizedDriverId = normalizeDriverId(bookingData.driverId);
  
  if (normalizedDriverId !== null) {
    // Driver is assigned
    if (normalizedDriverId === driverId) {
      // Same driver - allow it (idempotent)
      return {
        valid: true,
        error: null,
        message: 'Booking already assigned to this driver (idempotent accept)',
        details: { ...details, isIdempotent: true }
      };
    } else {
      // Different driver
      return {
        valid: false,
        error: 'BOOKING_ALREADY_ASSIGNED',
        message: `Booking already assigned to driver: ${normalizedDriverId}`,
        details
      };
    }
  }

  // No driver assigned - booking is available
  return {
    valid: true,
    error: null,
    message: 'Booking is available for acceptance',
    details
  };
}

module.exports = {
  isBookingAvailableForDriver,
  normalizeDriverId,
  isDriverIdEmpty,
  validateBookingAcceptance
};

