'use strict';
window.LumenSpaceBackground = class {
  constructor(container, status, origin) {
    this.container = container; this.status = status; this.origin = origin;
    this.home = container.parentElement;
    // The add-channel dialog can open on top of the library.
    this.dialogs = ['#video-dialog', '#history-dialog', '#settings-dialog', '#library-dialog'].map(selector => document.querySelector(selector));
    this.enabled = false; this.frame = null;
    this.modalObserver = new MutationObserver(() => this.placeBackground());
    for (const dialog of this.dialogs) this.modalObserver.observe(dialog, { attributes: true, attributeFilter: ['open'] });
    window.addEventListener('message', event => {
      if (event.origin !== this.origin || event.source !== this.frame?.contentWindow || event.data?.source !== 'lumen-space') return;
      if (event.data.type === 'playing') {
        clearTimeout(this.timeout); this.timeout = null;
        this.container.classList.add('is-playing');
        this.status.textContent = 'ISS · Sen · Ao vivo';
      } else if (event.data.type === 'unavailable') this.fallback();
      else if (event.data.type === 'buffering' && !this.timeout) this.timeout = setTimeout(() => this.fallback(), 25000);
    });
    window.addEventListener('offline', () => { if (this.enabled) this.fallback(); });
    window.addEventListener('online', () => { if (this.enabled) this.start(); });
  }
  configure(theme, minimized) {
    this.enabled = theme === 'space' && !minimized;
    this.status.hidden = theme !== 'space';
    this.placeBackground();
    if (this.enabled) { if (!this.frame && !this.retry) this.start(); }
    else this.stop();
  }
  placeBackground() {
    const revision = this.moveRevision = (this.moveRevision || 0) + 1;
    const target = this.enabled && this.dialogs.find(dialog => dialog.open);
    const move = () => {
      const host = target || this.home;
      // moveBefore preserves the live iframe and its playback during reparenting.
      if (this.container.parentElement !== host) host.moveBefore(this.container, host.firstChild);
      for (const dialog of this.dialogs) dialog.classList.toggle('has-space-background', dialog === host);
    };
    if (!target && this.dialogs.includes(this.container.parentElement) && this.enabled) {
      const transitions = this.container.parentElement.getAnimations().filter(animation => animation.playState === 'running');
      if (transitions.length) {
        // Preserve the live iframe until the holographic exit has finished.
        Promise.allSettled(transitions.map(animation => animation.finished)).then(() => {
          if (revision === this.moveRevision) this.placeBackground();
        });
        return;
      }
    }
    move();
  }
  stop() {
    clearTimeout(this.timeout); clearTimeout(this.retry); this.timeout = this.retry = null;
    this.frame?.remove(); this.frame = null;
    this.container.classList.remove('is-playing');
  }
  start() {
    this.stop();
    if (!this.enabled) return;
    if (!navigator.onLine) { this.fallback(); return; }
    this.status.textContent = 'ISS · Conectando à transmissão…';
    const frame = document.createElement('iframe');
    frame.title = 'Transmissão da ISS por Sen, sem som'; frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.allow = 'autoplay; encrypted-media';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.addEventListener('load', () => {
      if (this.frame === frame) frame.contentWindow.postMessage({ source: 'lumen-space-host', type: 'hello' }, this.origin);
    });
    this.frame = frame; frame.src = `${this.origin}/space-player.html`;
    this.container.append(frame);
    this.timeout = setTimeout(() => this.fallback(), 25000);
  }
  fallback() {
    this.stop();
    if (!this.enabled) return;
    this.status.textContent = 'ISS · Transmissão indisponível';
    this.retry = setTimeout(() => { this.retry = null; this.start(); }, 60000);
  }
};
