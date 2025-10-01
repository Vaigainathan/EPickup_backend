/**
 * Backup Service
 * Provides automated backup and disaster recovery capabilities
 */

const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs').promises;
const path = require('path');
const { logger } = require('../middleware/logger');

// Backup configuration
const backupConfig = {
  enabled: process.env.BACKUP_ENABLED === 'true',
  schedule: process.env.BACKUP_SCHEDULE || '0 2 * * *', // Daily at 2 AM
  retention: parseInt(process.env.BACKUP_RETENTION_DAYS) || 30,
  maxBackups: parseInt(process.env.BACKUP_MAX_COUNT) || 10,
  compression: process.env.BACKUP_COMPRESSION === 'true',
  encryption: process.env.BACKUP_ENCRYPTION === 'true',
  storagePath: process.env.BACKUP_STORAGE_PATH || './backups',
  collections: [
    'users',
    'drivers',
    'bookings',
    'payments',
    'serviceAreas',
    'adminUsers',
    'auditLogs',
    'notifications',
    'supportTickets'
  ]
};

// Backup types
const BackupTypes = {
  FULL: 'full',
  INCREMENTAL: 'incremental',
  DIFFERENTIAL: 'differential'
};

// Backup status
const BackupStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

// Backup service class
class BackupService {
  constructor() {
    this.db = getFirestore();
    this.isRunning = false;
    this.currentBackup = null;
    this.backupHistory = [];
  }
  
  // Initialize backup service
  async initialize() {
    try {
      // Create backup directory if it doesn't exist
      await this.ensureBackupDirectory();
      
      // Load backup history
      await this.loadBackupHistory();
      
      logger.info('Backup service initialized', {
        event: 'backup_service_initialized',
        config: {
          enabled: backupConfig.enabled,
          schedule: backupConfig.schedule,
          retention: backupConfig.retention,
          collections: backupConfig.collections.length
        }
      });
      
      return true;
    } catch (error) {
      logger.error('Failed to initialize backup service', {
        event: 'backup_service_init_failed',
        error: error.message
      });
      return false;
    }
  }
  
  // Ensure backup directory exists
  async ensureBackupDirectory() {
    try {
      await fs.access(backupConfig.storagePath);
    } catch {
      await fs.mkdir(backupConfig.storagePath, { recursive: true });
      logger.info('Created backup directory', {
        event: 'backup_directory_created',
        path: backupConfig.storagePath
      });
    }
  }
  
  // Load backup history
  async loadBackupHistory() {
    try {
      const historyFile = path.join(backupConfig.storagePath, 'backup_history.json');
      const data = await fs.readFile(historyFile, 'utf8');
      this.backupHistory = JSON.parse(data);
    } catch {
      this.backupHistory = [];
      logger.info('No backup history found, starting fresh', {
        event: 'backup_history_loaded',
        count: 0
      });
    }
  }
  
  // Save backup history
  async saveBackupHistory() {
    try {
      const historyFile = path.join(backupConfig.storagePath, 'backup_history.json');
      await fs.writeFile(historyFile, JSON.stringify(this.backupHistory, null, 2));
    } catch (error) {
      logger.error('Failed to save backup history', {
        event: 'backup_history_save_failed',
        error: error.message
      });
    }
  }
  
