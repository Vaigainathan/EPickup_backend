/**
 * Notification Template System
 * Centralized template management for all notifications
 */

const {
  buildMarketplacePushData,
  digitsDisplayId
} = require('./marketplace/marketplacePush');

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
      body: 'Payment confirmed — {{shopName}} is preparing your order',
      data: { type: 'payment_confirmed', action: 'tracking' }
    },
    UTR_CORRECTED: {
      title: 'Payment confirmed',
      body: 'Payment confirmed with UTR {{utr}}.',
      data: { type: 'utr_corrected', action: 'order' }
    },
    PAYMENT_LATE_ACCEPTED: {
      title: 'Payment confirmed',
      body: '{{shopName}} received your payment — your order is back on',
      data: { type: 'payment_late_accepted', action: 'order' }
    },
    PAYMENT_UNDER_REVIEW: {
      title: 'Payment under review',
      body: 'Your payment to {{shopName}} is under review',
      data: { type: 'payment_under_review', action: 'order' }
    },
    PAYMENT_REVIEW_SHOP: {
      title: 'Payment under review',
      body: 'Check UTR for shop order {{displayId}} — Received / Not found',
      data: { type: 'payment_review_shop', action: 'order' }
    },
    REVIEW_RESOLVED: {
      title: 'Payment review closed',
      body: 'The payment review for shop order {{displayId}} is closed.',
      data: { type: 'review_resolved', action: 'order' }
    },
    NOT_VERIFIED: {
      title: 'Payment not verified',
      body: 'We couldn\'t verify your payment for Shop order {{displayId}}',
      data: { type: 'not_verified', action: 'order' }
    },
    ORDER_CANCELLED: {
      title: 'Order cancelled',
      body: '{{shopName}} cancelled your order{{reasonLine}}',
      data: { type: 'order_cancelled', action: 'order' }
    },
    ITEMS_UNAVAILABLE: {
      title: 'Items unavailable',
      body: '{{shopName}} couldn\'t supply some items — ₹{{amount}} refund',
      data: { type: 'items_unavailable', action: 'refund' }
    },
    REFUND_INITIATED: {
      title: 'Refund pending',
      body: 'Share your UPI ID to get ₹{{amount}} back from {{shopName}}',
      data: { type: 'refund_initiated', action: 'refund' }
    },
    REFUND_UPI_REMINDER: {
      title: 'Refund pending',
      body: 'Share your UPI ID to receive your refund for shop order {{displayId}}.',
      data: { type: 'refund_upi_reminder', action: 'refund' }
    },
    REFUND_DUE: {
      title: 'Refund due',
      body: 'Refund ₹{{amount}} due to {{customerName}} by {{dueBy}}',
      data: { type: 'refund_due', action: 'refund' }
    },
    REFUND_OVERDUE: {
      title: 'Refund overdue',
      body: 'Overdue — support notified for shop order {{displayId}}',
      data: { type: 'refund_overdue', action: 'refund' }
    },
    REFUND_SENT: {
      title: 'Refund sent',
      body: '₹{{amount}} refunded — UTR {{refundUtr}}. Did you get it?',
      data: { type: 'refund_sent', action: 'refund' }
    },
    REFUND_ACK_REMINDER: {
      title: 'Confirm your refund',
      body: 'Did you get your ₹{{amount}} refund?',
      data: { type: 'refund_ack_reminder', action: 'refund' }
    },
    REFUND_CLOSED: {
      title: 'Refund closed',
      body: 'The refund for shop order {{displayId}} is closed.',
      data: { type: 'refund_closed', action: 'refund' }
    },
    REFUND_DISPUTED: {
      title: 'Refund under review',
      body: 'The refund for shop order {{displayId}} is under review.',
      data: { type: 'refund_disputed', action: 'refund' }
    },
    PAYMENT_EXPIRED: {
      title: 'Payment not confirmed',
      body: 'Did you pay? Enter your UTR',
      data: { type: 'payment_not_confirmed', action: 'pay' }
    },
    PAYMENT_NOT_CONFIRMED: {
      title: 'Payment not confirmed',
      body: 'Did you pay? Enter your UTR',
      data: { type: 'payment_not_confirmed', action: 'pay' }
    },
    UTR_NUDGE: {
      title: 'Enter your UTR',
      body: 'Enter your UTR so {{shopName}} can confirm faster',
      data: { type: 'utr_nudge', action: 'pay' }
    },
    PAYMENT_REMINDER: {
      title: 'Payment still waiting',
      body: 'Shop order {{displayId}} is still waiting for payment confirmation.',
      data: { type: 'payment_reminder', action: 'order' }
    },
    ORDER_CLOSED_UNCONFIRMED: {
      title: 'Order closed',
      body: 'Shop order {{displayId}} closed — payment wasn\'t confirmed',
      data: { type: 'order_closed_unconfirmed', action: 'order' }
    },
    INCOMING_PAYMENT: {
      title: 'New order to confirm',
      body: '₹{{expectedAmount}} incoming from {{customerName}} — confirm when received',
      data: { type: 'incoming_payment', action: 'order' }
    },
    UTR_SUBMITTED: {
      title: 'UTR entered',
      body: '{{customerName}} paid ₹{{amount}} — UTR ends {{utr}}. Check and confirm',
      data: { type: 'utr_submitted', action: 'order' }
    },
    AMOUNT_SHORT: {
      title: 'Payment short',
      body: '₹{{receivedAmount}} received, ₹{{balanceAmount}} short — pay balance or cancel',
      data: { type: 'amount_short', action: 'order' }
    },
    CUSTOMER_CANCELLED: {
      title: 'Order cancelled',
      body: 'Customer cancelled shop order {{displayId}}. {{detail}}',
      data: { type: 'customer_cancelled', action: 'order' }
    },
    ORDER_PACKED: {
      title: 'Order packed',
      body: 'Your {{shopName}} order is packed — delivery charge ₹{{deliveryFee}} in cash',
      data: { type: 'order_packed', action: 'tracking' }
    },
    DRIVER_SLOW: {
      title: 'Assigning delivery partner',
      body: 'Still assigning a delivery partner — thanks for waiting',
      data: { type: 'marketplace_driver_slow', action: 'tracking' }
    },
    ORDER_ASSIGNED: {
      title: 'Driver assigned',
      body: '{{driverName}} is picking up your {{shopName}} order',
      data: { type: 'order_assigned', action: 'tracking' }
    },
    DRIVER_AT_SHOP: {
      title: 'Driver at shop',
      body: '{{driverName}} has reached {{shopName}}',
      data: { type: 'driver_at_shop', action: 'tracking' }
    },
    OUT_FOR_DELIVERY: {
      title: 'Out for delivery',
      body: 'Your {{shopName}} order is on the way — delivery charge ₹{{deliveryFee}} in cash',
      data: { type: 'out_for_delivery', action: 'tracking' }
    },
    ORDER_DELIVERED: {
      title: 'Delivered',
      body: 'Delivered — rate your {{shopName}} order',
      data: { type: 'order_delivered', action: 'rate' }
    },
    HELP_UPDATE: {
      title: 'Help request update',
      body: 'Support needs your response on Shop order {{displayId}}.',
      data: { type: 'help_update', action: 'help' }
    },
    HELP_SHOP_RESPONSE: {
      title: 'Support needs your response',
      body: 'Support needs your response on Shop order {{displayId}}.',
      data: { type: 'help_shop_response', action: 'help' }
    },
    BALANCE_NOT_PAID: {
      title: 'Order cancelled',
      body: 'Order cancelled — ₹{{amount}} refund from {{shopName}}',
      data: { type: 'balance_not_paid', action: 'refund' }
    },
    BALANCE_NOT_PAID_SHOP: {
      title: 'Balance not paid',
      body: 'Balance not paid — refund ₹{{amount}} due',
      data: { type: 'balance_not_paid_shop', action: 'refund' }
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
  static process(template, variables = {}, context = {}) {
    if (!template) {
      throw new Error('Template is required');
    }

    const cleanedVariables = this.removeUndefinedValues(variables);
    const bodyVariables = { ...variables };
    const dataType = template.data && template.data.type;
    if (dataType === 'utr_corrected' && typeof bodyVariables.utr === 'string') {
      bodyVariables.utr = bodyVariables.utr.slice(-4);
    }
    if (dataType === 'utr_submitted' && typeof bodyVariables.utr === 'string') {
      bodyVariables.utr = bodyVariables.utr.slice(-4);
    }
    if (dataType === 'refund_sent' && typeof bodyVariables.refundUtr === 'string') {
      bodyVariables.refundUtr = bodyVariables.refundUtr.slice(-4);
    }

    const displayForBody = {
      ...bodyVariables,
      displayId: digitsDisplayId(bodyVariables.displayId)
    };

    const processedTemplate = {
      title: this.substituteVariables(template.title, displayForBody),
      body: this.substituteVariables(template.body, displayForBody),
      data: { ...template.data }
    };

    const { category, templateKey } = context;
    if (category === 'MARKETPLACE' && templateKey) {
      const pushVars = {
        orderId: cleanedVariables.orderId,
        displayId: cleanedVariables.displayId,
        shopName: cleanedVariables.shopName
      };
      processedTemplate.data = buildMarketplacePushData(templateKey, dataType, pushVars);
      processedTemplate.marketplace = true;
      return processedTemplate;
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
