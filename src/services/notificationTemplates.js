/**
 * Notification Template System
 * Centralized template management for all notifications
 */

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
   * Process a notification template with variables
   * @param {Object} template - The notification template
   * @param {Object} variables - Variables to substitute
   * @returns {Object} Processed notification
   */
  static process(template, variables = {}) {
    if (!template) {
      throw new Error('Template is required');
    }

    const processedTemplate = {
      title: this.substituteVariables(template.title, variables),
      body: this.substituteVariables(template.body, variables),
      data: { ...template.data }
    };

    // Add variables to data for app processing
    processedTemplate.data.variables = variables;

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
      return variables[variableName] || match;
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
   * Build customer booking created notification
   */
  static customerBookingCreated(bookingData) {
    const template = NotificationTemplateProcessor.getTemplate('CUSTOMER', 'BOOKING_CREATED');
    return NotificationTemplateProcessor.process(template, {
      bookingId: bookingData.id,
      customerName: bookingData.customerName
    });
  }

  /**
   * Build driver assigned notification for customer
   */
  static customerDriverAssigned(bookingData, driverData) {
    const template = NotificationTemplateProcessor.getTemplate('CUSTOMER', 'DRIVER_ASSIGNED');
    return NotificationTemplateProcessor.process(template, {
      driverName: driverData.name,
      eta: bookingData.estimatedPickupTime || '15 mins',
      bookingId: bookingData.id
    });
  }

  /**
   * Build new booking request notification for driver
   */
  static driverNewBookingRequest(bookingData) {
    const template = NotificationTemplateProcessor.getTemplate('DRIVER', 'NEW_BOOKING_REQUEST');
    return NotificationTemplateProcessor.process(template, {
      pickupAddress: bookingData.pickup?.address || 'Pickup Location',
      dropoffAddress: bookingData.dropoff?.address || 'Dropoff Location',
      fare: bookingData.fare?.total || 0,
      bookingId: bookingData.id
    });
  }

  /**
   * Build package delivered notification for customer
   */
  static customerPackageDelivered(bookingData) {
    const template = NotificationTemplateProcessor.getTemplate('CUSTOMER', 'PACKAGE_DELIVERED');
    return NotificationTemplateProcessor.process(template, {
      bookingId: bookingData.id,
      driverName: bookingData.driverName
    });
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
