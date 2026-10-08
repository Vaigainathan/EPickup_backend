/**
 * Notification Template System
 * Centralized template management for all notifications
 */

const formatNotificationVariableValue = (variableName, value) => {
  if (value === undefined || value === null) return value;

  const name = String(variableName || '').toLowerCase();
  const isEta = name.includes('eta');
  const isTime = name.includes('time');
  const isDate = name.includes('date') || name.includes('timestamp');

  if (!isEta && !isTime && !isDate) {
    return value;
  }

  // Firestore Timestamp
  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    if (date instanceof Date && !isNaN(date.getTime())) {
      if (isDate && !isTime && !isEta) {
        return date.toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit' });
      }
      return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    }
  }

  // Date object
  if (value instanceof Date && !isNaN(value.getTime())) {
    if (isDate && !isTime && !isEta) {
      return value.toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit' });
    }
    return value.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  }

  // ISO string
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      if (isDate && !isTime && !isEta) {
        return parsed.toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit' });
      }
      return parsed.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    }
    return value;
  }

  // Minutes as number
  if (isEta && typeof value === 'number' && isFinite(value)) {
    return `${Math.round(value)} mins`;
  }

  return value;
};

const NOTIFICATION_TEMPLATES = {
  // Customer Notifications
  CUSTOMER: {
    BOOKING_CREATED: {
      title: "Booking Confirmed! 🚚",
      body: "Your pickup request has been confirmed. We're finding a driver for you.",
      data: { type: 'booking_created', action: 'view_booking' }
    },
    DRIVER_ASSIGNED: {
      title: "Driver Assigned! 👨‍💼",
      body: "{{driverName}} is on the way to pick up your package. ETA: {{eta}}",
      data: { type: 'driver_assigned', action: 'track_driver' }
    },
    DRIVER_ARRIVED: {
      title: "Driver Arrived! 📍",
      body: "{{driverName}} has arrived at the pickup location. Please hand over your package.",
      data: { type: 'driver_arrived', action: 'contact_driver' }
    },
    PACKAGE_PICKED_UP: {
      title: "Package Picked Up! 📦",
      body: "Your package has been picked up and is on its way to the destination.",
      data: { type: 'package_picked_up', action: 'track_package' }
    },
    PACKAGE_DELIVERED: {
      title: "Package Delivered! ✅",
      body: "Your package has been successfully delivered. Thank you for using EPickup!",
      data: { type: 'package_delivered', action: 'rate_driver' }
    },
    BOOKING_CANCELLED: {
      title: "Booking Cancelled",
      body: "Your booking has been cancelled. {{reason}}",
      data: { type: 'booking_cancelled', action: 'book_again' }
    }
  },

  // Driver Notifications
  DRIVER: {
    NEW_BOOKING_REQUEST: {
      title: "New Booking Request! 📦",
      body: "Pickup: {{pickupAddress}}\nDropoff: {{dropoffAddress}}\nFare: ₹{{fare}}",
      data: { type: 'new_booking', action: 'view_booking' }
    },
    BOOKING_ACCEPTED: {
      title: "Booking Accepted! ✅",
      body: "You have accepted the booking. Please proceed to pickup location.",
      data: { type: 'booking_accepted', action: 'navigate_pickup' }
    },
    BOOKING_CANCELLED: {
      title: "Booking Cancelled",
      body: "The booking has been cancelled by the customer.",
      data: { type: 'booking_cancelled', action: 'find_new_booking' }
    },
    PAYMENT_RECEIVED: {
      title: "Payment Received! 💰",
      body: "You have received ₹{{amount}} for the completed delivery.",
      data: { type: 'payment_received', action: 'view_earnings' }
    },
    WALLET_LOW: {
      title: "Low Wallet Balance! ⚠️",
      body: "Your wallet balance is low (₹{{balance}}). Please recharge to continue.",
      data: { type: 'wallet_low', action: 'recharge_wallet' }
    }
  },

  SHOP: {
    BANK_DETAILS_UPDATED: {
      title: 'Bank details updated',
      body: 'Your bank details were updated',
      data: { type: 'bank_details_updated', action: 'view_settings' }
    },
    PASSWORD_CHANGED: {
      title: 'Password changed',
      body: 'Your password was changed',
      data: { type: 'password_changed', action: 'view_settings' }
    }
  },

  MARKETPLACE: {
    PAYMENT_CONFIRMED: {
      title: 'Payment confirmed',
      body: 'Your order {{displayId}} was accepted. The shop is preparing it.',
      data: { type: 'payment_confirmed', action: 'view_order' }
    },
    UTR_CORRECTED: {
      title: 'Payment confirmed',
      body: 'Payment confirmed with UTR {{utr}}.',
      data: { type: 'utr_corrected', action: 'view_order' }
    },
    PAYMENT_LATE_ACCEPTED: {
      title: 'Payment confirmed',
      body: 'Your late payment for order {{displayId}} was accepted. The shop is preparing it.',
      data: { type: 'payment_late_accepted', action: 'view_order' }
    },
    PAYMENT_UNDER_REVIEW: {
      title: 'Payment under review',
      body: 'Payment for order {{displayId}} is under review.',
      data: { type: 'payment_under_review', action: 'view_order' }
    },
    PAYMENT_REVIEW_SHOP: {
      title: 'Payment under review',
      body: 'Order {{displayId}} needs a payment check.',
      data: { type: 'payment_review_shop', action: 'view_order' }
    },
    REVIEW_RESOLVED: {
      title: 'Payment review closed',
      body: 'The payment review for order {{displayId}} is closed.',
      data: { type: 'review_resolved', action: 'view_order' }
    },
    NOT_VERIFIED: {
      title: 'Payment not verified',
      body: 'Payment for order {{displayId}} was not verified. The order is closed.',
      data: { type: 'not_verified', action: 'view_order' }
    },
    ORDER_CANCELLED: {
      title: 'Order cancelled',
      body: 'Your order {{displayId}} was cancelled.{{reasonLine}}',
      data: { type: 'order_cancelled', action: 'view_order' }
    },
    REFUND_INITIATED: {
      title: 'Refund pending',
      body: 'Share your UPI ID to receive your refund.',
      data: { type: 'refund_initiated', action: 'view_order' }
    },
    REFUND_UPI_REMINDER: {
      title: 'Refund pending',
      body: 'Share your UPI ID to receive your refund for order {{displayId}}.',
      data: { type: 'refund_upi_reminder', action: 'view_order' }
    },
    REFUND_DUE: {
      title: 'Refund due',
      body: 'A refund is due for order {{displayId}}. Pay it within 24 hours.',
      data: { type: 'refund_due', action: 'view_order' }
    },
    REFUND_OVERDUE: {
      title: 'Refund overdue',
      body: 'The refund for order {{displayId}} is overdue.',
      data: { type: 'refund_overdue', action: 'view_order' }
    },
    REFUND_SENT: {
      title: 'Refund sent',
      body: 'The shop has sent your refund for order {{displayId}}. UTR ending {{refundUtr}}.',
      data: { type: 'refund_sent', action: 'view_order' }
    },
    REFUND_ACK_REMINDER: {
      title: 'Confirm your refund',
      body: 'Confirm whether you received the refund for order {{displayId}}.',
      data: { type: 'refund_ack_reminder', action: 'view_order' }
    },
    REFUND_CLOSED: {
      title: 'Refund closed',
      body: 'The refund for order {{displayId}} is closed.',
      data: { type: 'refund_closed', action: 'view_order' }
    },
    REFUND_DISPUTED: {
      title: 'Refund under review',
      body: 'The refund for order {{displayId}} is under review.',
      data: { type: 'refund_disputed', action: 'view_order' }
    },
    PAYMENT_EXPIRED: {
      title: 'Payment expired',
      body: 'Payment for order {{displayId}} timed out. The order was cancelled.',
      data: { type: 'payment_expired', action: 'view_order' }
    },
    PAYMENT_NOT_CONFIRMED: {
      title: 'Payment not confirmed',
      body: 'Did you pay? Enter your UTR',
      data: { type: 'payment_not_confirmed', action: 'view_order' }
    },
    UTR_NUDGE: {
      title: 'Enter your UTR',
      body: 'Enter your UTR so {{shopName}} can confirm faster',
      data: { type: 'utr_nudge', action: 'view_order' }
    },
    PAYMENT_REMINDER: {
      title: 'Payment still waiting',
      body: 'Order {{displayId}} is still waiting for payment confirmation.',
      data: { type: 'payment_reminder', action: 'view_order' }
    },
    ORDER_CLOSED_UNCONFIRMED: {
      title: 'Order closed',
      body: 'Shop order {{displayId}} closed — payment wasn\'t confirmed',
      data: { type: 'order_closed_unconfirmed', action: 'view_order' }
    },
    INCOMING_PAYMENT: {
      title: 'New order to confirm',
      body: 'Order {{displayId}} is waiting for a payment of ₹{{expectedAmount}}.',
      data: { type: 'incoming_payment', action: 'view_order' }
    },
    UTR_SUBMITTED: {
      title: 'UTR entered',
      body: 'Order {{displayId}} has a UTR to check.',
      data: { type: 'utr_submitted', action: 'view_order' }
    },
    AMOUNT_SHORT: {
      title: 'Payment short',
      body: '₹{{receivedAmount}} received, ₹{{balanceAmount}} short — pay balance or cancel',
      data: { type: 'amount_short', action: 'view_order' }
    },
    CUSTOMER_CANCELLED: {
      title: 'Order cancelled',
      body: 'Order {{displayId}} was cancelled. {{detail}}',
      data: { type: 'customer_cancelled', action: 'view_order' }
    }
  },

  // Admin Notifications
  ADMIN: {
    EMERGENCY_ALERT: {
      title: "Emergency Alert! 🚨",
      body: "Driver {{driverName}} has triggered an emergency alert.",
      data: { type: 'emergency_alert', action: 'view_emergency' }
    },
    BOOKING_ISSUE: {
      title: "Booking Issue Reported",
      body: "Issue reported for booking #{{bookingId}}: {{issue}}",
      data: { type: 'booking_issue', action: 'view_booking' }
    },
    SYSTEM_ALERT: {
      title: "System Alert",
      body: "{{message}}",
      data: { type: 'system_alert', action: 'view_dashboard' }
    }
  }
};

