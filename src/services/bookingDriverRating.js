/**
 * Shared parcel + marketplace driver ratings (`ratings` collection).
 * Aggregate uses full recount (unchanged from legacy POST /bookings/:id/rate).
 */

async function findExistingBookingRating(db, bookingId, customerId) {
  const snap = await db.collection('ratings')
    .where('bookingId', '==', bookingId)
    .where('customerId', '==', customerId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

async function recomputeDriverRating(db, driverId) {
  const driverRatingsQuery = await db.collection('ratings')
    .where('driverId', '==', driverId)
    .get();

  const ratings = driverRatingsQuery.docs.map((doc) => doc.data().rating);
  const averageRating = ratings.reduce((sum, value) => sum + value, 0) / ratings.length;

  await db.collection('users').doc(driverId).update({
    'driver.averageRating': averageRating,
    'driver.totalRatings': ratings.length,
    updatedAt: new Date()
  });

  return {
    averageRating,
    totalRatings: ratings.length
  };
}

function buildRatingDocument({
  bookingId,
  customerId,
  driverId,
  rating,
  feedback,
  categories
}) {
  return {
    bookingId,
    customerId,
    driverId,
    rating: parseInt(rating, 10),
    feedback: feedback || '',
    categories: categories || {},
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

async function addBookingDriverRating(db, {
  bookingId,
  customerId,
  driverId,
  rating,
  feedback,
  categories
}) {
  const existing = await findExistingBookingRating(db, bookingId, customerId);
  if (existing) {
    const error = new Error('Rating already submitted for this booking');
    error.code = 'DRIVER_ALREADY_RATED';
    throw error;
  }

  const ratingData = buildRatingDocument({
    bookingId,
    customerId,
    driverId,
    rating,
    feedback,
    categories
  });

  const ratingRef = await db.collection('ratings').add(ratingData);
  const aggregate = await module.exports.recomputeDriverRating(db, driverId);

  return {
    ratingRef,
    ratingData,
    ...aggregate
  };
}

async function createBookingDriverRatingInTransaction(tx, db, {
  bookingId,
  customerId,
  driverId,
  rating,
  feedback,
  categories
}) {
  const query = db.collection('ratings')
    .where('bookingId', '==', bookingId)
    .where('customerId', '==', customerId)
    .limit(1);
  const existing = await tx.get(query);
  if (!existing.empty) {
    const error = new Error('Rating already submitted for this booking');
    error.code = 'DRIVER_ALREADY_RATED';
    throw error;
  }

  const ratingData = buildRatingDocument({
    bookingId,
    customerId,
    driverId,
    rating,
    feedback,
    categories
  });
  const ratingRef = db.collection('ratings').doc();
  tx.set(ratingRef, ratingData);
  return { ratingRef, ratingData };
}

module.exports = {
  findExistingBookingRating,
  recomputeDriverRating,
  addBookingDriverRating,
  createBookingDriverRatingInTransaction
};
