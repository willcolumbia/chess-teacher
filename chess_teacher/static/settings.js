"use strict";

// Look-and-feel settings (theme, accent color, board colors, coordinates, animation), kept in this browser.
// Every page loads this in <head>, before the stylesheet paints, so there's no flash of the wrong colors.
window.ChessSettings = (() => {
  const KEY = "lookSettings";

  // color: buttons and highlights; text: text on top of it; ink: the color as text on the light theme.
  const ACCENTS = {
    gold: { name: "Gold", color: "#e2b04a", text: "#1a1408", ink: "#8a6212" },
    blue: { name: "Blue", color: "#5c8fe0", text: "#0b1530", ink: "#2f62b8" },
    green: { name: "Green", color: "#74c05a", text: "#0d1f08", ink: "#3f7f2a" },
    coral: { name: "Coral", color: "#e07a5f", text: "#2a0f08", ink: "#b04a30" },
    purple: { name: "Purple", color: "#a78bfa", text: "#1a1033", ink: "#6d4fd0" },
  };
  const BOARDS = {
    walnut: { name: "Walnut", light: "#f0d9b5", dark: "#b58863" },
    green: { name: "Green", light: "#e9edcc", dark: "#6f8f4e" },
    blue: { name: "Blue", light: "#dfe6ea", dark: "#7f9cb0" },
    slate: { name: "Slate", light: "#d9dde2", dark: "#8b95a1" },
    rose: { name: "Rose", light: "#f1dcd6", dark: "#b67b72" },
  };
  const THEMES = ["dark", "light", "system"];
  const MOTION = { normal: 1, fast: 0.5, off: 0 }; // multiplies how long pieces take to slide
  const DEFAULTS = { theme: "dark", accent: "gold", board: "walnut", coords: true, motion: "normal" };

  const prefersLight = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

  function load() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {};
    } catch (e) {
      // storage unavailable: use the defaults
    }
    const s = { ...DEFAULTS, ...saved };
    if (!THEMES.includes(s.theme)) s.theme = DEFAULTS.theme;
    if (!ACCENTS[s.accent]) s.accent = DEFAULTS.accent;
    if (!BOARDS[s.board]) s.board = DEFAULTS.board;
    if (!(s.motion in MOTION)) s.motion = DEFAULTS.motion;
    s.coords = s.coords !== false;
    return s;
  }

  function soft(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  function apply(s = load()) {
    const root = document.documentElement;
    const theme = s.theme === "system" ? (prefersLight && prefersLight.matches ? "light" : "dark") : s.theme;
    const accent = ACCENTS[s.accent];
    const board = BOARDS[s.board];
    root.dataset.theme = theme;
    root.dataset.coords = s.coords ? "on" : "off";
    root.dataset.motion = s.motion;
    root.style.setProperty("--accent", accent.color);
    root.style.setProperty("--accent-text", accent.text);
    root.style.setProperty("--accent-ink", theme === "light" ? accent.ink : accent.color);
    root.style.setProperty("--accent-soft", soft(accent.color, theme === "light" ? 0.18 : 0.14));
    root.style.setProperty("--light-sq", board.light);
    root.style.setProperty("--dark-sq", board.dark);
  }

  function save(s) {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch (e) {
      // settings just won't be remembered
    }
  }

  function set(changes) {
    const s = { ...load(), ...changes };
    save(s);
    apply(s);
    return s;
  }

  function reset() {
    save(DEFAULTS);
    apply(DEFAULTS);
    return { ...DEFAULTS };
  }

  const motionScale = () => MOTION[document.documentElement.dataset.motion] ?? 1;

  apply();
  if (prefersLight && prefersLight.addEventListener) prefersLight.addEventListener("change", () => apply());
  window.addEventListener("storage", (e) => e.key === KEY && apply()); // changed in another tab

  return { ACCENTS, BOARDS, DEFAULTS, load, set, reset, apply, motionScale };
})();
