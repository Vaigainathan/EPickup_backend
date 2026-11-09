const driverRouter = require('../src/routes/driver');

describe('driver route registration order', () => {
  test('PUT /status is registered before PUT /:id/status', () => {
    const routes = driverRouter.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods)
      }));

    const putStatusIndex = routes.findIndex(
      (r) => r.path === '/status' && r.methods.includes('put')
    );
    const putIdStatusIndex = routes.findIndex(
      (r) => r.path === '/:id/status' && r.methods.includes('put')
    );

    expect(putStatusIndex).toBeGreaterThanOrEqual(0);
    expect(putIdStatusIndex).toBeGreaterThanOrEqual(0);
    expect(putStatusIndex).toBeLessThan(putIdStatusIndex);
  });
});
