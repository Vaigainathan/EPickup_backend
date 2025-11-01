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
 */
const ACTIVE_BOOKING_STATUSES = [
  'pending',
  'driver_assigned',
  'accepted',
  'driver_enroute',
  'driver_arrived',
  'picked_up',
  'in_transit',
  'delivered',
  'money_collection'
];

/**
 * Active booking statuses with driver assigned
 * Statuses where customer should see trip progress screen
 */
const ACTIVE_BOOKING_WITH_DRIVER_STATUSES = [
  'driver_assigned',
  'driver_enroute',
  'driver_arrived',
  'picked_up',
  'in_transit',
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
 */
const VALID_BOOKING_STATUSES = [
  'pending',
  'driver_assigned',
  'accepted',
  'driver_enroute',
  'driver_arrived',
  'picked_up',
  'in_transit',
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

module.exports = {
  ACTIVE_BOOKING_STATUSES,
  ACTIVE_BOOKING_WITH_DRIVER_STATUSES,
  PENDING_BOOKING_STATUSES,
  COMPLETED_BOOKING_STATUSES,
  VALID_BOOKING_STATUSES,
  PAYMENT_STATUSES
};

