const { appendEvent } = require('./orderEvents');

const LEFT_SHOP = new Set(['picked_up', 'on_the_way', 'delivered']);

function lineId(line, index) {
  if (line && typeof line.id === 'string' && line.id.trim() !== '') {
    return line.id;
  }
  return `line${index}`;
}

function lineQty(line) {
  const qty = Number(line && line.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    return 0;
  }
  return Math.floor(qty);
}

function stockCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }
  return Math.floor(count);
}

function deductionAlreadyRan(items) {
  return items.some((line) => typeof line.stockDeducted === 'number');
}

function usesVariants(product, line) {
  if (!product) {
    return false;
  }
  if (product.hasVariants === true) {
    return true;
  }
  return Boolean(line && line.variantId) && Array.isArray(product.variants) && product.variants.length > 0;
}

function variantRow(product, variantId) {
  if (!product || !Array.isArray(product.variants) || !variantId) {
    return null;
  }
  return product.variants.find((row) => row && row.id === variantId) || null;
}

function cloneProduct(data) {
  return {
    ...data,
    variants: Array.isArray(data.variants) ? data.variants.map((row) => ({ ...row })) : []
  };
}

function productPatch(working, variantMode) {
  if (variantMode) {
    return { variants: working.variants };
  }
  return { stock: working.stock };
}

function publicLine(line) {
  return {
    id: line.id,
    productId: line.productId || null,
    variantId: line.variantId || null,
    qty: line.qty,
    stockDeducted: line.stockDeducted
  };
}

function takeFromWorking(working, line) {
  const qty = lineQty(line);
  if (usesVariants(working, line)) {
    const variant = variantRow(working, line.variantId);
    if (!variant) {
      return 0;
    }
    const available = stockCount(variant.stock);
    const taken = Math.min(qty, available);
    variant.stock = available - taken;
    return taken;
  }
  const available = stockCount(working.stock);
  const taken = Math.min(qty, available);
  working.stock = available - taken;
  return taken;
}

function addToWorking(working, line, units) {
  if (usesVariants(working, line)) {
    const variant = variantRow(working, line.variantId);
    if (!variant) {
      return false;
    }
    variant.stock = stockCount(variant.stock) + units;
    return true;
  }
  if (line && line.variantId) {
    return false;
  }
  working.stock = stockCount(working.stock) + units;
  return true;
}

function previewDeduction(items, productsById) {
  const source = Array.isArray(items) ? items : [];
  const catalogue = productsById instanceof Map ? productsById : new Map();
  const working = new Map();
  const next = source.map((line, index) => {
    const copy = { ...line, id: lineId(line, index) };
    const productId = copy.productId;
    let taken = 0;
    if (productId && catalogue.has(productId)) {
      if (!working.has(productId)) {
        working.set(productId, cloneProduct(catalogue.get(productId)));
      }
      taken = takeFromWorking(working.get(productId), copy);
    }
    copy.stockDeducted = taken;
    return copy;
  });
  const stockShort = next.some((line) => line.stockDeducted < lineQty(line));
  const orderStockDeducted = next.some((line) => line.stockDeducted > 0);
  return {
    items: next,
    stockShort,
    orderStockDeducted,
    lines: next.map((line) => ({
      id: line.id,
      productId: line.productId || null,
      variantId: line.variantId || null,
      qty: lineQty(line),
      stockDeducted: line.stockDeducted
    }))
  };
}

