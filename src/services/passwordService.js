const bcrypt = require('bcryptjs');
const { getFirestore } = require('./firebase');

class PasswordService {
  constructor() {
    this.db = getFirestore();
    this.saltRounds = 12;
  }

  async hashPassword(password) {
    return await bcrypt.hash(password, this.saltRounds);
  }

  async verifyPassword(password, hash) {
    return await bcrypt.compare(password, hash);
  }

  validatePasswordStrength(password) {
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    const errors = [];
    if (password.length < minLength) errors.push(`Password must be at least ${minLength} characters`);
    if (!hasUpperCase) errors.push('Password must contain at least one uppercase letter');
    if (!hasLowerCase) errors.push('Password must contain at least one lowercase letter');
    if (!hasNumbers) errors.push('Password must contain at least one number');
    if (!hasSpecialChar) errors.push('Password must contain at least one special character');

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  async setPassword(userId, password) {
    const validation = this.validatePasswordStrength(password);
    if (!validation.isValid) {
      throw new Error(`Password validation failed: ${validation.errors.join(', ')}`);
    }

    const passwordHash = await this.hashPassword(password);
    await this.db.collection('users').doc(userId).update({
      passwordHash,
      updatedAt: new Date()
    });

    return true;
  }

  async changePassword(userId, currentPassword, newPassword) {
    const userDoc = await this.db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    if (!userData.passwordHash) {
      throw new Error('No password set for this account');
    }

    const isCurrentPasswordValid = await this.verifyPassword(currentPassword, userData.passwordHash);
    if (!isCurrentPasswordValid) {
      throw new Error('Current password is incorrect');
    }

    return await this.setPassword(userId, newPassword);
  }

  async resetPassword(userId, newPassword) {
    return await this.setPassword(userId, newPassword);
  }

  async verifyPasswordForUser(userId, password) {
    const userDoc = await this.db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    if (!userData.passwordHash) {
      throw new Error('No password set for this account');
    }

    return await this.verifyPassword(password, userData.passwordHash);
  }

  async hasPassword(userId) {
    const userDoc = await this.db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return false;
    }

    const userData = userDoc.data();
    return !!userData.passwordHash;
  }
}

module.exports = new PasswordService();
