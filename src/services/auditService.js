const { getFirestore } = require('./firebase');

class AuditService {
  constructor() {
    this.db = getFirestore();
  }

  async logAction(userId, action, resource, resourceId, details = {}, ipAddress = null, userAgent = null) {
    try {
      const auditLog = {
        userId,
        action,
        resource,
        resourceId,
        details,
        ipAddress,
        userAgent,
        timestamp: new Date(),
        createdAt: new Date()
      };

      await this.db.collection('auditLogs').add(auditLog);
      return true;
    } catch (error) {
      console.error('Error logging audit action:', error);
      // Don't throw error to avoid breaking main functionality
      return false;
    }
  }

  async logLogin(userId, success, details = {}) {
    return await this.logAction(
      userId,
      success ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED',
      'auth',
      userId,
      details
    );
  }

  async logLogout(userId, details = {}) {
    return await this.logAction(
      userId,
      'LOGOUT',
      'auth',
      userId,
      details
    );
  }

  async logPasswordChange(userId, success, details = {}) {
    return await this.logAction(
      userId,
      success ? 'PASSWORD_CHANGED' : 'PASSWORD_CHANGE_FAILED',
      'auth',
      userId,
      details
    );
  }

  async logPasswordReset(userId, success, details = {}) {
    return await this.logAction(
      userId,
      success ? 'PASSWORD_RESET' : 'PASSWORD_RESET_FAILED',
      'auth',
      userId,
      details
    );
  }

  async logEmailChange(userId, oldEmail, newEmail, success, details = {}) {
    return await this.logAction(
      userId,
      success ? 'EMAIL_CHANGED' : 'EMAIL_CHANGE_FAILED',
      'profile',
      userId,
      {
        oldEmail,
        newEmail,
        ...details
      }
    );
  }

  async logPhoneChange(userId, oldPhone, newPhone, success, details = {}) {
    return await this.logAction(
      userId,
      success ? 'PHONE_CHANGED' : 'PHONE_CHANGE_FAILED',
      'profile',
      userId,
      {
        oldPhone,
        newPhone,
        ...details
      }
    );
  }

  async logProfileUpdate(userId, changes, success, details = {}) {
    return await this.logAction(
      userId,
      success ? 'PROFILE_UPDATED' : 'PROFILE_UPDATE_FAILED',
      'profile',
      userId,
      {
        changes,
        ...details
      }
    );
  }

  async logAccountDeletion(userId, reason, success, details = {}) {
    return await this.logAction(
      userId,
      success ? 'ACCOUNT_DELETED' : 'ACCOUNT_DELETION_FAILED',
      'account',
      userId,
      {
        reason,
        ...details
      }
    );
  }

  async logAccountDeactivation(userId, reason, success, details = {}) {
    return await this.logAction(
      userId,
      success ? 'ACCOUNT_DEACTIVATED' : 'ACCOUNT_DEACTIVATION_FAILED',
      'account',
      userId,
      {
        reason,
        ...details
      }
    );
  }

  async logFileUpload(userId, filename, fileType, success, details = {}) {
    return await this.logAction(
      userId,
      success ? 'FILE_UPLOADED' : 'FILE_UPLOAD_FAILED',
      'file',
      filename,
      {
        fileType,
        ...details
      }
    );
  }

  async logFileDeletion(userId, filename, success, details = {}) {
    return await this.logAction(
      userId,
      success ? 'FILE_DELETED' : 'FILE_DELETION_FAILED',
      'file',
      filename,
      details
    );
  }

  async logSuspiciousActivity(userId, activity, details = {}) {
    return await this.logAction(
      userId,
      'SUSPICIOUS_ACTIVITY',
      'security',
      userId,
      {
        activity,
        ...details
      }
    );
  }

  async logFailedAttempt(userId, attemptType, details = {}) {
    return await this.logAction(
      userId,
      'FAILED_ATTEMPT',
      'security',
      userId,
      {
        attemptType,
        ...details
      }
    );
  }

  async getUserAuditLogs(userId, limit = 50, offset = 0) {
    try {
      const logsQuery = await this.db
        .collection('auditLogs')
        .where('userId', '==', userId)
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .offset(offset)
        .get();

      return logsQuery.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error getting user audit logs:', error);
      throw error;
    }
  }

  async getAuditLogsByAction(action, limit = 50, offset = 0) {
    try {
      const logsQuery = await this.db
        .collection('auditLogs')
        .where('action', '==', action)
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .offset(offset)
        .get();

      return logsQuery.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error getting audit logs by action:', error);
      throw error;
    }
  }

  async getAuditLogsByDateRange(startDate, endDate, limit = 100) {
    try {
      const logsQuery = await this.db
        .collection('auditLogs')
        .where('timestamp', '>=', startDate)
        .where('timestamp', '<=', endDate)
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      return logsQuery.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error getting audit logs by date range:', error);
      throw error;
    }
  }

  async cleanupOldAuditLogs(daysToKeep = 90) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const oldLogs = await this.db
        .collection('auditLogs')
        .where('timestamp', '<', cutoffDate)
        .get();

      const batch = this.db.batch();
      oldLogs.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      return oldLogs.size;
    } catch (error) {
      console.error('Error cleaning up old audit logs:', error);
      throw error;
    }
  }

  async getAuditSummary(userId, days = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const logsQuery = await this.db
        .collection('auditLogs')
        .where('userId', '==', userId)
        .where('timestamp', '>=', startDate)
        .get();

      const logs = logsQuery.docs.map(doc => doc.data());
      
      const summary = {
        totalActions: logs.length,
        loginAttempts: logs.filter(log => log.action.includes('LOGIN')).length,
        failedLogins: logs.filter(log => log.action === 'LOGIN_FAILED').length,
        passwordChanges: logs.filter(log => log.action === 'PASSWORD_CHANGED').length,
        profileUpdates: logs.filter(log => log.action === 'PROFILE_UPDATED').length,
        suspiciousActivities: logs.filter(log => log.action === 'SUSPICIOUS_ACTIVITY').length,
        failedAttempts: logs.filter(log => log.action === 'FAILED_ATTEMPT').length
      };

      return summary;
    } catch (error) {
      console.error('Error getting audit summary:', error);
      throw error;
    }
  }
}

module.exports = new AuditService();
