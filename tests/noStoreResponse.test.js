const express = require('express');
const request = require('supertest');
const { prepareNoStoreResponse } = require('../src/middleware/noStoreResponse');

describe('prepareNoStoreResponse (real Express)', () => {
  function buildApp(payload) {
    const app = express();
    app.get('/trip', (req, res) => {
      prepareNoStoreResponse(req, res);
      res.json(payload);
    });
    app.get('/broken-etag-false', (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.set('ETag', false);
      res.json(payload);
    });
    return app;
  }

  test('first response is 200 with body; conditional GET also 200 with full body', async () => {
    const app = buildApp({ ok: true, bookingId: 'b1' });
    const first = await request(app).get('/trip');
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true, bookingId: 'b1' });
    const etag = first.headers.etag;
    expect(etag).toBeDefined();

    const second = await request(app)
      .get('/trip')
      .set('If-None-Match', etag)
      .set('If-Modified-Since', 'Wed, 21 Oct 2015 07:28:00 GMT');

    expect(second.status).toBe(200);
    expect(second.body).toEqual({ ok: true, bookingId: 'b1' });
    expect(second.headers.etag).not.toBe('false');
    expect(second.headers['cache-control']).toMatch(/no-store/);
  });

  test('res.set(ETag, false) yields literal ETag header and can 304', async () => {
    const app = buildApp({ demo: 1 });
    const first = await request(app).get('/broken-etag-false');
    const etagHeader = first.headers.etag;
    expect(String(etagHeader)).toBe('false');

    const second = await request(app)
      .get('/broken-etag-false')
      .set('If-None-Match', etagHeader);
    expect(second.status).toBe(304);
    expect(second.text).toBe('');
  });
});
