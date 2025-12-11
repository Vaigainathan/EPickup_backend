/**
 * Phone Number Normalization Utility
 * Ensures consistent phone number format for comparisons
 */

/**
 * Normalize phone number to standard format (+91XXXXXXXXXX)
 * @param {string} phone - Phone number in any format
 * @returns {string|null} Normalized phone number or null if invalid
 */
function normalizePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') {
    return null;
  }
  
  // Remove all spaces, dashes, and parentheses
  let normalized = phone.replace(/[\s\-()]/g, '');
  
  // Remove leading zeros
  normalized = normalized.replace(/^0+/, '');
  
  // Ensure starts with +91
  if (!normalized.startsWith('+91')) {
    if (normalized.startsWith('91') && normalized.length >= 12) {
      normalized = '+' + normalized;
    } else if (normalized.length === 10) {
      // Assume Indian number without country code
      normalized = '+91' + normalized;
    } else {
      // Invalid format
      return null;
    }
  }
  
  // Validate length (should be +91 + 10 digits = 13 characters)
  if (normalized.length !== 13 || !/^\+91\d{10}$/.test(normalized)) {
    return null;
  }
  
  return normalized;
}

/**
 * Compare two phone numbers (normalized)
 * @param {string} phone1 - First phone number
 * @param {string} phone2 - Second phone number
 * @returns {boolean} True if phones match (after normalization)
 */
function comparePhoneNumbers(phone1, phone2) {
  const normalized1 = normalizePhoneNumber(phone1);
  const normalized2 = normalizePhoneNumber(phone2);
  
  if (!normalized1 || !normalized2) {
    return false;
  }
  
  return normalized1 === normalized2;
}

module.exports = {
  normalizePhoneNumber,
  comparePhoneNumbers
};

