const { getFirestore } = require('../firebase');

const VALID_STATUSES = ['acknowledged', 'resolved'];

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function alertUserId(alert) {
  return alert.customerId || alert.userId || null;
}

async function notifyEmergencyStatusUpdate(userId, alertId, status, adminNotes) {
  if (!userId) {
    return;
  }
  try {
    const notificationService = require('../notificationService');
    await notificationService.sendToUser(userId, {
      type: 'emergency_status_update',
      title: 'Emergency Alert Update',
      body: `Your emergency alert has been ${status}`,
      data: {
        alertId,
        status,
        adminNotes: adminNotes || null
      }
    });
  } catch (error) {
    console.error('❌ [ADMIN_EMERGENCY_ALERT] push failed:', error.message);
  }
}

async function updateAlertStatus({ alertId, status, adminId, note }) {
  if (!VALID_STATUSES.includes(status)) {
    httpError(400, 'VALIDATION_ERROR', 'Invalid status');
  }

  const db = getFirestore();
  const alertRef = db.collection('emergencyAlerts').doc(alertId);
  const alertDoc = await alertRef.get();

  if (!alertDoc.exists) {
    httpError(404, 'ALERT_NOT_FOUND', 'Emergency alert not found');
  }

  const existing = alertDoc.data();
  const now = new Date();
  const adminNotes = typeof note === 'string' && note.trim() ? note.trim() : null;

  const updateData = {
    status,
    updatedAt: now,
    adminNotes
  };

  if (status === 'acknowledged') {
    updateData.acknowledgedAt = now;
    updateData.acknowledgedBy = adminId;
  }

  if (status === 'resolved') {
    updateData.resolvedAt = now;
    updateData.resolvedBy = adminId;
  }

  await alertRef.update(updateData);

  await notifyEmergencyStatusUpdate(alertUserId(existing), alertId, status, adminNotes);

  return {
    id: alertId,
    status,
    acknowledgedAt: updateData.acknowledgedAt || existing.acknowledgedAt || null,
    resolvedAt: updateData.resolvedAt || existing.resolvedAt || null,
    adminNotes,
    updatedAt: now
  };
}

module.exports = {
  updateAlertStatus
};