/**
 * Template processor with variable substitution
 */
class NotificationTemplateProcessor {
  /**
   * Remove undefined values from an object recursively
   * @param {Object} obj - Object to clean
   * @returns {Object} Cleaned object
   */
  static removeUndefinedValues(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.removeUndefinedValues(item));
    }

    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = this.removeUndefinedValues(value);
      }
    }
    return cleaned;
  }

  /**
   * Process a notification template with variables
   * @param {Object} template - The notification template
   * @param {Object} variables - Variables to substitute
   * @returns {Object} Processed notification
   */
  static process(template, variables = {}) {
    if (!template) {
      throw new Error('Template is required');
    }

    // ✅ FIX: Remove undefined values from variables before adding to data
    const cleanedVariables = this.removeUndefinedValues(variables);
    const bodyVariables = { ...variables };
    const dataType = template.data && template.data.type;
    if (dataType === 'utr_corrected' && typeof bodyVariables.utr === 'string') {
      bodyVariables.utr = bodyVariables.utr.slice(-4);
    }
    if (dataType === 'refund_sent' && typeof bodyVariables.refundUtr === 'string') {
      bodyVariables.refundUtr = bodyVariables.refundUtr.slice(-4);
    }

    const processedTemplate = {
      title: this.substituteVariables(template.title, variables),
      body: this.substituteVariables(template.body, bodyVariables),
      data: { ...template.data }
    };

    // Add cleaned variables to data for app processing (only if there are any)
    // One place for every REFUND_INITIATED send. The body already has the rupee
    // amount. The data payload must not.
    if (typeof dataType === 'string' && dataType.startsWith('refund_')) {
      delete cleanedVariables.amount;
      delete cleanedVariables.upiId;
      delete cleanedVariables.refundUtr;
      delete cleanedVariables.utr;
    }
    // One place for every UTR_CORRECTED send, customer and shop. The body shows
    // the last 4. The data payload must not carry the UTR.
    if (dataType === 'utr_corrected') {
      delete cleanedVariables.utr;
    }

    if (Object.keys(cleanedVariables).length > 0) {
      processedTemplate.data.variables = cleanedVariables;
    }

    return processedTemplate;
  }

  /**
   * Substitute variables in text using {{variable}} syntax
   * @param {string} text - Text with variables
   * @param {Object} variables - Variables to substitute
   * @returns {string} Processed text
   */
  static substituteVariables(text, variables) {
    if (!text || typeof text !== 'string') {
      return text;
    }

    return text.replace(/\{\{(\w+)\}\}/g, (match, variableName) => {
      const rawValue = variables[variableName];
      const formattedValue = formatNotificationVariableValue(variableName, rawValue);
      return formattedValue || match;
    });
  }

  /**
   * Get a notification template by type and category
   * @param {string} category - Category (CUSTOMER, DRIVER, ADMIN)
   * @param {string} type - Template type
   * @returns {Object} Template object
   */
  static getTemplate(category, type) {
    const categoryTemplates = NOTIFICATION_TEMPLATES[category];
    if (!categoryTemplates) {
      throw new Error(`Invalid notification category: ${category}`);
    }

    const template = categoryTemplates[type];
    if (!template) {
      throw new Error(`Invalid notification type: ${type} for category: ${category}`);
    }

    return template;
  }

  /**
   * Get all available templates for a category
   * @param {string} category - Category (CUSTOMER, DRIVER, ADMIN)
   * @returns {Object} All templates for the category
   */
  static getCategoryTemplates(category) {
    return NOTIFICATION_TEMPLATES[category] || {};
  }

  /**
   * Validate template variables
   * @param {Object} template - Template to validate
   * @param {Object} variables - Variables to check
   * @returns {Object} Validation result
   */
  static validateVariables(template, variables) {
    const requiredVariables = this.extractVariables(template);
    const missingVariables = requiredVariables.filter(variable => 
      !(variable in variables) || variables[variable] === undefined
    );

    return {
      isValid: missingVariables.length === 0,
      missingVariables,
      requiredVariables
    };
  }

  /**
   * Extract all variables from a template
   * @param {Object} template - Template to analyze
   * @returns {Array} Array of variable names
   */
  static extractVariables(template) {
    const variables = new Set();
    
    if (template.title) {
      const titleVars = template.title.match(/\{\{(\w+)\}\}/g);
      if (titleVars) {
        titleVars.forEach(match => {
          variables.add(match.replace(/\{\{|\}\}/g, ''));
        });
      }
    }

    if (template.body) {
      const bodyVars = template.body.match(/\{\{(\w+)\}\}/g);
      if (bodyVars) {
        bodyVars.forEach(match => {
          variables.add(match.replace(/\{\{|\}\}/g, ''));
        });
      }
    }

    return Array.from(variables);
  }
}

