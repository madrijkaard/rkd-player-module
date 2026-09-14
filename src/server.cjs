const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

async function serve(routes, policy) {
  const server = http.createServer((request, response) => {
    if (request.headers.host !== `127.0.0.1:${server.address().port}`) { response.writeHead(403).end(); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    let pathname;
    try { pathname = new URL(request.url, 'http://local').pathname; } catch { response.writeHead(400).end(); return; }
    const file = routes[pathname];
    if (!file) { response.writeHead(404).end(); return; }
    const ext = path.extname(file);
    response.writeHead(200, {
      'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' })[ext] || 'application/octet-stream',
      'Content-Security-Policy': policy,
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store'
    });
    if (request.method === 'HEAD') response.end();
    else fs.createReadStream(file).on('error', () => response.destroy()).pipe(response);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections(); server.close(); } };
}
async function createServers(root) {
  const ui = (name) => path.join(root, 'src', 'ui', name);
  // A separate origin keeps the remote YouTube API away from the Electron bridge.
  const player = await serve({ '/player.html': ui('player.html'), '/player.js': ui('player.js'), '/space-player.html': ui('space-player.html'), '/space-player.js': ui('space-player.js') }, "default-src 'none'; script-src 'self' https://www.youtube.com https://s.ytimg.com; style-src 'unsafe-inline'; frame-src https://www.youtube.com https://www.youtube-nocookie.com; img-src https://i.ytimg.com; connect-src https://www.youtube.com; base-uri 'none'; form-action 'none'");
  const main = await serve({
    '/radar-cities.json': ui('radar-cities.json'),
    '/cyberpunk-background.js': ui('cyberpunk-background.js'),
    '/': ui('index.html'), '/app.js': ui('app.js'), '/visualizer.js': ui('visualizer.js'), '/space-background.js': ui('space-background.js'), '/radar-background.js': ui('radar-background.js'), '/radar-map.json': ui('radar-map.json'), '/style.css': ui('style.css'), '/themes.css': ui('themes.css')
  }, `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://i.ytimg.com https://yt3.googleusercontent.com https://yt3.ggpht.com data:; frame-src ${player.origin}; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  return { main, player, close: () => { main.close(); player.close(); } };
}
module.exports = { createServers };
