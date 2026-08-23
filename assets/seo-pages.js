(function () {
  'use strict';
  var root = document.documentElement;
  var toggle = document.getElementById('seo-theme-toggle');

  function savedTheme() {
    try { return localStorage.getItem('theme') || localStorage.getItem('ug_theme') || ''; }
    catch (e) { return ''; }
  }

  function applyTheme(theme) {
    var clean = theme === 'light' ? 'light' : 'dark';
    root.setAttribute('data-theme', clean);
    if (toggle) {
      toggle.setAttribute('aria-pressed', clean === 'light' ? 'true' : 'false');
      toggle.setAttribute('aria-label', clean === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
      toggle.innerHTML = '<i data-lucide="' + (clean === 'light' ? 'moon' : 'sun') + '"></i>';
    }
    document.querySelectorAll('.logo img').forEach(function (img) {
      img.src = clean === 'light' ? '/assets/brand-logo-light-fast.webp' : '/assets/brand-logo-fast.webp';
    });
    if (window.lucide) window.lucide.createIcons();
  }

  applyTheme(savedTheme() || (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  if (toggle) toggle.addEventListener('click', function () {
    var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    try { localStorage.setItem('theme', next); localStorage.setItem('ug_theme', next); } catch (e) {}
    applyTheme(next);
  });

  if (window.lucide) window.lucide.createIcons();
  else window.addEventListener('load', function () { if (window.lucide) window.lucide.createIcons(); }, { once: true });
})();
