const { FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('./firebase');
const bookingStateMachine = require('./bookingStateMachine');

class DriverStatusError extends Error {
  constructor(statusCode, code, message, details = {}) {
    super(message);
    this.name = 'DriverStatusError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

const STATUS_ALIASES = {
  driver_arrived_pickup: 'driver_arrived',
  arrived_pickup: 'driver_arrived',
  arrived_at_pickup: 'driver_arrived',
  driver_arrived_dropoff: 'at_dropoff',
  arrived_dropoff: 'at_dropoff',
  arrived_at_dropoff: 'at_dropoff',
  at_drop_off: 'at_dropoff',
  enroute_dropoff: 'in_transit',
  enroute_to_dropoff: 'in_transit',
  en_route_dropoff: 'in_transit',
  en_route_to_dropoff: 'in_transit',
  delivering: 'in_transit',
  delivery_in_progress: 'in_transit',
  money_collection_pending: 'money_collection',
  payment_collection: 'money_collection',
  delivery_completed: 'delivered',
  completed_delivery: 'delivered'
};

const STATUS_RULES = {
  driver_assigned: { allowedFrom: ['pending'], requireLocation: null },
  accepted: { allowedFrom: ['pending', 'driver_assigned'], requireLocation: null },
  driver_enroute: { allowedFrom: ['driver_assigned', 'accepted'], requireLocation: null },
  // ✅ CRITICAL FIX: Allow driver_arrived from driver_assigned, driver_enroute, or accepted
  // This allows drivers who accept and immediately go to pickup location to mark as arrived
  driver_arrived: { allowedFrom: ['driver_assigned', 'driver_enroute', 'accepted'], requireLocation: 'pickup' },
  picked_up: { allowedFrom: ['driver_arrived', 'driver_enroute', 'accepted'], requireLocation: 'pickup' },
  in_transit: { allowedFrom: ['picked_up'], requireLocation: null },
  at_dropoff: { allowedFrom: ['in_transit'], requireLocation: 'dropoff' },
  money_collection: { allowedFrom: ['delivered'], requireLocation: null },
  completed: { allowedFrom: ['money_collection', 'delivered'], requireLocation: null }
};

class DriverStatusWorkflowService {
  constructor() {
    this.db = null;
    this.MAX_PICKUP_RADIUS_KM = 0.1;
    this.MAX_DROPOFF_RADIUS_KM = 0.1;
  }

  getDb() {
    if (!this.db) {
      this.db = getFirestore();
    }
    return this.db;
  }

  normalizeStatus(status) {
    if (!status) {
      return null;
    }

    const normalized = status.toString().trim().toLowerCase();
    return STATUS_ALIASES[normalized] || normalized;
  }

  toDate(value) {
    if (!value) {
      return null;
    }
    if (typeof value.toDate === 'function') {
      return value.toDate();
    }
    return new Date(value);
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    const radius = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return radius * c;
  }

  ensureDriverOwnership(booking, driverId) {
    if (!booking || booking.driverId !== driverId) {
      throw new DriverStatusError(
        403,
        'ACCESS_DENIED',
        'You can only update bookings assigned to you'
      );
    }
  }

  ensureLocationRequirement(statusKey, booking, location) {
    const rule = STATUS_RULES[statusKey];
    if (!rule || !rule.requireLocation) {
      return;
    }

    if (
      !location ||
      typeof location.latitude !== 'number' ||
      typeof location.longitude !== 'number'
    ) {
      throw new DriverStatusError(
        400,
        'LOCATION_REQUIRED',
        `Location is required to confirm ${statusKey.replace('_', ' ')}`
      );
    }

    const targetCoordinates =
      rule.requireLocation === 'pickup'
        ? booking?.pickup?.coordinates
        : booking?.dropoff?.coordinates;

    if (
      targetCoordinates &&
      typeof targetCoordinates.latitude === 'number' &&
      typeof targetCoordinates.longitude === 'number'
    ) {
      const distance = this.calculateDistance(
        location.latitude,
        location.longitude,
        targetCoordinates.latitude,
        targetCoordinates.longitude
      );
      const maxRadiusKm =
        rule.requireLocation === 'pickup'
          ? this.MAX_PICKUP_RADIUS_KM
          : this.MAX_DROPOFF_RADIUS_KM;

      if (distance > maxRadiusKm) {
        const distanceMeters = (distance * 1000).toFixed(0);
        const limitMeters = (maxRadiusKm * 1000).toFixed(0);
        throw new DriverStatusError(
          400,
          'OUTSIDE_CONFIRMATION_RADIUS',
          `You must be within ${limitMeters}m of the ${rule.requireLocation} location to confirm this status. You are currently ${distanceMeters}m away.`
        );
      }
    }
  }

  ensureTransitionAllowed(currentStatus, nextStatus) {
    if (currentStatus === nextStatus) {
      return;
    }

    const rule = STATUS_RULES[nextStatus];
    if (rule && Array.isArray(rule.allowedFrom)) {
      if (!rule.allowedFrom.includes(currentStatus)) {
        throw new DriverStatusError(
          409,
          'INVALID_STATE_TRANSITION',
          `Cannot transition from ${currentStatus} to ${nextStatus}`
        );
      }
    }
  }

  buildSequenceFallback(booking) {
    const existingSequence = booking?.statusMeta?.sequence || 0;
    return existingSequence + 1;
  }

  async logStatusUpdate({
    bookingId,
    status,
    driverId,
    eventTimestamp,
    eventId,
    source,
    metadata = {},
    idempotent = false
  }) {
    try {
      const logData = {
        bookingId,
        status,
        driverId,
        timestamp: eventTimestamp.toISOString(),
        updatedBy: driverId,
        source,
        eventId,
        idempotent,
        metadata
      };

      await this.getDb().collection('booking_status_updates').add(logData);
    } catch (error) {
      console.warn(
        `⚠️ [DRIVER_STATUS_WORKFLOW] Failed to log status update for booking ${bookingId}:`,
        error.message
      );
    }
  }

  buildIdempotentUpdateData({ location, eventTimestamp, source, eventId }) {
    const updateData = {};

    if (location) {
      updateData['driver.currentLocation'] = {
        ...location,
        timestamp: eventTimestamp
      };
    }

    updateData['statusMeta.lastHeartbeatAt'] = eventTimestamp;
    updateData['statusMeta.lastHeartbeatSource'] = source;

    if (eventId) {
      updateData['statusMeta.lastHeartbeatId'] = eventId;
    }

    updateData.updatedAt = new Date();

    return updateData;
  }

  buildStatusUpdateData({
    booking,
    status,
    location,
    notes,
    eventTimestamp,
    eventId,
    source,
    additionalUpdates = {}
  }) {
    const updateData = {
      eventTimestamp,
      driverId: booking.driverId,
      'statusMeta.lastEventId':
        eventId || `${booking.driverId}:${status}:${eventTimestamp.getTime()}`,
      'statusMeta.lastEventSource': source,
      'statusMeta.lastEventAt': eventTimestamp,
      'statusMeta.lastStatusBefore': this.normalizeStatus(booking.status),
      'statusMeta.lastStatusAfter': status,
      'statusMeta.sequence': FieldValue.increment(1)
    };

    if (location) {
      updateData['driver.currentLocation'] = {
        ...location,
        timestamp: eventTimestamp
      };
    }

    if (notes) {
      updateData['driver.statusNotes'] = notes;
    }

    if (additionalUpdates && typeof additionalUpdates === 'object') {
      Object.assign(updateData, additionalUpdates);
    }

    return updateData;
  }

  async updateStatus({
    bookingId,
    driverId,
    requestedStatus,
    location,
    notes,
    eventId,
    eventTimestamp,
    source = 'driver_app',
    additionalUpdates = {}
  }) {
    const db = this.getDb();
    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get();

    if (!bookingDoc.exists) {
      throw new DriverStatusError(
        404,
        'BOOKING_NOT_FOUND',
        'Booking not found'
      );
    }

    const bookingData = bookingDoc.data();
    this.ensureDriverOwnership(bookingData, driverId);

    const canonicalStatus = this.normalizeStatus(requestedStatus);
    if (!canonicalStatus) {
      throw new DriverStatusError(
        400,
        'INVALID_STATUS',
        'Invalid status value provided'
      );
    }

    if (canonicalStatus === 'delivered' || canonicalStatus === 'completed') {
      throw new DriverStatusError(
        400,
        'FORBIDDEN_STATUS',
        'Delivered/completed status must be confirmed via the delivery completion endpoint'
      );
    }

    const currentStatus = this.normalizeStatus(bookingData.status || 'pending');
    let eventTs = eventTimestamp ? new Date(eventTimestamp) : new Date();
    if (isNaN(eventTs.getTime())) {
      eventTs = new Date();
    }

    const lastEventAtRaw =
      bookingData.statusMeta?.lastEventAt || bookingData.updatedAt;
    const lastEventAt = this.toDate(lastEventAtRaw);
    
    // ✅ CRITICAL FIX: Allow events within 5 seconds of last update to handle clock skew and network delays
    const timeDiff = lastEventAt ? (eventTs.getTime() - lastEventAt.getTime()) : 0;
    const CLOCK_SKEW_TOLERANCE_MS = 5000; // 5 seconds tolerance
    
    if (lastEventAt && eventTs < lastEventAt && timeDiff < -CLOCK_SKEW_TOLERANCE_MS) {
      throw new DriverStatusError(
        409,
        'STALE_EVENT',
        `Event timestamp ${eventTs.toISOString()} is older than the last recorded update ${lastEventAt.toISOString()}`
      );
    }
    
    // ✅ FIX: If timestamp is slightly stale but within tolerance, use current time instead
    if (lastEventAt && eventTs < lastEventAt) {
      console.log(`⚠️ [UPDATE_STATUS] Event timestamp is ${Math.abs(timeDiff)}ms older than last update, using current time instead`);
      eventTs = new Date();
    }

    if (canonicalStatus === currentStatus) {
      const heartbeatUpdates = this.buildIdempotentUpdateData({
        location,
        eventTimestamp: eventTs,
        source,
        eventId
      });

      if (Object.keys(heartbeatUpdates).length > 0) {
        await bookingRef.update(heartbeatUpdates);
      }

      const freshDoc = await bookingRef.get();
      const freshBooking = freshDoc.data();

      await this.logStatusUpdate({
        bookingId,
        status: canonicalStatus,
        driverId,
        eventTimestamp: eventTs,
        eventId,
        source,
        metadata: { idempotent: true },
        idempotent: true
      });

      return {
        booking: freshBooking,
        status: canonicalStatus,
        previousStatus: currentStatus,
        eventTimestamp: eventTs,
        idempotent: true,
        sequence: freshBooking?.statusMeta?.sequence || this.buildSequenceFallback(bookingData),
        shouldBroadcast: !!location,
        broadcastPayload: { location, notes }
      };
    }

    this.ensureTransitionAllowed(currentStatus, canonicalStatus);
    this.ensureLocationRequirement(canonicalStatus, bookingData, location);

    const updateData = this.buildStatusUpdateData({
      booking: bookingData,
      status: canonicalStatus,
      location,
      notes,
      eventTimestamp: eventTs,
      eventId,
      source,
      additionalUpdates
    });

    try {
      await bookingStateMachine.transitionBooking(
        bookingId,
        canonicalStatus,
        updateData,
        {
          userId: driverId,
          userType: 'driver',
          driverId,
          source,
          eventId,
          eventTimestamp: eventTs
        }
      );
    } catch (error) {
      if (error instanceof DriverStatusError) {
        throw error;
      }

      throw new DriverStatusError(
        409,
        'STATUS_TRANSITION_FAILED',
        error.message || 'Failed to update booking status',
        { originalError: error.message }
      );
    }

    const updatedDoc = await bookingRef.get();
    const updatedBooking = updatedDoc.data();

    await this.logStatusUpdate({
      bookingId,
      status: canonicalStatus,
      driverId,
      eventTimestamp: eventTs,
      eventId,
      source,
      metadata: { notes: notes || null },
      idempotent: false
    });

    return {
      booking: updatedBooking,
      status: canonicalStatus,
      previousStatus: currentStatus,
      eventTimestamp: eventTs,
      idempotent: false,
      sequence:
        updatedBooking?.statusMeta?.sequence ||
        this.buildSequenceFallback(updatedBooking),
      shouldBroadcast: true,
      broadcastPayload: { location, notes }
    };
  }

  async completeDelivery({
    bookingId,
    driverId,
    location,
    notes,
    photoUrl,
    recipientName,
    recipientPhone,
    eventId,
    eventTimestamp,
    source = 'driver_app'
  }) {
    const db = this.getDb();
    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get();

    if (!bookingDoc.exists) {
      throw new DriverStatusError(
        404,
        'BOOKING_NOT_FOUND',
        'Booking not found'
      );
    }

    const bookingData = bookingDoc.data();
    this.ensureDriverOwnership(bookingData, driverId);

    let eventTs = eventTimestamp ? new Date(eventTimestamp) : new Date();
    if (isNaN(eventTs.getTime())) {
      eventTs = new Date();
    }

    const currentStatus = this.normalizeStatus(bookingData.status || 'pending');
    
    // ✅ CRITICAL FIX: Allow idempotent delivery completion if already delivered
    // This prevents errors when frontend retries or state is already delivered
    if (currentStatus === 'delivered' || currentStatus === 'money_collection' || currentStatus === 'completed') {
      console.log(`ℹ️ [COMPLETE_DELIVERY] Booking ${bookingId} already in '${currentStatus}' status - returning idempotent success`);
      const updatedDoc = await bookingRef.get();
      const updatedBooking = updatedDoc.data();
      
      return {
        booking: updatedBooking,
        status: currentStatus,
        previousStatus: currentStatus,
        eventTimestamp: eventTs,
        idempotent: true,
        sequence: updatedBooking?.statusMeta?.sequence || this.buildSequenceFallback(updatedBooking),
        shouldBroadcast: false,
        broadcastPayload: { location, notes }
      };
    }

    const lastEventAtRaw =
      bookingData.statusMeta?.lastEventAt || bookingData.updatedAt;
    const lastEventAt = this.toDate(lastEventAtRaw);
    
    // ✅ CRITICAL FIX: Allow events within 5 seconds of last update to handle clock skew and network delays
    const timeDiff = lastEventAt ? (eventTs.getTime() - lastEventAt.getTime()) : 0;
    const CLOCK_SKEW_TOLERANCE_MS = 5000; // 5 seconds tolerance
    
    if (lastEventAt && eventTs < lastEventAt && timeDiff < -CLOCK_SKEW_TOLERANCE_MS) {
      throw new DriverStatusError(
        409,
        'STALE_EVENT',
        `Event timestamp ${eventTs.toISOString()} is older than the last recorded update ${lastEventAt.toISOString()}`
      );
    }
    
    // ✅ FIX: If timestamp is slightly stale but within tolerance, use current time instead
    if (lastEventAt && eventTs < lastEventAt) {
      console.log(`⚠️ [COMPLETE_DELIVERY] Event timestamp is ${Math.abs(timeDiff)}ms older than last update, using current time instead`);
      eventTs = new Date();
    }

    this.ensureLocationRequirement('at_dropoff', bookingData, location);
    
    if (!['at_dropoff', 'in_transit'].includes(currentStatus)) {
      throw new DriverStatusError(
        409,
        'INVALID_STATE_TRANSITION',
        `Cannot confirm delivery when booking is in '${currentStatus}' status`
      );
    }

    const additionalUpdates = {
      eventTimestamp: eventTs,
      driverId,
      'statusMeta.lastEventId':
        eventId || `${driverId}:delivered:${eventTs.getTime()}`,
      'statusMeta.lastEventSource': source,
      'statusMeta.lastEventAt': eventTs,
      'statusMeta.lastStatusBefore': currentStatus,
      'statusMeta.lastStatusAfter': 'delivered',
      'statusMeta.sequence': FieldValue.increment(1),
      'driver.currentLocation': {
        ...location,
        timestamp: eventTs
      },
      'timing.actualDeliveryTime': eventTs,
      'workflow.dropoff.lastConfirmedAt': eventTs
    };

    if (!bookingData.timing?.arrivedDropoffAt) {
      additionalUpdates['timing.arrivedDropoffAt'] = eventTs;
    }

    if (notes) {
      additionalUpdates['driver.deliveryNotes'] = notes;
    }

    if (photoUrl) {
      additionalUpdates['deliveryVerification'] = {
        photoUrl,
        verifiedAt: eventTs,
        verifiedBy: driverId,
        location,
        notes: notes || null,
        recipientName: recipientName || null,
        recipientPhone: recipientPhone || null
      };
    }

    if (recipientName || recipientPhone) {
      additionalUpdates['recipient'] = {
        name: recipientName || bookingData.recipient?.name || 'Recipient',
        phone: recipientPhone || bookingData.recipient?.phone || null,
        confirmedAt: eventTs,
        confirmedBy: driverId
      };
    }

    try {
      await bookingStateMachine.transitionBooking(
        bookingId,
        'delivered',
        additionalUpdates,
        {
          userId: driverId,
          userType: 'driver',
          driverId,
          source,
          eventId,
          eventTimestamp: eventTs
        }
      );
    } catch (error) {
      if (error instanceof DriverStatusError) {
        throw error;
      }

      throw new DriverStatusError(
        409,
        'STATUS_TRANSITION_FAILED',
        error.message || 'Failed to complete delivery',
        { originalError: error.message }
      );
    }

    const updatedDoc = await bookingRef.get();
    const updatedBooking = updatedDoc.data();

    await this.logStatusUpdate({
      bookingId,
      status: 'delivered',
      driverId,
      eventTimestamp: eventTs,
      eventId,
      source,
      metadata: {
        notes: notes || null,
        photoUrl: photoUrl || null,
        recipientName: recipientName || null,
        recipientPhone: recipientPhone || null
      },
      idempotent: false
    });

    return {
      booking: updatedBooking,
      status: 'delivered',
      previousStatus: currentStatus,
      eventTimestamp: eventTs,
      idempotent: false,
      sequence:
        updatedBooking?.statusMeta?.sequence ||
        this.buildSequenceFallback(updatedBooking),
      shouldBroadcast: true,
      broadcastPayload: {
        location,
        notes,
        photoUrl,
        recipientName,
        recipientPhone
      }
    };
  }
}

const driverStatusWorkflowService = new DriverStatusWorkflowService();

module.exports = {
  driverStatusWorkflowService,
  DriverStatusError
};

