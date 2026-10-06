/**
 * Standardized Booking Status Constants
 * 
 * This file provides shared constants for booking statuses across the application
 * to ensure consistency and avoid duplication.
 * 
 * ✅ USE THIS FILE for all active booking queries and status validations
 */

/**
 * Active booking statuses - bookings that prevent creating new bookings
 * Includes all statuses from pending through money_collection
 * ✅ CRITICAL FIX: Must include photo_captured
 */
const ACTIVE_BOOKING_STATUSES = [
  'pending',
  'driver_assigned',
  'accepted',
  'driver_enroute',
  'driver_arrived',
  'photo_captured', // ✅ CRITICAL FIX: Add photo_captured state
  'picked_up',
  'in_transit',
  'at_dropoff',
  'delivered',
  'money_collection'
];

/**
 * Active booking statuses with driver assigned
 * Statuses where customer should see trip progress screen
 * ✅ CRITICAL FIX: Must include photo_captured
 */
const ACTIVE_BOOKING_WITH_DRIVER_STATUSES = [
  'driver_assigned',
  'driver_enroute',
  'driver_arrived',
  'photo_captured', // ✅ CRITICAL FIX: Add photo_captured state
  'picked_up',
  'in_transit',
  'at_dropoff',
  'delivered',
  'money_collection'
];

/**
 * Pending booking statuses - waiting for driver assignment
 */
const PENDING_BOOKING_STATUSES = [
  'pending',
  'confirmed',
  'searching'
];

/**
 * Completed booking statuses - bookings that are finished
 */
const COMPLETED_BOOKING_STATUSES = [
  'completed',
  'cancelled',
  'rejected'
];

/**
 * All valid booking statuses
 * ✅ CRITICAL FIX: Must include photo_captured to match state machine
 */
const VALID_BOOKING_STATUSES = [
  'pending',
  'driver_assigned',
  'accepted',
  'driver_enroute',
  'driver_arrived',
  'photo_captured', // ✅ CRITICAL FIX: Add photo_captured state
  'picked_up',
  'in_transit',
  'at_dropoff',
  'delivered',
  'money_collection',
  'completed',
  'cancelled',
  'rejected'
];

/**
 * Payment-related statuses
 */
const PAYMENT_STATUSES = [
  'delivered',
  'money_collection',
  'completed'
];

const CUSTOMER_PARCEL_BLOCKING_STATUSES = ACTIVE_BOOKING_STATUSES.filter((status) =>
  status !== 'delivered' && status !== 'money_collection'
);

const CUSTOMER_NON_CANCELLABLE_STATUSES = [
  'picked_up',
  'in_transit',
  'at_dropoff',
  'delivered',
  'money_collection',
  'completed',
  'cancelled',
  'rejected'
];

function customerCancelRefusal(status) {
  const currentStatus = status || '';
  if (!CUSTOMER_NON_CANCELLABLE_STATUSES.includes(currentStatus)) {
    return null;
  }
  return {
    status: 400,
    body: {
      success: false,
      error: 'Cannot cancel this booking',
      code: 'CANCELLATION_NOT_ALLOWED',
      message: currentStatus === 'cancelled'
        ? 'This booking is already cancelled.'
        : 'Cancellation is not allowed once the driver has picked up your order. Please contact support if you have an issue.'
    }
  };
}

function planCustomerActiveCancel(status) {
  if (!CUSTOMER_PARCEL_BLOCKING_STATUSES.includes(status)) {
    return { action: 'not_blocking' };
  }
  const refusal = customerCancelRefusal(status);
  if (refusal) {
    return { action: 'refuse', refusal };
  }
  return { action: 'cancel' };
}

function activeCancelHttp(result) {
  if (result && result.success) {
    return {
      status: 200,
      body: {
        success: true,
        message: 'Active booking cancelled successfully',
        data: result
      }
    };
  }
  if (result && result.outcome === 'refuse') {
    return {
      status: result.refusal.status,
      body: result.refusal.body
    };
  }
  return {
    status: 404,
    body: {
      success: false,
      error: 'No parcel booking to cancel',
      code: 'NO_BLOCKING_BOOKING'
    }
  };
}

module.exports = {
  ACTIVE_BOOKING_STATUSES,
  ACTIVE_BOOKING_WITH_DRIVER_STATUSES,
  PENDING_BOOKING_STATUSES,
  COMPLETED_BOOKING_STATUSES,
  VALID_BOOKING_STATUSES,
  PAYMENT_STATUSES,
  CUSTOMER_PARCEL_BLOCKING_STATUSES,
  CUSTOMER_NON_CANCELLABLE_STATUSES,
  customerCancelRefusal,
  planCustomerActiveCancel,
  activeCancelHttp
};

