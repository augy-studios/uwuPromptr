// The prompter itself: scrolling, the clock, and the settings that shape
// how the text reads. It owns no markup of its own beyond the nodes handed
// to it, and it reports every change through onChange so the toolbar, the
// modals and the remote all read one state.

import { clampSetting, getSettings, saveSettings, SETTING_RANGES } from "./storage.js";

export class Prompter {
  constructor({ viewport, text, stage, onChange }) {
    this.viewport = viewport;
    this.text = text;
    // The focus arrows hang off the stage rather than the viewport, which
    // clips them at the two edges they sit on.
    this.stage = stage || viewport.parentElement;
    this.onChange = onChange || (() => {});

    this.settings = getSettings();
    this.playing = false;

    // Sub-pixel scroll position. scrollTop is an integer in most browsers,
    // so at slow speeds writing straight to it would round every frame to
    // zero and the text would never move. The fractional part lives here.
    this.offset = 0;
    this.lastFrame = 0;
    this.frame = null;

    this.elapsed = 0;
    this.startedAt = 0;
    this.wakeLock = null;

    this.tick = this.tick.bind(this);

    // A person who scrolls by hand while paused should not be yanked back
    // to where the engine thinks it was on the next play.
    this.viewport.addEventListener("scroll", () => {
      if (!this.playing) this.offset = this.viewport.scrollTop;
    }, { passive: true });

    this.apply();
  }

  /* ---- settings ---- */

  get(name) {
    return this.settings[name];
  }

  set(name, value, { silent = false } = {}) {
    const next = name in SETTING_RANGES ? clampSetting(name, value) : value;
    if (this.settings[name] === next) return next;

    this.settings[name] = next;
    saveSettings(this.settings);
    this.apply();
    if (!silent) this.onChange(this.state());
    return next;
  }

  // Put one setting back to what it ships as. Returns the value, so a caller
  // can say what it did without looking it up again.
  resetSetting(name) {
    const range = SETTING_RANGES[name];
    if (!range) return this.settings[name];
    return this.set(name, range.default);
  }

  isDefault(name) {
    const range = SETTING_RANGES[name];
    if (!range) return true;
    return this.settings[name] === range.default;
  }

  nudge(name, direction, coarse = false) {
    const range = SETTING_RANGES[name];
    if (!range) return;
    const step = coarse ? range.coarse : range.step;
    return this.set(name, this.settings[name] + step * direction);
  }

  apply() {
    const s = this.settings;
    const t = this.text.style;

    t.fontSize = `${s.fontSize}px`;
    t.lineHeight = String(s.lineHeight);
    t.paddingLeft = `${s.margin}%`;
    t.paddingRight = `${s.margin}%`;

    // Both flips are one transform on the text, not on the viewport: the
    // viewport is what scrolls, and flipping it would invert the scroll
    // direction along with the glyphs.
    const scaleX = s.flipX ? -1 : 1;
    const scaleY = s.flipY ? -1 : 1;
    t.transform = scaleX === 1 && scaleY === 1 ? "" : `scale(${scaleX}, ${scaleY})`;

    this.stage.classList.toggle("show-focus", Boolean(s.focusLine));
    this.stage.style.setProperty("--focus-position", `${s.focusPosition}%`);
  }

  state() {
    return {
      ...this.settings,
      playing: this.playing,
      elapsed: this.elapsedMs(),
      progress: this.progress(),
    };
  }

  /* ---- transport ---- */

  play() {
    if (this.playing) return;
    if (this.atEnd()) this.rewind();

    this.playing = true;
    this.lastFrame = 0;
    this.startedAt = performance.now();
    this.frame = requestAnimationFrame(this.tick);
    this.requestWakeLock();
    this.onChange(this.state());
  }

  pause() {
    if (!this.playing) return;

    this.playing = false;
    this.elapsed = this.elapsedMs();
    this.startedAt = 0;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.releaseWakeLock();
    this.onChange(this.state());
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  reset() {
    this.pause();
    this.rewind();
    this.elapsed = 0;
    this.onChange(this.state());
  }

  rewind() {
    this.offset = 0;
    this.viewport.scrollTop = 0;
  }

  atEnd() {
    const max = this.viewport.scrollHeight - this.viewport.clientHeight;
    return max <= 0 || this.viewport.scrollTop >= max - 1;
  }

  progress() {
    const max = this.viewport.scrollHeight - this.viewport.clientHeight;
    if (max <= 0) return 0;
    return Math.min(100, Math.max(0, (this.viewport.scrollTop / max) * 100));
  }

  // Jump to a point in the script, as a percentage. What the remote's
  // scrubber sends.
  seek(percent) {
    const max = this.viewport.scrollHeight - this.viewport.clientHeight;
    this.offset = Math.max(0, Math.min(max, (max * percent) / 100));
    this.viewport.scrollTop = this.offset;
    this.onChange(this.state());
  }

  tick(now) {
    if (!this.playing) return;

    // The first frame after play has no previous timestamp to measure
    // against; skipping it avoids a jump proportional to however long the
    // tab was idle.
    if (this.lastFrame) {
      const delta = (now - this.lastFrame) / 1000;
      // Speed is lines-per-minute-ish: pixels per second scale with the
      // font size, so raising the font does not silently slow the read.
      const pixelsPerSecond = (this.settings.speed * this.settings.fontSize) / 12;
      this.offset += pixelsPerSecond * delta;
      this.viewport.scrollTop = this.offset;

      if (this.atEnd()) {
        this.pause();
        return;
      }
    }

    this.lastFrame = now;
    this.frame = requestAnimationFrame(this.tick);
  }

  /* ---- clock ---- */

  elapsedMs() {
    if (!this.playing || !this.startedAt) return this.elapsed;
    return this.elapsed + (performance.now() - this.startedAt);
  }

  /* ---- screen wake lock ---- */

  // Nobody wants the screen to sleep mid-take. Unsupported browsers and a
  // refused request are both fine: the prompter carries on either way.
  async requestWakeLock() {
    if (!("wakeLock" in navigator) || this.wakeLock) return;
    try {
      this.wakeLock = await navigator.wakeLock.request("screen");
      this.wakeLock.addEventListener("release", () => {
        this.wakeLock = null;
      });
    } catch {
      this.wakeLock = null;
    }
  }

  releaseWakeLock() {
    if (!this.wakeLock) return;
    this.wakeLock.release().catch(() => {});
    this.wakeLock = null;
  }
}

export function formatElapsed(ms) {
  const total = Math.floor(ms / 1000);
  const hours = String(Math.floor(total / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

// Text pasted out of a word processor arrives full of smart quotes, hard
// line breaks mid-sentence and non-breaking spaces, all of which read badly
// once the font is 60px tall. This is the same cleanup the reference app
// does on paste.
export function cleanPastedText(raw) {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
