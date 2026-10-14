const admin = require('firebase-admin');
const { touchOrderSignal, bumpOrderSignal, appendEvent } = require('../src/services/marketplace/orderEvents');

const SERVER_TIME = admin.firestore.FieldValue.serverTimestamp();

function mockOrderRef() {
  const signalSets = [];
  return {
    signalSets,
    ref: {
      id: 'order-1',
      path: 'marketplaceOrders/order-1',
      collection(name) {
        return {
          doc(id) {
            return {
              id,
              path: `marketplaceOrders/order-1/${name}/${id}`
            };
          }
        };
      }
    },
    tx: {
      set(ref, data) {
        if (ref.path && ref.path.endsWith('signal/latest')) {
          signalSets.push({ ...data });
        }
      }
    }
  };
}

describe('marketplace order signal (Rule 8)', () => {
  test('touchOrderSignal overwrites type when called twice in one transaction', () => {
    const { ref, tx, signalSets } = mockOrderRef();
    touchOrderSignal(tx, ref, 'cust-1', 'refund_created');
    touchOrderSignal(tx, ref, 'cust-1', 'cancelled');
    expect(signalSets).toHaveLength(2);
    expect(signalSets[1].type).toBe('cancelled');
    expect(signalSets[1].customerId).toBe('cust-1');
    expect(signalSets[1].updatedAt).toEqual(SERVER_TIME);
  });

  test('appendEvent then bumpOrderSignal leaves final signal matching bump type', () => {
    const { ref, tx, signalSets } = mockOrderRef();
    appendEvent(tx, ref, {
      type: 'timed_out',
      actor: { type: 'system', id: 'payment-job' },
      data: null
    }, 'cust-1');
    bumpOrderSignal(tx, ref, 'cust-1', 'timed_out');
    expect(signalSets[signalSets.length - 1].type).toBe('timed_out');
  });
});
