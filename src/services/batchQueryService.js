const { getFirestore } = require('./firebase');

/**
 * Batch Query Service
 * Provides efficient batch operations to solve N+1 query problems
 */
class BatchQueryService {
  constructor() {
    this.db = getFirestore();
    this.batchSize = 500; // Firestore batch limit
  }

  /**
   * Get multiple documents by IDs in a single batch
   * @param {string} collection - Collection name
   * @param {Array<string>} ids - Array of document IDs
   * @returns {Array<Object>} Array of documents
   */
  async getDocumentsByIds(collection, ids) {
    if (!ids || ids.length === 0) {
      return [];
    }

    try {
      // Remove duplicates and filter out invalid IDs
      const uniqueIds = [...new Set(ids.filter(id => id && typeof id === 'string'))];
      
      if (uniqueIds.length === 0) {
        return [];
      }

      // Split into batches if needed
      const batches = this.chunkArray(uniqueIds, this.batchSize);
      const results = [];

      for (const batch of batches) {
        const batchResults = await this.db.getAll(
          ...batch.map(id => this.db.collection(collection).doc(id))
        );
        
        results.push(...batchResults.map(doc => ({
          id: doc.id,
          exists: doc.exists,
          data: doc.exists ? doc.data() : null
        })));
      }

      return results;
    } catch (error) {
      console.error('Error in getDocumentsByIds:', error);
      throw error;
    }
  }

  /**
   * Get driver locations for multiple drivers
   * @param {Array<string>} driverIds - Array of driver IDs
   * @returns {Array<Object>} Array of driver locations
   */
  async getDriverLocationsBatch(driverIds) {
    try {
      const locations = await this.getDocumentsByIds('driverLocations', driverIds);
      
      return locations
        .filter(loc => loc.exists)
        .map(loc => ({
          driverId: loc.id,
          ...loc.data
        }));
    } catch (error) {
      console.error('Error in getDriverLocationsBatch:', error);
      throw error;
    }
  }

  /**
   * Get user profiles for multiple users
   * @param {Array<string>} userIds - Array of user IDs
   * @returns {Array<Object>} Array of user profiles
   */
  async getUserProfilesBatch(userIds) {
    try {
      const users = await this.getDocumentsByIds('users', userIds);
      
      return users
        .filter(user => user.exists)
        .map(user => ({
          id: user.id,
          ...user.data
        }));
    } catch (error) {
      console.error('Error in getUserProfilesBatch:', error);
      throw error;
    }
  }

  /**
   * Get bookings for multiple booking IDs
   * @param {Array<string>} bookingIds - Array of booking IDs
   * @returns {Array<Object>} Array of bookings
   */
  async getBookingsBatch(bookingIds) {
    try {
      const bookings = await this.getDocumentsByIds('bookings', bookingIds);
      
      return bookings
        .filter(booking => booking.exists)
        .map(booking => ({
          id: booking.id,
          ...booking.data
        }));
    } catch (error) {
      console.error('Error in getBookingsBatch:', error);
      throw error;
    }
  }

  /**
   * Get driver assignments for multiple drivers
   * @param {Array<string>} driverIds - Array of driver IDs
   * @returns {Array<Object>} Array of driver assignments
   */
  async getDriverAssignmentsBatch(driverIds) {
    try {
      const assignments = await this.db.collection('driverAssignments')
        .where('driverId', 'in', driverIds)
        .get();
      
      return assignments.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error in getDriverAssignmentsBatch:', error);
      throw error;
    }
  }

  /**
   * Get enriched driver data with locations and assignments
   * @param {Array<Object>} drivers - Array of driver objects
   * @returns {Array<Object>} Array of enriched driver data
   */
  async getEnrichedDriversData(drivers) {
    try {
      const driverIds = drivers.map(driver => driver.id || driver.uid);
      
      // Get all related data in parallel
      const [locations, assignments] = await Promise.all([
        this.getDriverLocationsBatch(driverIds),
        this.getDriverAssignmentsBatch(driverIds)
      ]);

      // Create lookup maps for efficient merging
      const locationMap = new Map(locations.map(loc => [loc.driverId, loc]));
      const assignmentMap = new Map(assignments.map(assignment => [assignment.driverId, assignment]));

      // Merge data
      return drivers.map(driver => {
        const driverId = driver.id || driver.uid;
        return {
          ...driver,
          location: locationMap.get(driverId) || null,
          assignment: assignmentMap.get(driverId) || null
        };
      });
    } catch (error) {
      console.error('Error in getEnrichedDriversData:', error);
      throw error;
    }
  }

