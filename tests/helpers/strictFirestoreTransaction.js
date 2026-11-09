/**
 * Wraps a mock (or real) transaction so any read after set/update/delete throws.
 * Firestore requires all reads before writes; Jest mocks do not enforce this.
 */
function wrapStrictTransaction(tx) {
  let writes = 0;

  function markWrite() {
    writes += 1;
  }

  function refLabel(ref) {
    if (!ref) {
      return 'unknown';
    }
    if (typeof ref.path === 'string') {
      return ref.path;
    }
    if (typeof ref.id === 'string') {
      return ref.id;
    }
    return 'query';
  }

  return {
    async get(ref) {
      if (writes > 0) {
        throw new Error(`Transaction read after write at ${refLabel(ref)}`);
      }
      return tx.get(ref);
    },
    set(ref, data) {
      markWrite();
      return tx.set(ref, data);
    },
    update(ref, patch) {
      markWrite();
      return tx.update(ref, patch);
    },
    delete(ref) {
      markWrite();
      return tx.delete(ref);
    }
  };
}

/**
 * Standalone strict transaction double (no inner mock required).
 */
function createStrictFirestoreTransaction({ getImpl } = {}) {
  const inner = {
    get: jest.fn(async (ref) => {
      if (getImpl) {
        return getImpl(ref);
      }
      return {
        exists: true,
        data: () => ({ driver: { currentBookingId: 'booking-1', isOnline: true } })
      };
    }),
    update: jest.fn((ref, data) => ({ ref, data })),
    set: jest.fn((ref, data) => ({ ref, data }))
  };
  const tx = wrapStrictTransaction(inner);
  tx.__inner = inner;
  return tx;
}

module.exports = {
  wrapStrictTransaction,
  createStrictFirestoreTransaction
};