  // Create backup
  async createBackup(type = BackupTypes.FULL, options = {}) {
    if (!backupConfig.enabled) {
      throw new Error('Backup service is disabled');
    }
    
    if (this.isRunning) {
      throw new Error('Backup is already in progress');
    }
    
    const backupId = `backup_${Date.now()}`;
    const backup = {
      id: backupId,
      type,
      status: BackupStatus.PENDING,
      startTime: new Date().toISOString(),
      endTime: null,
      size: 0,
      collections: [],
      errors: [],
      options
    };
    
    this.currentBackup = backup;
    this.isRunning = true;
    
    try {
      logger.info('Starting backup', {
        event: 'backup_started',
        backupId,
        type,
        options
      });
      
      backup.status = BackupStatus.IN_PROGRESS;
      
      // Create backup directory
      const backupDir = path.join(backupConfig.storagePath, backupId);
      await fs.mkdir(backupDir, { recursive: true });
      
      // Backup collections
      for (const collectionName of backupConfig.collections) {
        try {
          await this.backupCollection(collectionName, backupDir);
          backup.collections.push(collectionName);
        } catch (error) {
          backup.errors.push({
            collection: collectionName,
            error: error.message
          });
          logger.error('Failed to backup collection', {
            event: 'backup_collection_failed',
            backupId,
            collection: collectionName,
            error: error.message
          });
        }
      }
      
      // Backup metadata
      await this.backupMetadata(backupDir, backup);
      
      // Calculate backup size
      backup.size = await this.calculateBackupSize(backupDir);
      
      // Compress backup if enabled
      if (backupConfig.compression) {
        await this.compressBackup(backupDir);
      }
      
      // Encrypt backup if enabled
      if (backupConfig.encryption) {
        await this.encryptBackup(backupDir);
      }
      
      backup.status = BackupStatus.COMPLETED;
      backup.endTime = new Date().toISOString();
      
      // Add to history
      this.backupHistory.push(backup);
      
      // Cleanup old backups
      await this.cleanupOldBackups();
      
      // Save history
      await this.saveBackupHistory();
      
      logger.info('Backup completed', {
        event: 'backup_completed',
        backupId,
        type,
        size: backup.size,
        collections: backup.collections.length,
        errors: backup.errors.length
      });
      
      return backup;
    } catch (error) {
      backup.status = BackupStatus.FAILED;
      backup.endTime = new Date().toISOString();
      backup.errors.push({
        type: 'general',
        error: error.message
      });
      
      logger.error('Backup failed', {
        event: 'backup_failed',
        backupId,
        type,
        error: error.message
      });
      
      throw error;
    } finally {
      this.isRunning = false;
      this.currentBackup = null;
    }
  }
  
  // Backup collection
  async backupCollection(collectionName, backupDir) {
    const collection = this.db.collection(collectionName);
    const snapshot = await collection.get();
    
    const documents = [];
    snapshot.forEach(doc => {
      documents.push({
        id: doc.id,
        data: doc.data()
      });
    });
    
    const collectionFile = path.join(backupDir, `${collectionName}.json`);
    await fs.writeFile(collectionFile, JSON.stringify(documents, null, 2));
    
    logger.info('Collection backed up', {
      event: 'collection_backed_up',
      collection: collectionName,
      documentCount: documents.length
    });
  }
  
  // Backup metadata
  async backupMetadata(backupDir, backup) {
    const metadata = {
      backupId: backup.id,
      type: backup.type,
      timestamp: backup.startTime,
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      collections: backup.collections,
      errors: backup.errors,
      config: {
        retention: backupConfig.retention,
        compression: backupConfig.compression,
        encryption: backupConfig.encryption
      }
    };
    
    const metadataFile = path.join(backupDir, 'metadata.json');
    await fs.writeFile(metadataFile, JSON.stringify(metadata, null, 2));
  }
  
  // Calculate backup size
  async calculateBackupSize(backupDir) {
    let totalSize = 0;
    
    const files = await fs.readdir(backupDir);
    for (const file of files) {
      const filePath = path.join(backupDir, file);
      const stats = await fs.stat(filePath);
      totalSize += stats.size;
    }
    
    return totalSize;
  }
  
  // Compress backup
  async compressBackup(backupDir) {
    // Implementation would use compression library like tar or zip
    logger.info('Backup compression not implemented', {
      event: 'backup_compression_skipped',
      backupDir
    });
  }
  
  // Encrypt backup
  async encryptBackup(backupDir) {
    // Implementation would use encryption library
    logger.info('Backup encryption not implemented', {
      event: 'backup_encryption_skipped',
      backupDir
    });
  }
  