/**
 * Predefined notification builders for common scenarios
 */
class NotificationBuilder {
  /**
   * Format ETA/time values for notifications
   * Accepts Date, Firestore Timestamp, ISO string, or minute values
   */
  static formatNotificationTime(value) {
    if (!value) return null;

    // Firestore Timestamp
    if (typeof value?.toDate === 'function') {
      const date = value.toDate();
      if (date instanceof Date && !isNaN(date.getTime())) {
        return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
      }
    }

    // Date object
    if (value instanceof Date && !isNaN(value.getTime())) {
      return value.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    }

    // ISO string
    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!isNaN(parsed.getTime())) {
        return parsed.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
      }
      return value; // Already human-readable (e.g., "15 mins")
    }

    // Minutes as number
    if (typeof value === 'number' && isFinite(value)) {
      return `${Math.round(value)} mins`;
    }

    return String(value);
  }

  /**
   * Build customer booking created notification
   */
  static customerBookingCreated(bookingData) {
    const template = NotificationTemplateProcessor.getTemplate('CUSTOMER', 'BOOKING_CREATED');
    // ✅ FIX: Handle both bookingData.id and bookingData.bookingId
    const bookingId = bookingData.id || bookingData.bookingId;
    const notification = NotificationTemplateProcessor.process(template, {
      bookingId: bookingId,
      customerName: bookingData.customerName
    });
    // ✅ FIX: Add bookingId at top level for easy access
    notification.bookingId = bookingId;
    return notification;
  }

  /**
   * Build driver assigned notification for customer
   */
  static customerDriverAssigned(bookingData, driverData) {
    const template = NotificationTemplateProcessor.getTemplate('CUSTOMER', 'DRIVER_ASSIGNED');
    // ✅ FIX: Handle both bookingData.id and bookingData.bookingId
    const bookingId = bookingData.id || bookingData.bookingId;
    const etaValue = bookingData.estimatedPickupTime || bookingData.estimatedArrival || bookingData.eta;
    const formattedEta = this.formatNotificationTime(etaValue) || '15 mins';
    const notification = NotificationTemplateProcessor.process(template, {
      driverName: driverData?.name || driverData?.driverName || 'Driver',
      eta: formattedEta,
      bookingId: bookingId
    });
    // ✅ FIX: Add bookingId at top level for easy access
    notification.bookingId = bookingId;
    return notification;
  }

  /**
   * Build new booking request notification for driver
   */
  static driverNewBookingRequest(bookingData) {
    const template = NotificationTemplateProcessor.getTemplate('DRIVER', 'NEW_BOOKING_REQUEST');
    // ✅ FIX: Handle both bookingData.id and bookingData.bookingId
    const bookingId = bookingData.id || bookingData.bookingId;
    const notification = NotificationTemplateProcessor.process(template, {
      pickupAddress: bookingData.pickup?.address || 'Pickup Location',
      dropoffAddress: bookingData.dropoff?.address || 'Dropoff Location',
      fare: bookingData.fare?.total || bookingData.pricing?.total || 0,
      bookingId: bookingId
    });
    // ✅ FIX: Add bookingId at top level for easy access
    notification.bookingId = bookingId;
    return notification;
  }

  /**
   * Build package delivered notification for customer
   */
  static customerPackageDelivered(bookingData) {
    const template = NotificationTemplateProcessor.getTemplate('CUSTOMER', 'PACKAGE_DELIVERED');
    // ✅ FIX: Handle both bookingData.id and bookingData.bookingId
    const bookingId = bookingData.id || bookingData.bookingId;
    const notification = NotificationTemplateProcessor.process(template, {
      bookingId: bookingId,
      driverName: bookingData.driverName || 'Driver'
    });
    // ✅ FIX: Add bookingId at top level for easy access
    notification.bookingId = bookingId;
    return notification;
  }

  /**
   * Build emergency alert notification for admin
   */
  static adminEmergencyAlert(driverData, location) {
    const template = NotificationTemplateProcessor.getTemplate('ADMIN', 'EMERGENCY_ALERT');
    return NotificationTemplateProcessor.process(template, {
      driverName: driverData.name,
      driverId: driverData.id,
      location: location ? `${location.latitude}, ${location.longitude}` : 'Unknown'
    });
  }
}

module.exports = {
  NOTIFICATION_TEMPLATES,
  NotificationTemplateProcessor,
  NotificationBuilder
};
