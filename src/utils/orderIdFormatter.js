/**
 * Order ID Formatter - Backend Utility
 * Provides consistent formatting for display IDs across backend services
 */

/**
 * Format display ID as user-facing string
 * @param {number} displayId - 5-digit display ID
 * @returns {string} Formatted ID (e.g., "#14357")
 */
function formatDisplayId(displayId) {
  if (!displayId && displayId !== 0) {
    return 'N/A';
  }
  
  const numId = typeof displayId === 'string' ? parseInt(displayId, 10) : displayId;
  
  if (!Number.isFinite(numId)) {
    return 'N/A';
  }
  
  // Ensure 5-digit format
  const paddedId = String(numId).padStart(5, '0');
  return `#${paddedId}`;
}

/**
 * Format display ID for display in logs/debugging
 * @param {number} displayId - 5-digit display ID
 * @returns {string} Formatted ID without #
 */
function formatDisplayIdPlain(displayId) {
  if (!displayId && displayId !== 0) {
    return 'N/A';
  }
  
  const numId = typeof displayId === 'string' ? parseInt(displayId, 10) : displayId;
  
  if (!Number.isFinite(numId)) {
    return 'N/A';
  }
  
  return String(numId).padStart(5, '0');
}

/**
 * Extract display ID from booking object
 * @param {Object} booking - Booking object from API
 * @returns {number|null} Display ID or null
 */
function extractDisplayId(booking) {
  return booking?.displayId || null;
}

module.exports = {
  formatDisplayId,
  formatDisplayIdPlain,
  extractDisplayId
};
