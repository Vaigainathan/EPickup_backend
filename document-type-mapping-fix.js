// Document Type Mapping Fix
// This file defines the standard document type mappings across the entire system

const DOCUMENT_TYPE_MAPPING = {
  // Frontend (camelCase) -> Backend (snake_case) -> Database (camelCase)
  frontend: {
    drivingLicense: 'driving_license',
    aadhaarCard: 'aadhaar_card', 
    bikeInsurance: 'bike_insurance',
    rcBook: 'rc_book',
    profilePhoto: 'profile_photo'
  },
  
  // Backend API (snake_case) -> Database (camelCase)
  backend: {
    driving_license: 'drivingLicense',
    aadhaar_card: 'aadhaarCard',
    bike_insurance: 'bikeInsurance', 
    rc_book: 'rcBook',
    profile_photo: 'profilePhoto'
  },
  
  // Database (camelCase) -> Frontend (camelCase)
  database: {
    drivingLicense: 'drivingLicense',
    aadhaarCard: 'aadhaarCard',
    bikeInsurance: 'bikeInsurance',
    rcBook: 'rcBook', 
    profilePhoto: 'profilePhoto'
  }
};

// Helper functions
function frontendToBackend(frontendType) {
  return DOCUMENT_TYPE_MAPPING.frontend[frontendType] || frontendType;
}

function backendToDatabase(backendType) {
  return DOCUMENT_TYPE_MAPPING.backend[backendType] || backendType;
}

function databaseToFrontend(databaseType) {
  return DOCUMENT_TYPE_MAPPING.database[databaseType] || databaseType;
}

module.exports = {
  DOCUMENT_TYPE_MAPPING,
  frontendToBackend,
  backendToDatabase, 
  databaseToFrontend
};
