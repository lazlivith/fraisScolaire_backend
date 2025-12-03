/**
 * Student Validator Class
 * Follows Single Responsibility Principle - handles only validation logic
 */

const { calculateAge, isValidDate } = require('../utils/dateUtils');

class StudentValidator {
  /**
   * Validate required fields for student creation
   * @param {Object} studentData - Student data object
   * @returns {Object} { isValid: boolean, message: string }
   */
  static validateRequiredFields(studentData) {
    const { nom, prenom, date_naissance, classe_id, nationalite } = studentData;

    if (!nom || !prenom || !date_naissance || !classe_id || !nationalite) {
      return {
        isValid: false,
        message: "Le nom, prénom, date de naissance, classe et nationalité sont requis",
      };
    }

    return { isValid: true };
  }

  /**
   * Validate student name
   * @param {string} name - Name to validate
   * @param {string} fieldName - Field name for error message
   * @returns {Object} { isValid: boolean, message: string }
   */
  static validateName(name, fieldName = "Le nom") {
    if (!name || name.trim().length < 2) {
      return {
        isValid: false,
        message: `${fieldName} doit contenir au moins 2 caractères`,
      };
    }

    return { isValid: true };
  }

  /**
   * Validate birth date and age
   * @param {string} dateNaissance - Birth date
   * @param {number} minAge - Minimum age (default: 3)
   * @param {number} maxAge - Maximum age (default: 25)
   * @returns {Object} { isValid: boolean, message: string, age: number }
   */
  static validateBirthDate(dateNaissance, minAge = 3, maxAge = 25) {
    if (!isValidDate(dateNaissance)) {
      return {
        isValid: false,
        message: "Format de date invalide",
      };
    }

    const age = calculateAge(dateNaissance);

    if (age < minAge || age > maxAge) {
      return {
        isValid: false,
        message: `L'âge doit être entre ${minAge} et ${maxAge} ans`,
      };
    }

    return { isValid: true, age };
  }

  /**
   * Validate all student data
   * @param {Object} studentData - Complete student data
   * @returns {Object} { isValid: boolean, message: string, age: number }
   */
  static validateStudentData(studentData) {
    // Check required fields
    const requiredCheck = this.validateRequiredFields(studentData);
    if (!requiredCheck.isValid) {
      return requiredCheck;
    }

    // Validate nom
    const nomCheck = this.validateName(studentData.nom, "Le nom");
    if (!nomCheck.isValid) {
      return nomCheck;
    }

    // Validate prenom
    const prenomCheck = this.validateName(studentData.prenom, "Le prénom");
    if (!prenomCheck.isValid) {
      return prenomCheck;
    }

    // Validate birth date and age
    const birthDateCheck = this.validateBirthDate(studentData.date_naissance);
    if (!birthDateCheck.isValid) {
      return birthDateCheck;
    }

    return { isValid: true, age: birthDateCheck.age };
  }
}

module.exports = StudentValidator;
