const { Timestamp, FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('../firebase');
const { presentCustomerOrder } = require('./customerOrderView');
const { appendEvent } = require('./orderEvents');
const { parseMarketplaceRatingBody } = require('./marketplaceRatingValidation');
const {
  createBookingDriverRatingInTransaction,
  recomputeDriverRating
} = require('../bookingDriverRating');

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function roundAverage(sum, count) {
  if (!count) {
    return 0;
  }
  return Math.round((sum / count) * 100) / 100;
}

function shopRatingFromDoc(data) {
  const rating = data && data.rating && typeof data.rating === 'object' ? data.rating : {};
  const sum = Number(rating.sum);
  const count = Number(rating.count);
  return {
    sum: Number.isFinite(sum) ? sum : 0,
    count: Number.isFinite(count) ? count : 0,
    average: Number.isFinite(Number(rating.average)) ? Number(rating.average) : 0
  };
}

function orderAlreadyRated(data) {
  const rating = data && data.rating;
  return rating != null && typeof rating === 'object' && Object.keys(rating).length > 0;
}

async function submitOrderRating({ customerId, orderId, body }) {
  const parsed = parseMarketplaceRatingBody(body);
  const db = getFirestore();
  const orderRef = db.collection('marketplaceOrders').doc(orderId);

  const outcome = await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) {
      throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }
    const data = orderSnap.data() || {};
    if (data.customerId !== customerId) {
      throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }
    if (data.orderStatus !== 'completed') {
      throw httpError(409, 'INVALID_STATE', 'Order is not completed');
    }
    if (orderAlreadyRated(data)) {
      throw httpError(409, 'ALREADY_RATED', 'This order was already rated');
    }

    const shopRatingRef = db.collection('shopRatings').doc(orderId);
    const shopRatingSnap = await tx.get(shopRatingRef);
    if (shopRatingSnap.exists) {
      throw httpError(409, 'ALREADY_RATED', 'This order was already rated');
    }

    let driverIdForRecompute = null;

    if (parsed.driver) {
      const linkedBookingId = typeof data.linkedBookingId === 'string' ? data.linkedBookingId : '';
      if (!linkedBookingId) {
        throw httpError(409, 'INVALID_STATE', 'No driver is assigned for this order');
      }
      const bookingSnap = await tx.get(db.collection('bookings').doc(linkedBookingId));
      const booking = bookingSnap.exists ? (bookingSnap.data() || {}) : {};
      const driverId = typeof booking.driverId === 'string' ? booking.driverId : '';
      if (!driverId) {
        throw httpError(409, 'INVALID_STATE', 'No driver is assigned for this order');
      }
      await createBookingDriverRatingInTransaction(tx, db, {
        bookingId: linkedBookingId,
        customerId,
        driverId,
        rating: parsed.driver.stars,
        feedback: '',
        categories: { tags: parsed.driver.tags }
      });
      driverIdForRecompute = driverId;
    }

    if (parsed.shop) {
      const shopId = data.shopId;
      if (!shopId) {
        throw httpError(409, 'INVALID_STATE', 'Order has no shop');
      }
      const shopRef = db.collection('shops').doc(shopId);
      const shopSnap = await tx.get(shopRef);
      const shopData = shopSnap.exists ? (shopSnap.data() || {}) : {};
      const current = shopRatingFromDoc(shopData);
      const nextSum = current.sum + parsed.shop.stars;
      const nextCount = current.count + 1;
      const nextAverage = roundAverage(nextSum, nextCount);

      tx.set(shopRatingRef, {
        orderId,
        shopId,
        customerId,
        stars: parsed.shop.stars,
        tags: parsed.shop.tags,
        comment: parsed.shop.comment,
        createdAt: FieldValue.serverTimestamp()
      });
      tx.set(shopRef, {
        rating: {
          sum: nextSum,
          count: nextCount,
          average: nextAverage
        }
      }, { merge: true });
    }

    const ratedAt = Timestamp.now();
    const orderRating = {
      ratedAt
    };
    if (parsed.shop) {
      orderRating.shopStars = parsed.shop.stars;
    }
    if (parsed.driver) {
      orderRating.driverStars = parsed.driver.stars;
    }

    tx.update(orderRef, {
      rating: orderRating,
      updatedAt: ratedAt
    });

    appendEvent(tx, orderRef, {
      type: 'rated',
      actor: { type: 'customer', id: customerId },
      data: null
    }, customerId);

    return {
      driverIdForRecompute,
      data: {
        ...data,
        rating: orderRating,
        updatedAt: ratedAt
      }
    };
  });

  if (outcome.driverIdForRecompute) {
    try {
      await recomputeDriverRating(db, outcome.driverIdForRecompute);
    } catch (error) {
      console.error('❌ [MARKETPLACE_RATING] Driver aggregate recompute failed:', error.message);
    }
  }

  return {
    status: 200,
    body: {
      success: true,
      data: {
        order: presentCustomerOrder({ ...outcome.data, id: orderId })
      }
    }
  };
}

module.exports = {
  submitOrderRating
};
