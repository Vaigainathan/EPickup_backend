const RECEIPT_DELAY_MS = 15 * 60 * 1000;

/** @type {Map<string, { userId: string, notificationType: string, tokenSuffix: string }>} */
const pendingTickets = new Map();

let scheduled = false;

function tokenSuffix(token) {
  if (typeof token !== 'string' || token.length < 6) {
    return '??????';
  }
  return token.slice(-6);
}

function registerExpoTickets(results, tokens, context = {}) {
  if (!Array.isArray(results) || !Array.isArray(tokens)) {
    return;
  }
  const userId = context.userId || '';
  const notificationType = context.notificationType || 'unknown';
  results.forEach((result, index) => {
    if (!result || result.status !== 'ok' || !result.id) {
      return;
    }
    pendingTickets.set(result.id, {
      userId,
      notificationType,
      tokenSuffix: tokenSuffix(tokens[index])
    });
  });
  scheduleReceiptFetch();
}

function scheduleReceiptFetch(delayMs = RECEIPT_DELAY_MS) {
  if (scheduled) {
    return;
  }
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    processPendingReceipts().catch((error) => {
      console.error('[ExpoPushReceipts] processPendingReceipts failed:', error.message);
    });
  }, delayMs);
}

function isDeviceNotRegistered(receipt) {
  if (!receipt || receipt.status !== 'error') {
    return false;
  }
  const details = receipt.details;
  if (details && typeof details === 'object') {
    if (details.error === 'DeviceNotRegistered') {
      return true;
    }
  }
  if (typeof receipt.message === 'string' && receipt.message.includes('DeviceNotRegistered')) {
    return true;
  }
  return false;
}

function isInvalidCredentials(receipt) {
  if (!receipt || receipt.status !== 'error') {
    return false;
  }
  const details = receipt.details;
  if (details && typeof details === 'object') {
    const err = details.error;
    return err === 'InvalidCredentials'
      || err === 'InvalidCredentialsError'
      || err === 'InvalidAccessToken';
  }
  return false;
}

async function processPendingReceipts() {
  if (pendingTickets.size === 0) {
    return;
  }

  const { Expo } = require('expo-server-sdk');
  const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });
  const { getFirestore } = require('./firebase');

  const ids = [...pendingTickets.keys()];
  const chunks = expo.chunkPushNotificationReceiptIds(ids);

  for (let c = 0; c < chunks.length; c += 1) {
    const chunk = chunks[c];
    let receipts;
    try {
      receipts = await expo.getPushNotificationReceiptsAsync(chunk);
    } catch (error) {
      console.error('[ExpoPushReceipts] getPushNotificationReceiptsAsync failed:', error.message);
      continue;
    }

    const db = getFirestore();
    for (const [ticketId, receipt] of Object.entries(receipts || {})) {
      const meta = pendingTickets.get(ticketId);
      pendingTickets.delete(ticketId);

      if (!receipt || receipt.status === 'ok') {
        continue;
      }

      const logBase = {
        ticketId,
        userId: meta && meta.userId,
        notificationType: meta && meta.notificationType,
        tokenSuffix: meta && meta.tokenSuffix,
        message: receipt.message,
        details: receipt.details
      };

      if (isDeviceNotRegistered(receipt)) {
        console.warn('[ExpoPushReceipts] DeviceNotRegistered — clearing expoPushToken:', logBase);
        if (meta && meta.userId) {
          try {
            await db.collection('users').doc(meta.userId).set({
              expoPushToken: null,
              tokenUpdatedAt: new Date()
            }, { merge: true });
          } catch (updateError) {
            console.error('[ExpoPushReceipts] Failed to clear expoPushToken:', updateError.message);
          }
        }
        continue;
      }

      if (isInvalidCredentials(receipt)) {
        console.error('[ExpoPushReceipts] InvalidCredentials from Expo (token NOT cleared):', logBase);
        continue;
      }

      console.warn('[ExpoPushReceipts] Push receipt error (token NOT cleared):', logBase);
    }
  }
}

function resetReceiptQueueForTests() {
  pendingTickets.clear();
  scheduled = false;
}

module.exports = {
  RECEIPT_DELAY_MS,
  registerExpoTickets,
  scheduleReceiptFetch,
  processPendingReceipts,
  resetReceiptQueueForTests
};
