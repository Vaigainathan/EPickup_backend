const axios = require('axios');
const locationService = require('./locationService');

const ROUTE_MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
const ROAD_FACTOR = 1.3;
const CHUNK_SIZE = 25;
const MATRIX_TIMEOUT_MS = 2500;
const ENRICHMENT_BUDGET_MS = 3000;
const MIN_GOOGLE_BUDGET_MS = 500;
const MAX_PARALLEL_CHUNKS = 3;
const GOOGLE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FALLBACK_CACHE_TTL_MS = 60 * 1000;
const CIRCUIT_BREAKER_MS = 60 * 1000;
const CACHE_MAX_ENTRIES = 2000;

function isMarketplaceRoadDistanceOn() {
  return process.env.MARKETPLACE_ROAD_DISTANCE === 'on';
}

function roundCoord(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function roundKm(km) {
  return Math.round(km * 10) / 10;
}

function cacheKey(origin, shopId, location) {
  const oLat = roundCoord(origin.lat, 3);
  const oLng = roundCoord(origin.lng, 3);
  const dLat = roundCoord(location.lat, 5);
  const dLng = roundCoord(location.lng, 5);
  return `${oLat},${oLng}|${shopId}|${dLat},${dLng}`;
}

function haversineRoadKm(origin, location) {
  const meters = locationService.calculateHaversineDistance(origin, location);
  return roundKm((meters / 1000) * ROAD_FACTOR);
}

function elementIsValid(element) {
  if (!element || typeof element !== 'object') {
    return false;
  }
  if (element.condition !== 'ROUTE_EXISTS') {
    return false;
  }
  const status = element.status;
  if (status && typeof status === 'object' && Object.keys(status).length > 0) {
    return false;
  }
  if (typeof status === 'string' && status.trim() !== '') {
    return false;
  }
  return typeof element.distanceMeters === 'number' && Number.isFinite(element.distanceMeters);
}

class LruCache {
  constructor(maxEntries) {
    this.maxEntries = maxEntries;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs) {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
  }
}

const distanceCache = new LruCache(CACHE_MAX_ENTRIES);
const inFlight = new Map();
let circuitOpenUntil = 0;

function openCircuit() {
  circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_MS;
}

function circuitIsOpen() {
  return Date.now() < circuitOpenUntil;
}

function parseMatrixElements(elements, chunkDestinations) {
  const byIndex = new Map();
  if (!Array.isArray(elements)) {
    return byIndex;
  }
  for (const element of elements) {
    const originIndex = element.originIndex === undefined ? 0 : element.originIndex;
    if (originIndex !== 0) {
      continue;
    }
    const destIndex = element.destinationIndex === undefined ? 0 : element.destinationIndex;
    if (!Number.isInteger(destIndex) || destIndex < 0 || destIndex >= chunkDestinations.length) {
      continue;
    }
    if (!elementIsValid(element)) {
      continue;
    }
    const shopId = chunkDestinations[destIndex].id;
    byIndex.set(shopId, {
      distanceKm: roundKm(element.distanceMeters / 1000),
      approx: false
    });
  }
  return byIndex;
}

async function fetchMatrixChunk(origin, chunkDestinations, apiKey, remainingBudgetMs) {
  if (remainingBudgetMs < MIN_GOOGLE_BUDGET_MS) {
    const error = new Error('insufficient enrichment budget');
    error.code = 'INSUFFICIENT_BUDGET';
    throw error;
  }
  const body = {
    origins: [
      {
        waypoint: {
          location: {
            latLng: {
              latitude: origin.lat,
              longitude: origin.lng
            }
          }
        }
      }
    ],
    destinations: chunkDestinations.map((dest) => ({
      waypoint: {
        location: {
          latLng: {
            latitude: dest.location.lat,
            longitude: dest.location.lng
          }
        }
      }
    })),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_UNAWARE'
  };

  const timeoutMs = Math.min(MATRIX_TIMEOUT_MS, remainingBudgetMs);
  const response = await axios.post(ROUTE_MATRIX_URL, body, {
    timeout: timeoutMs,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,distanceMeters,status,condition'
    }
  });

  const elements = Array.isArray(response.data) ? response.data : [];
  return parseMatrixElements(elements, chunkDestinations);
}

function chunkList(list, size) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size));
  }
  return chunks;
}

