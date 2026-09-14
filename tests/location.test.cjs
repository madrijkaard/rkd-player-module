const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanPosition, createLocation } = require('../src/location.cjs');
test('location keeps regional precision and rejects invalid coordinates', () => {
  assert.deepEqual(cleanPosition({ status: 'available', lat: -23.55551, lon: -46.63331, accuracy: 25 }), { status: 'available', lat: -23.56, lon: -46.63, accuracy: 25 });
  for (const value of [null, {}, { status: 'available', lat: 100, lon: 0 }, { status: 'available', lat: '10', lon: 0 }]) assert.equal(cleanPosition(value).status, 'unavailable');
  assert.deepEqual(cleanPosition({ status: 'denied', lat: 1, lon: 1 }), { status: 'denied' });
});
test('location caches requests, allows retry, and uses a hidden bounded Windows helper', async () => {
  let calls = 0, now = 0;
  const location = createLocation({ platform: 'win32', now: () => now, run: (exe, args, options, callback) => {
    calls++; assert.ok(exe.endsWith('powershell.exe')); assert.equal(options.windowsHide, true); assert.equal(options.timeout, 20000);
    setImmediate(() => callback(null, JSON.stringify({ status: 'available', lat: 40.4, lon: -3.7 })));
    return { kill() {} };
  } });
  await Promise.all([location.get(), location.get()]); assert.equal(calls, 1);
  now = 599999; await location.get(); assert.equal(calls, 1);
  await location.get(true); assert.equal(calls, 2);
  now += 600001; await location.get(); assert.equal(calls, 3);
});
test('location preserves denied permission and supports cancellation', async () => {
  const denied = createLocation({ platform: 'win32', run: (exe, args, options, callback) => { setImmediate(() => callback(null, '{"status":"denied"}')); return { kill() {} }; } });
  assert.deepEqual(await denied.get(), { status: 'denied' });
  const location = createLocation({ platform: 'win32', run: (exe, args, options, callback) => ({ kill: () => callback(Error('Cancelled'), '') }) });
  const pending = location.get(); location.stop(); assert.equal((await pending).status, 'unavailable');
});
