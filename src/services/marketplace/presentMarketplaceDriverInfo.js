function resolvePhotoUrl(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const candidates = [
    raw.photoUrl,
    raw.profilePhoto,
    raw.profilePicture,
    raw.photoURL
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    const value = candidates[i];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return null;
}

function presentMarketplaceDriverInfo(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const name = typeof raw.name === 'string' ? raw.name : '';
  const phone = typeof raw.phone === 'string' ? raw.phone : '';
  const vehicle = typeof raw.vehicle === 'string'
    ? raw.vehicle
    : (typeof raw.vehicleNumber === 'string' ? raw.vehicleNumber : '');
  const photoUrl = resolvePhotoUrl(raw);
  if (!name && !phone && !vehicle && !photoUrl) {
    return null;
  }
  return {
    name,
    phone,
    vehicle,
    photoUrl: photoUrl || null
  };
}

function driverInfoFromUserDoc(userData) {
  if (!userData || typeof userData !== 'object') {
    return null;
  }
  return presentMarketplaceDriverInfo({
    name: userData.name,
    phone: userData.phone,
    vehicleNumber: userData.driver && userData.driver.vehicleDetails
      ? userData.driver.vehicleDetails.vehicleNumber
      : '',
    vehicle: userData.driver && userData.driver.vehicleDetails
      ? userData.driver.vehicleDetails.vehicleModel
      : '',
    photoUrl: userData.profilePicture || userData.photoURL || userData.profilePhoto
  });
}

module.exports = {
  presentMarketplaceDriverInfo,
  driverInfoFromUserDoc,
  resolvePhotoUrl
};
