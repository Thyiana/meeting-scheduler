// Shared across index.html / guest.html / signage.html. Applies a
// data-theme attribute on <html> that style.css (and guest.css/signage.css)
// key their dark-mode overrides off of. Preference is remembered in
// localStorage per-browser; falls back to the OS-level prefers-color-scheme
// on first visit so a phone/laptop already in dark mode doesn't force the
// person to toggle it manually.
(function () {
  'use strict';
  const STORAGE_KEY = 'meeting-scheduler-theme';
  const root = document.documentElement;

  function systemPrefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function currentTheme() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
    return systemPrefersDark() ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
  }

  applyTheme(currentTheme());

  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(currentTheme());
    const btn = document.getElementById('themeToggleBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
    });
  });
})();
