const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
function cleanPosition(value) {
  if (value?.status !== 'available' || !Number.isFinite(value.lat) || !Number.isFinite(value.lon) || Math.abs(value.lat) > 90 || Math.abs(value.lon) > 180) return { status: value?.status === 'denied' ? 'denied' : 'unavailable' };
  // Regional precision is sufficient; do not retain exact device coordinates.
  return { status: 'available', lat: Math.round(value.lat * 100) / 100, lon: Math.round(value.lon * 100) / 100, accuracy: Number.isFinite(value.accuracy) && value.accuracy >= 0 ? value.accuracy : null };
}
function createLocation({ platform = process.platform, run = execFile, now = Date.now } = {}) {
  let cached, expires = 0, pending, child, generation = 0;
  async function get(force = false) {
    if (pending) return pending;
    if (!force && cached && now() < expires) return cached;
    if (platform !== 'win32') return { status: 'unavailable' };
    const attempt = generation;
    pending = new Promise(resolve => {
      const script = fs.readFileSync(path.join(__dirname, 'location-windows.ps1'), 'utf8');
      const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      child = run(executable, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 20000, maxBuffer: 8192, encoding: 'utf8' }, (error, stdout) => {
        let result = { status: 'unavailable' };
        if (!error) { try { result = cleanPosition(JSON.parse(stdout.replace(/^\uFEFF/, '').trim())); } catch {} }
        if (generation === attempt) { cached = result; expires = now() + (result.status === 'available' ? 600000 : 60000); }
        resolve(result);
      });
    });
    try { return await pending; } finally { pending = null; child = null; }
  }
  return { get, stop: () => { generation++; child?.kill(); } };
}
module.exports = { createLocation, cleanPosition };
