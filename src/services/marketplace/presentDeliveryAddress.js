function presentLocation(location) {
  if (!location) {
    return null;
  }
  const lat = location.latitude ?? location._latitude;
  const lng = location.longitude ?? location._longitude;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || typeof lng !== 'number' || !Number.isFinite(lng)) {
    return null;
  }
  return { lat, lng };
}

function optionalString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function presentDeliveryAddress(source, options = {}) {
  const includeAddressId = options.includeAddressId === true;
  const row = source && typeof source === 'object' ? source : {};
  const label = optionalString(row.label) || optionalString(row.name);
  const out = {
    text: typeof row.text === 'string' ? row.text : '',
    coordinates: presentLocation(row.coordinates),
    label,
    houseNo: optionalString(row.houseNo),
    street: optionalString(row.street),
    landmark: optionalString(row.landmark),
    receiverName: optionalString(row.receiverName),
    receiverPhone: optionalString(row.receiverPhone)
  };
  if (includeAddressId) {
    out.addressId = typeof row.addressId === 'string' ? row.addressId : null;
  }
  return out;
}

module.exports = {
  presentDeliveryAddress,
  presentLocation
};