async function deductStock(tx, db, { orderRef, items, actor }) {
  const source = Array.isArray(items) ? items : [];
  if (deductionAlreadyRan(source)) {
    return {
      items: source,
      stockShort: source.some((line) => (
        typeof line.stockDeducted === 'number' && line.stockDeducted < lineQty(line)
      )),
      orderStockDeducted: source.some((line) => (
        typeof line.stockDeducted === 'number' && line.stockDeducted > 0
      )),
      wrote: false
    };
  }

  const productIds = [];
  source.forEach((line) => {
    if (line && line.productId && !productIds.includes(line.productId)) {
      productIds.push(line.productId);
    }
  });
  const loaded = new Map();
  for (let index = 0; index < productIds.length; index += 1) {
    const productId = productIds[index];
    const ref = db.collection('products').doc(productId);
    const snap = await tx.get(ref);
    loaded.set(productId, { ref, snap, working: snap.exists ? cloneProduct(snap.data() || {}) : null });
  }

  const variantMode = new Map();
  const next = source.map((line, index) => {
    const copy = { ...line, id: lineId(line, index) };
    const qty = lineQty(copy);
    const entry = copy.productId ? loaded.get(copy.productId) : null;
    if (!entry || !entry.working) {
      copy.stockDeducted = 0;
      return copy;
    }
    const before = JSON.stringify(productPatch(entry.working, usesVariants(entry.working, copy)));
    const taken = takeFromWorking(entry.working, copy);
    const after = JSON.stringify(productPatch(entry.working, usesVariants(entry.working, copy)));
    if (before !== after) {
      variantMode.set(copy.productId, usesVariants(entry.working, copy) || variantMode.get(copy.productId) === true);
    }
    copy.stockDeducted = qty === 0 ? 0 : taken;
    return copy;
  });

  loaded.forEach((entry, productId) => {
    if (!variantMode.has(productId) || !entry.working) {
      return;
    }
    tx.update(entry.ref, productPatch(entry.working, variantMode.get(productId) === true));
  });

  const stockShort = next.some((line) => line.stockDeducted < lineQty(line));
  const orderStockDeducted = next.some((line) => line.stockDeducted > 0);
  appendEvent(tx, orderRef, {
    type: 'stock_deducted',
    actor,
    data: {
      stockShort,
      lines: next.map(publicLine)
    }
  });
  if (stockShort) {
    appendEvent(tx, orderRef, {
      type: 'stock_short',
      actor,
      data: { stockShort: true }
    });
  }
  return {
    items: next,
    stockShort,
    orderStockDeducted,
    wrote: true
  };
}

function cancelRestoresStock(data) {
  const status = data && data.orderStatus;
  if (status === 'preparing') {
    return true;
  }
  if (status !== 'ready') {
    return false;
  }
  const stage = data.delivery && data.delivery.stage;
  return !LEFT_SHOP.has(stage);
}

async function restoreLines(tx, db, { orderRef, items, actor, indexes }) {
  const source = Array.isArray(items) ? items : [];
  const selected = new Set(Array.isArray(indexes) ? indexes : source.map((_, index) => index));
  const next = source.map((line, index) => ({ ...line, id: lineId(line, index) }));
  const targets = [];
  next.forEach((line, index) => {
    if (!selected.has(index) || line.stockRestored === true) {
      return;
    }
    const units = typeof line.stockDeducted === 'number' ? line.stockDeducted : 0;
    targets.push({ index, units });
  });
  if (targets.length === 0) {
    return { items: next, wrote: false };
  }

  const productIds = [];
  targets.forEach((target) => {
    const line = next[target.index];
    if (target.units > 0 && line.productId && !productIds.includes(line.productId)) {
      productIds.push(line.productId);
    }
  });
  const loaded = new Map();
  for (let index = 0; index < productIds.length; index += 1) {
    const productId = productIds[index];
    const ref = db.collection('products').doc(productId);
    const snap = await tx.get(ref);
    loaded.set(productId, {
      ref,
      snap,
      working: snap.exists ? cloneProduct(snap.data() || {}) : null,
      dirty: false,
      variantMode: false
    });
  }

  const eventLines = [];
  targets.forEach((target) => {
    const line = next[target.index];
    if (target.units <= 0) {
      line.stockRestored = true;
      eventLines.push({
        id: line.id,
        productId: line.productId || null,
        variantId: line.variantId || null,
        units: 0,
        missing: false
      });
      return;
    }
    const entry = line.productId ? loaded.get(line.productId) : null;
    const restored = entry && entry.working
      ? addToWorking(entry.working, line, target.units)
      : false;
    if (!restored) {
      line.stockRestored = true;
      eventLines.push({
        id: line.id,
        productId: line.productId || null,
        variantId: line.variantId || null,
        units: 0,
        missing: true
      });
      return;
    }
    entry.dirty = true;
    entry.variantMode = usesVariants(entry.working, line) || entry.variantMode;
    line.stockRestored = true;
    eventLines.push({
      id: line.id,
      productId: line.productId || null,
      variantId: line.variantId || null,
      units: target.units,
      missing: false
    });
  });

  loaded.forEach((entry) => {
    if (!entry.dirty) {
      return;
    }
    tx.update(entry.ref, productPatch(entry.working, entry.variantMode));
  });
  appendEvent(tx, orderRef, {
    type: 'stock_restored',
    actor,
    data: { lines: eventLines }
  });
  return { items: next, wrote: true };
}

module.exports = {
  lineId,
  previewDeduction,
  deductStock,
  restoreLines,
  cancelRestoresStock
};