  /**
   * Get enriched booking data with customer and driver info
   * @param {Array<Object>} bookings - Array of booking objects
   * @returns {Array<Object>} Array of enriched booking data
   */
  async getEnrichedBookingsData(bookings) {
    try {
      const customerIds = bookings.map(booking => booking.customerId).filter(Boolean);
      const driverIds = bookings.map(booking => booking.driverId).filter(Boolean);
      
      // Get all related data in parallel
      const [customers, drivers] = await Promise.all([
        this.getUserProfilesBatch(customerIds),
        this.getUserProfilesBatch(driverIds)
      ]);

      // Create lookup maps
      const customerMap = new Map(customers.map(customer => [customer.id, customer]));
      const driverMap = new Map(drivers.map(driver => [driver.id, driver]));

      // Merge data
      return bookings.map(booking => ({
        ...booking,
        customer: customerMap.get(booking.customerId) || null,
        driver: driverMap.get(booking.driverId) || null
      }));
    } catch (error) {
      console.error('Error in getEnrichedBookingsData:', error);
      throw error;
    }
  }

  /**
   * Get paginated results with total count
   * @param {Object} query - Firestore query
   * @param {Object} options - Pagination options
   * @returns {Object} Paginated results
   */
  async getPaginatedResults(query, options = {}) {
    const {
      page = 1,
      limit = 20,
      orderBy = 'createdAt',
      orderDirection = 'desc'
    } = options;

    try {
      // Get total count (this is expensive, consider caching)
      const countQuery = query.limit(1000); // Firestore limit for count
      const countSnapshot = await countQuery.get();
      const totalCount = countSnapshot.size;

      // Calculate pagination
      const offset = (page - 1) * limit;
      const totalPages = Math.ceil(totalCount / limit);

      // Get paginated results
      const paginatedQuery = query
        .orderBy(orderBy, orderDirection)
        .offset(offset)
        .limit(limit);

      const snapshot = await paginatedQuery.get();
      const results = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      return {
        data: results,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      };
    } catch (error) {
      console.error('Error in getPaginatedResults:', error);
      throw error;
    }
  }

  /**
   * Batch write operations
   * @param {Array<Object>} operations - Array of write operations
   * @returns {Object} Batch write result
   */
  async batchWrite(operations) {
    try {
      const batches = this.chunkArray(operations, this.batchSize);
      const results = [];

      for (const batch of batches) {
        const batchWrite = this.db.batch();
        
        batch.forEach(operation => {
          const { type, collection, docId, data } = operation;
          const docRef = this.db.collection(collection).doc(docId);
          
          switch (type) {
            case 'set':
              batchWrite.set(docRef, data);
              break;
            case 'update':
              batchWrite.update(docRef, data);
              break;
            case 'delete':
              batchWrite.delete(docRef);
              break;
            default:
              throw new Error(`Unknown operation type: ${type}`);
          }
        });

        const result = await batchWrite.commit();
        results.push(result);
      }

      return {
        success: true,
        batchesProcessed: batches.length,
        totalOperations: operations.length
      };
    } catch (error) {
      console.error('Error in batchWrite:', error);
      throw error;
    }
  }

  /**
   * Utility function to chunk array into smaller arrays
   * @param {Array} array - Array to chunk
   * @param {number} size - Chunk size
   * @returns {Array<Array>} Array of chunks
   */
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Get collection statistics
   * @param {string} collection - Collection name
   * @returns {Object} Collection statistics
   */
  async getCollectionStats(collection) {
    try {
      const snapshot = await this.db.collection(collection).limit(1000).get();
      
      return {
        totalDocuments: snapshot.size,
        estimatedTotal: snapshot.size >= 1000 ? '1000+' : snapshot.size
      };
    } catch (error) {
      console.error('Error in getCollectionStats:', error);
      throw error;
    }
  }
}

// Create singleton instance
const batchQueryService = new BatchQueryService();

module.exports = batchQueryService;
