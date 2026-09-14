const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/ui/cyberpunk-background.js'), 'utf8');
const A = 'AAAAAAAAAAA', B = 'BBBBBBBBBBB', C = 'CCCCCCCCCCC';

function setup(ids = [], reduced = false) {
  const images = [], animations = [], timers = new Map();
  let now = 0, nextTimer = 0;
  const container = {
    children: [], dataset: {}, classList: { add() {} },
    get lastElementChild() { return this.children.at(-1); },
    append(image) { this.children.push(image); }
  };
  class Image {
    constructor() { images.push(this); }
    remove() { container.children = container.children.filter(image => image !== this); }
    animate(frames, options) { const animation = { frames, options }; animations.push(animation); return animation; }
  }
  const context = {
    window: {}, Image, matchMedia: () => ({ matches: reduced }),
    document: { querySelector: () => ({ style: { setProperty() {} }, classList: { add() {} } }) },
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  vm.runInNewContext(source, context);
  const background = new context.window.LumenCyberpunkBackground(container, ids.map(id => ({ id })));
  function tick(ms) {
    const end = now + ms;
    while (true) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now = end;
  }
  function loaded(image = images.at(-1), width = 1280) { image.naturalWidth = width; image.onload(); }
  return { background, container, images, animations, timers, tick, loaded };
}

test('history slideshow changes every 10 seconds and crossfades for 2 seconds', () => {
  const s = setup([A, B]); s.background.configure('cyberpunk'); s.loaded();
  assert.equal(s.container.dataset.videoId, A);
  s.tick(9999); assert.equal(s.images.length, 1);
  s.tick(1); assert.ok(s.images.at(-1).src.includes(B)); s.loaded();
  assert.equal(s.container.dataset.videoId, B);
  assert.equal(s.container.children.length, 2);
  assert.equal(s.animations[0].options.duration, 2000);
  assert.equal(s.animations[0].options.easing, 'ease-in-out');
  s.animations[0].onfinish(); assert.equal(s.container.children.length, 1);
  s.tick(10000); assert.ok(s.images.at(-1).src.includes(A));
});

test('selection cancels slideshow requests and playback retains its cover after timers advance', () => {
  const s = setup([A, B]); s.background.configure('cyberpunk'); s.loaded();
  s.tick(10000); const lateSlide = s.images.at(-1);
  s.background.selectVideo(); s.loaded(lateSlide);
  assert.equal(s.container.dataset.videoId, A);
  assert.equal(s.timers.size, 0);
  s.background.rememberVideo(C); s.loaded();
  s.tick(60000); s.background.rememberVideo(C);
  assert.equal(s.container.dataset.videoId, C);
  assert.equal(s.images.length, 3);
  assert.equal(s.timers.size, 0);
});

test('empty/single history, duplicate IDs and reduced motion avoid unnecessary cycling', () => {
  const empty = setup(['invalid']); empty.background.configure('cyberpunk'); empty.tick(60000);
  assert.equal(empty.images.length, 0);
  const single = setup([A, A]); single.background.configure('cyberpunk'); single.loaded(); single.tick(60000);
  assert.equal(single.images.length, 1);
  const reduced = setup([A, B], true); reduced.background.configure('cyberpunk'); reduced.loaded();
  reduced.tick(10000); reduced.loaded();
  assert.equal(reduced.animations.length, 0);
  assert.equal(reduced.container.children.length, 1);
});

test('missing covers fall back then skip; leaving Cyberpunk suspends the slideshow', () => {
  const s = setup([A, B]); s.background.configure('cyberpunk'); s.loaded();
  s.tick(10000); s.loaded(s.images.at(-1), 120);
  assert.ok(s.images.at(-1).src.endsWith('/hqdefault.jpg'));
  s.images.at(-1).onerror(); assert.equal(s.container.dataset.videoId, A);
  assert.equal(s.timers.size, 1);
  s.background.configure('military'); s.tick(60000);
  assert.equal(s.timers.size, 0);
  assert.equal(s.images.length, 3);
  s.background.configure('cyberpunk'); s.tick(10000);
  assert.ok(s.images.at(-1).src.includes(B));
});
