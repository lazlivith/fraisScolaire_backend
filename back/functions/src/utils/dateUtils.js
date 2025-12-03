/**
 * Utility functions for date operations
 * Follows DRY principle by centralizing date calculations
 */

/**
 * Calculate age from birth date
 * @param {string|Date} dateNaissance - Birth date
 * @returns {number} Age in years
 */
const calculateAge = (dateNaissance) => {
  const birthDate = new Date(dateNaissance);
  const today = new Date();
  
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  
  return age;
};

/**
 * Validate if date is valid
 * @param {string|Date} date - Date to validate
 * @returns {boolean} True if valid date
 */
const isValidDate = (date) => {
  const dateObj = new Date(date);
  return !isNaN(dateObj.getTime());
};

/**
 * Get current academic year in format YYYY-YYYY+1
 * @returns {string} Academic year (e.g., "2024-2025")
 */
const getCurrentAcademicYear = () => {
  const currentYear = new Date().getFullYear();
  return `${currentYear}-${currentYear + 1}`;
};

module.exports = {
  calculateAge,
  isValidDate,
  getCurrentAcademicYear,
};