async function runWithConcurrency(taskFns, limit) {
  const results = new Array(taskFns.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < taskFns.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await taskFns[index]();
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, taskFns.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

async function getDistances(origin, destinations) {
  const startedAt = Date.now();
  const stats = { hit: 0, miss: 0, fallback: 0 };
  const result = new Map();

  const list = Array.isArray(destinations) ? destinations.filter((d) => d && d.id && d.location) : [];

  if (!origin || list.length === 0) {
    console.log(`[ROAD_DISTANCE] hit=${stats.hit} miss=${stats.miss} fallback=${stats.fallback} ms=0`);
    return result;
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const pendingGoogle = [];

  for (const dest of list) {
    const key = cacheKey(origin, dest.id, dest.location);
    const cached = distanceCache.get(key);
    if (cached) {
      stats.hit += 1;
      result.set(dest.id, cached);
      continue;
    }
    const inflight = inFlight.get(key);
    if (inflight) {
      stats.hit += 1;
      const value = await inflight;
      result.set(dest.id, value);
      continue;
    }
    pendingGoogle.push(dest);
  }

  const budgetRemaining = () => ENRICHMENT_BUDGET_MS - (Date.now() - startedAt);
  const googleEnabled = Boolean(apiKey) && !circuitIsOpen() && budgetRemaining() > 0;

  if (pendingGoogle.length > 0 && googleEnabled) {
    const chunks = chunkList(pendingGoogle, CHUNK_SIZE);
    const chunkTasks = chunks.map((chunkDestinations) => async () => {
      const run = (async () => {
        let ok = false;
        let values = new Map();
        if (budgetRemaining() <= 0 || circuitIsOpen()) {
          ok = false;
        } else {
          try {
            const remaining = budgetRemaining();
            values = await fetchMatrixChunk(origin, chunkDestinations, apiKey, remaining);
            ok = true;
          } catch (error) {
            if (error.code !== 'INSUFFICIENT_BUDGET') {
              openCircuit();
            }
            ok = false;
            values = new Map();
          }
        }

        const resolvedById = new Map();
        for (const dest of chunkDestinations) {
          let value = ok ? values.get(dest.id) : null;
          if (value) {
            distanceCache.set(cacheKey(origin, dest.id, dest.location), value, GOOGLE_CACHE_TTL_MS);
          } else {
            value = {
              distanceKm: haversineRoadKm(origin, dest.location),
              approx: true
            };
            distanceCache.set(cacheKey(origin, dest.id, dest.location), value, FALLBACK_CACHE_TTL_MS);
          }
          resolvedById.set(dest.id, value);
        }
        return { ok, resolvedById };
      })();

      for (const dest of chunkDestinations) {
        const key = cacheKey(origin, dest.id, dest.location);
        inFlight.set(key, run.then((chunkResult) => chunkResult.resolvedById.get(dest.id)));
      }

      try {
        return await run;
      } finally {
        for (const dest of chunkDestinations) {
          inFlight.delete(cacheKey(origin, dest.id, dest.location));
        }
      }
    });

    const chunkResults = await runWithConcurrency(chunkTasks, MAX_PARALLEL_CHUNKS);

    for (const chunkResult of chunkResults) {
      for (const [destId, value] of chunkResult.resolvedById.entries()) {
        if (result.has(destId)) {
          continue;
        }
        stats.miss += 1;
        if (value.approx) {
          stats.fallback += 1;
        }
        result.set(destId, value);
      }
    }
  } else if (pendingGoogle.length > 0) {
    for (const dest of pendingGoogle) {
      stats.miss += 1;
      stats.fallback += 1;
      const value = {
        distanceKm: haversineRoadKm(origin, dest.location),
        approx: true
      };
      distanceCache.set(cacheKey(origin, dest.id, dest.location), value, FALLBACK_CACHE_TTL_MS);
      result.set(dest.id, value);
    }
  }

  for (const dest of list) {
    if (!result.has(dest.id)) {
      stats.miss += 1;
      stats.fallback += 1;
      const value = {
        distanceKm: haversineRoadKm(origin, dest.location),
        approx: true
      };
      distanceCache.set(cacheKey(origin, dest.id, dest.location), value, FALLBACK_CACHE_TTL_MS);
      result.set(dest.id, value);
    }
  }

  const ms = Date.now() - startedAt;
  console.log(`[ROAD_DISTANCE] hit=${stats.hit} miss=${stats.miss} fallback=${stats.fallback} ms=${ms}`);
  return result;
}

function resetForTests() {
  distanceCache.map.clear();
  inFlight.clear();
  circuitOpenUntil = 0;
}

module.exports = {
  getDistances,
  isMarketplaceRoadDistanceOn,
  resetForTests,
  ROAD_FACTOR,
  ENRICHMENT_BUDGET_MS,
  MAX_PARALLEL_CHUNKS,
  CHUNK_SIZE
};