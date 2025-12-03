/**
 * Utility functions for scholarship (bourse) calculations
 * Follows DRY and SRP principles
 */

/**
 * Calculate scholarship discount
 * @param {number} totalAmount - Total amount before discount
 * @param {number} percentage - Discount percentage (e.g., 50 for 50%)
 * @returns {number} Discount amount
 */
const calculateScholarshipDiscount = (totalAmount, percentage) => {
  if (!percentage || percentage <= 0) {
    return 0;
  }
  return (totalAmount * percentage) / 100;
};

/**
 * Apply scholarship discount to total amount
 * @param {number} totalAmount - Total amount
 * @param {Object} scholarshipInfo - Scholarship information object
 * @param {number} [scholarshipInfo.taux] - Discount percentage
 * @param {number} [scholarshipInfo.pourcentage_remise] - Alternative percentage field
 * @param {number} [scholarshipInfo.montant_remise] - Fixed discount amount
 * @returns {number} Amount after discount
 */
const applyScholarshipDiscount = (totalAmount, scholarshipInfo) => {
  if (!scholarshipInfo) {
    return totalAmount;
  }

  let finalAmount = totalAmount;

  // Check for percentage discount
  const percentage = scholarshipInfo.taux || scholarshipInfo.pourcentage_remise;
  if (percentage) {
    const discount = calculateScholarshipDiscount(totalAmount, percentage);
    finalAmount -= discount;
  } 
  // Check for fixed amount discount
  else if (scholarshipInfo.montant_remise) {
    finalAmount = Math.max(0, totalAmount - scholarshipInfo.montant_remise);
  }

  return Math.max(0, finalAmount);
};

module.exports = {
  calculateScholarshipDiscount,
  applyScholarshipDiscount,
};
