const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { getFirestore } = require('./firebase');

class EmailService {
  constructor() {
    this.db = getFirestore();
    this.transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });
  }

  generateVerificationToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  async sendVerificationEmail(email, token, type = 'verification') {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}&type=${type}`;
    
    const mailOptions = {
      from: process.env.EMAIL_FROM_ADDRESS || 'noreply@epickup.com',
      to: email,
      subject: 'Verify your EPickup account',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Verify your EPickup account</h2>
          <p>Hello,</p>
          <p>Please click the button below to verify your email address:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationUrl}" 
               style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Verify Email
            </a>
          </div>
          <p>This link will expire in 24 hours.</p>
          <p>If you didn't create an account with EPickup, you can safely ignore this email.</p>
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
          <p style="color: #666; font-size: 12px;">
            This is an automated email from EPickup. Please do not reply to this email.
          </p>
        </div>
      `
    };

    await this.transporter.sendMail(mailOptions);
  }

  async sendPasswordResetEmail(email, token) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    
    const mailOptions = {
      from: process.env.EMAIL_FROM_ADDRESS || 'noreply@epickup.com',
      to: email,
      subject: 'Reset your EPickup password',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Reset your EPickup password</h2>
          <p>Hello,</p>
          <p>We received a request to reset your password. Click the button below to create a new password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" 
               style="background-color: #dc3545; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Reset Password
            </a>
          </div>
          <p>This link will expire in 1 hour.</p>
          <p>If you didn't request a password reset, you can safely ignore this email.</p>
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
          <p style="color: #666; font-size: 12px;">
            This is an automated email from EPickup. Please do not reply to this email.
          </p>
        </div>
      `
    };

    await this.transporter.sendMail(mailOptions);
  }

  async createVerificationRecord(userId, email, type = 'verification') {
    const token = this.generateVerificationToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await this.db.collection('emailVerifications').doc(token).set({
      userId,
      email,
      token,
      type,
      expiresAt,
      used: false,
      createdAt: new Date()
    });

    return token;
  }

  async createPasswordResetRecord(userId, email) {
    const token = this.generateVerificationToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.db.collection('emailVerifications').doc(token).set({
      userId,
      email,
      token,
      type: 'password_reset',
      expiresAt,
      used: false,
      createdAt: new Date()
    });

    return token;
  }

  async verifyEmailToken(token) {
    const verificationDoc = await this.db.collection('emailVerifications').doc(token).get();
    
    if (!verificationDoc.exists) {
      throw new Error('Invalid verification token');
    }

    const verificationData = verificationDoc.data();
    
    if (verificationData.used) {
      throw new Error('Token already used');
    }

    if (new Date() > verificationData.expiresAt.toDate()) {
      throw new Error('Token expired');
    }

    return verificationData;
  }

  async markTokenAsUsed(token) {
    await this.db.collection('emailVerifications').doc(token).update({
      used: true,
      usedAt: new Date()
    });
  }

  async verifyEmail(userId, token) {
    const verificationData = await this.verifyEmailToken(token);
    
    if (verificationData.type !== 'verification' && verificationData.type !== 'change') {
      throw new Error('Invalid token type for email verification');
    }

    // Update user's email verification status
    await this.db.collection('users').doc(userId).update({
      emailVerified: true,
      updatedAt: new Date()
    });

    // Mark token as used
    await this.markTokenAsUsed(token);

    return true;
  }

  async resetPasswordWithToken(token, newPassword) {
    const verificationData = await this.verifyEmailToken(token);
    
    if (verificationData.type !== 'password_reset') {
      throw new Error('Invalid token type for password reset');
    }

    // Reset password
    const passwordService = require('./passwordService');
    await passwordService.resetPassword(verificationData.userId, newPassword);

    // Mark token as used
    await this.markTokenAsUsed(token);

    return true;
  }

  async sendEmailChangeVerification(userId, newEmail) {
    const token = await this.createVerificationRecord(userId, newEmail, 'change');
    await this.sendVerificationEmail(newEmail, token, 'change');
    return token;
  }

  async sendPasswordResetVerification(userId, email) {
    const token = await this.createPasswordResetRecord(userId, email);
    await this.sendPasswordResetEmail(email, token);
    return token;
  }

  async cleanupExpiredTokens() {
    const expiredTokens = await this.db
      .collection('emailVerifications')
      .where('expiresAt', '<', new Date())
      .where('used', '==', false)
      .get();

    const batch = this.db.batch();
    expiredTokens.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    return expiredTokens.size;
  }
}

module.exports = new EmailService();
