'use strict';
window.LumenCyberpunkBackground = class {
  constructor(container, history = []) {
    this.container = container;
    this.dialogs = ['#library-dialog', '#video-dialog', '#settings-dialog', '#history-dialog'].map(selector => document.querySelector(selector));
    this.enabled = false;
    this.videoId = '';
    this.requestedId = '';
    this.generation = 0;
    this.historyIds = [...new Set(history.map(item => item.id).filter(id => typeof id === 'string' && /^[\w-]{11}$/.test(id)))];
    this.slideIndex = 0;
    this.hasSelection = false;
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
  }
  configure(theme) {
    this.enabled = theme === 'cyberpunk';
    clearTimeout(this.timer);
    if (!this.enabled) { this.generation++; this.requestedId = ''; return; }
    if (this.videoId) this.load(this.videoId);
    else this.showSlide();
  }
  selectVideo() {
    this.hasSelection = true;
    clearTimeout(this.timer);
    this.generation++; this.requestedId = '';
  }
  rememberVideo(id) {
    if (typeof id !== 'string' || !/^[\w-]{11}$/.test(id)) return;
    this.hasSelection = true;
    clearTimeout(this.timer);
    if (this.videoId !== id) { this.videoId = id; this.requestedId = ''; this.generation++; }
    this.load(id);
  }
  showSlide() {
    if (!this.enabled || this.hasSelection || !this.historyIds.length) return;
    const id = this.historyIds[this.slideIndex];
    this.slideIndex = (this.slideIndex + 1) % this.historyIds.length;
    this.load(id, () => {
      if (this.enabled && !this.hasSelection && this.historyIds.length > 1) {
        this.timer = setTimeout(() => this.showSlide(), 10000);
      }
    });
  }
  showImage(image, id) {
    const previous = this.container.lastElementChild;
    for (const child of [...this.container.children]) if (child !== previous) child.remove();
    this.container.append(image);
    if (previous && !this.motion.matches) {
      const fade = image.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 2000, easing: 'ease-in-out' });
      fade.onfinish = () => previous.remove();
    } else previous?.remove();
    this.container.dataset.videoId = id;
    this.container.classList.add('has-cover');
    for (const dialog of this.dialogs) {
      dialog.style.setProperty('--cyberpunk-cover', `url("${image.src}")`);
      dialog.classList.add('has-cyberpunk-cover');
    }
  }
  load(id, complete = () => {}) {
    if (!this.enabled) return;
    if (this.container.dataset.videoId === id) { complete(); return; }
    if (this.requestedId === id) return;
    const generation = ++this.generation;
    this.requestedId = id;
    const request = (quality) => {
      const image = new Image();
      image.alt = ''; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
      const failed = () => {
        if (generation !== this.generation) return;
        if (quality === 'maxresdefault') request('hqdefault');
        else { this.requestedId = ''; complete(); }
      };
      image.onload = () => {
        if (generation !== this.generation) return;
        // YouTube can return a tiny placeholder when a high-resolution cover is absent.
        if (image.naturalWidth <= 120) { failed(); return; }
        this.showImage(image, id);
        this.requestedId = '';
        complete();
      };
      image.onerror = failed;
      image.src = `https://i.ytimg.com/vi/${id}/${quality}.jpg`;
    };
    // Keep the previous cover visible until its replacement has loaded successfully.
    request('maxresdefault');
  }
};
