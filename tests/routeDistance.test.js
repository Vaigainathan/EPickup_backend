jest.mock('axios');

const axios = require('axios');
const fareCalculationService = require('../src/services/fareCalculationService');
const bookingService = require('../src/services/bookingService');

const pickup = { lat: 12.9716, lng: 77.5946 };
const dropoff = { lat: 13.0827, lng: 80.2707 };
const realNow = fareCalculationService.now;
const realSleep = fareCalculationService.sleep;

function routeResponse(distanceMeters) {
  return {
    status: 200,
    data: { routes: [{ distanceMeters, duration: '600s' }] }
  };
}

function httpError(status, googleStatus, googleMessage) {
  const error = new Error(`Request failed with status code ${status}`);
  error.response = {
    status,
    data: { error: { status: googleStatus, message: googleMessage } }
  };
  return error;
}

afterEach(() => {
  fareCalculationService.now = realNow;
  fareCalculationService.sleep = realSleep;
  axios.post.mockReset();
});

describe('Routes API distance', () => {
  test('returns kilometers from distanceMeters', async () => {
    axios.post.mockResolvedValue(routeResponse(8460));

    const km = await fareCalculationService.getDistanceFromGoogleMaps(pickup, dropoff);

    expect(km).toBe(8.46);
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body, config] = axios.post.mock.calls[0];
    expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    expect(body.travelMode).toBe('DRIVE');
    expect(body.routingPreference).toBe('TRAFFIC_UNAWARE');
    expect(body.origin.location.latLng).toEqual({ latitude: 12.9716, longitude: 77.5946 });
    expect(config.timeout).toBe(2500);
    expect(config.headers['X-Goog-FieldMask']).toBe('routes.distanceMeters,routes.duration');
    expect(config.headers['X-Goog-Api-Key']).toBe(fareCalculationService.GOOGLE_MAPS_API_KEY);
  });

  test('retries HTTP 5xx once and then returns the distance', async () => {
    fareCalculationService.sleep = async () => {};
    axios.post
      .mockRejectedValueOnce(httpError(503, 'UNAVAILABLE', 'backend error'))
      .mockResolvedValueOnce(routeResponse(1000));

    const km = await fareCalculationService.getDistanceFromGoogleMaps(pickup, dropoff);

    expect(km).toBe(1);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  test('retries HTTP 429 once and then returns the distance', async () => {
    fareCalculationService.sleep = async () => {};
    axios.post
      .mockRejectedValueOnce(httpError(429, 'RESOURCE_EXHAUSTED', 'quota'))
      .mockResolvedValueOnce(routeResponse(8460));

    const km = await fareCalculationService.getDistanceFromGoogleMaps(pickup, dropoff);

    expect(km).toBe(8.46);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  test('throws FareUnavailableError after three timeouts', async () => {
    fareCalculationService.sleep = async () => {};
    const timeout = new Error('timeout of 2500ms exceeded');
    timeout.code = 'ECONNABORTED';
    axios.post.mockRejectedValue(timeout);

    await expect(fareCalculationService.getDistanceFromGoogleMaps(pickup, dropoff))
      .rejects.toBeInstanceOf(fareCalculationService.FareUnavailableError);
    expect(axios.post).toHaveBeenCalledTimes(3);
  });

  test('does not retry HTTP 403 REQUEST_DENIED', async () => {
    axios.post.mockRejectedValue(httpError(403, 'PERMISSION_DENIED', 'REQUEST_DENIED'));
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(fareCalculationService.getDistanceFromGoogleMaps(pickup, dropoff))
      .rejects.toMatchObject({ name: 'FareUnavailableError', message: 'REQUEST_DENIED' });
    expect(axios.post).toHaveBeenCalledTimes(1);
    const dumped = JSON.stringify(errorLog.mock.calls);
    expect(dumped).not.toContain('X-Goog-Api-Key');
    if (fareCalculationService.GOOGLE_MAPS_API_KEY) {
      expect(dumped).not.toContain(fareCalculationService.GOOGLE_MAPS_API_KEY);
    }
    errorLog.mockRestore();
  });

  test('throws FareUnavailableError when routes is empty', async () => {
    axios.post.mockResolvedValue({ status: 200, data: { routes: [] } });

    await expect(fareCalculationService.getDistanceFromGoogleMaps(pickup, dropoff))
      .rejects.toMatchObject({
        name: 'FareUnavailableError',
        message: 'Routes API returned no distance'
      });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('throws FareUnavailableError without a third attempt when the budget would be exceeded', async () => {
    let clock = 0;
    fareCalculationService.now = () => clock;
    fareCalculationService.sleep = async (ms) => {
      clock += ms;
    };
    axios.post.mockImplementation(async () => {
      clock += 2500;
      const error = new Error('timeout of 2500ms exceeded');
      error.code = 'ECONNABORTED';
      throw error;
    });

    await expect(fareCalculationService.getDistanceFromGoogleMaps(pickup, dropoff))
      .rejects.toMatchObject({ name: 'FareUnavailableError', message: 'distance budget exceeded' });
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  test('bookingService.calculateDistance uses latitude and longitude', async () => {
    axios.post.mockResolvedValue(routeResponse(2000));

    const km = await bookingService.calculateDistance(
      { latitude: 12.9716, longitude: 77.5946 },
      { latitude: 13.0827, longitude: 80.2707 }
    );

    expect(km).toBe(2);
    const body = axios.post.mock.calls[0][1];
    expect(body.origin.location.latLng).toEqual({ latitude: 12.9716, longitude: 77.5946 });
    expect(body.destination.location.latLng).toEqual({ latitude: 13.0827, longitude: 80.2707 });
  });

  test('fareUnavailableBody is the shared 503 payload', () => {
    expect(fareCalculationService.fareUnavailableBody()).toEqual({
      success: false,
      error: 'Fare unavailable',
      details: "We couldn't calculate the delivery price right now. Please try again.",
      code: 'FARE_UNAVAILABLE'
    });
  });
});
