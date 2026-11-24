/**
 * Round a monetary amount to 2 decimal places (INR / wallet points).
 * @param {number|string} n
 * @returns {number}
 */
function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

module.exports = {
  roundMoney
};