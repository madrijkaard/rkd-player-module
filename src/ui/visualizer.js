'use strict';
// Only analyses the live stream of this app. No recording and no audio output.
window.LumenVisualizer = class {
  constructor(canvas, onStatus) {
    this.canvas = canvas; this.paint = canvas.getContext('2d'); this.onStatus = onStatus;
    this.style = 'bars'; this.enabled = true; this.visible = true; this.generation = 0;
    this.refreshColors();
    this.state = 'idle'; this.level = 0; this.phase = 0; this.last = 0; this.lastMetric = 0;
    this.stars = Array.from({ length: 30 }, (_, i) => ({ x: ((i * 97 + 31) % 419) / 419, y: ((i * 47 + 19) % 97) / 97 }));
    this.resize = new ResizeObserver(() => { const r = canvas.getBoundingClientRect(); this.width = r.width; this.height = r.height; const dpr = Math.min(devicePixelRatio, 2); canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); this.paint.setTransform(dpr, 0, 0, dpr, 0, 0); this.draw(); });
    this.resize.observe(canvas);
    window.addEventListener('pagehide', () => this.stop());
  }
  status(state, message) { this.state = state; this.canvas.dataset.state = state; this.canvas.title = message; this.onStatus(state, message); }
  refreshColors() {
    const colors = getComputedStyle(document.documentElement);
    this.activeColor = colors.getPropertyValue('--mint').trim() || '#a2efd5';
    this.idleColor = colors.getPropertyValue('--visualizer-idle').trim() || '#395c60';
    this.draw();
  }
  configure(enabled, style) {
    this.style = style; this.enabled = enabled;
    this.canvas.setAttribute('aria-label', `Visualizador de áudio: ${{ bars: 'Barras', wave: 'Ondas', aurora: 'Aurora', helix: 'DNA', constellation: 'Constelação', matrix: 'Matriz LED' }[style]}`);
    this.canvas.dataset.style = style;
    this.canvas.parentElement.hidden = !enabled;
    if (!enabled) this.stop();
    else if (this.state === 'off') this.status('idle', 'Selecione um vídeo para começar.');
    this.draw();
  }
  async start() {
    if (!this.enabled || this.stream || this.state === 'starting') return;
    const generation = ++this.generation;
    this.status('starting', 'Conectando ao áudio do player…');
    let stream, context;
    try {
      context = new AudioContext();
      // Both calls originate in the click that starts playback / enables this setting.
      const resumed = context.resume();
      resumed.catch(() => {});
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1, width: 1, height: 1 }, audio: { suppressLocalAudioPlayback: false, restrictOwnAudio: false } });
      await resumed;
      if (generation !== this.generation || !this.enabled) { stream.getTracks().forEach(t => t.stop()); await context.close(); return; }
      if (!stream.getAudioTracks().length) throw new Error('A captura não forneceu áudio.');
      // Display capture requires a video track, but only the audio is needed here.
      stream.getVideoTracks().forEach(track => track.stop());
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048; analyser.smoothingTimeConstant = .75;
      analyser.minDecibels = -85; analyser.maxDecibels = -20;
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser); // Do not connect to destination: prevents feedback/echo.
      this.stream = stream; this.context = context; this.source = source; this.analyser = analyser;
      this.frequency = new Uint8Array(analyser.frequencyBinCount);
      this.wave = new Float32Array(analyser.fftSize);
      stream.getAudioTracks()[0].addEventListener('ended', () => { if (this.stream === stream) { this.stop(); this.status('error', 'A captura de áudio foi interrompida. Tente ativar novamente.'); } });
      this.status('listening', 'Acompanhando o áudio deste player.');
      this.animate();
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (context && context.state !== 'closed') await context.close().catch(() => {});
      if (generation !== this.generation) return;
      this.status('error', 'Não foi possível captar o áudio. Clique em “Tentar ativar novamente”.');
      console.warn('Visualizador:', error.name, error.message);
    }
  }
  stop() {
    this.generation++;
    cancelAnimationFrame(this.animation); this.animation = null;
    const stream = this.stream; this.stream = null;
    stream?.getTracks().forEach(track => track.stop());
    this.source?.disconnect(); this.source = null;
    this.context?.close().catch(() => {}); this.context = null; this.analyser = null;
    this.frequency = null; this.wave = null; this.level = 0; this.last = 0;
    this.canvas.dataset.level = '0';
    this.status(this.enabled ? 'idle' : 'off', this.enabled ? 'Selecione um vídeo para começar.' : 'Visualizador desativado.');
    this.draw();
  }
  setVisible(visible) {
    this.visible = visible;
    if (!visible) { cancelAnimationFrame(this.animation); this.animation = null; this.last = 0; }
    else if (this.stream) this.animate();
  }
  animate() {
    if (this.animation || !this.visible || !this.stream) return;
    const frame = time => {
      this.animation = null;
      if (!this.visible || !this.analyser) return;
      if (time - this.last >= 1000 / 30) {
        const dt = Math.min((time - (this.last || time)) / 1000, .1); this.last = time;
        this.analyser.getByteFrequencyData(this.frequency);
        this.analyser.getFloatTimeDomainData(this.wave);
        this.level = Math.sqrt(this.wave.reduce((sum, value) => sum + value * value, 0) / this.wave.length);
        this.phase += dt * Math.min(this.level * 12, 2);
        if (time - this.lastMetric > 250) { this.canvas.dataset.level = this.level.toFixed(5); this.lastMetric = time; }
        this.draw();
      }
      this.animation = requestAnimationFrame(frame);
    };
    this.animation = requestAnimationFrame(frame);
  }
  band(i, count) {
    if (!this.frequency || this.level < .0005) return 0;
    const maxHz = Math.min(16000, this.context.sampleRate / 2);
    const low = 35 * Math.pow(maxHz / 35, i / count), high = 35 * Math.pow(maxHz / 35, (i + 1) / count);
    const bin = this.context.sampleRate / this.analyser.fftSize;
    let value = 0;
    for (let j = Math.max(1, Math.floor(low / bin)); j <= Math.min(this.frequency.length - 1, Math.ceil(high / bin)); j++) value = Math.max(value, this.frequency[j]);
    return value / 255;
  }
  draw() {
    const c = this.paint, w = this.width || 0, h = this.height || 0;
    c.clearRect(0, 0, w, h);
    if (!this.enabled || !w || !h) return;
    const active = this.level > .0005, mid = h / 2;
    c.strokeStyle = active ? this.activeColor : this.idleColor; c.fillStyle = active ? this.activeColor : this.idleColor; c.lineWidth = 1.4;
    if (this.style === 'bars') {
      const count = 48, gap = 3, width = (w - gap * (count - 1)) / count;
      for (let i = 0; i < count; i++) { const height = 2 + this.band(i, count) * (h - 8); c.globalAlpha = .35 + this.band(i, count) * .65; c.fillRect(i * (width + gap), (h - height) / 2, Math.max(width, 1), height); }
    } else if (this.style === 'wave') {
      const gain = Math.min(24, .4 / Math.max(.01, this.level));
      c.beginPath();
      for (let i = 0; i < 256; i++) { const sample = active ? this.wave[Math.floor(i * this.wave.length / 256)] : 0; const y = mid + Math.tanh(sample * gain) * (mid - 3); i ? c.lineTo(i * w / 255, y) : c.moveTo(0, y); }
      c.stroke();
    } else if (this.style === 'aurora') {
      // Translucent ribbons follow separate frequency bands across the title bar.
      for (let ribbon = 0; ribbon < 4; ribbon++) {
        const energy = this.band(ribbon, 4), amplitude = (mid - 3) * (.12 + energy * .75);
        c.globalAlpha = .12 + energy * .18;
        c.beginPath();
        for (let i = 0; i <= 120; i++) {
          const x = i * w / 120;
          const y = mid + Math.sin(i / 120 * Math.PI * (2 + ribbon) + this.phase + ribbon) * amplitude;
          i ? c.lineTo(x, y) : c.moveTo(x, y);
        }
        for (let i = 120; i >= 0; i--) {
          const y = mid + Math.sin(i / 120 * Math.PI * (2 + ribbon) + this.phase + ribbon + .6) * amplitude;
          c.lineTo(i * w / 120, y);
        }
        c.closePath(); c.fill(); c.stroke();
      }
    } else if (this.style === 'helix') {
      const count = 80, turns = Math.max(2, w / 220), amplitude = (mid - 4) * (.15 + Math.min(this.level * 8, 1) * .8);
      for (let strand = 0; strand < 2; strand++) {
        c.globalAlpha = strand ? .85 : .45; c.beginPath();
        for (let i = 0; i <= count; i++) {
          const y = mid + Math.sin(i / count * Math.PI * 2 * turns + this.phase * 2 + strand * Math.PI) * amplitude;
          i ? c.lineTo(i * w / count, y) : c.moveTo(0, y);
        }
        c.stroke();
      }
      for (let i = 0; i <= count; i += 2) {
        const x = i * w / count, offset = Math.sin(i / count * Math.PI * 2 * turns + this.phase * 2) * amplitude;
        c.globalAlpha = .15 + this.band(i / 2, count / 2 + 1) * .55;
        c.beginPath(); c.moveTo(x, mid - offset); c.lineTo(x, mid + offset); c.stroke();
      }
    } else if (this.style === 'constellation') {
      const points = this.stars.map((p, i) => {
        const power = this.band(i, 30);
        return { x: ((p.x + this.phase * .008) % 1) * w, y: mid + Math.sin(p.y * Math.PI * 2 + this.phase * .4) * (mid - 4) * (.4 + power * .6), power };
      });
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        for (let j = i + 1; j < points.length; j++) {
          const q = points[j], distance = Math.hypot(p.x - q.x, p.y - q.y), reach = Math.min(110, w / 7);
          if (distance >= reach) continue;
          c.globalAlpha = (1 - distance / reach) * (.1 + (p.power + q.power) * .25);
          c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke();
        }
        c.globalAlpha = .25 + p.power * .75;
        c.beginPath(); c.arc(p.x, p.y, 1 + p.power * 1.8, 0, Math.PI * 2); c.fill();
      }
    } else if (this.style === 'matrix') {
      const columns = 48, rows = Math.max(3, Math.floor((h - 4) / 6));
      const cellWidth = w / columns, cellHeight = (h - 4) / rows;
      for (let column = 0; column < columns; column++) {
        const power = this.band(column, columns), lit = Math.round(power * rows);
        for (let row = 0; row < rows; row++) {
          c.globalAlpha = row < lit ? .4 + row / rows * .6 : .07;
          c.fillRect(column * cellWidth + 1, h - 2 - (row + 1) * cellHeight, Math.max(1, cellWidth - 3), Math.max(1, cellHeight - 2));
        }
      }
    }
    c.globalAlpha = 1;
  }
};
