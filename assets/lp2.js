/* ==========================================================================
   UndressGoon — landing variant B (lp2) behaviour.

   Two jobs, both purely presentational — no product/auth/payment logic here,
   site.js still owns the whole funnel:

   1. Force the black theme. lp2 is a paid-traffic page and must always look
      the same, so a visitor's saved light-theme preference is ignored here.
   2. Turn the result panel into a POPUP. The panel still lives in the DOM
      (site.js needs .result-panel / #web-results / #web-result-empty), it's
      just parked inside a modal that opens when a generation starts and when
      results land — so the page itself never shows a big empty result box.
   ========================================================================== */
(function () {
  'use strict';

  // ---- 1. Lock the page to the black theme -------------------------------
  function forceDark() {
    if (document.documentElement.getAttribute('data-theme') !== 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }
  forceDark();
  // site.js's initTheme() runs later and may apply a saved 'light' choice —
  // watch the attribute and put it back.
  try {
    new MutationObserver(forceDark).observe(document.documentElement, {
      attributes: true, attributeFilter: ['data-theme']
    });
  } catch (e) { /* observer unsupported — the inline attribute still applies */ }

  // ---- 2. Result popup ----------------------------------------------------
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    var modal = document.getElementById('lp2-result-modal');
    var form = document.getElementById('web-generate-form');
    if (!modal) return;

    function open() {
      if (!modal.hidden) return;
      modal.hidden = false;
      document.body.classList.add('modal-open');
      // setTimeout, not requestAnimationFrame: rAF is throttled to a stop in a
      // backgrounded tab, which would leave the overlay at opacity 0 while it
      // still swallows clicks. Matches site.js's own modal timing.
      window.setTimeout(function () { modal.classList.add('is-open'); }, 20);
      if (window.UG_REFRESH_ICONS) window.UG_REFRESH_ICONS();
    }
    function close() {
      if (modal.hidden) return;
      modal.classList.remove('is-open');
      document.body.classList.remove('modal-open');
      window.setTimeout(function () { modal.hidden = true; }, 180);
    }

    modal.querySelectorAll('[data-close-result]').forEach(function (el) {
      el.addEventListener('click', close);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });

    // Open as soon as a generation is actually submitted. Use the capture
    // phase so we run before site.js's own submit handler, and only open when
    // the form is really going to run (photo + consent present) — otherwise a
    // validation error would pop an empty modal.
    if (form) {
      form.addEventListener('submit', function () {
        var consent = document.getElementById('web-consent');
        var file = document.getElementById('person-photo');
        var hasPhoto = !!(file && file.files && file.files.length);
        if (hasPhoto && consent && consent.checked) open();
      }, true);
    }

    // ---- Mobile: move the trust strip below the generator so the upload
    // zone is reachable with one short scroll. Pure DOM relocation of an
    // already-translated block; moved back on desktop.
    var trust = document.querySelector('.lp2-col-pitch .lp2-trust');
    var pitch = document.querySelector('.lp2-col-pitch');
    var genCol = document.querySelector('.lp2-col-gen');
    if (trust && pitch && genCol && window.matchMedia) {
      var slot = document.createElement('div');
      slot.className = 'lp2-trust-mobile';
      genCol.appendChild(slot);
      var mq = window.matchMedia('(max-width: 980px)');
      var place = function () {
        if (mq.matches) { if (trust.parentNode !== slot) slot.appendChild(trust); }
        else if (trust.parentNode !== pitch) pitch.appendChild(trust);
      };
      place();
      if (mq.addEventListener) mq.addEventListener('change', place);
      else if (mq.addListener) mq.addListener(place);
      window.addEventListener('resize', place);  // belt-and-braces
    }

    // Safety net: if results or the loader appear by any other path (e.g. a
    // restored session), surface the popup too.
    var results = document.getElementById('web-results');
    if (results) {
      try {
        new MutationObserver(function () {
          if (results.children.length) open();
        }).observe(results, { childList: true });
      } catch (e) { /* no-op */ }
    }
  });
})();
