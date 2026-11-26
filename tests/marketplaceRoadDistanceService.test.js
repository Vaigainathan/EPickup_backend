const axios = require('axios');
const locationService = require('../src/services/locationService');
const roadDistanceService = require('../src/services/marketplaceRoadDistanceService');

jest.mock('axios');
jest.mock('../src/services/locationService', () => ({
  calculateHaversineDistance: jest.fn(() => 5000)
}));

const ORIGIN = { lat: 12.971, lng: 77.594 };
const DEST_A = { id: 'shop-a', location: { lat: 12.98, lng: 77.6 } };
const DEST_B = { id: 'shop-b', location: { lat: 12.99, lng: 77.61 } };

describe('marketplaceRoadDistanceService', () => {
  const originalEnv = process.env;
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    roadDistanceService.resetForTests();
    process.env = { ...originalEnv, GOOGLE_MAPS_API_KEY: 'test-key' };
    locationService.calculateHaversineDistance.mockReturnValue(5000);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    logSpy.mockRestore();
  });

  test('matrix success returns road km with approx false for every destination', async () => {
    axios.post.mockResolvedValue({
      data: [
        {
          originIndex: 0,
          destinationIndex: 0,
          distanceMeters: 6500,
          condition: 'ROUTE_EXISTS',
          status: {}
        },
        {
          originIndex: 0,
          destinationIndex: 1,
          distanceMeters: 12000,
          condition: 'ROUTE_EXISTS',
          status: {}
        }
      ]
    });

    const map = await roadDistanceService.getDistances(ORIGIN, [DEST_A, DEST_B]);
    expect(map.size).toBe(2);
    expect(map.get('shop-a')).toEqual({ distanceKm: 6.5, approx: false });
    expect(map.get('shop-b')).toEqual({ distanceKm: 12, approx: false });
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [, body, config] = axios.post.mock.calls[0];
    expect(config.headers['X-Goog-FieldMask']).toBe(
      'originIndex,destinationIndex,distanceMeters,status,condition'
    );
    expect(body.travelMode).toBe('DRIVE');
    expect(body.routingPreference).toBe('TRAFFIC_UNAWARE');
    expect(config.timeout).toBe(2500);
  });

  test('parses element with omitted originIndex as origin 0', async () => {
    axios.post.mockResolvedValue({
      data: [
        {
          destinationIndex: 0,
          distanceMeters: 2100,
          condition: 'ROUTE_EXISTS',
          status: {}
        }
      ]
    });

    const map = await roadDistanceService.getDistances(ORIGIN, [DEST_A]);
    expect(map.get('shop-a')).toEqual({ distanceKm: 2.1, approx: false });
  });

  test('parses element with omitted destinationIndex as destination 0', async () => {
    axios.post.mockResolvedValue({
      data: [
        {
          originIndex: 0,
          distanceMeters: 1800,
          condition: 'ROUTE_EXISTS',
          status: {}
        }
      ]
    });

    const map = await roadDistanceService.getDistances(ORIGIN, [DEST_A]);
    expect(map.get('shop-a')).toEqual({ distanceKm: 1.8, approx: false });
  });

  test('parses unordered matrix elements by index', async () => {
    axios.post.mockResolvedValue({
      data: [
        {
          originIndex: 0,
          destinationIndex: 1,
          distanceMeters: 8000,
          condition: 'ROUTE_EXISTS',
          status: {}
        },
        {
          originIndex: 0,
          destinationIndex: 0,
          distanceMeters: 4000,
          condition: 'ROUTE_EXISTS',
          status: {}
        }
      ]
    });

    const map = await roadDistanceService.getDistances(ORIGIN, [DEST_A, DEST_B]);
    expect(map.get('shop-a')).toEqual({ distanceKm: 4, approx: false });
    expect(map.get('shop-b')).toEqual({ distanceKm: 8, approx: false });
  });

  test('element with error status uses haversine fallback', async () => {
    axios.post.mockResolvedValue({
      data: [
        {
          originIndex: 0,
          destinationIndex: 0,
          distanceMeters: 7000,
          condition: 'ROUTE_EXISTS',
          status: { code: 5 }
        }
      ]
    });

    const map = await roadDistanceService.getDistances(ORIGIN, [DEST_A]);
    expect(map.get('shop-a')).toEqual({ distanceKm: 6.5, approx: true });
  });

  test('non-OK element uses haversine fallback with approx true', async () => {
    axios.post.mockResolvedValue({
      data: [
        {
          originIndex: 0,
          destinationIndex: 0,
          distanceMeters: 7000,
          condition: 'ROUTE_EXISTS',
          status: {}
        },
        {
          originIndex: 0,
          destinationIndex: 1,
          distanceMeters: 9000,
          condition: 'ROUTE_NOT_FOUND',
          status: {}
        }
      ]
    });

    const map = await roadDistanceService.getDistances(ORIGIN, [DEST_A, DEST_B]);
    expect(map.get('shop-a')).toEqual({ distanceKm: 7, approx: false });
    expect(map.get('shop-b')).toEqual({ distanceKm: 6.5, approx: true });
    expect(map.has('shop-b')).toBe(true);
  });

  test('timeout uses fallback for all destinations and opens circuit', async () => {
    axios.post.mockRejectedValue(new Error('timeout'));
    const map = await roadDistanceService.getDistances(ORIGIN, [DEST_A, DEST_B]);
    expect(map.get('shop-a')).toEqual({ distanceKm: 6.5, approx: true });
    expect(map.get('shop-b')).toEqual({ distanceKm: 6.5, approx: true });

    axios.post.mockClear();
    const map2 = await roadDistanceService.getDistances(ORIGIN, [DEST_A]);
    expect(axios.post).not.toHaveBeenCalled();
    expect(map2.get('shop-a').approx).toBe(true);
  });

  test('cache hit avoids second axios call for google result', async () => {
    axios.post.mockResolvedValue({
      data: [
        {
          originIndex: 0,
          destinationIndex: 0,
          distanceMeters: 5000,
          condition: 'ROUTE_EXISTS',
          status: {}
        }
      ]
    });

    await roadDistanceService.getDistances(ORIGIN, [DEST_A]);
    await roadDistanceService.getDistances(ORIGIN, [DEST_A]);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('in-flight dedup avoids duplicate matrix call for same key', async () => {
    let resolvePost;
    axios.post.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        })
    );

    const first = roadDistanceService.getDistances(ORIGIN, [DEST_A]);
    const second = roadDistanceService.getDistances(ORIGIN, [DEST_A]);
    await new Promise((r) => setImmediate(r));
    resolvePost({
      data: [
        {
          originIndex: 0,
          destinationIndex: 0,
          distanceMeters: 4200,
          condition: 'ROUTE_EXISTS',
          status: {}
        }
      ]
    });
    const [mapA, mapB] = await Promise.all([first, second]);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(mapA.get('shop-a')).toEqual({ distanceKm: 4.2, approx: false });
    expect(mapB.get('shop-a')).toEqual({ distanceKm: 4.2, approx: false });
  });

  test('chunks more than 25 shops into multiple requests', async () => {
    const destinations = Array.from({ length: 30 }, (_, i) => ({
      id: `shop-${i}`,
      location: { lat: 12.9 + i * 0.001, lng: 77.6 }
    }));
    axios.post.mockImplementation(async (_url, body) => ({
      data: body.destinations.map((_, index) => ({
        originIndex: 0,
        destinationIndex: index,
        distanceMeters: 3000,
        condition: 'ROUTE_EXISTS',
        status: {}
      }))
    }));

    const map = await roadDistanceService.getDistances(ORIGIN, destinations);
    expect(axios.post.mock.calls.length).toBe(2);
    expect(map.size).toBe(30);
    destinations.forEach((dest) => {
      expect(map.has(dest.id)).toBe(true);
    });
  });

  test('returns empty map when no destinations', async () => {
    const map = await roadDistanceService.getDistances(ORIGIN, []);
    expect(map.size).toBe(0);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('logs ROAD_DISTANCE summary line', async () => {
    axios.post.mockResolvedValue({
      data: [
        {
          originIndex: 0,
          destinationIndex: 0,
          distanceMeters: 1000,
          condition: 'ROUTE_EXISTS',
          status: {}
        }
      ]
    });
    await roadDistanceService.getDistances(ORIGIN, [DEST_A]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[ROAD_DISTANCE\] hit=\d+ miss=\d+ fallback=\d+ ms=\d+$/));
  });

  test('skips Google when remaining enrichment budget is under 500ms', async () => {
    let callCount = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? 0 : 2600;
    });

    const map = await roadDistanceService.getDistances(ORIGIN, [DEST_A]);
    expect(axios.post).not.toHaveBeenCalled();
    expect(map.get('shop-a')).toEqual({ distanceKm: 6.5, approx: true });
  });

  test('uses min of matrix timeout and remaining enrichment budget for axios', async () => {
    let callCount = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? 0 : 1500;
    });
    axios.post.mockResolvedValue({
      data: [
        {
          originIndex: 0,
          destinationIndex: 0,
          distanceMeters: 900,
          condition: 'ROUTE_EXISTS',
          status: {}
        }
      ]
    });

    await roadDistanceService.getDistances(ORIGIN, [DEST_A]);
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [, , config] = axios.post.mock.calls[0];
    expect(config.timeout).toBe(1500);
  });

  test('isMarketplaceRoadDistanceOn respects env flag', () => {
    delete process.env.MARKETPLACE_ROAD_DISTANCE;
    expect(roadDistanceService.isMarketplaceRoadDistanceOn()).toBe(false);
    process.env.MARKETPLACE_ROAD_DISTANCE = 'on';
    expect(roadDistanceService.isMarketplaceRoadDistanceOn()).toBe(true);
  });
});