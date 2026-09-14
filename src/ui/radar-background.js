'use strict';
window.LumenRadarBackground = class {
  constructor(container, api) {
    this.container = container; this.home = container.parentElement; this.api = api;
    this.canvas = container.querySelector('canvas'); this.ctx = this.canvas.getContext('2d');
    this.status = container.querySelector('[role="status"]');
    this.dialogs = ['#video-dialog', '#history-dialog', '#settings-dialog', '#library-dialog'].map(s => document.querySelector(s));
    this.enabled = false; this.generation = 0; this.flights = []; this.map = [];
    this.cities = []; this.cityLabels = []; this.cityLayoutKey = null;
    this.bounds = { south: -25, north: -21, west: -49, east: -43 };
    this.location = { status: 'unavailable' };
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.noiseFrames = [];
    this.motion.addEventListener('change', () => { if (this.enabled) { cancelAnimationFrame(this.frame); this.animate(); } });
    new ResizeObserver(() => this.resize()).observe(container);
    const observer = new MutationObserver(() => this.place());
    this.dialogs.forEach(d => observer.observe(d, { attributes: true, attributeFilter: ['open'] }));
    fetch('/radar-map.json').then(r => r.json()).then(map => { this.map = map.features; if (this.enabled) this.draw(); }).catch(() => {});
    fetch('/radar-cities.json').then(r => r.json()).then(data => {
      this.cities = data.cities; this.cityLayoutKey = null;
      if (this.enabled) this.draw();
    }).catch(() => {});
  }
  configure(theme, minimized) {
    const enabled = theme === 'military' && !minimized;
    if (enabled === this.enabled) return;
    this.enabled = enabled; this.generation++;
    this.container.hidden = !enabled;
    clearTimeout(this.timer); cancelAnimationFrame(this.frame);
    if (enabled) {
      this.nextInterference = performance.now() + 6000 + Math.random() * 8000;
      this.interference = null;
      this.place(); this.resize(); this.refresh(this.generation); this.animate();
    }
    else { this.flights = []; this.place(); }
  }
  place() {
    const host = (this.enabled && this.dialogs.find(d => d.open)) || this.home;
    // Keep the live map behind a console until its closing transition finishes.
    const currentHost = this.container.parentElement;
    if (this.enabled && host === this.home && this.dialogs.includes(currentHost)) {
      const transitions = currentHost.getAnimations().filter(animation => animation.playState === 'running');
      if (transitions.length) {
        if (this.exitingHost !== currentHost) {
          this.exitingHost = currentHost;
          Promise.allSettled(transitions.map(animation => animation.finished)).then(() => {
            if (this.exitingHost === currentHost) { this.exitingHost = null; this.place(); }
          });
        }
        return;
      }
    }
    this.exitingHost = null;
    if (this.container.parentElement !== host) host.moveBefore(this.container, host.firstChild);
    this.dialogs.forEach(d => d.classList.toggle('has-radar-background', this.enabled && d === host));
    if (this.enabled) this.resize();
  }
  async refresh(generation) {
    this.status.textContent = 'OpenSky · Detectando região e buscando posições reais…';
    let delay = 60000;
    try {
      const result = await this.api.radar();
      if (!this.enabled || generation !== this.generation) return;
      this.flights = result.flights || []; this.bounds = result.bounds || this.bounds;
      this.location = result.location || { status: 'unavailable' };
      this.container.dataset.state = result.status;
      this.container.dataset.updatedAt = String(result.timestamp || 0);
      delay = Math.max(1000, (result.nextUpdateAt || Date.now() + 60000) - Date.now());
      const region = this.location.status === 'available' ? 'Sua região' : 'Região padrão SP/RJ';
      if (result.status === 'live') this.status.textContent = `OpenSky · ${region} · ${this.flights.length} aeronaves · Posições ${new Date(result.timestamp).toLocaleTimeString('pt-BR')} · 60 s`;
      else this.status.textContent = `OpenSky · ${region} · ` + (result.status === 'limited' ? 'Limite da API atingido · Aguardando nova consulta' : result.status === 'connecting' ? 'Aguardando atualização da região' : 'Dados indisponíveis · Tentaremos novamente');
      this.draw();
    } catch {
      if (!this.enabled || generation !== this.generation) return;
      this.flights = []; this.container.dataset.state = 'offline'; this.status.textContent = 'OpenSky · Sem conexão · Tentaremos novamente'; this.draw();
    }
    if (this.enabled && generation === this.generation) this.timer = setTimeout(() => this.refresh(generation), delay);
  }
  resize() {
    if (!this.enabled) return;
    const { width, height } = this.container.getBoundingClientRect();
    this.width = width; this.height = height;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * ratio); this.canvas.height = Math.round(height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0); this.draw();
  }
  animate(time = 0) {
    if (!this.enabled) return;
    if (!this.lastFrame || time - this.lastFrame >= 50) { this.draw(time); this.lastFrame = time; }
    if (!this.motion.matches) this.frame = requestAnimationFrame(t => this.animate(t));
  }
  drawInterference(time = performance.now()) {
    const c = this.ctx, w = this.width, h = this.height;
    if (!this.noiseFrames.length) {
      // Small cached textures keep the TV grain inexpensive at any window size.
      for (let frame = 0; frame < 4; frame++) {
        const tile = document.createElement('canvas'); tile.width = tile.height = 128;
        const ctx = tile.getContext('2d'), pixels = ctx.createImageData(128, 128);
        for (let i = 0; i < pixels.data.length; i += 4) {
          const bright = Math.random() > .5;
          pixels.data[i] = bright ? 205 : 0;
          pixels.data[i + 1] = bright ? 230 : 0;
          pixels.data[i + 2] = bright ? 190 : 0;
          pixels.data[i + 3] = Math.floor(Math.random() * 24);
        }
        ctx.putImageData(pixels, 0, 0);
        this.noiseFrames.push(c.createPattern(tile, 'repeat'));
      }
    }
    c.save();
    if (this.motion.matches) this.interference = null;
    else if (time >= this.nextInterference) {
      this.interference = { until: time + 140 + Math.random() * 120, y: Math.random() * h * .9, height: 3 + Math.random() * 12, shift: (Math.random() > .5 ? 1 : -1) * (3 + Math.random() * 6) };
      this.nextInterference = time + 6000 + Math.random() * 8000;
    }
    const fault = this.interference;
    if (fault && time < fault.until) {
      // A brief horizontal tracking fault affects only the radar image.
      const ratio = this.canvas.width / w;
      c.drawImage(this.canvas, 0, fault.y * ratio, this.canvas.width, fault.height * ratio, fault.shift, fault.y, w, fault.height);
      c.fillStyle = '#cde6be10'; c.fillRect(0, fault.y, w, 1);
      c.fillStyle = '#00000022'; c.fillRect(0, fault.y + fault.height, w, 2);
    }
    c.fillStyle = this.noiseFrames[this.motion.matches ? 0 : Math.floor(time / 100) % this.noiseFrames.length];
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#00000012';
    for (let y = 0; y < h; y += 4) c.fillRect(0, y, w, 1);
    c.restore();
  }
  layoutCities(point) {
    const c = this.ctx, w = this.width, h = this.height, b = this.bounds;
    const lat = this.location.status === 'available' ? this.location.lat : (b.south + b.north) / 2;
    const lon = this.location.status === 'available' ? this.location.lon : (b.west + b.east) / 2;
    const key = [w, h, b.south, b.north, b.west, b.east, lat, lon].join(',');
    if (key === this.cityLayoutKey) return;
    this.cityLayoutKey = key; this.cityLabels = [];
    const nearby = this.cities.filter(city => city[1] >= b.west && city[1] <= b.east && city[2] >= b.south && city[2] <= b.north)
      .map(([name, x, y, population]) => {
        const distance = Math.hypot((x - lon) * Math.cos(lat * Math.PI / 180), y - lat) * 111;
        return { name: name.toLocaleUpperCase('pt-BR'), point: point(x, y), distance, score: Math.log10(Math.max(population, 1000)) / (1 + distance / 100) };
      }).sort((a, b) => a.distance - b.distance);
    // Reserve first choice for the closest city, then balance proximity and size.
    const closest = nearby.shift();
    nearby.sort((a, b) => b.score - a.score);
    if (closest) nearby.unshift(closest);
    const limit = Math.min(65, Math.max(12, Math.floor(w * h / 16000)));
    for (const city of nearby) {
      const [x, y] = city.point, width = c.measureText(city.name).width;
      if (x < 8 || y < 8 || x > w - 8 || y > h - 8) continue;
      // Try four label positions so dense groups remain readable on narrow modals.
      for (const [tx, ty] of [[x + 7, y + 3], [x - width - 7, y + 3], [x - width / 2, y - 8], [x - width / 2, y + 17]]) {
        const box = { left: Math.min(x - 4, tx - 4), right: Math.max(x + 4, tx + width + 4), top: Math.min(y - 4, ty - 12), bottom: Math.max(y + 4, ty + 5) };
        if (box.left < 4 || box.top < 4 || box.right > w - 4 || box.bottom > h - 4) continue;
        if (this.cityLabels.some(label => box.left < label.box.right && box.right > label.box.left && box.top < label.box.bottom && box.bottom > label.box.top)) continue;
        this.cityLabels.push({ name: city.name, x, y, tx, ty, box });
        break;
      }
      if (this.cityLabels.length >= limit) break;
    }
  }
  draw(time = 0) {
    const c = this.ctx, w = this.width, h = this.height;
    if (!w || !h) return;
    const b = this.bounds, merc = lat => Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, lat)) * Math.PI / 360)) * 180 / Math.PI;
    const north = merc(b.north), south = merc(b.south);
    const scale = Math.max(w / (b.east - b.west), h / (north - south));
    const point = (lon, lat) => [w / 2 + (lon - (b.east + b.west) / 2) * scale, h / 2 - (merc(lat) - (north + south) / 2) * scale];
    c.clearRect(0, 0, w, h); c.fillStyle = '#080f0d'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#19291e'; c.strokeStyle = '#76906180'; c.lineWidth = 1;
    for (const feature of this.map) {
      const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      c.beginPath();
      for (const polygon of polygons) for (const ring of polygon) { ring.forEach(([lon, lat], i) => { const [x, y] = point(lon, lat); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.closePath(); }
      c.fill('evenodd'); c.stroke();
    }
    c.strokeStyle = '#b8d48c19'; c.lineWidth = 1;
    for (let lon = Math.floor(b.west) - 1; lon <= b.east + 1; lon++) { const [x] = point(lon, 0); c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
    for (let lat = Math.floor(b.south) - 1; lat <= b.north + 1; lat++) { const [, y] = point(0, lat); c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    const [cx, cy] = point((b.west + b.east) / 2, (b.south + b.north) / 2), radius = Math.max(w, h) * .8;
    c.strokeStyle = '#b7d28f25';
    for (let r = scale; r < radius; r += scale) { c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke(); }
    // Decorative sweep; aircraft are drawn only at coordinates returned by OpenSky.
    const angle = this.motion.matches ? -.6 : (time / 18000) * Math.PI * 2;
    const sweep = c.createConicGradient(angle, cx, cy); sweep.addColorStop(0, '#b7e68924'); sweep.addColorStop(.12, '#b7e68900'); sweep.addColorStop(1, '#b7e68900');
    c.fillStyle = sweep; c.fillRect(0, 0, w, h);
    if (this.location.status === 'available') {
      const [x, y] = point(this.location.lon, this.location.lat);
      c.strokeStyle = '#e5f1c8'; c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2); c.moveTo(x - 11, y); c.lineTo(x + 11, y); c.moveTo(x, y - 11); c.lineTo(x, y + 11); c.stroke();
    }
    c.font = '10px Consolas, monospace'; c.fillStyle = '#b5c798bf';
    this.layoutCities(point);
    for (const { name, x, y, tx, ty } of this.cityLabels) {
      c.fillRect(x - 1.5, y - 1.5, 3, 3);
      c.save(); c.shadowColor = '#080f0d'; c.shadowBlur = 3;
      c.fillText(name, tx, ty); c.restore();
    }
    for (const flight of this.flights) {
      if (Date.now() - flight.positionAt > 120000) continue;
      const [x, y] = point(flight.lon, flight.lat); if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
      c.save(); c.translate(x, y); c.rotate(flight.heading * Math.PI / 180);
      c.fillStyle = '#d6ef9d'; c.shadowColor = '#caff88'; c.shadowBlur = 6;
      c.beginPath(); c.moveTo(0, -8); c.lineTo(2, -2); c.lineTo(8, 2); c.lineTo(8, 4); c.lineTo(2, 2); c.lineTo(2, 6); c.lineTo(4, 8); c.lineTo(0, 7); c.lineTo(-4, 8); c.lineTo(-2, 6); c.lineTo(-2, 2); c.lineTo(-8, 4); c.lineTo(-8, 2); c.lineTo(-2, -2); c.closePath(); c.fill(); c.restore();
      c.fillStyle = '#d6ef9db3'; c.fillText(flight.callsign, x + 11, y - 9);
    }
    this.drawInterference();
  }
};
