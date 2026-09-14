const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BOUNDS, boundsForLocation, parseFlights, createRadar } = require('../src/radar.cjs');
const time = 1789260000;
const row = (patch = {}) => Object.assign(['abcdef', 'TAM123  ', 'Brazil', time, time, -46.5, -23.5, 9000, false, 220, 90], patch);
const body = { time, states: [row()] };
test('radar accepts only recent airborne aircraft inside the fixed region', () => {
  const result = parseFlights({ time, states: [row(), row(), row({ 0: 'bad' }), row({ 0: 'aaaaaa', 5: null }), row({ 0: 'bbbbbb', 8: true }), row({ 0: 'cccccc', 3: time - 121 }), row({ 0: 'dddddd', 6: 70 })] }, time * 1000);
  assert.equal(result.flights.length, 1); assert.equal(result.flights[0].callsign, 'TAM123'); assert.equal(result.flights[0].heading, 90);
  assert.deepEqual(parseFlights({ time, states: null }, time * 1000).flights, []);
  assert.throws(() => parseFlights(body, (time + 121) * 1000)); assert.throws(() => parseFlights({}, time * 1000));
});
test('radar shares requests and caches for a minute without persisting positions', async () => {
  let now = time * 1000, calls = 0;
  const radar = createRadar({ now: () => now, fetchImpl: async () => { calls++; return Response.json({ ...body, time: now / 1000 }); } });
  const [a, b] = await Promise.all([radar.get(), radar.get()]);
  assert.equal(calls, 1); assert.equal(a.status, 'live'); assert.deepEqual(a, b);
  await radar.get(); assert.equal(calls, 1); now += 60000; await radar.get(); assert.equal(calls, 2);
});
test('radar honors quota retry time and clears aircraft on failure', async () => {
  let now = time * 1000, calls = 0;
  const radar = createRadar({ now: () => now, fetchImpl: async () => { calls++; return calls === 1 ? Response.json(body) : new Response('', { status: 429, headers: { 'X-Rate-Limit-Retry-After-Seconds': '300' } }); } });
  await radar.get(); now += 60000; const limited = await radar.get();
  assert.equal(limited.status, 'limited'); assert.deepEqual(limited.flights, []); assert.equal(limited.nextUpdateAt, now + 300000);
  now += 100000; await radar.get(); assert.equal(calls, 2);
  const offline = createRadar({ fetchImpl: async () => { throw Error('Network'); } });
  assert.equal((await offline.get()).status, 'offline');
});
test('radar cancels a pending request when leaving the theme', async () => {
  const radar = createRadar({ fetchImpl: (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('Aborted')), { once: true })) });
  const pending = radar.get(); radar.stop(); assert.equal((await pending).status, 'offline');
});
test('radar recenters queries and filters around the device, preserving quota deadlines', async () => {
  let now = time * 1000, requested;
  const radar = createRadar({ now: () => now, fetchImpl: async url => {
    requested = new URL(url);
    return Response.json({ time: now / 1000, states: [row({ 5: -3.7, 6: 40.4, 3: now / 1000 }), row()] });
  } });
  const location = { status: 'available', lat: 40.4, lon: -3.7 };
  radar.setLocation(location); const result = await radar.get();
  assert.equal(requested.searchParams.get('lamin'), '38.4'); assert.equal(requested.searchParams.get('lomin'), '-6.7');
  assert.equal(result.flights.length, 1); assert.equal(result.flights[0].lat, 40.4);
  radar.setLocation({ status: 'available', lat: -33.8, lon: 151.2 }); const changed = await radar.get();
  assert.equal(changed.bounds.west, 148.2); assert.deepEqual(changed.flights, []); assert.equal(changed.nextUpdateAt, time * 1000 + 60000);
  radar.setLocation({ status: 'denied' }); assert.deepEqual((await radar.get()).bounds, BOUNDS);
});
test('location bounds remain valid near poles and the date line with one-credit area', () => {
  for (const [lat, lon] of [[90, 180], [-90, -180], [0, 0]]) {
    const b = boundsForLocation({ status: 'available', lat, lon });
    assert.ok(b.west >= -180 && b.east <= 180 && b.south >= -85 && b.north <= 85);
    assert.ok((b.north - b.south) * (b.east - b.west) <= 25);
  }
  assert.deepEqual(boundsForLocation({ status: 'unavailable' }), BOUNDS);
});