  // Cleanup old backups
  async cleanupOldBackups() {
    try {
      // Sort backups by date (newest first)
      this.backupHistory.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
      
      // Keep only the most recent backups
      const backupsToKeep = this.backupHistory.slice(0, backupConfig.maxBackups);
      const backupsToDelete = this.backupHistory.slice(backupConfig.maxBackups);
      
      // Delete old backup files
      for (const backup of backupsToDelete) {
        try {
          const backupDir = path.join(backupConfig.storagePath, backup.id);
          await fs.rmdir(backupDir, { recursive: true });
          
          logger.info('Old backup deleted', {
            event: 'old_backup_deleted',
            backupId: backup.id,
            startTime: backup.startTime
          });
        } catch (error) {
          logger.error('Failed to delete old backup', {
            event: 'old_backup_delete_failed',
            backupId: backup.id,
            error: error.message
          });
        }
      }
      
      // Update history
      this.backupHistory = backupsToKeep;
      
    } catch (error) {
      logger.error('Failed to cleanup old backups', {
        event: 'backup_cleanup_failed',
        error: error.message
      });
    }
  }
  
  // Restore backup
  async restoreBackup(backupId, options = {}) {
    try {
      const backup = this.backupHistory.find(b => b.id === backupId);
      if (!backup) {
        throw new Error(`Backup ${backupId} not found`);
      }
      
      if (backup.status !== BackupStatus.COMPLETED) {
        throw new Error(`Backup ${backupId} is not completed`);
      }
      
      logger.info('Starting backup restore', {
        event: 'backup_restore_started',
        backupId,
        options
      });
      
      const backupDir = path.join(backupConfig.storagePath, backupId);
      
      // Restore collections
      for (const collectionName of backup.collections) {
        try {
          await this.restoreCollection(collectionName, backupDir);
        } catch (error) {
          logger.error('Failed to restore collection', {
            event: 'restore_collection_failed',
            backupId,
            collection: collectionName,
            error: error.message
          });
          throw error;
        }
      }
      
      logger.info('Backup restore completed', {
        event: 'backup_restore_completed',
        backupId
      });
      
      return true;
    } catch (error) {
      logger.error('Backup restore failed', {
        event: 'backup_restore_failed',
        backupId,
        error: error.message
      });
      throw error;
    }
  }
  
  // Restore collection
  async restoreCollection(collectionName, backupDir) {
    const collectionFile = path.join(backupDir, `${collectionName}.json`);
    const data = await fs.readFile(collectionFile, 'utf8');
    const documents = JSON.parse(data);
    
    const collection = this.db.collection(collectionName);
    const batch = this.db.batch();
    
    for (const doc of documents) {
      const docRef = collection.doc(doc.id);
      batch.set(docRef, doc.data);
    }
    
    await batch.commit();
    
    logger.info('Collection restored', {
      event: 'collection_restored',
      collection: collectionName,
      documentCount: documents.length
    });
  }
  
  // Get backup status
  getBackupStatus() {
    return {
      isRunning: this.isRunning,
      currentBackup: this.currentBackup,
      totalBackups: this.backupHistory.length,
      lastBackup: this.backupHistory.length > 0 ? this.backupHistory[this.backupHistory.length - 1] : null,
      config: backupConfig
    };
  }
  
  // Get backup history
  getBackupHistory() {
    return this.backupHistory;
  }
  
  // Cancel current backup
  async cancelBackup() {
    if (this.isRunning && this.currentBackup) {
      this.currentBackup.status = BackupStatus.CANCELLED;
      this.currentBackup.endTime = new Date().toISOString();
      
      this.isRunning = false;
      this.currentBackup = null;
      
      logger.info('Backup cancelled', {
        event: 'backup_cancelled'
      });
      
      return true;
    }
    
    return false;
  }
}

// Create backup service instance
const backupService = new BackupService();

module.exports = {
  backupService,
  BackupTypes,
  BackupStatus
};
