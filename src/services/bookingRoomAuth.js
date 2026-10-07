const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'rejected']);

function denied() {
  return {
    ok: false,
    code: 'PERMISSION_DENIED',
    message: 'You do not have permission to join this booking room'
  };
}

async function authorizeBookingRoomJoin(db, socket, bookingId) {
  if (!socket || !socket.userId || !socket.userType) {
    return {
      ok: false,
      code: 'AUTHENTICATION_ERROR',
      message: 'User authentication required'
    };
  }

  const snap = await db.collection('bookings').doc(bookingId).get();
  if (!snap.exists) {
    return {
      ok: false,
      code: 'BOOKING_NOT_FOUND',
      message: 'Booking not found'
    };
  }

  const booking = snap.data() || {};
  const { userId, userType } = socket;
  if (userType === 'customer') {
    if (booking.customerId !== userId) {
      return denied();
    }
  } else if (userType === 'driver') {
    if (booking.driverId !== userId) {
      return denied();
    }
  } else if (userType !== 'admin') {
    return denied();
  }

  if (TERMINAL_STATUSES.has(booking.status)) {
    return {
      ok: false,
      code: 'BOOKING_NOT_ACTIVE',
      message: `Booking is in terminal state: ${booking.status}`
    };
  }

  return { ok: true, booking };
}

function emitTimestampedError(socket, code, message) {
  socket.emit('error', {
    code,
    message,
    timestamp: new Date().toISOString()
  });
}

async function applyJoinBookingRoom(socket, data, db) {
  try {
    if (!socket || typeof socket.join !== 'function') {
      if (socket && typeof socket.emit === 'function') {
        emitTimestampedError(socket, 'INVALID_SOCKET', 'Socket instance is not available for room join');
      }
      return;
    }

    const bookingId = typeof data === 'string' ? data : (data && (data.bookingId || data.tripId));
    if (!bookingId || typeof bookingId !== 'string' || !bookingId.trim()) {
      emitTimestampedError(socket, 'INVALID_DATA', 'Booking ID is required to join booking room');
      return;
    }

    const trimmed = bookingId.trim();
    const decision = await authorizeBookingRoomJoin(db, socket, trimmed);
    if (!decision.ok) {
      emitTimestampedError(socket, decision.code, decision.message);
      return;
    }

    const roomName = `booking:${trimmed}`;
    socket.join(roomName);
    socket.emit('booking-room-joined', {
      success: true,
      bookingId: trimmed,
      room: roomName,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ [SOCKET] Failed to join booking room:', error);
    emitTimestampedError(socket, 'ROOM_JOIN_ERROR', 'Failed to join booking room');
  }
}

async function applyJoinBooking(socket, bookingId, db) {
  try {
    if (!bookingId) {
      socket.emit('error', {
        code: 'INVALID_BOOKING_ID',
        message: 'Booking ID is required'
      });
      return;
    }

    const decision = await authorizeBookingRoomJoin(db, socket, bookingId);
    if (!decision.ok) {
      socket.emit('error', {
        code: decision.code,
        message: decision.message
      });
      return;
    }

    const userId = socket.userId;
    const userType = socket.userType;
    await db.collection('websocket_rooms').doc(`${bookingId}:${userId}`).set({
      bookingId,
      userId,
      userType,
      room: `booking:${bookingId}`,
      joinedAt: new Date(),
      lastSeen: new Date(),
      socketId: socket.id
    }, { merge: true });

    socket.join(`booking:${bookingId}`);
    console.log(`✅ [SOCKET] User ${userId} (${userType}) joined booking room: booking:${bookingId}`);
    socket.emit('booking-room-joined', {
      success: true,
      bookingId,
      room: `booking:${bookingId}`
    });
  } catch (error) {
    console.error('❌ [SOCKET] Error joining booking room:', error);
    socket.emit('error', {
      code: 'ROOM_JOIN_ERROR',
      message: 'Failed to join booking room',
      details: error.message
    });
  }
}

module.exports = {
  authorizeBookingRoomJoin,
  applyJoinBookingRoom,
  applyJoinBooking
};
