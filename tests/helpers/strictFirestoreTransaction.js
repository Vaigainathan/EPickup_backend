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

module.exports = {
  wrapStrictTransaction
};
