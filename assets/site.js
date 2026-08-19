/**
 * UndressGoon — fast gallery + conversion helpers
 * Images: hard-coded list of WebP thumbs (no sequential probing)
 */
(function () {
  'use strict';

  var CFG = window.UG_CONFIG || {};
  var IMAGE_COUNT = CFG.imageCount || 22;
  var THUMB_EXT = CFG.thumbExt || '.webp';
  var BOT_URL = CFG.botUrl || 'https://t.me/goonmasterbotbot?start=web';
  var ETA_SECONDS = Number(CFG.etaSeconds || 30);
  var i18n = CFG.i18n || {};
  var currentSession = null;
  var telegramLinkPoll = 0;
  var checkoutCreditPoll = 0;
  var packOffer = null;
  var discountCode = '';
  var discountOffer = null;
  var discountFromUrl = false;  // URL/campaign codes persist; typed codes are session-only
  var firstGenerationDone = false;
  var exitOfferArmed = false;

  function track(event, properties) {
    if (typeof window.ugTrack === 'function') {
      window.ugTrack(event, properties || {});
    }
  }

  function selectedModeValue() {
    var mode = document.querySelector('input[name="mode"]:checked');
    return mode ? mode.value : 'prompt';
  }

  function t(key, fallback) {
    return i18n && Object.prototype.hasOwnProperty.call(i18n, key) ? i18n[key] : fallback;
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[ch];
    });
  }

  function formatCredits(count) {
    var n = Number(count || 0);
    var template = n === 1 ? t('creditSingular', '{n} credit available') : t('creditPlural', '{n} credits available');
    return template.replace('{n}', String(n));
  }

  function pluralizeImage(count) {
    return Number(count || 1) === 1 ? t('imageSingular', 'image') : t('imagePlural', 'images');
  }

  function cleanDiscountCode(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);
  }

  function initDiscountCode() {
    // Legacy purge: older builds persisted the code in localStorage, so a
    // one-time campaign code (e.g. COMEBACK20) stuck to EVERY future checkout
    // and silently inflated credits. Discount codes are now session-scoped.
    try { localStorage.removeItem('ug_discount_code'); } catch (e) {}
    var params;
    try { params = new URLSearchParams(location.search || ''); } catch (e) { params = null; }
    var fromUrl = params ? cleanDiscountCode(params.get('discount') || params.get('coupon') || '') : '';
    if (fromUrl) {
      discountCode = fromUrl;
      discountFromUrl = true;
      try { sessionStorage.setItem('ug_discount_code', discountCode); } catch (e) {}
      setTimeout(function () {
        setStatus(t('discountSaved', 'Discount saved. It will apply at checkout if eligible.'), 'success');
        updateDiscountUi();
      }, 600);
      return;
    }
    // A stored code lives only for this browsing session (a campaign visit).
    try { discountCode = cleanDiscountCode(sessionStorage.getItem('ug_discount_code') || ''); } catch (e) {}
    if (discountCode) discountFromUrl = true;
    updateDiscountUi();
  }

  function checkoutPayload(code) {
    var payload = { code: code };
    if (discountCode) payload.discountCode = discountCode;
    return payload;
  }

  function updateDiscountUi(message, tone) {
    var input = document.getElementById('discount-code');
    var note = document.getElementById('discount-note');
    if (input && document.activeElement !== input) input.value = discountCode || '';
    if (note) {
      note.textContent = message || (discountCode ? t('discountReady', 'Code ready for checkout.') : '');
      note.className = tone ? ('discount-note ' + tone) : 'discount-note';
    }
    updateModalPromo();
    updatePackPrices();
  }

  function saveDiscountCode(value) {
    var clean = cleanDiscountCode(value);
    if (!clean) {
      discountCode = '';
      discountOffer = null;
      try { sessionStorage.removeItem('ug_discount_code'); } catch (e) {}
      updateDiscountUi(t('discountCleared', 'Discount code cleared.'), '');
      return Promise.resolve(false);
    }
    updateDiscountUi(t('checkingDiscount', 'Checking code...'), 'working');
    return fetch(apiUrl('/web/discount/validate'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discountCode: clean })
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (payload) {
          if (!res.ok || !payload.ok) throw new Error(payload.message || t('discountCheckFail', 'Could not check this code.'));
          return payload;
        });
      })
      .then(function (payload) {
        if (!payload.valid) {
          discountCode = '';
          discountOffer = null;
          try { sessionStorage.removeItem('ug_discount_code'); } catch (e) {}
          updateDiscountUi(payload.message || t('discountInvalid', 'Invalid code.'), 'error');
          return false;
        }
        discountCode = cleanDiscountCode(payload.code || clean);
        discountOffer = {
          code: discountCode,
          percentOff: Number(payload.percentOff || 0),
          bonusPercent: Number(payload.bonusPercent || 0)
        };
        // Typed codes are session-only (not persisted) so the field is empty on
        // reopen; only URL/campaign codes persist across page loads.
        var label = payload.percentOff ? (payload.percentOff + '% off applied.') :
          (payload.bonusPercent ? ('+' + payload.bonusPercent + '% bonus credits applied.') : (payload.message || 'Discount applied.'));
        updateDiscountUi(label, 'success');
        return true;
      })
      .catch(function (err) {
        updateDiscountUi(err.message || t('discountCheckFail', 'Could not check this code.'), 'error');
        return false;
      });
  }

  function saveDiscountCodeLocal(value) {
    discountCode = cleanDiscountCode(value);
    discountOffer = null;
    try {
      if (discountCode) sessionStorage.setItem('ug_discount_code', discountCode);
      else sessionStorage.removeItem('ug_discount_code');
    } catch (e) {}
    updateDiscountUi(
      discountCode ? t('discountReady', 'Code ready for checkout.') : t('discountCleared', 'Discount code cleared.'),
      discountCode ? 'success' : ''
    );
  }

  function formatMoneyFromCents(cents) {
    var amount = Math.max(0, Number(cents || 0)) / 100;
    return '$' + amount.toFixed(2);
  }

  function packAmountCents(pack) {
    if (!pack) return 0;
    if (pack.amountCents != null) return Number(pack.amountCents || 0);
    if (pack.amount_cents != null) return Number(pack.amount_cents || 0);
    var parsed = String(pack.price || '').replace(/[^0-9.]/g, '');
    return Math.round(Number(parsed || 0) * 100);
  }

  function discountedAmountCents(pack) {
    var cents = packAmountCents(pack);
    var percent = Number(discountOffer && discountOffer.percentOff || 0);
    if (!discountCode || !percent) return cents;
    return Math.max(0, Math.round(cents * (100 - percent) / 100));
  }

  function packPriceHtml(pack) {
    var original = packAmountCents(pack);
    var discounted = discountedAmountCents(pack);
    if (discountCode && discountOffer && Number(discountOffer.percentOff || 0) > 0 && discounted < original) {
      return '<span class="pack-price discounted"><s>' + esc(formatMoneyFromCents(original)) + '</s><b>' + esc(formatMoneyFromCents(discounted)) + '</b></span>';
    }
    return '<span class="pack-price">' + esc(pack.price || formatMoneyFromCents(original)) + '</span>';
  }

  function updatePackPrices() {
    var grid = document.getElementById('pack-grid');
    if (!grid || !packOffer || !packOffer.packs) return;
    grid.querySelectorAll('.pack-card[data-pack-code]').forEach(function (card) {
      var code = card.getAttribute('data-pack-code');
      var pack = (packOffer.packs || []).find(function (item) { return String(item.code) === code; });
      var price = card.querySelector('.pack-price');
      if (pack && price) price.outerHTML = packPriceHtml(pack);
    });
  }

  function userLabel(user) {
    if (!user) return t('myAccount', 'My account');
    return user.name || user.firstName || user.email || user.username || t('myAccount', 'My account');
  }

  function userInitial(user) {
    var label = userLabel(user).trim();
    return (label ? label.charAt(0) : 'U').toUpperCase();
  }

  // Resolve paths for both https://undressgoon.app/ and file:///.../index.html
  // Prefer explicit UG_CONFIG.thumbBase; else derive from this script's src attribute.
  function detectThumbBase() {
    if (CFG.thumbBase) return CFG.thumbBase;

    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].getAttribute('src') || '';
      if (src.indexOf('site.js') === -1) continue;
      // "assets/site.js" -> "results/thumbs/"
      // "../assets/site.js" -> "../results/thumbs/"
      // "/assets/site.js" -> "/results/thumbs/"
      var prefix = src.replace(/assets\/site\.js(\?.*)?$/, '');
      return prefix + 'results/thumbs/';
    }

    var path = (location.pathname || '').replace(/\\/g, '/');
    if (/\/(es|pt|fr|de|ru|zh|ja)(\/index\.html)?$/i.test(path)) {
      return '../results/thumbs/';
    }
    return 'results/thumbs/';
  }

  var THUMB_BASE = detectThumbBase();

  function thumbUrl(n) {
    return THUMB_BASE + n + THUMB_EXT;
  }

  function nums() {
    var a = [];
    for (var i = 1; i <= IMAGE_COUNT; i++) a.push(i);
    return a;
  }

  function onImgLoad(img, card) {
    if (img.complete && img.naturalWidth) {
      img.classList.add('loaded');
      if (card) card.classList.add('has-img');
      return;
    }
    img.addEventListener('load', function () {
      img.classList.add('loaded');
      if (card) card.classList.add('has-img');
    }, { once: true });
    img.addEventListener('error', function () {
      if (card) card.classList.add('has-img');
    }, { once: true });
  }

  function buildMarquee() {
    var marquee = document.getElementById('marquee');
    if (!marquee) return;

    var ids = nums();

    function cardHtml(n, eager) {
      var alt = i18n.imgAlt || 'AI undress result';
      var src = thumbUrl(n);
      var imgSource = eager ? 'src="' + src + '"' : 'data-src="' + src + '"';
      return (
        '<div class="result-card" data-n="' + n + '">' +
          '<img ' + imgSource + ' alt="' + alt + '" width="480" height="600" ' +
            'decoding="async" loading="' + (eager ? 'eager' : 'lazy') + '" ' +
            (eager ? 'fetchpriority="high" ' : '') + '/>' +
        '</div>'
      );
    }

    // First 4 paint immediately; rest hydrate when near viewport. Duplicate track for loop.
    var html = ids.map(function (n, idx) { return cardHtml(n, idx < 4); }).join('');
    marquee.innerHTML = html + html;

    function hydrateCard(card) {
      var img = card.querySelector('img');
      if (!img) return;
      var pendingSrc = img.getAttribute('data-src');
      if (pendingSrc) {
        img.setAttribute('src', pendingSrc);
        img.removeAttribute('data-src');
      }
      onImgLoad(img, card);
    }

    var lazyCards = [];
    marquee.querySelectorAll('.result-card').forEach(function (card) {
      var img = card.querySelector('img');
      if (!img) return;
      if (img.getAttribute('src')) hydrateCard(card);
      else lazyCards.push(card);
    });

    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          hydrateCard(entry.target);
        });
      }, { rootMargin: '600px 800px' });
      lazyCards.forEach(function (card) { observer.observe(card); });
    } else {
      window.setTimeout(function () {
        lazyCards.forEach(hydrateCard);
      }, 1200);
    }
  }

  // Sticky bottom CTA after scroll
  function initSticky() {
    var bar = document.getElementById('sticky-cta');
    if (!bar) return;
    var shown = false;
    function check() {
      var y = window.scrollY || document.documentElement.scrollTop;
      if (y > 380) {
        if (!shown) { bar.classList.add('show'); shown = true; }
      } else if (shown) {
        bar.classList.remove('show');
        shown = false;
      }
    }
    window.addEventListener('scroll', check, { passive: true });
    check();
  }

  // Live "generating now" counter for soft social proof.
  function initLiveCounter() {
    var el = document.getElementById('live-count');
    if (!el) return;
    var base = 18 + Math.floor(Math.random() * 22); // 18-39
    el.textContent = String(base);

    setInterval(function () {
      var delta = Math.floor(Math.random() * 5) - 2; // -2..+2
      base = Math.max(12, Math.min(64, base + delta));
      el.textContent = String(base);
    }, 3500 + Math.floor(Math.random() * 2000));
  }

  // Soft re-engagement toast once per session
  function initToast() {
    var toast = document.getElementById('reengage-toast');
    if (!toast) return;
    try {
      if (sessionStorage.getItem('ug_toast')) return;
    } catch (e) { /* private mode */ }

    setTimeout(function () {
      if (currentSession && currentSession.user) return;
      if ((window.scrollY || 0) < 200) return;
      toast.classList.add('show');
      try { sessionStorage.setItem('ug_toast', '1'); } catch (e) {}
      setTimeout(function () { toast.classList.remove('show'); }, 8000);
    }, 22000);
  }

  function shouldShowExitOffer() {
    if (!firstGenerationDone) return false;
    try {
      if (sessionStorage.getItem('ug_exit_offer_seen')) return false;
    } catch (e) {}
    var panel = document.getElementById('checkout-panel');
    return !(panel && !panel.hidden);
  }

  function isFirstResultOfferEligible() {
    var gens = currentSession && currentSession.user && Number(currentSession.user.successfulGenerations);
    return Number.isFinite(gens) && gens === 0;
  }

  function showExitOffer() {
    if (!shouldShowExitOffer()) return false;
    try { sessionStorage.setItem('ug_exit_offer_seen', '1'); } catch (e) {}
    showCheckout(true, 'exit_post_gen');
    return true;
  }

  function armExitOffer() {
    if (exitOfferArmed) return;
    exitOfferArmed = true;
    document.addEventListener('mouseout', function (event) {
      if (event.relatedTarget || event.toElement) return;
      if (event.clientY > 8) return;
      showExitOffer();
    });
    if (window.history && window.history.pushState) {
      try { window.history.pushState({ ugExitGuard: true }, '', location.href); } catch (e) {}
      window.addEventListener('popstate', function () {
        if (showExitOffer()) {
          try { window.history.pushState({ ugExitGuard: true }, '', location.href); } catch (e) {}
        }
      });
    }
  }

  // Preload first few thumbs for instant marquee paint
  function preloadCritical() {
    for (var i = 1; i <= 4; i++) {
      var link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'image';
      link.href = thumbUrl(i);
      link.type = 'image/webp';
      document.head.appendChild(link);
    }
  }

  function normalizeCtas() {
    // On the generator page scroll to #generate; on pages without a generator
    // (e.g. referral.html) send the visitor to the index generator instead.
    var target = document.getElementById('generate') ? '#generate' : 'index.html#generate';
    document.querySelectorAll('[data-generate-cta]').forEach(function (a) {
      a.setAttribute('href', target);
      a.removeAttribute('target');
      a.removeAttribute('rel');
    });
  }

  function initLanguageSwitch() {
    document.querySelectorAll('.lang-switch select').forEach(function (select) {
      if (select.dataset.bound) return;
      select.dataset.bound = '1';
      select.addEventListener('change', function () {
        if (!select.value) return;
        // Remember the manual choice so auto-detect never overrides it again,
        // and carry ad-attribution query params across the language switch.
        try {
          var m = select.value.match(/\/(es|pt|zh|ja|ru|fr|de)\//i);
          localStorage.setItem('ug_lang', m ? m[1].toLowerCase() : 'en');
        } catch (e) {}
        var join = select.value.indexOf('?') === -1 ? '?' : '&';
        var qs = (location.search || '').replace(/^\?/, '');
        window.location.href = qs ? select.value + join + qs : select.value;
      });
    });
  }

  function apiUrl(path) {
    var base = (CFG.apiBase || '').replace(/\/$/, '');
    return base + path;
  }

  function setStatus(text, tone) {
    var el = document.getElementById('web-status');
    if (!el) return;
    el.textContent = text || '';
    el.dataset.tone = tone || '';
  }

  function ensureGenerationLoader() {
    var panel = document.querySelector('.result-panel');
    if (!panel) return null;
    var loader = document.getElementById('generation-loader');
    if (loader) return loader;
    loader = document.createElement('div');
    loader.className = 'generation-loader';
    loader.id = 'generation-loader';
    loader.hidden = true;
    loader.setAttribute('aria-live', 'polite');
    loader.innerHTML =
      '<div class="gen-orbit" aria-hidden="true"><span></span></div>' +
      '<div class="gen-loader-copy">' +
        '<strong id="gen-loader-title"></strong>' +
        '<span id="gen-loader-sub"></span>' +
      '</div>' +
      '<div class="gen-progress" aria-hidden="true"><span id="gen-progress-bar"></span></div>';
    panel.insertBefore(loader, panel.firstChild);
    return loader;
  }

  function updateGenerationLoader(phase, startedAt) {
    var loader = ensureGenerationLoader();
    var empty = document.getElementById('web-result-empty');
    if (!loader) return;
    var elapsed = Math.max(0, Math.round((Date.now() - (startedAt || Date.now())) / 1000));
    var title = document.getElementById('gen-loader-title');
    var sub = document.getElementById('gen-loader-sub');
    var bar = document.getElementById('gen-progress-bar');
    var label = t('genRunningTitle', 'Generating your image');
    var detail = t('genRunningSub', '{elapsed}s elapsed. Typical wait is {eta}s, sometimes a little longer.')
      .replace('{elapsed}', String(elapsed))
      .replace('{eta}', String(ETA_SECONDS));
    var progress = Math.min(96, 18 + Math.round((elapsed / Math.max(ETA_SECONDS, 1)) * 72));
    if (phase === 'preparing') {
      label = t('genPreparingTitle', 'Preparing your upload');
      detail = t('genPreparingSub', 'Reading your photo and starting the AI job.');
      progress = 5;
    } else if (phase === 'queued') {
      label = t('genQueuedTitle', 'Queued for generation');
      detail = t('genQueuedSub', 'Your photo is uploaded. The AI will start in a moment.');
      progress = 9;
    }
    if (title) title.textContent = label;
    if (sub) sub.textContent = detail;
    if (bar) bar.style.width = progress + '%';
    loader.hidden = false;
    if (empty) empty.hidden = true;
  }

  function hideGenerationLoader(showEmpty) {
    var loader = document.getElementById('generation-loader');
    var empty = document.getElementById('web-result-empty');
    if (loader) loader.hidden = true;
    if (empty && showEmpty) empty.hidden = false;
  }

  function updateModalPromo() {}

  function showCheckout(show, reason) {
    var panel = document.getElementById('checkout-panel');
    if (!panel) return;
    if (show) {
      var title = document.getElementById('topup-title');
      var copy = document.getElementById('topup-copy');
      if (reason === 'exit_post_gen') {
        if (title) title.textContent = t('exitOfferTitle', 'Wait - your first result unlocked a private deal');
        if (copy) copy.textContent = t('exitOfferCopy', 'Keep going now and get bonus credits added automatically to every pack.');
      } else {
        if (title) title.textContent = reason === 'empty' ? t('topupEmptyTitle', 'You are out of credits') : t('topupTitle', 'Ready for another image?');
        if (copy) copy.textContent = reason === 'empty' ? t('topupEmptyCopy', 'Choose a pack and keep generating in seconds.') : t('topupCopy', 'Pick a pack and keep generating on the website.');
      }
      // Start each checkout with an empty discount field — a typed code from a
      // previous open should not linger (campaign/URL codes are kept).
      if (!discountFromUrl) {
        discountCode = '';
        discountOffer = null;
        var dEl = document.getElementById('discount-code');
        if (dEl) dEl.value = '';
        var dNote = document.getElementById('discount-note');
        if (dNote) { dNote.textContent = ''; dNote.className = 'discount-note'; }
      }
      updateModalPromo(reason);
      panel.hidden = false;
      document.body.classList.add('modal-open');
      setTimeout(function () { panel.classList.add('is-open'); }, 20);
      refreshIcons();
      return;
    }
    panel.classList.remove('is-open');
    document.body.classList.remove('modal-open');
    setTimeout(function () { panel.hidden = true; }, 180);
  }

  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }
  window.UG_REFRESH_ICONS = refreshIcons;

  function setTheme(theme) {
    var clean = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', clean);
    var toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', clean === 'light' ? 'true' : 'false');
      toggle.setAttribute('aria-label', clean === 'light' ? t('darkTheme', 'Switch to dark theme') : t('lightTheme', 'Switch to light theme'));
      toggle.innerHTML = '<i data-lucide="' + (clean === 'light' ? 'moon' : 'sun') + '"></i>';
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', clean === 'light' ? '#f6f7fb' : '#070709');
    document.querySelectorAll('.logo img').forEach(function (img) {
      var src = img.getAttribute('src') || '';
      if (clean === 'light') {
        img.setAttribute('src', src.replace('brand-logo-fast.png', 'brand-logo-light-fast.png').replace('brand-logo.png', 'brand-logo-light-fast.png'));
      } else {
        img.setAttribute('src', src.replace('brand-logo-light-fast.png', 'brand-logo-fast.png').replace('brand-logo-light.png', 'brand-logo-fast.png'));
      }
    });
  }

  function initTheme() {
    var saved = '';
    try { saved = localStorage.getItem('ug_theme') || ''; } catch (e) {}
    // Dark is the default on arrival regardless of OS preference; only switch
    // to light if the visitor explicitly chose it via the toggle.
    setTheme(saved === 'light' ? 'light' : 'dark');
    var toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        try { localStorage.setItem('ug_theme', next); } catch (e) {}
        setTheme(next);
        refreshIcons();
      });
    }
  }

  var deviceFpCache = null;
  function deviceFingerprint() {
    // A device fingerprint DERIVED from stable browser/hardware signals, so it
    // survives incognito, cleared storage and reinstalls (unlike the old random
    // localStorage id, which reset in one click). With the server-side IP guard
    // this makes farming free credits across throwaway accounts far harder — not
    // bulletproof (a different device or a canvas-randomising browser still gets
    // a fresh id), but casual abuse goes from trivial to annoying.
    if (deviceFpCache) return deviceFpCache;
    var parts = [];
    try {
      var n = navigator || {};
      parts.push(n.userAgent || '');
      parts.push((n.language || '') + '|' + ((n.languages || []).join(',')));
      parts.push(n.platform || '');
      parts.push((n.hardwareConcurrency || '') + '|' + (n.deviceMemory || '') + '|' + (n.maxTouchPoints || ''));
      var sc = window.screen || {};
      parts.push(sc.width + 'x' + sc.height + 'x' + (sc.colorDepth || '') + '@' + (window.devicePixelRatio || 1));
      parts.push(String(new Date().getTimezoneOffset()));
      try { parts.push(Intl.DateTimeFormat().resolvedOptions().timeZone || ''); } catch (e) {}
      parts.push(fpCanvas());
      parts.push(fpWebgl());
    } catch (e) {}
    var strong = parts.filter(function (p) { return p; }).length >= 4;
    var fp = 'd' + fpHash(parts.join('~~'));
    if (!strong) {
      // Too few signals (headless / locked-down browser) — keep a random
      // per-browser id rather than return empty (empty disables the guard).
      try {
        var stored = localStorage.getItem('ug_fp');
        if (stored) { fp = stored; } else { localStorage.setItem('ug_fp', fp); }
      } catch (e) {}
    }
    deviceFpCache = String(fp).slice(0, 96);
    return deviceFpCache;
  }
  function fpHash(str) {
    var h = 5381, i = str.length;
    while (i) { h = ((h * 33) ^ str.charCodeAt(--i)) >>> 0; }
    return h.toString(16);
  }
  function fpCanvas() {
    try {
      var c = document.createElement('canvas');
      c.width = 240; c.height = 60;
      var ctx = c.getContext('2d');
      if (!ctx) return '';
      ctx.textBaseline = 'top';
      ctx.font = '16px Arial';
      ctx.fillStyle = '#f60'; ctx.fillRect(8, 8, 120, 28);
      ctx.fillStyle = '#069'; ctx.fillText('ug-fp ✨©', 12, 12);
      ctx.fillStyle = 'rgba(102,204,0,0.7)'; ctx.fillText('ug-fp ✨©', 14, 14);
      return fpHash(c.toDataURL());
    } catch (e) { return ''; }
  }
  function fpWebgl() {
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) return '';
      var d = gl.getExtension('WEBGL_debug_renderer_info');
      var v = d ? gl.getParameter(d.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
      var r = d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      return fpHash(String(v) + '|' + String(r));
    } catch (e) { return ''; }
  }

  // Ad attribution (TrafficStars click_id, campaign, utm_*). Captured on landing
  // and persisted, so it survives navigation AND reaches the email-signup flow —
  // not just the Google link. Last ad click wins; organic returns don't clear it.
  var TRACKING_KEYS = ['click_id', 'clickid', 'campaign', 'campaign_id', 'creative_id',
    'site_id', 'spot_id', 'adspot_id', 'adspot_name', 'device', 'device_type', 'os',
    'browser', 'geo', 'country', 'region', 'lang', 'format_id', 'format', 'pricing_model',
    'utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term',
    'juicy_s2s', 's2s'];
  function captureTracking() {
    try {
      var p = new URLSearchParams(location.search || '');
      var t = {};
      TRACKING_KEYS.forEach(function (k) { var v = p.get(k); if (v) t[k] = String(v).slice(0, 180); });
      if (Object.keys(t).length) localStorage.setItem('ug_tracking', JSON.stringify(t));
    } catch (e) {}
  }
  function storedTracking() {
    try { var t = JSON.parse(localStorage.getItem('ug_tracking') || '{}'); return t && typeof t === 'object' ? t : {}; }
    catch (e) { return {}; }
  }
  captureTracking();

  function initGoogleLogin() {
    var link = document.getElementById('google-login');
    if (!link) return;
    function updateHref() {
      var params = new URLSearchParams(location.search || '');
      params.delete('google_login');
      params.delete('web_login');
      // Backfill ad attribution from the landing stash so it survives navigating
      // to another page before logging in (params-less URL would otherwise lose it).
      var saved = storedTracking();
      Object.keys(saved).forEach(function (k) { if (!params.get(k)) params.set(k, saved[k]); });
      params.set('return_to', location.origin + location.pathname);
      var fp = deviceFingerprint();
      if (fp) params.set('ug_fp', fp);
      link.href = apiUrl('/web/auth/google/start') + '?' + params.toString();
    }
    updateHref();
    if (!link.dataset.loginBound) {
      link.dataset.loginBound = '1';
      link.addEventListener('click', updateHref);
    }
  }

  function updateWebAccount(session) {
    currentSession = session && session.ok ? session : null;
    var account = document.getElementById('web-account');
    var balance = document.getElementById('web-balance');
    var login = document.getElementById('login-box');
    var logout = document.getElementById('web-logout');
    var form = document.getElementById('web-generate-form');
    var submit = document.getElementById('web-submit');
    var siteAccount = document.getElementById('site-account');
    var accountName = document.getElementById('site-account-name');
    var accountCredits = document.getElementById('site-account-credits');
    var accountAvatar = document.getElementById('site-account-avatar');
    var accountEmail = document.getElementById('account-email');
    var accountMenuCredits = document.getElementById('account-menu-credits');
    var accountLinkTelegram = document.getElementById('account-link-telegram');
    var telegramLink = document.getElementById('telegram-link');
    var stickyCta = document.getElementById('sticky-cta');
    var stickyFreeCopy = document.querySelector('#sticky-cta .sticky-copy');
    var user = currentSession && currentSession.user;
    var authed = !!user;
    var toast = document.getElementById('reengage-toast');

    if (account) account.textContent = authed ? ('@' + (user.username || user.id)) : t('notLoggedIn', 'Not logged in');
    if (balance) balance.textContent = authed ? formatCredits(user.credits) : signupCreditCopy();
    var loginCopy = document.getElementById('login-box-copy');
    if (loginCopy && !authed) loginCopy.textContent = signupCreditCopy() + '. ' + t('noCardNeeded', 'No card needed.');
    // Must be signed in to generate — show the login box when signed out.
    if (login) login.hidden = authed;
    if (logout) logout.hidden = !authed;
    if (form) form.classList.toggle('is-locked', !authed);
    // Multi-image / credits selector is for signed-in users only.
    var variationRow = document.getElementById('variation-row');
    if (variationRow) variationRow.hidden = !authed;
    // Signed-out visitors can still click Generate; the submit handler gates on
    // auth, preserves their work, and prompts them to sign up. Only disable
    // while a job is running.
    if (submit && submit.dataset.busy !== '1') submit.disabled = false;
    if (siteAccount) siteAccount.hidden = !authed;
    // No header sign-in button — signed-out visitors use the login box in the
    // generator panel (Google + Email), which shows whenever they're not authed.
    if (accountName) accountName.textContent = authed ? userLabel(user) : t('myAccount', 'My account');
    if (accountCredits) accountCredits.textContent = authed ? formatCredits(user.credits) : '';
    if (accountAvatar) accountAvatar.textContent = authed ? userInitial(user) : 'U';
    if (accountEmail) accountEmail.textContent = authed ? (user.email || userLabel(user)) : t('signedIn', 'Signed in');
    if (accountMenuCredits) accountMenuCredits.textContent = authed ? formatCredits(user.credits) : '';
    if (stickyCta) {
      stickyCta.hidden = authed;
      if (authed) stickyCta.classList.remove('show');
    }
    if (stickyFreeCopy) stickyFreeCopy.hidden = authed;
    if (toast && authed) toast.classList.remove('show');
    if (authed && typeof window.ugIdentify === 'function') {
      window.ugIdentify(user.id, {
        credits: user.credits,
        telegram_linked: !!(currentSession && currentSession.telegram && currentSession.telegram.linked)
      });
    }
    document.dispatchEvent(new CustomEvent('ug:session-updated'));
    var linked = !!(currentSession && currentSession.telegram && currentSession.telegram.linked);
    if (accountLinkTelegram) accountLinkTelegram.innerHTML = linked ? '<i data-lucide="check"></i> ' + t('telegramLinkedShort', 'Telegram linked') : '<i data-lucide="send"></i> ' + t('linkTelegram', 'Link Telegram');
    if (telegramLink) telegramLink.innerHTML = linked ? '<i data-lucide="check"></i> ' + t('telegramLinkedShort', 'Telegram linked') : '<i data-lucide="send"></i> ' + t('linkTelegram', 'Link Telegram');
    updateReferral(currentSession && currentSession.referral, authed);
    refreshIcons();
  }

  function formatMoney(cents) {
    return '$' + (Math.max(0, Number(cents || 0)) / 100).toFixed(2);
  }

  // Renders the dedicated referral page (referral.html). No-ops elsewhere.
  function updateReferral(referral, authed) {
    var panel = document.getElementById('ref-panel');
    var anon = document.getElementById('ref-anon');
    if (!panel && !anon) return;  // not on the referral page
    var ready = !!(authed && referral && referral.enabled && referral.link);
    if (anon) anon.hidden = ready;
    if (panel) panel.hidden = !ready;
    var gbtn = document.getElementById('ref-google');
    if (gbtn && !gbtn.dataset.bound) {
      gbtn.dataset.bound = '1';
      gbtn.addEventListener('click', goToGoogleLogin);
    }
    if (!ready) return;
    var set = function (id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
    var link = document.getElementById('ref-link');
    if (link) link.value = referral.link;
    set('ref-balance', formatMoney(referral.balanceCents));
    set('ref-earned', formatMoney(referral.earnedCents));
    set('ref-referred', String(referral.referred || 0));
    set('ref-active', String(referral.count || 0));
    set('ref-buyers', String(referral.buyers || 0));
    var pct = String(referral.revsharePercent || 20) + '%';
    document.querySelectorAll('.ref-pct, #ref-revshare-pct').forEach(function (el) { el.textContent = pct; });
    var copy = document.getElementById('ref-copy');
    if (copy && !copy.dataset.bound) {
      copy.dataset.bound = '1';
      copy.addEventListener('click', function () {
        if (!link) return;
        link.select();
        var done = function () {
          copy.classList.add('copied');
          var prev = copy.innerHTML;
          copy.textContent = t('copied', 'Copied!');
          setTimeout(function () { copy.innerHTML = prev; copy.classList.remove('copied'); refreshIcons(); }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(link.value).then(done, function () { try { document.execCommand('copy'); done(); } catch (e) {} });
        } else { try { document.execCommand('copy'); done(); } catch (e) {} }
      });
    }
  }

  function refreshWebSession() {
    return fetch(apiUrl('/web/session'), { credentials: 'include' })
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (data) {
        updateWebAccount(data && data.ok ? data : null);
        return data;
      })
      .catch(function () {
        updateWebAccount(null);
        return null;
      });
  }

  function loadPacks() {
    var grid = document.getElementById('pack-grid');
    if (!grid) return;
    fetch(apiUrl('/web/packs'), { credentials: 'include' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data || !data.ok) return;
        packOffer = data;
        var packs = data.packs || [];
        var baseline = 0;  // most expensive $/image (the smallest pack) = savings baseline
        packs.forEach(function (p) {
          var c = Number(p.credits || 0);
          if (c) baseline = Math.max(baseline, (Number(p.priceCents || 0) / c) / 100);
        });
        grid.innerHTML = packs.map(function (pack, idx) {
          var credits = Number(pack.credits || pack.baseCredits || 0);
          var perImg = credits ? ((Number(pack.priceCents || 0) / credits) / 100) : 0;
          var savings = (baseline && perImg) ? Math.round((1 - (perImg / baseline)) * 100) : 0;
          // Badges from the numbers, not the title: biggest pack = best $/credit,
          // the one below it is the "popular" anchor that pulls buyers up.
          var isBest = idx === packs.length - 1;
          var isPopular = !isBest && idx === packs.length - 2;
          var ribbon = isBest ? '<em class="pack-badge best">' + esc(t('bestValue', 'BEST VALUE')) + '</em>'
                    : isPopular ? '<em class="pack-badge pop">' + esc(t('mostPopular', 'MOST POPULAR')) + '</em>' : '';
          var saveBadge = savings >= 5 ? '<span class="pack-save">−' + savings + '%</span>' : '';
          var creditLine = credits + ' ' + esc(t('creditsWord', 'credits'));
          var gensLine = '<span class="pack-gens">= ' + credits + ' ' + esc(t('perkGens', 'generations')) + '</span>';
          // Per-image price, with the smallest pack's rate struck through so the
          // saving is visible ("$0.62 ~~$0.83~~ / image").
          var perImgLine = perImg ?
            ('<span class="pack-perimg">$' + perImg.toFixed(2) + ' / ' + esc(t('imageWord', 'image')) +
              (savings >= 10 ? ' <s>$' + baseline.toFixed(2) + '</s>' : '') + '</span>') : '';
          var cryptoButton = data.cryptoEnabled !== false ?
            '<button type="button" data-crypto-pack="' + esc(pack.code) + '"><i data-lucide="wallet"></i> ' + esc(t('payCrypto', 'Crypto')) + '</button>' :
            '';
          var cardButton = data.cardEnabled ?
            '<button type="button" class="pay-card-pack" data-card-pack="' + esc(pack.code) + '"><i data-lucide="credit-card"></i> ' + esc(t('payCard', 'Card')) + '</button>' :
            '';
          return (
            '<div class="pack-card ' + (isBest ? 'featured' : '') + '" data-pack-code="' + esc(pack.code) + '" style="--i:' + idx + '">' +
              ribbon + saveBadge +
              '<strong class="pack-credits">' + creditLine + '</strong>' +
              gensLine +
              packPriceHtml(pack) +
              perImgLine +
              '<ul class="pack-perks">' +
                '<li><i data-lucide="check"></i> ' + esc(t('perkUnlock', 'Unlocks all presets + custom prompts')) + '</li>' +
              '</ul>' +
              '<div class="pack-actions">' + cardButton + cryptoButton + '</div>' +
            '</div>'
          );
        }).join('');
        refreshIcons();
        grid.querySelectorAll('button[data-crypto-pack]').forEach(function (button) {
          button.addEventListener('click', function () {
            var code = button.getAttribute('data-crypto-pack');
            var original = button.innerHTML;
            button.disabled = true;
            button.textContent = t('opening', 'Opening...');
            setStatus(t('creatingCheckout', 'Creating secure crypto checkout...'), 'working');
            fetch(apiUrl('/web/crypto/create'), {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(checkoutPayload(code))
            })
              .then(function (res) {
                return res.json().catch(function () { return {}; }).then(function (payload) {
                  if (!res.ok || !payload.ok) throw new Error(payload.message || 'Could not create checkout.');
                  return payload;
                });
              })
              .then(function (payload) {
                location.href = payload.invoiceUrl;
              })
              .catch(function (err) {
                if (/discount/i.test(err.message || '')) saveDiscountCodeLocal('');
                setStatus(err.message || t('checkoutFail', 'Could not create checkout.'), 'error');
                button.disabled = false;
                button.innerHTML = original || '<i data-lucide="wallet"></i> ' + esc(t('payCrypto', 'Crypto'));
                refreshIcons();
              });
          });
        });
        grid.querySelectorAll('button[data-card-pack]').forEach(function (button) {
          button.addEventListener('click', function () {
            startCardCheckout(button.getAttribute('data-card-pack'), button);
          });
        });
      })
      .catch(function () {});
  }

  function pollCreditsAfterCheckout(startCredits) {
    if (checkoutCreditPoll) window.clearInterval(checkoutCreditPoll);
    var tries = 0;
    checkoutCreditPoll = window.setInterval(function () {
      tries += 1;
      refreshWebSession().then(function (session) {
        var credits = Number(session && session.user && session.user.credits || 0);
        if (credits > Number(startCredits || 0)) {
          window.clearInterval(checkoutCreditPoll);
          checkoutCreditPoll = 0;
          showCheckout(false);
          setStatus(t('cardCreditsAdded', 'Payment complete. Credits added to your account.'), 'success');
        } else if (tries >= 100) {
          window.clearInterval(checkoutCreditPoll);
          checkoutCreditPoll = 0;
        }
      });
    }, 3000);
  }

  function startCardCheckout(code, button) {
    if (!currentSession || !currentSession.user) {
      setStatus(t('loginFirst', 'Login with Google first.'), 'error');
      return;
    }
    if (!code) {
      setStatus(t('checkoutFail', 'Could not create checkout.'), 'error');
      return;
    }
    var original = button ? button.innerHTML : '';
    if (button) {
      button.disabled = true;
      button.textContent = t('opening', 'Opening...');
    }
    var checkoutWindow = window.open('about:blank', '_blank');
    if (!checkoutWindow) {
      setStatus(t('popupBlocked', 'Popup blocked. Allow popups and click Card again.'), 'error');
      if (button) {
        button.disabled = false;
        button.innerHTML = original || '<i data-lucide="credit-card"></i> ' + t('payCard', 'Card');
        refreshIcons();
      }
      return;
    }
    try { checkoutWindow.opener = null; } catch (e) {}
    try {
      checkoutWindow.document.write('<!doctype html><title>Opening checkout...</title><body style="font-family:Arial,sans-serif;padding:24px">Opening checkout...</body>');
      checkoutWindow.document.close();
    } catch (e) {}
    setStatus(t('creatingCardCheckout', 'Opening secure card checkout...'), 'working');
    return fetch(apiUrl('/web/card/create'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checkoutPayload(code))
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (payload) {
          if (!res.ok || !payload.ok) throw new Error(payload.message || t('checkoutFail', 'Could not create checkout.'));
          return payload;
        });
      })
      .then(function (payload) {
        checkoutWindow.location.replace(payload.checkoutUrl);
        track('website_card_checkout_opened', { code: code });
        setStatus(t('cardCheckoutOpened', 'Card checkout opened. Return here after payment.'), 'success');
        pollCreditsAfterCheckout(currentSession && currentSession.user && currentSession.user.credits);
      })
      .catch(function (err) {
        try { checkoutWindow.close(); } catch (e) {}
        if (/discount/i.test(err.message || '')) saveDiscountCodeLocal('');
        setStatus(err.message || t('checkoutFail', 'Could not create checkout.'), 'error');
      })
      .finally(function () {
        if (button) {
          button.disabled = false;
          button.innerHTML = original || '<i data-lucide="credit-card"></i> ' + t('payCard', 'Card');
          refreshIcons();
        }
      });
  }

  function pollTelegramLink() {
    if (telegramLinkPoll) window.clearInterval(telegramLinkPoll);
    var tries = 0;
    telegramLinkPoll = window.setInterval(function () {
      tries += 1;
      refreshWebSession().then(function (session) {
        if (session && session.telegram && session.telegram.linked) {
          window.clearInterval(telegramLinkPoll);
          telegramLinkPoll = 0;
          setStatus(t('telegramLinked', 'Telegram is linked.'), 'success');
        } else if (tries >= 20) {
          window.clearInterval(telegramLinkPoll);
          telegramLinkPoll = 0;
        }
      });
    }, 3000);
  }

  function requestTelegramLink() {
    setStatus(t('linkingTelegram', 'Opening Telegram link...'), 'working');
    return fetch(apiUrl('/web/link/telegram'), {
      method: 'POST',
      credentials: 'include'
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (payload) {
          if (!res.ok || !payload.ok) throw new Error(payload.message || t('telegramLinkFail', 'Could not create Telegram link.'));
          return payload;
        });
      })
      .then(function (payload) {
        if (payload.linked) {
          setStatus(t('telegramLinked', 'Telegram is linked.'), 'success');
          return refreshWebSession().then(function () { return payload; });
        }
        window.open(payload.botUrl || BOT_URL, '_blank', 'noopener');
        setStatus(t('telegramLinkOpened', 'Confirm the link in Telegram, then come back here.'), 'success');
        pollTelegramLink();
        return payload;
      })
      .catch(function (err) {
        setStatus(err.message || t('telegramLinkFail', 'Could not create Telegram link.'), 'error');
        throw err;
      });
  }

  function waitForGeneration(jobId, startedAt) {
    var started = startedAt || Date.now();
    return fetch(apiUrl('/web/generation/' + encodeURIComponent(jobId)), {
      credentials: 'include'
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (payload) {
          if (!res.ok) {
            var error = new Error(payload.message || t('genericError', 'Something went wrong.'));
            error.payload = payload;
            throw error;
          }
          return payload;
        });
      })
      .then(function (payload) {
        if (payload.status === 'done') {
          hideGenerationLoader(false);
          return payload;
        }
        if (payload.status === 'failed' || payload.ok === false) {
          hideGenerationLoader(true);
          var error = new Error(payload.message || t('genericError', 'Something went wrong.'));
          error.payload = payload;
          throw error;
        }
        var elapsed = Math.max(1, Math.round((Date.now() - started) / 1000));
        updateGenerationLoader(payload.status, started);
        var waiting = payload.status === 'queued' ?
          t('queued', 'Queued... generation will start in a moment.') :
          t('stillGenerating', 'Still generating... {s}s elapsed.').replace('{s}', String(elapsed));
        setStatus(waiting, 'working');
        return new Promise(function (resolve) {
          setTimeout(resolve, payload.status === 'queued' ? 1800 : 2600);
        }).then(function () {
          return waitForGeneration(jobId, started);
        });
      });
  }

  function openCardCheckout() {
    if (!currentSession || !currentSession.user) {
      setStatus(t('loginFirst', 'Login with Google first.'), 'error');
      return;
    }
    var packs = packOffer && packOffer.packs || [];
    var best = packs[2] || packs[1] || packs[0];
    if (best && best.code) {
      startCardCheckout(best.code, null);
      return;
    }
    setStatus(t('checkoutFail', 'Could not create checkout.'), 'error');
  }

  function initAccountControls() {
    var trigger = document.getElementById('site-account-trigger');
    var menu = document.getElementById('site-account-menu');
    var topup = document.getElementById('account-topup');
    var linkTelegram = document.getElementById('account-link-telegram');
    var modalLink = document.getElementById('telegram-link');
    var close = document.getElementById('topup-close');
    var logout = document.getElementById('account-logout');

    if (topup) topup.innerHTML = '<i data-lucide="coins"></i> ' + t('getCredits', 'Get credits');
    var support = document.querySelector('.account-menu a[href*="start=support"]');
    if (support) support.innerHTML = '<i data-lucide="message-circle"></i> ' + t('contactSupport', 'Contact support');
    if (logout) logout.innerHTML = '<i data-lucide="log-out"></i> ' + t('logout', 'Logout');

    function closeMenu() {
      if (menu) menu.hidden = true;
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }

    if (trigger && menu) {
      trigger.addEventListener('click', function (event) {
        event.stopPropagation();
        menu.hidden = !menu.hidden;
        trigger.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
      });
      document.addEventListener('click', closeMenu);
      menu.addEventListener('click', function (event) { event.stopPropagation(); });
    }
    if (topup) {
      topup.addEventListener('click', function () {
        closeMenu();
        showCheckout(true);
      });
    }
    if (linkTelegram) {
      linkTelegram.addEventListener('click', function () {
        closeMenu();
        requestTelegramLink();
      });
    }
    if (modalLink) modalLink.addEventListener('click', requestTelegramLink);
    var discountInput = document.getElementById('discount-code');
    var discountApply = document.getElementById('discount-apply');
    if (discountInput) {
      discountInput.value = discountCode || '';
      discountInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          saveDiscountCode(discountInput.value);
        }
      });
    }
    if (discountApply) {
      discountApply.addEventListener('click', function () {
        saveDiscountCode(discountInput ? discountInput.value : '');
      });
    }
    if (close) close.addEventListener('click', function () { showCheckout(false); });
    document.querySelectorAll('[data-close-topup]').forEach(function (button) {
      button.addEventListener('click', function () { showCheckout(false); });
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        closeMenu();
        showCheckout(false);
      }
    });
    if (logout) {
      logout.addEventListener('click', function () {
        fetch(apiUrl('/web/logout'), { method: 'POST', credentials: 'include' })
          .finally(function () {
            closeMenu();
            updateWebAccount(null);
            initGoogleLogin();
          });
      });
    }
  }

  function paintResults(images) {
    var empty = document.getElementById('web-result-empty');
    var target = document.getElementById('web-results');
    if (!target) return;
    target.innerHTML = '';
    (images || []).forEach(function (img, idx) {
      var url = 'data:' + (img.mime || 'image/jpeg') + ';base64,' + img.data;
      var a = document.createElement('a');
      a.href = url;
      a.download = 'undressgoon-web-' + (idx + 1) + '.jpg';
      var el = document.createElement('img');
      el.src = url;
      el.alt = t('generatedResult', 'Generated result') + ' ' + (idx + 1);
      a.appendChild(el);
      target.appendChild(a);
    });
    if (empty) empty.hidden = !!(images && images.length);
  }

  function goToGoogleLogin() {
    var link = document.getElementById('google-login');
    if (link && link.getAttribute('href')) window.location.href = link.getAttribute('href');
  }

  // "Sign up to claim your free credit" — or 2 credits when arriving through a
  // referral link (base free credit + referral bonus).
  function arrivedViaReferral() {
    try { return !!new URLSearchParams(location.search || '').get('ref'); } catch (e) { return false; }
  }
  function signupCreditCopy() {
    return arrivedViaReferral()
      ? t('signupClaim2', 'Sign up to claim your 2 free credits')
      : t('signupClaim1', 'Sign up to claim your free credit');
  }

  // A message card rendered in the results window (errors, sign-in prompts, etc.).
  function paintResultNotice(opts) {
    var target = document.getElementById('web-results');
    var empty = document.getElementById('web-result-empty');
    if (!target) return;
    target.innerHTML = '';
    var card = document.createElement('div');
    card.className = 'result-notice' + (opts.tone ? ' ' + opts.tone : '');
    var html = '';
    if (opts.icon) html += '<div class="rn-icon">' + opts.icon + '</div>';
    if (opts.title) html += '<p class="rn-title">' + esc(opts.title) + '</p>';
    if (opts.message) html += '<p class="rn-sub">' + esc(opts.message) + '</p>';
    if (opts.actionLabel) html += '<button type="button" class="btn btn-accent rn-cta" id="rn-action">' + esc(opts.actionLabel) + '</button>';
    card.innerHTML = html;
    target.appendChild(card);
    if (empty) empty.hidden = true;
    if (opts.actionLabel && opts.onAction) {
      var a = document.getElementById('rn-action');
      if (a) a.addEventListener('click', opts.onAction);
    }
    try { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
  }

  function ensureGeneratorEnhancements(root) {
    var form = root ? root.querySelector('#web-generate-form') : document.getElementById('web-generate-form');
    if (!form) return;
    var modeRow = form.querySelector('.mode-row');
    if (!document.getElementById('advanced-options')) {
      var prompt = document.getElementById('web-prompt');
      var advanced = document.createElement('div');
      advanced.className = 'advanced-options';
      advanced.id = 'advanced-options';
      advanced.innerHTML =
        '<label><span>' + esc(t('breastSizeLabel', 'Breast size')) + '</span><select id="breast-size" name="breast_size">' +
          '<option value="natural" selected>' + esc(t('keepNatural', 'Keep natural')) + '</option>' +
          '<option value="smaller">' + esc(t('breastSmaller', 'Slightly smaller')) + '</option>' +
          '<option value="fuller">' + esc(t('breastFuller', 'Fuller')) + '</option>' +
          '<option value="larger">' + esc(t('breastLarger', 'Larger curvy')) + '</option>' +
        '</select></label>' +
        '<label><span>' + esc(t('pubicHairLabel', 'Pubic hair')) + '</span><select id="pubic-hair" name="pubic_hair">' +
          '<option value="natural" selected>' + esc(t('keepNatural', 'Keep natural')) + '</option>' +
          '<option value="shaved">' + esc(t('pubicShaved', 'Shaved')) + '</option>' +
          '<option value="trimmed">' + esc(t('pubicTrimmed', 'Trimmed')) + '</option>' +
          '<option value="full">' + esc(t('pubicFull', 'Full bush')) + '</option>' +
        '</select></label>';
      if (prompt) prompt.insertAdjacentElement('afterend', advanced);
    }
    if (!document.getElementById('variation-row')) {
      var consent = document.getElementById('web-consent');
      var variation = document.createElement('div');
      variation.className = 'variation-row';
      variation.id = 'variation-row';
      variation.innerHTML =
        '<label for="variation-count"><span>' + esc(t('imagesLabel', 'Images')) + '</span>' +
        '<select id="variation-count" name="variations">' +
          '<option value="1" selected>1 ' + esc(t('imageSingular', 'image')) + '</option>' +
          '<option value="2">2 ' + esc(t('imagePlural', 'images')) + '</option>' +
          '<option value="3">3 ' + esc(t('imagePlural', 'images')) + '</option>' +
          '<option value="4">4 ' + esc(t('imagePlural', 'images')) + '</option>' +
        '</select></label><small id="variation-cost">1 ' + esc(t('creditWord', 'credit')) + '</small>';
      var consentLine = consent ? consent.closest('.consent-line') : null;
      if (consentLine) consentLine.insertAdjacentElement('beforebegin', variation);
      else form.appendChild(variation);
    }
  }

  // Free (never-purchased) users may only run the Fully Nude preset; everything
  // else — other presets + custom prompts — unlocks after any top-up.
  var FREE_PRESET_KEY = 'nude';
  function isBuyer() {
    return !!(currentSession && currentSession.user && currentSession.user.hasPurchased);
  }

  function initPresets() {
    var tabs = document.getElementById('preset-tabs');
    var grid = document.getElementById('preset-grid');
    var prompt = document.getElementById('web-prompt');
    var clear = document.getElementById('preset-clear');
    var picker = document.querySelector('.preset-picker');
    var modeInputs = document.querySelectorAll('input[name="mode"]');
    var label = document.querySelector('.preset-top .field-label');
    var promptLabel = document.querySelector('label[for="web-prompt"]');
    var presets = CFG.presets || [];
    if (!tabs || !grid || !prompt || !presets.length) return;

    // Prompt is hidden by default — presets fill it invisibly (users never see
    // our prompt text). A "Write my own prompt" button reveals an empty field.
    prompt.removeAttribute('required');
    function showCustomPrompt(show) {
      if (promptLabel) promptLabel.style.display = show ? '' : 'none';
      prompt.style.display = show ? '' : 'none';
      prompt.classList.toggle('is-open', !!show);
    }
    if (label) label.textContent = t('choosePresetLabel', 'Choose a look');
    var writeOwn = document.getElementById('write-own-prompt');
    if (!writeOwn && picker) {
      writeOwn = document.createElement('button');
      writeOwn.type = 'button';
      writeOwn.id = 'write-own-prompt';
      writeOwn.className = 'write-own-btn';
      picker.insertAdjacentElement('afterend', writeOwn);
    }
    function renderWriteOwn() {
      if (!writeOwn) return;
      var locked = !isBuyer();
      writeOwn.classList.toggle('locked', locked);
      writeOwn.innerHTML = (locked ? '<i data-lucide="lock"></i> ' : '<i data-lucide="pencil"></i> ')
        + esc(t('writeOwnPrompt', 'Write my own prompt'));
      refreshIcons();
    }
    if (writeOwn && !writeOwn.dataset.bound) {
      writeOwn.dataset.bound = '1';
      writeOwn.addEventListener('click', function () {
        if (!isBuyer()) { setStatus(t('lockedCustomHint', 'Custom prompts unlock after a top-up. Your free credit works with the Fully Nude preset.'), 'working'); return; }
        selected = '';
        prompt.value = '';
        showCustomPrompt(true);
        renderGrid();
        prompt.focus();
      });
    }
    showCustomPrompt(false);

    var outfitCats = [
      { key: 'hot', label: t('tabHot', 'Hottest') },
      { key: 'clothes', label: t('tabClothes', 'Clothes') },
      { key: 'fantasy', label: t('tabFantasy', 'Fantasy') }
    ];
    // Scene categories = the new PonyRealism generate-then-swap catalogue
    // (keys must match scene_presets.py on the backend).
    var sceneCats = [
      { key: 'sex', label: t('tabSex', 'Sex') },
      { key: 'oral', label: t('tabOral', 'Oral') },
      { key: 'nasty', label: t('tabNasty', 'Nasty') },
      { key: 'tease', label: t('tabTease', 'Tease') },
      { key: 'cosplay', label: t('tabCosplay', 'Cosplay') },
      { key: 'bdsm', label: t('tabBdsm', 'BDSM') }
    ];
    var presetPromptUpgrades = {
      nude: 'completely naked, fully exposed, no clothing at all, bare breasts with natural visible nipples and areolas, natural skin texture, same pose and same camera framing, clear recognizable face, realistic shadows on the body',
      oily: 'completely nude body covered in shiny oil, glistening skin, bare breasts with natural visible nipples and areolas, oil highlights on chest stomach hips and thighs, no clothing, clear face, realistic bedroom lighting',
      bondage: 'completely nude body in a consensual shibari-style rope harness, rope framing the chest waist hips and thighs, bare breasts with natural visible nipples and areolas, no other clothing, clear face, full body visible, dramatic warm light',
      lingerie: 'tiny sheer black lingerie that barely covers anything, transparent fabric, nipples visible through the fabric, high-cut panties, straps hugging the body, same pose and face, realistic fabric tension and shadows',
      crotchless: 'crotchless panties and open-cup bra, exposed lingerie look, bare breasts visible through the open cups, straps and lace framing the body, same pose and camera angle, realistic skin and fabric detail',
      bikini: 'extremely skimpy micro bikini, thin strings only, tiny triangle top and micro bottom, glossy skin, same body proportions, same pose and clear face, realistic fabric tension and shadows',
      wet: 'soaking wet white t-shirt clinging tightly to the body with no bra, hard nipples visible through transparent wet fabric, tiny soaked panties, wet skin, realistic water droplets and bathroom light',
      bdsm: 'tight black leather harness, collar, cuffs and straps framing the body, breasts and crotch exposed, consensual dungeon styling, glossy leather highlights, clear face, same pose and realistic shadows',
      latex: 'shiny tight black latex catsuit unzipped down the front, breasts and crotch exposed through the opening, glossy latex reflections, same face and body proportions, realistic tight fit and folds',
      tights: 'remove every piece of clothing, then put only sheer black pantyhose on the legs and feet; upper body fully naked with bare breasts and visible nipples, bare torso and arms, nothing on the chest, same pose and framing',
      stockings: 'remove every piece of clothing, then put only sheer black thigh-high stockings on the legs; upper body fully naked with bare breasts and visible nipples, bare pussy with no panties, same pose and framing',
      pleated_uniform: 'tiny pleated uniform skirt with no panties, tight white blouse unbuttoned low, cleavage visible, messy teasing cosplay look, same face and body proportions, realistic indoor photo',
      nurse: 'short tight nurse costume unzipped low, cleavage out, garter belt, no panties, teasing clinical-room fantasy styling, same pose and clear face, realistic fabric and shadows',
      maid: 'tiny french maid outfit, very short skirt with no panties, stockings, cleavage, apron barely covering the body, playful messy bedroom styling, same identity and camera framing',
      office: 'slutty office look: tight blouse unbuttoned, pencil skirt hiked up, no panties, stockings, desk fantasy styling, same pose and face, realistic office lighting'
    };
    // NEW scene catalogue PonyRealism generate-then-swap. `prompt` holds the
    // scene KEY (the invisible-prompt bridge carries it to submit; the backend
    // resolves key -> full Pony prompt server-side). Keys MUST match
    // scene_presets.py. Subject attributes (skin/body/bust/) are sent separately.
    var scenePresets = CFG.scenePresets || [
      { key: 'missionary', category: 'sex', label: 'Missionary', prompt: 'missionary' },
      { key: 'cowgirl', category: 'sex', label: 'Cowgirl', prompt: 'cowgirl' },
      { key: 'doggystyle', category: 'sex', label: 'Doggystyle', prompt: 'doggystyle' },
      { key: 'reverse_cowgirl', category: 'sex', label: 'Reverse Cowgirl', prompt: 'reverse_cowgirl' },
      { key: 'standing_sex', category: 'sex', label: 'Standing', prompt: 'standing_sex' },
      { key: 'lesbian_scissoring', category: 'sex', label: 'Girl-on-Girl', prompt: 'lesbian_scissoring' },
      { key: 'blowjob_pov', category: 'oral', label: 'Blowjob (POV)', prompt: 'blowjob_pov' },
      { key: 'deepthroat', category: 'oral', label: 'Deepthroat', prompt: 'deepthroat' },
      { key: 'cunnilingus', category: 'oral', label: 'Licked Out', prompt: 'cunnilingus' },
      { key: 'sixtynine', category: 'oral', label: 'Sixty-Nine', prompt: 'sixtynine' },
      { key: 'titjob', category: 'oral', label: 'Titjob', prompt: 'titjob' },
      { key: 'creampie', category: 'nasty', label: 'Creampie', prompt: 'creampie' },
      { key: 'facial', category: 'nasty', label: 'Facial', prompt: 'facial' },
      { key: 'anal', category: 'nasty', label: 'Anal', prompt: 'anal' },
      { key: 'ahegao_ride', category: 'nasty', label: 'Ahegao', prompt: 'ahegao_ride' },
      { key: 'bukkake', category: 'nasty', label: 'Covered', prompt: 'bukkake' },
      { key: 'white_pantyhose', category: 'tease', label: 'White Pantyhose', prompt: 'white_pantyhose' },
      { key: 'footjob_pantyhose', category: 'tease', label: 'Footjob (Pantyhose)', prompt: 'footjob_pantyhose' },
      { key: 'feet_soles', category: 'tease', label: 'Feet & Soles', prompt: 'feet_soles' },
      { key: 'armpit', category: 'tease', label: 'Armpit', prompt: 'armpit' },
      { key: 'bent_over', category: 'tease', label: 'Bent Over', prompt: 'bent_over' },
      { key: 'shower_wet', category: 'tease', label: 'Wet Shower', prompt: 'shower_wet' },
      { key: 'schoolgirl_sex', category: 'cosplay', label: 'Schoolgirl', prompt: 'schoolgirl_sex' },
      { key: 'nurse', category: 'cosplay', label: 'Naughty Nurse', prompt: 'nurse' },
      { key: 'maid', category: 'cosplay', label: 'French Maid', prompt: 'maid' },
      { key: 'bunnysuit', category: 'cosplay', label: 'Bunny Suit', prompt: 'bunnysuit' },
      { key: 'catgirl', category: 'cosplay', label: 'Catgirl', prompt: 'catgirl' },
      { key: 'shibari', category: 'bdsm', label: 'Shibari', prompt: 'shibari' },
      { key: 'collar_leash', category: 'bdsm', label: 'Collar & Leash', prompt: 'collar_leash' },
      { key: 'spanking', category: 'bdsm', label: 'Spanking', prompt: 'spanking' },
      { key: 'latex_domme', category: 'bdsm', label: 'Latex Domme', prompt: 'latex_domme' },
      { key: 'restrained_bed', category: 'bdsm', label: 'Tied to Bed', prompt: 'restrained_bed' }
    ];
// (legacy Qwen scene presets removed — replaced by the scenePresets catalogue above)
    presets = presets.map(function (preset) {
      if (preset && presetPromptUpgrades[preset.key]) {
        return Object.assign({}, preset, { prompt: presetPromptUpgrades[preset.key] });
      }
      return preset;
    });
    var active = 'hot';
    var selected = '';
    var sceneHelp = null;

    // Subject attributes (scene mode only): the generated body would otherwise be
    // random, so the user picks skin tone / build / bust / hair to keep it on
    // identity. Values MUST match scene_presets.SUBJECT_ATTRIBUTES on the backend.
    var subjectAttrs = [
      { key: 'skin_tone', label: t('subjSkin', 'Skin tone'), options: [['auto', 'Auto (match my photo)'], ['pale', 'Pale'], ['fair', 'Fair'], ['light', 'Light'], ['olive', 'Olive'], ['tan', 'Tan'], ['brown', 'Brown'], ['dark', 'Dark'], ['ebony', 'Deep ebony']] },
      { key: 'body_type', label: t('subjBody', 'Body type'), options: [['auto', 'Auto'], ['petite', 'Petite'], ['slim', 'Slim'], ['athletic', 'Athletic'], ['curvy', 'Curvy'], ['thick', 'Thick'], ['bbw', 'Plus-size']] },
      { key: 'breast_size', label: t('subjBust', 'Breast size'), options: [['auto', 'Auto'], ['flat', 'Flat'], ['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['huge', 'Huge']] },
      { key: 'butt_size', label: t('subjButt', 'Butt'), options: [['auto', 'Auto'], ['small', 'Small'], ['average', 'Average'], ['big', 'Big'], ['huge', 'Huge']] },
      { key: 'hair', label: t('subjHair', 'Hair'), options: [['auto', 'Auto'], ['black', 'Black'], ['brown', 'Brown'], ['blonde', 'Blonde'], ['red', 'Red'], ['dark_long', 'Long dark'], ['blonde_long', 'Long blonde']] },
      { key: 'height', label: t('subjHeight', 'Height'), options: [['auto', 'Auto'], ['short', 'Short'], ['average', 'Average'], ['tall', 'Tall']] }
    ];
    var subjectBox = document.getElementById('scene-subject');
    if (!subjectBox && picker) {
      subjectBox = document.createElement('div');
      subjectBox.id = 'scene-subject';
      subjectBox.className = 'advanced-options';
      subjectBox.style.display = 'none';
      subjectBox.innerHTML =
        '<div class="scene-subject-head" style="grid-column:1/-1;font-size:.78rem;color:var(--muted);margin-bottom:2px">' +
        esc(t('subjHead', 'Match your look — keep the body true to you (optional).')) + '</div>' +
        subjectAttrs.map(function (a) {
          return '<label><span>' + esc(a.label) + '</span><select id="subj-' + a.key + '">' +
            a.options.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join('') +
            '</select></label>';
        }).join('');
      picker.insertAdjacentElement('afterend', subjectBox);
    }
    function showSubject(on) { if (subjectBox) subjectBox.style.display = on ? '' : 'none'; }

    function activeMode() {
      var checked = document.querySelector('input[name="mode"]:checked');
      return checked ? checked.value : 'prompt';
    }

    function activeCats() {
      return activeMode() === 'scene' ? sceneCats : outfitCats;
    }

    function activePresets() {
      return activeMode() === 'scene' ? scenePresets : presets;
    }

    function ensureSceneHelp() {
      if (sceneHelp || !picker) return sceneHelp;
      sceneHelp = document.createElement('p');
      sceneHelp.className = 'scene-help';
      picker.insertBefore(sceneHelp, tabs);
      return sceneHelp;
    }

    function syncModeCopy() {
      var mode = activeMode();
      var scene = mode === 'scene';
      modeInputs.forEach(function (input) {
        if (input.parentElement) input.parentElement.classList.toggle('active', input.checked);
      });
      if (picker) picker.hidden = false;
      if (label) label.textContent = scene
        ? t('chooseSceneLabel', 'PICK A SCENE')
        : t('presetPromptInstruction', 'CHOOSE A PRESET OR JUST DIRECTLY WRITE YOUR OWN PROMPT');
      if (promptLabel) promptLabel.textContent = scene ? t('scenePromptLabel', 'Scene prompt') : t('promptLabel', 'Prompt');
      prompt.required = true;
      if (clear) clear.hidden = true;
      var help = ensureSceneHelp();
      if (help) {
        help.hidden = !scene;
        help.textContent = t('sceneHelp', 'Pick a scene, then set your body details below so it comes out looking like you.');
      }
      prompt.placeholder = scene ?
        '' :
        t('promptPlaceholder', 'Example: tiny black micro bikini, glossy skin, bedroom mirror selfie');
      // Scene mode is preset-only (no free-text prompt, no custom-prompt button)
      // and shows the subject selectors instead of the undress body options.
      var adv = document.getElementById('advanced-options');
      if (adv) adv.style.display = scene ? 'none' : '';
      showSubject(scene);
      if (writeOwn) writeOwn.style.display = scene ? 'none' : '';
      if (scene) showCustomPrompt(false);
    }

    function renderTabs() {
      var cats = activeCats();
      if (!cats.some(function (cat) { return cat.key === active; })) {
        active = cats[0].key;
      }
      tabs.innerHTML = cats.map(function (cat) {
        return '<button type="button" class="' + (cat.key === active ? 'active' : '') + '" data-cat="' + esc(cat.key) + '">' + esc(cat.label) + '</button>';
      }).join('');
      tabs.querySelectorAll('button').forEach(function (button) {
        button.addEventListener('click', function () {
          active = button.getAttribute('data-cat') || 'hot';
          renderTabs();
          renderGrid();
        });
      });
    }

    function renderGrid() {
      var mode = activeMode();
      var buyer = isBuyer();
      grid.innerHTML = activePresets().filter(function (p) {
        return p.category === active;
      }).map(function (p) {
        var icon = mode === 'scene' ? '' : (p.category === 'hot' ? 'flame' : (p.category === 'fantasy' ? 'sparkles' : 'shirt'));
        var locked = !buyer && p.key !== FREE_PRESET_KEY;
        return '<button type="button" class="' + (p.key === selected ? 'active' : '') + (locked ? ' locked' : '') + '" data-key="' + esc(p.key) + '"' + (locked ? ' data-locked="1"' : '') + '><i data-lucide="' + icon + '"></i>' + esc(p.label) + (locked ? '<span class="preset-lock"><i data-lucide="lock"></i></span>' : '') + '</button>';
      }).join('');
      refreshIcons();
      grid.querySelectorAll('button').forEach(function (button) {
        button.addEventListener('click', function () {
          if (button.dataset.locked === '1') {
            // Don't ambush free users with the top-up popup on a casual tap —
            // just explain what their free credit covers.
            setStatus(t('lockedPresetHint', 'Your free credit works only with the Fully Nude preset. Top up to unlock this look.'), 'working');
            return;
          }
          var key = button.getAttribute('data-key');
          var mode = activeMode();
          var preset = activePresets().find(function (p) { return p.key === key; });
          if (!preset) return;
          selected = preset.key;
          prompt.value = preset.prompt;      // applied invisibly (field stays hidden)
          showCustomPrompt(false);
          var modeInput = document.querySelector('input[name="mode"][value="' + (mode === 'scene' ? 'scene' : 'prompt') + '"]');
          if (modeInput) modeInput.checked = true;
          renderGrid();
        });
      });
    }

    if (clear) {
      clear.addEventListener('click', function () {
        if (!isBuyer()) { setStatus(t('lockedCustomHint', 'Custom prompts unlock after a top-up. Your free credit works with the Fully Nude preset.'), 'working'); return; }
        selected = '';
        prompt.value = '';
        showCustomPrompt(true);
        renderGrid();
        prompt.focus();
      });
    }
    prompt.addEventListener('input', function () {
      selected = '';
      renderGrid();
    });
    modeInputs.forEach(function (input) {
      input.addEventListener('change', function () {
        active = activeMode() === 'scene' ? sceneCats[0].key : outfitCats[0].key;
        selected = '';
        prompt.value = '';
        showCustomPrompt(false);
        syncModeCopy();
        renderTabs();
        renderGrid();
      });
    });
    // Re-render locks when the session loads or the user becomes a buyer.
    document.addEventListener('ug:session-updated', function () {
      renderGrid();
      renderWriteOwn();
    });

    syncModeCopy();
    renderTabs();
    renderGrid();
    renderWriteOwn();

    // First load: preselect the free Fully Nude preset so a new visitor lands
    // on a ready-to-run look — the one their free credit actually covers.
    if (!selected && activeMode() !== 'scene') {
      var freePreset = presets.find(function (p) { return p.key === FREE_PRESET_KEY; });
      if (freePreset) {
        selected = freePreset.key;
        prompt.value = freePreset.prompt;  // applied invisibly (field stays hidden)
        showCustomPrompt(false);
        renderGrid();
      }
    }
  }

  function initWebGenerator() {
    var root = document.querySelector('[data-web-generator]');
    if (!root) return;
    ensureGeneratorEnhancements(root);

    var file = document.getElementById('person-photo');
    var fileName = document.getElementById('upload-name');
    var uploadZone = document.querySelector('.upload-zone');
    var uploadPreview = document.getElementById('upload-preview');
    var form = document.getElementById('web-generate-form');
    var logout = document.getElementById('web-logout');
    var submit = document.getElementById('web-submit');
    var variationSelect = document.getElementById('variation-count');
    var variationCost = document.getElementById('variation-cost');
    var previewUrl = '';
    var selectedPersonSnapshot = null;
    var pendingGeneration = null;

    if (!CFG.apiBase && location.protocol === 'file:') {
      setStatus(t('apiMissing', 'Set UG_CONFIG.apiBase to your bot backend URL before uploading to cPanel.'), 'error');
    }

    initGoogleLogin();
    initEmailLogin();
    refreshWebSession().then(resumePendingGeneration);
    initPresets();
    loadPacks();
    initAccountControls();

    function maxVariations() {
      var fromSession = currentSession && Number(currentSession.maxVariations || 0);
      var fromConfig = Number(CFG.maxVariations || 0);
      var value = fromSession || fromConfig || 4;
      return Math.max(1, Math.min(4, value));
    }

    function costPerImage() {
      var fromSession = currentSession && Number(currentSession.costPerImage || 0);
      var fromConfig = Number(CFG.costPerImage || 0);
      return Math.max(1, fromSession || fromConfig || 1);
    }

    function selectedVariations() {
      var n = variationSelect ? Number(variationSelect.value || 1) : 1;
      return Math.max(1, Math.min(maxVariations(), Number.isFinite(n) ? n : 1));
    }

    function availableCredits() {
      var u = currentSession && currentSession.user;
      return u ? Math.max(0, Number(u.credits || 0)) : 0;
    }

    function syncVariationControl() {
      if (!variationSelect) return;
      var variationRow = document.getElementById('variation-row');
      var authed = !!(currentSession && currentSession.user);
      var perImage = costPerImage();
      // Only offer as many images as the user can actually pay for right now.
      var affordable = Math.floor(availableCredits() / perImage);
      var max = Math.max(1, Math.min(maxVariations(), affordable));
      Array.prototype.forEach.call(variationSelect.options, function (option) {
        var unavailable = Number(option.value) > max;
        option.disabled = unavailable;
        option.hidden = unavailable;
      });
      if (Number(variationSelect.value || 1) > max) variationSelect.value = String(max);
      // With 0-1 credits there's nothing to choose (it's always a single image),
      // so hide the whole selector rather than show a pointless "1 image".
      if (variationRow) variationRow.hidden = !authed || affordable < 2;
      var count = selectedVariations();
      var totalCost = count * perImage;
      if (variationCost) {
        variationCost.textContent = totalCost + ' ' + (totalCost === 1 ? t('creditWord', 'credit') : t('creditsWord', 'credits'));
      }
      if (submit && submit.dataset.busy !== '1') {
        submit.innerHTML = '<i data-lucide="wand-sparkles"></i> ' + t('generateVerb', 'Generate') + ' ' + count + ' ' + pluralizeImage(count);
        refreshIcons();
      }
    }

    function clearUploadPreview() {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = '';
      selectedPersonSnapshot = null;
      if (uploadPreview) {
        uploadPreview.hidden = true;
        uploadPreview.removeAttribute('src');
      }
      if (uploadZone) uploadZone.classList.remove('has-preview');
      if (fileName) fileName.textContent = t('uploadHint', 'JPG, PNG, or WebP up to 12 MB');
    }

    function selectedPersonFile() {
      return file && file.files && file.files.length ? file.files[0] : null;
    }

    function estimateDataUrlBytes(dataUrl) {
      var base64 = String(dataUrl || '').split(',').pop() || '';
      if (!base64) return 0;
      var padding = (base64.match(/=+$/) || [''])[0].length;
      return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
    }

    function readFileAsDataUrl(chosen) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result || '')); };
        reader.onerror = function () { reject(new Error(t('readFail', 'Could not read the selected photo.'))); };
        reader.readAsDataURL(chosen);
      });
    }

    function updateUploadPreview() {
      var chosen = selectedPersonFile();
      if (!chosen) {
        clearUploadPreview();
        return;
      }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(chosen);
      if (uploadPreview) {
        uploadPreview.src = previewUrl;
        uploadPreview.hidden = false;
      }
      if (uploadZone) uploadZone.classList.add('has-preview');
      if (fileName) fileName.textContent = chosen.name;
      selectedPersonSnapshot = null;
      readFileAsDataUrl(chosen).then(function (dataUrl) {
        if (selectedPersonFile() !== chosen) return;
        selectedPersonSnapshot = {
          dataUrl: dataUrl,
          name: chosen.name || 'upload.jpg',
          type: chosen.type || '',
          size: chosen.size || estimateDataUrlBytes(dataUrl)
        };
      }).catch(function () {});
    }

    function validateImageFile(chosen, label) {
      if (!chosen) return label + ' is missing.';
      if (!/image\/(jpeg|png|webp)/i.test(chosen.type || '')) {
        return t('badPhotoType', 'Upload a valid JPG, PNG, or WebP photo.');
      }
      if (chosen.size > 12 * 1024 * 1024) {
        return t('photoTooLarge', 'Photo is too large. Upload an image up to 12 MB.');
      }
      return '';
    }

    function buildGenerationPayload() {
      var consent = document.getElementById('web-consent');
      var prompt = document.getElementById('web-prompt');
      var mode = document.querySelector('input[name="mode"]:checked');
      var chosen = selectedPersonFile();
      var snapshot = selectedPersonSnapshot;
      var modeValue = mode ? mode.value : 'prompt';
      var breastSize = document.getElementById('breast-size');
      var pubicHair = document.getElementById('pubic-hair');
      var variations = selectedVariations();

      if (!chosen && !(snapshot && snapshot.dataUrl)) {
        setStatus(t('missingPhoto', 'Upload a person photo first.'), 'error');
        if (file) file.focus();
        return null;
      }
      if (chosen) {
        var personError = validateImageFile(chosen, 'Photo');
        if (personError) {
          setStatus(personError, 'error');
          if (file) file.focus();
          return null;
        }
      } else if (snapshot && snapshot.size > 12 * 1024 * 1024) {
        setStatus(t('photoTooLarge', 'Photo is too large. Upload an image up to 12 MB.'), 'error');
        if (file) file.focus();
        return null;
      }
      if (!consent || !consent.checked) {
        setStatus(t('termsRequired', 'Confirm you are 18+ and have rights to this photo.'), 'error');
        if (consent) consent.focus();
        return null;
      }
      if (prompt && !prompt.value.trim()) {
        setStatus(t('promptRequired', 'Pick a preset or write a prompt first.'), 'error');
        prompt.focus();
        return null;
      }

      var payload = new FormData();
      payload.append('prompt', prompt ? prompt.value.trim() : '');
      payload.append('mode', modeValue);
      payload.append('terms_accepted', '1');
      payload.append('variations', String(variations));
      if (modeValue === 'scene') {
        // The invisible-prompt bridge holds the chosen scene KEY; send it as
        // `scene` and attach the subject attribute picks (skip the undress body
        // options — the subject selectors replace them here).
        payload.append('scene', prompt ? prompt.value.trim() : '');
        ['skin_tone', 'body_type', 'breast_size', 'butt_size', 'hair', 'height'].forEach(function (k) {
          var s = document.getElementById('subj-' + k);
          if (s && s.value && s.value !== 'auto') payload.append(k, s.value);
        });
      } else {
        payload.append('breast_size', breastSize ? breastSize.value : 'natural');
        payload.append('pubic_hair', pubicHair ? pubicHair.value : 'natural');
      }
      if (chosen) {
        payload.append('person_name', chosen.name || 'upload.jpg');
        payload.append('person', chosen, chosen.name || 'upload.jpg');
        return readFileAsDataUrl(chosen).then(function (dataUrl) {
          selectedPersonSnapshot = {
            dataUrl: dataUrl,
            name: chosen.name || 'upload.jpg',
            type: chosen.type || '',
            size: chosen.size || estimateDataUrlBytes(dataUrl)
          };
          payload.append('person_b64', dataUrl);
          return payload;
        }).catch(function () {
          return payload;
        });
      }
      payload.append('person_name', snapshot.name || 'upload.jpg');
      payload.append('person_b64', snapshot.dataUrl || '');
      return Promise.resolve(payload);
    }

    if (file) {
      file.addEventListener('change', function () {
        updateUploadPreview();
        if (selectedPersonFile()) {
          track('website_photo_selected', { mode: selectedModeValue() });
        }
      });
    }

    if (variationSelect) variationSelect.addEventListener('change', syncVariationControl);
    document.addEventListener('ug:session-updated', syncVariationControl);
    syncVariationControl();

    if (logout) {
      logout.addEventListener('click', function () {
        fetch(apiUrl('/web/logout'), { method: 'POST', credentials: 'include' })
          .finally(function () {
            updateWebAccount(null);
            initGoogleLogin();
          });
      });
    }


    function runGeneration(payloadPromise) {
      if (submit) { submit.disabled = true; submit.dataset.busy = '1'; }
      setStatus(t('readingUpload', 'Reading upload...'), 'working');
      paintResults([]);
      updateGenerationLoader('preparing', Date.now());
      payloadPromise
        .then(function (payload) {
          updateGenerationLoader('preparing', Date.now());
          setStatus(t('generating', 'Generating... this usually takes under a minute.'), 'working');
          return fetch(apiUrl('/web/generate'), { method: 'POST', credentials: 'include', body: payload });
        })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (!res.ok || !data.ok) {
              var error = new Error(data.message || 'Generation failed.');
              error.payload = data;
              throw error;
            }
            return data;
          });
        })
        .then(function (data) {
          if (data.jobId) {
            updateGenerationLoader('queued', Date.now());
            setStatus(t('queued', 'Queued... generation will start in a moment.'), 'working');
            return waitForGeneration(data.jobId);
          }
          return data;
        })
        .then(function (data) {
          if (isFirstResultOfferEligible()) {
            firstGenerationDone = true;
            armExitOffer();
          }
          paintResults(data.images || []);
          track('website_generation_success', { image_count: (data.images || []).length, balance: data.balance });
          setStatus(t('doneBalance', 'Done. Balance: {balance}.').replace('{balance}', formatCredits(data.balance)), 'success');
          return refreshWebSession();
        })
        .catch(function (err) {
          hideGenerationLoader(true);
          setStatus('', '');  // errors are shown in the results window instead
          var payload = err.payload || {};
          if (payload.code === 'insufficient_credits') {
            track('website_generation_out_of_credits', {});
            paintResultNotice({
              tone: 'warn', icon: '💳',
              title: t('outOfCreditsTitle', 'You are out of credits'),
              message: t('outOfCreditsMsg', 'Pick a pack to keep generating.'),
              actionLabel: t('getCredits', 'Get credits'),
              onAction: function () { showCheckout(true, 'empty'); }
            });
          } else if (payload.code === 'top_up_required') {
            track('website_generation_top_up_required', {});
            paintResultNotice({
              tone: 'warn', icon: '🔓',
              title: t('topUpUnlockTitle', 'Top up to unlock this'),
              message: t('topUpUnlockMsg', 'Your free credit only works with the Fully Nude preset. Top up to unlock all presets and custom prompts.'),
              actionLabel: t('unlockGetCredits', 'Unlock — get credits'),
              onAction: function () { showCheckout(true, 'locked_feature'); }
            });
          } else if (payload.code === 'not_authenticated') {
            // Signed-out: save their work, prompt sign-up; after signin the
            // generation runs for real (resumePendingGeneration).
            track('website_generation_not_authenticated', {});
            stashPending(payloadPromise);
            revealLoginPrompt();
            paintResultNotice({
              icon: '🔒',
              title: t('signUpToGenerateTitle', 'Sign up to generate'),
              message: signupCreditCopy() + ' — ' + t('noCardNeeded', 'no card needed.'),
              actionLabel: t('continueGoogle', 'Continue with Google'),
              onAction: goToGoogleLogin
            });
          } else {
            track('website_generation_error', { code: payload.code || 'unknown' });
            paintResultNotice({
              tone: 'bad', icon: '⚠️',
              title: t('genFailedTitle', 'Something went wrong'),
              message: err.message || t('genericError', 'Please try again.')
            });
          }
        })
        .finally(function () {
          if (submit) submit.dataset.busy = '';
          refreshWebSession().then(function () { if (submit) submit.disabled = false; });
        });
    }

    function payloadFromSnapshot(snap) {
      var payload = new FormData();
      payload.append('prompt', snap.prompt || '');
      payload.append('mode', snap.mode || 'prompt');
      payload.append('terms_accepted', '1');
      payload.append('variations', String(snap.variations || 1));
      payload.append('breast_size', snap.breastSize || 'natural');
      payload.append('pubic_hair', snap.pubicHair || 'natural');
      payload.append('person_name', 'upload.jpg');
      payload.append('person_b64', snap.dataUrl || '');
      return payload;
    }

    function stashPending(payloadPromise) {
      pendingGeneration = payloadPromise;
      var prompt = document.getElementById('web-prompt');
      var mode = document.querySelector('input[name="mode"]:checked');
      var breastSize = document.getElementById('breast-size');
      var pubicHair = document.getElementById('pubic-hair');
      var variations = document.getElementById('variation-count');
      var personSnapFile = selectedPersonFile();
      payloadPromise.then(function () {
        var snap = {
          prompt: prompt ? prompt.value.trim() : '',
          mode: mode ? mode.value : 'prompt',
          variations: variations ? Number(variations.value || 1) : 1,
          breastSize: breastSize ? breastSize.value : 'natural',
          pubicHair: pubicHair ? pubicHair.value : 'natural',
          dataUrl: ''
        };
        var reads = [];
        if (personSnapFile) {
          reads.push(readFileAsDataUrl(personSnapFile).then(function (dataUrl) {
            snap.dataUrl = dataUrl;
          }));
        } else if (selectedPersonSnapshot && selectedPersonSnapshot.dataUrl) {
          snap.dataUrl = selectedPersonSnapshot.dataUrl;
        }
        Promise.all(reads).then(function () {
          // Best-effort persist so a Google redirect survives.
          try { sessionStorage.setItem('ug_pending', JSON.stringify(snap)); }
          catch (e) {
            snap.dataUrl = '';
            try { sessionStorage.setItem('ug_pending', JSON.stringify(snap)); } catch (_) {}
          }
        }).catch(function () {});
      }).catch(function () {});
    }

    function resumePendingGeneration() {
      if (!(currentSession && currentSession.user)) return;
      if (pendingGeneration) {
        var p = pendingGeneration; pendingGeneration = null;
        try { sessionStorage.removeItem('ug_pending'); } catch (e) {}
        runGeneration(p);
        return;
      }
      try {
        var raw = sessionStorage.getItem('ug_pending');
        if (!raw) return;
        sessionStorage.removeItem('ug_pending');
        var snap = JSON.parse(raw);
        if (snap && snap.prompt) {
          var promptEl = document.getElementById('web-prompt');
          if (promptEl && !promptEl.value) promptEl.value = snap.prompt;
        }
        if (snap && snap.mode) {
          var modeInput = document.querySelector('input[name="mode"][value="' + String(snap.mode).replace(/"/g, '') + '"]');
          if (modeInput) {
            modeInput.checked = true;
            modeInput.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        var breastEl = document.getElementById('breast-size');
        var pubicEl = document.getElementById('pubic-hair');
        var variationsEl = document.getElementById('variation-count');
        if (breastEl && snap && snap.breastSize) breastEl.value = snap.breastSize;
        if (pubicEl && snap && snap.pubicHair) pubicEl.value = snap.pubicHair;
        if (variationsEl && snap && snap.variations) {
          variationsEl.value = String(snap.variations);
          variationsEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (snap && snap.dataUrl) runGeneration(Promise.resolve(payloadFromSnapshot(snap)));
      } catch (e) { /* ignore */ }
    }

    function revealLoginPrompt() {
      var box = document.getElementById('login-box');
      if (box) {
        box.hidden = false;
        try { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
      }
      setStatus(t('signInToGenerate', 'Sign in to generate — your photo and prompt are saved.'), 'working');
    }

    function initEmailLogin() {
      var startBtn = document.getElementById('email-login-start');
      var emailForm = document.getElementById('email-form');
      var codeForm = document.getElementById('email-code-form');
      var emailInput = document.getElementById('email-input');
      var codeInput = document.getElementById('email-code');
      var sentCopy = document.getElementById('email-sent-copy');
      var errorEl = document.getElementById('login-error');
      var resendBtn = document.getElementById('email-resend');
      var backBtn = document.getElementById('email-back');
      if (!startBtn || !emailForm || !codeForm) return;
      var currentEmail = '';
      function showError(msg) { if (errorEl) { errorEl.textContent = msg || ''; errorEl.hidden = !msg; } }
      startBtn.addEventListener('click', function () {
        startBtn.hidden = true; emailForm.hidden = false; showError('');
        if (emailInput) emailInput.focus();
      });
      function sendCode() {
        showError('');
        var email = (emailInput.value || '').trim();
        if (!email) return;
        var sendBtn = document.getElementById('email-send');
        if (sendBtn) sendBtn.disabled = true;
        fetch(apiUrl('/web/auth/email/start'), { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email }) })
          .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
          .then(function (res) {
            if (sendBtn) sendBtn.disabled = false;
            if (!res.ok || !res.d.ok) { showError(res.d.message || 'Could not send the code.'); return; }
            currentEmail = res.d.email || email;
            emailForm.hidden = true; codeForm.hidden = false;
            if (sentCopy) sentCopy.textContent = t('emailCodeSent', 'We emailed a 6-digit code to {email}. It expires in {min} minutes.').replace('{email}', currentEmail).replace('{min}', String(res.d.ttlMinutes || 15));
            if (codeInput) { codeInput.value = ''; codeInput.focus(); }
            track('website_email_code_sent', {});
          })
          .catch(function () { if (sendBtn) sendBtn.disabled = false; showError('Network error. Try again.'); });
      }
      emailForm.addEventListener('submit', function (e) { e.preventDefault(); sendCode(); });
      if (resendBtn) resendBtn.addEventListener('click', function () { sendCode(); });
      if (backBtn) backBtn.addEventListener('click', function () { codeForm.hidden = true; emailForm.hidden = false; showError(''); if (emailInput) emailInput.focus(); });
      codeForm.addEventListener('submit', function (e) {
        e.preventDefault(); showError('');
        var code = (codeInput.value || '').trim();
        if (code.length < 4) return;
        var verifyBtn = document.getElementById('email-verify');
        if (verifyBtn) verifyBtn.disabled = true;
        fetch(apiUrl('/web/auth/email/verify'), { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: currentEmail, code: code, ug_fp: deviceFingerprint(), tracking: storedTracking() }) })
          .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
          .then(function (res) {
            if (verifyBtn) verifyBtn.disabled = false;
            if (!res.ok || !res.d.ok) { showError(res.d.message || 'Verification failed.'); return; }
            track('website_email_verified', {});
            updateWebAccount(res.d);
            resumePendingGeneration();
          })
          .catch(function () { if (verifyBtn) verifyBtn.disabled = false; showError('Network error. Try again.'); });
      });
    }

    if (!form) return;
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var payloadPromise = buildGenerationPayload();
      if (!payloadPromise) return;
      var authed = !!(currentSession && currentSession.user);
      track('website_generation_submit', { mode: selectedModeValue(), logged_in: authed });
      // Must be signed in to generate — save their work and prompt sign-up.
      if (!authed) {
        stashPending(payloadPromise);
        revealLoginPrompt();
        paintResultNotice({
          icon: '🔒',
          title: t('signUpToGenerateTitle', 'Sign up to generate'),
          message: signupCreditCopy() + ' — ' + t('noCardNeeded', 'no card needed.'),
          actionLabel: t('continueGoogle', 'Continue with Google'),
          onAction: goToGoogleLogin
        });
        return;
      }
      runGeneration(payloadPromise);
    });
  }

  // Boot ASAP
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Pages without the generator (e.g. referral.html) still need the session so
  // the account menu + referral panel render. initWebGenerator() bails early on
  // those pages (no [data-web-generator]), so drive the session here instead.
  function initReferralPage() {
    if (!document.getElementById('ref-panel') && !document.getElementById('ref-anon')) return;
    if (document.querySelector('[data-web-generator]')) return;  // generator page already loads it
    initAccountControls();
    refreshWebSession();  // → updateWebAccount → updateReferral renders the page
  }

  function boot() {
    preloadCritical();
    buildMarquee();
    normalizeCtas();
    initLanguageSwitch();
    initTheme();
    initDiscountCode();
    initWebGenerator();
    initReferralPage();
    initSticky();
    initLiveCounter();
    initToast();
    refreshIcons();
  }
})();
