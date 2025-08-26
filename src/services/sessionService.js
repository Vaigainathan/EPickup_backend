const { getFirestore } = require('./firebase');
const crypto = require('crypto');

class SessionService {
  constructor() {
    this.db = getFirestore();
    this.sessionExpiryHours = 24 * 7; // 7 days
  }

  generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
  }

  generateDeviceId() {
    return crypto.randomBytes(16).toString('hex');
  }

  async createSession(userId, deviceInfo = {}, ipAddress = null, userAgent = null) {
    try {
      const sessionId = this.generateSessionId();
      const deviceId = this.generateDeviceId();
      const expiresAt = new Date(Date.now() + this.sessionExpiryHours * 60 * 60 * 1000);

      const sessionData = {
        userId,
        sessionId,
        deviceId,
        deviceInfo: {
          platform: deviceInfo.platform || 'unknown',
          model: deviceInfo.model || 'unknown',
          os: deviceInfo.os || 'unknown',
          browser: deviceInfo.browser || 'unknown',
          ...deviceInfo
        },
        ipAddress,
        userAgent,
        isActive: true,
        lastActivity: new Date(),
        createdAt: new Date(),
        expiresAt
      };

      await this.db.collection('sessions').doc(sessionId).set(sessionData);

      return {
        sessionId,
        deviceId,
        expiresAt
      };
    } catch (error) {
      console.error('Error creating session:', error);
      throw error;
    }
  }

  async validateSession(sessionId) {
    try {
      const sessionDoc = await this.db.collection('sessions').doc(sessionId).get();
      
      if (!sessionDoc.exists) {
        return { valid: false, reason: 'Session not found' };
      }

      const sessionData = sessionDoc.data();
      
      if (!sessionData.isActive) {
        return { valid: false, reason: 'Session inactive' };
      }

      if (new Date() > sessionData.expiresAt.toDate()) {
        // Mark session as expired
        await this.db.collection('sessions').doc(sessionId).update({
          isActive: false,
          expiredAt: new Date()
        });
        return { valid: false, reason: 'Session expired' };
      }

      // Update last activity
      await this.db.collection('sessions').doc(sessionId).update({
        lastActivity: new Date()
      });

      return {
        valid: true,
        sessionData
      };
    } catch (error) {
      console.error('Error validating session:', error);
      return { valid: false, reason: 'Validation error' };
    }
  }

  async invalidateSession(sessionId) {
    try {
      await this.db.collection('sessions').doc(sessionId).update({
        isActive: false,
        invalidatedAt: new Date()
      });
      return true;
    } catch (error) {
      console.error('Error invalidating session:', error);
      throw error;
    }
  }

  async invalidateAllUserSessions(userId, exceptSessionId = null) {
    try {
      let sessionsQuery = this.db
        .collection('sessions')
        .where('userId', '==', userId)
        .where('isActive', '==', true);

      if (exceptSessionId) {
        sessionsQuery = sessionsQuery.where('sessionId', '!=', exceptSessionId);
      }

      const sessions = await sessionsQuery.get();
      
      const batch = this.db.batch();
      sessions.docs.forEach(doc => {
        batch.update(doc.ref, {
          isActive: false,
          invalidatedAt: new Date()
        });
      });

      await batch.commit();
      return sessions.size;
    } catch (error) {
      console.error('Error invalidating all user sessions:', error);
      throw error;
    }
  }

  async getUserSessions(userId) {
    try {
      const sessionsQuery = await this.db
        .collection('sessions')
        .where('userId', '==', userId)
        .orderBy('lastActivity', 'desc')
        .get();

      return sessionsQuery.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error getting user sessions:', error);
      throw error;
    }
  }

  async getActiveUserSessions(userId) {
    try {
      const sessionsQuery = await this.db
        .collection('sessions')
        .where('userId', '==', userId)
        .where('isActive', '==', true)
        .orderBy('lastActivity', 'desc')
        .get();

      return sessionsQuery.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error getting active user sessions:', error);
      throw error;
    }
  }

  async updateSessionActivity(sessionId) {
    try {
      await this.db.collection('sessions').doc(sessionId).update({
        lastActivity: new Date()
      });
      return true;
    } catch (error) {
      console.error('Error updating session activity:', error);
      throw error;
    }
  }

  async cleanupExpiredSessions() {
    try {
      const expiredSessions = await this.db
        .collection('sessions')
        .where('expiresAt', '<', new Date())
        .where('isActive', '==', true)
        .get();

      const batch = this.db.batch();
      expiredSessions.docs.forEach(doc => {
        batch.update(doc.ref, {
          isActive: false,
          expiredAt: new Date()
        });
      });

      await batch.commit();
      return expiredSessions.size;
    } catch (error) {
      console.error('Error cleaning up expired sessions:', error);
      throw error;
    }
  }

  async getSessionStats(userId) {
    try {
      const allSessions = await this.getUserSessions(userId);
      const activeSessions = allSessions.filter(session => session.isActive);
      
      return {
        totalSessions: allSessions.length,
        activeSessions: activeSessions.length,
        lastActivity: activeSessions.length > 0 ? 
          Math.max(...activeSessions.map(s => s.lastActivity.toDate().getTime())) : null
      };
    } catch (error) {
      console.error('Error getting session stats:', error);
      throw error;
    }
  }

  async detectSuspiciousActivity(userId, currentSession) { // eslint-disable-line no-unused-vars
    try {
      const recentSessions = await this.db
        .collection('sessions')
        .where('userId', '==', userId)
        .where('createdAt', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000)) // Last 24 hours
        .get();

      const sessions = recentSessions.docs.map(doc => doc.data());
      
      // Check for multiple sessions from different IP addresses
      const uniqueIPs = [...new Set(sessions.map(s => s.ipAddress).filter(ip => ip))];
      
      if (uniqueIPs.length > 3) {
        return {
          suspicious: true,
          reason: 'Multiple sessions from different IP addresses',
          details: {
            uniqueIPs: uniqueIPs.length,
            sessions: sessions.length
          }
        };
      }

      // Check for rapid session creation
      const recentSessionsCount = sessions.filter(s => 
        s.createdAt.toDate().getTime() > Date.now() - 60 * 60 * 1000 // Last hour
      ).length;

      if (recentSessionsCount > 5) {
        return {
          suspicious: true,
          reason: 'Rapid session creation',
          details: {
            sessionsInLastHour: recentSessionsCount
          }
        };
      }

      return { suspicious: false };
    } catch (error) {
      console.error('Error detecting suspicious activity:', error);
      return { suspicious: false, error: 'Detection failed' };
    }
  }

  async getDeviceFingerprint(deviceInfo, ipAddress, userAgent) {
    const fingerprint = {
      platform: deviceInfo.platform || 'unknown',
      model: deviceInfo.model || 'unknown',
      os: deviceInfo.os || 'unknown',
      browser: deviceInfo.browser || 'unknown',
      ipAddress,
      userAgent: userAgent ? userAgent.substring(0, 200) : 'unknown' // Limit length
    };

    return crypto.createHash('sha256')
      .update(JSON.stringify(fingerprint))
      .digest('hex');
  }
}

module.exports = new SessionService();
