const BOUNDS = Object.freeze({ south: -25, north: -21, west: -49, east: -43 });
const INTERVAL = 60000;
function boundsForLocation(location) {
  if (location?.status !== 'available' || !Number.isFinite(location.lat) || !Number.isFinite(location.lon) || Math.abs(location.lat) > 90 || Math.abs(location.lon) > 180) return BOUNDS;
  const lat = Math.max(-83, Math.min(83, location.lat)), lon = Math.max(-177, Math.min(177, location.lon));
  return { south: +(lat - 2).toFixed(2), north: +(lat + 2).toFixed(2), west: +(lon - 3).toFixed(2), east: +(lon + 3).toFixed(2) };
}
function parseFlights(data, now = Date.now(), bounds = BOUNDS) {
  if (!data || !Number.isFinite(data.time) || (data.states !== null && !Array.isArray(data.states))) throw new Error('Resposta inválida');
  if (Math.abs(now / 1000 - data.time) > 120) throw new Error('Dados desatualizados');
  const seen = new Set();
  const flights = (data.states || []).slice(0, 2000).filter(row => {
    if (!Array.isArray(row) || typeof row[0] !== 'string' || !/^[a-f\d]{6}$/i.test(row[0]) || seen.has(row[0]) || row[8] !== false) return false;
    if (!Number.isFinite(row[3]) || Math.abs(now / 1000 - row[3]) > 120 || !Number.isFinite(row[5]) || !Number.isFinite(row[6])) return false;
    if (row[5] < bounds.west || row[5] > bounds.east || row[6] < bounds.south || row[6] > bounds.north) return false;
    seen.add(row[0]); return true;
  }).map(row => ({ id: row[0], callsign: String(row[1] || row[0]).trim().slice(0, 16), lon: row[5], lat: row[6], heading: Number.isFinite(row[10]) ? ((row[10] % 360) + 360) % 360 : 0, positionAt: row[3] * 1000 }));
  return { flights, timestamp: data.time * 1000 };
}
function createRadar({ fetchImpl = (...args) => fetch(...args), now = Date.now } = {}) {
  let pending, controller, nextUpdateAt = 0, snapshot = { status: 'connecting', flights: [], timestamp: 0 };
  let bounds = BOUNDS, location = { status: 'unavailable' }, revision = 0;
  function setLocation(value) {
    const next = boundsForLocation(value);
    location = next !== BOUNDS ? value : { status: value?.status === 'denied' ? 'denied' : 'unavailable' };
    if (JSON.stringify(next) === JSON.stringify(bounds)) return;
    bounds = next; revision++; controller?.abort(); snapshot = { status: 'connecting', flights: [], timestamp: 0 };
    // Keep the request deadline, including quota backoff, when the region changes.
  }
  function current() {
    if (snapshot.status === 'live' && now() - snapshot.timestamp > 120000) return { status: 'stale', flights: [], timestamp: snapshot.timestamp, bounds, location, nextUpdateAt };
    return { ...snapshot, bounds, location, nextUpdateAt };
  }
  async function get() {
    if (pending) return pending;
    if (now() < nextUpdateAt) return current();
    nextUpdateAt = now() + INTERVAL;
    controller = new AbortController();
    const requestRevision = revision, requestedBounds = bounds;
    const url = new URL('https://opensky-network.org/api/states/all');
    for (const [key, value] of Object.entries({ lamin: bounds.south, lamax: bounds.north, lomin: bounds.west, lomax: bounds.east })) url.searchParams.set(key, value);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    pending = (async () => {
      try {
        const response = await fetchImpl(url.toString(), { signal, headers: { Accept: 'application/json', 'User-Agent': 'rkd-player-module/1.1.0 (desktop flight-map background)' } });
        if (requestRevision !== revision) return current();
        if (response.status === 429) {
          const seconds = Number(response.headers.get('X-Rate-Limit-Retry-After-Seconds') || response.headers.get('Retry-After'));
          nextUpdateAt = now() + (Number.isFinite(seconds) && seconds > 0 ? Math.max(60, Math.min(86400, seconds)) : 3600) * 1000;
          snapshot = { status: 'limited', flights: [], timestamp: 0 };
        } else {
          if (!response.ok) throw new Error('Serviço indisponível');
          const reader = response.body.getReader(); const chunks = []; let size = 0;
          try {
            while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 2 * 1024 * 1024) throw new Error('Resposta muito grande'); chunks.push(part.value); }
          } finally { await reader.cancel().catch(() => {}); }
          const parsed = parseFlights(JSON.parse(Buffer.concat(chunks).toString('utf8')), now(), requestedBounds);
          if (requestRevision === revision) snapshot = { status: 'live', ...parsed };
        }
      } catch { if (requestRevision === revision) snapshot = { status: 'offline', flights: [], timestamp: 0 }; }
      return current();
    })();
    try { return await pending; } finally { pending = null; controller = null; }
  }
  return { get, setLocation, stop: () => controller?.abort() };
}
module.exports = { BOUNDS, boundsForLocation, parseFlights, createRadar };
