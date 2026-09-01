/**
 * UndressGoon — fast gallery + conversion helpers
 * Images: hard-coded list of WebP thumbs (no sequential probing)
 */
(function () {
  'use strict';

  var CFG = window.UG_CONFIG || {};
  var BOT_URL = CFG.botUrl || 'https://t.me/goonmasterbotbot?start=web';
  var ETA_SECONDS = Number(CFG.etaSeconds || 60);
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

  function validateSavedDiscountAfterLogin(session) {
    // Campaign links may be opened while logged out. Once OAuth/email login
    // establishes the session, validate the carried code so the customer sees
    // the actual bonus before they choose a pack. Checkout still validates on
    // the server as the authoritative final gate.
    if (!discountCode || !session || !session.ok || !session.user) return Promise.resolve(false);
    return saveDiscountCode(discountCode);
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
  // Resolves the site root from our own <script src>, so a locale page under
  // /fr/ points at ../examples/ and not /fr/examples/.
  var SITE_VERSION = '';

  function detectSiteBase() {
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].getAttribute('src') || '';
      if (src.indexOf('site.js') === -1) continue;
      // "assets/site.js" -> "", "../assets/site.js" -> "../"
      var q = src.match(/\?v=([^&"']+)/);
      if (q) SITE_VERSION = q[1];
      return src.replace(/assets\/site\.js(\?.*)?$/, '');
    }

    var path = (location.pathname || '').replace(/\\/g, '/');
    if (/\/(es|pt|fr|de|ru|zh|ja)(\/index\.html)?$/i.test(path)) {
      return '../';
    }
    return '';
  }

  var SITE_BASE = detectSiteBase();





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
    // Progress chatter ("Reading upload...", "Still generating... 65s elapsed")
    // is already shown by the generation loader, and repeating it under the
    // button just added noise. Only failures and completions land here now.
    if (tone === 'working') {
      el.textContent = '';
      el.dataset.tone = '';
      return;
    }
    el.textContent = text || '';
    el.dataset.tone = tone || '';
  }

  // ---- "working on your photo" preview -------------------------------
  // The uploaded photo, drawn heavily pixelated and resolving slowly while the
  // job runs, with a bar that fills towards the expected wait. It shows the
  // worker is chewing on THEIR image, and the detail never becomes visible.
  var _pvTimer = 0, _pvRaf = 0, _pvStarted = 0, _pvImg = null, _pvBlocks = 0;
  var PV_START_BLOCKS = 14, PV_MAX_BLOCKS = 46;

  function ensurePreview() {
    var panel = document.querySelector('.result-panel');
    if (!panel) return null;
    var el = document.getElementById('ug-preview');
    if (el) return el;
    el = document.createElement('div');
    el.className = 'ug-preview';
    el.id = 'ug-preview';
    el.hidden = true;
    el.innerHTML =
      // the sweep lives INSIDE the media box: as a sibling it was sized
      // against the whole preview block and swept on past the photo
      '<div class="ug-preview-media">' +
        '<canvas id="ug-preview-canvas"></canvas>' +
        '<div class="ug-preview-scan" aria-hidden="true"></div>' +
      '</div>' +
      '<p class="ug-preview-label" id="ug-preview-label"></p>' +
      '<div class="ug-preview-bar" aria-hidden="true"><span id="ug-preview-fill"></span></div>';
    panel.insertBefore(el, panel.firstChild);
    return el;
  }

  function drawPreviewFrame() {
    var canvas = document.getElementById('ug-preview-canvas');
    if (!canvas || !_pvImg) return;
    var ratio = _pvImg.naturalHeight / _pvImg.naturalWidth || 1;
    var w = Math.max(4, Math.round(_pvBlocks));
    var h = Math.max(4, Math.round(_pvBlocks * ratio));
    canvas.width = w;
    canvas.height = h;              // tiny canvas...
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(_pvImg, 0, 0, w, h);
    // ...upscaled by CSS with image-rendering: pixelated
    canvas.style.aspectRatio = _pvImg.naturalWidth + ' / ' + _pvImg.naturalHeight;
  }

  // A live counter on its own reads like a hang, so the label narrates the
  // stages instead. Times are cosmetic: the worker reports no sub-progress.
  var PV_STEPS = [
    { at: 0,  key: 'workStep1', text: 'Uploading your photo' },
    { at: 6,  key: 'workStep2', text: 'Applying the preset' },
    { at: 15, key: 'workStep3', text: 'Rendering the details' },
    { at: 28, key: 'workStep4', text: 'Enhancing the quality' },
    { at: 42, key: 'workStep5', text: 'Adding the finishing touches' }
  ];

  function previewStatus(elapsed) {
    if (selectedModeValue() === 'video') {
      return t(
        'videoPatientWait',
        'Video generation can take up to 3 minutes, so please be patient.'
      );
    }
    // past the advertised wait, say why rather than counting on in silence
    if (elapsed > ETA_SECONDS) {
      return t(
        'workBusy',
        'Other users are generating right now, so this one takes a little longer.'
      );
    }
    var step = PV_STEPS[0];
    for (var i = 0; i < PV_STEPS.length; i++) {
      if (elapsed >= PV_STEPS[i].at) step = PV_STEPS[i];
    }
    return t(step.key, step.text) + '…';
  }

  function tickPreview() {
    var elapsed = (Date.now() - _pvStarted) / 1000;
    var previewEta = selectedModeValue() === 'video' ? 180 : ETA_SECONDS;
    // fill towards 92% over the expected wait, then creep, so it never sits
    // still and never claims to be finished early
    var pct = elapsed <= previewEta
      ? (elapsed / previewEta) * 92
      : 92 + Math.min(6, (elapsed - previewEta) * 0.25);
    var fill = document.getElementById('ug-preview-fill');
    if (fill) fill.style.width = Math.min(98, Math.max(2, pct)).toFixed(1) + '%';
    var label = document.getElementById('ug-preview-label');
    if (label) {
      label.innerHTML = '<b>' + Math.round(elapsed) + 's</b> · ' +
        esc(previewStatus(elapsed));
    }
    _pvRaf = window.setTimeout(tickPreview, 250);
  }

  // On a stacked (phone) layout the result panel sits below the whole form, so
  // tapping Generate looks like nothing happened. Bring the preview on screen,
  // but only when it is not already there, and never on lp2: that page moves
  // its own stage and scrolls itself.
  // instant, not smooth: a smooth scroll silently does nothing where the
  // compositor is not animating, and these have to land every time
  // Phones stack the generator and the result vertically, so on a tap the
  // answer is below the fold and we scroll to it. Desktop lays them side by
  // side — the result is already on screen, so that same scroll just yanks the
  // page down for nothing. Gate the on-submit / on-loading scroll to mobile;
  // desktop only recentres the finished result (and only if it is off screen).
  function isMobileView() {
    return (window.innerWidth || document.documentElement.clientWidth || 0) < 768;
  }

  function scrollToElement(el, block) {
    if (!el) return;
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    var rect = el.getBoundingClientRect();
    try {
      el.scrollIntoView({ block: block || 'center' });
    } catch (e) {
      el.scrollIntoView();
    }
    // and if that did not move the page, drive the window itself
    if (el.getBoundingClientRect().top === rect.top) {
      window.scrollTo(0, Math.max(0, rect.top + window.pageYOffset - vh * 0.25));
    }
  }

  function scrollResultIntoView(el) {
    if (!el) return;
    if (document.getElementById('lp2-stage-result')) return;
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    var rect = el.getBoundingClientRect();
    if (rect.top >= 0 && rect.top < vh * 0.6) return;   // already in sight
    scrollToElement(el, 'center');
  }

  function startWorkingPreview(file) {
    var el = ensurePreview();
    if (!el || !file) return;
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      _pvImg = img;
      _pvBlocks = PV_START_BLOCKS;
      el.hidden = false;
      // the old orbit loader may already be on screen from the 'preparing'
      // call before this ran; hide it now rather than on the next poll
      var oldLoader = document.getElementById('generation-loader');
      if (oldLoader) oldLoader.hidden = true;
      drawPreviewFrame();
      if (isMobileView()) scrollResultIntoView(el);
      _pvStarted = Date.now();
      window.clearInterval(_pvTimer);
      _pvTimer = window.setInterval(function () {
        // ease towards the cap so it decelerates instead of resolving early
        _pvBlocks += Math.max(0.6, (PV_MAX_BLOCKS - _pvBlocks) * 0.08);
        if (_pvBlocks > PV_MAX_BLOCKS) _pvBlocks = PV_MAX_BLOCKS;
        drawPreviewFrame();
      }, 1200);
      window.clearTimeout(_pvRaf);
      tickPreview();
    };
    img.onerror = function () { URL.revokeObjectURL(url); };
    img.src = url;
  }

  function stopWorkingPreview(complete) {
    window.clearInterval(_pvTimer); _pvTimer = 0;
    window.clearTimeout(_pvRaf); _pvRaf = 0;
    var fill = document.getElementById('ug-preview-fill');
    if (fill && complete) fill.style.width = '100%';
    var el = document.getElementById('ug-preview');
    if (!el) return;
    // let the bar visibly reach the end before the preview disappears
    window.setTimeout(function () { el.hidden = true; }, complete ? 260 : 0);
    _pvImg = null;
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
    // The pixelated preview replaces this loader: it shows the same elapsed
    // time and its own filling bar. Showing both was two spinners stacked.
    // (This runs on every poll, so the check has to live here, not in CSS.)
    var pv = document.getElementById('ug-preview');
    if (pv && !pv.hidden) {
      loader.hidden = true;
      if (empty) empty.hidden = true;
      return;
    }
    var elapsed = Math.max(0, Math.round((Date.now() - (startedAt || Date.now())) / 1000));
    var title = document.getElementById('gen-loader-title');
    var sub = document.getElementById('gen-loader-sub');
    var bar = document.getElementById('gen-progress-bar');
    var videoMode = selectedModeValue() === 'video';
    var eta = videoMode ? 180 : ETA_SECONDS;
    var label = videoMode ? t('videoRunningTitle', 'Generating your video') : t('genRunningTitle', 'Generating your image');
    var detail = t('genRunningSub', '{elapsed}s elapsed. Typical wait is {eta}s, sometimes a little longer.')
      .replace('{elapsed}', String(elapsed))
      .replace('{eta}', String(eta));
    var progress = Math.min(96, 18 + Math.round((elapsed / Math.max(eta, 1)) * 72));
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

  // A plain explanation popup. Deliberately NOT the top-up modal: tapping a
  // gated preset is a moment to explain what the free generation covers, not
  // to push packs at someone who has not tried the product yet.
  function showNotice(title, message) {
    var el = document.getElementById('ug-notice');
    if (!el) {
      el = document.createElement('div');
      el.className = 'ug-notice';
      el.id = 'ug-notice';
      el.innerHTML =
        '<div class="ug-notice-backdrop" data-close-notice></div>' +
        '<div class="ug-notice-box" role="dialog" aria-modal="true">' +
          '<strong class="ug-notice-title"></strong>' +
          '<p class="ug-notice-msg"></p>' +
          '<button type="button" class="btn btn-accent ug-notice-ok" data-close-notice></button>' +
        '</div>';
      document.body.appendChild(el);
      el.addEventListener('click', function (ev) {
        if (ev.target.hasAttribute('data-close-notice')) hideNotice();
      });
      document.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') hideNotice();
      });
    }
    el.querySelector('.ug-notice-title').textContent = title || '';
    el.querySelector('.ug-notice-msg').textContent = message || '';
    el.querySelector('.ug-notice-ok').textContent = t('noticeOk', 'Got it');
    el.hidden = false;
    setTimeout(function () { el.classList.add('is-open'); }, 20);
  }

  function hideNotice() {
    var el = document.getElementById('ug-notice');
    if (!el || el.hidden) return;
    el.classList.remove('is-open');
    setTimeout(function () { el.hidden = true; }, 180);
  }

  // Keep naming a saved recipe inside the product instead of invoking the
  // browser's security-styled `window.prompt()` dialog.
  function askSavedVideoRecipeName(defaultValue) {
    return new Promise(function (resolve) {
      var el = document.getElementById('ug-recipe-name-dialog');
      if (!el) {
        el = document.createElement('div');
        el.className = 'ug-recipe-name-dialog';
        el.id = 'ug-recipe-name-dialog';
        el.hidden = true;
        el.innerHTML =
          '<div class="ug-recipe-name-backdrop" data-close-recipe-name></div>' +
          '<form class="ug-recipe-name-box" aria-modal="true" role="dialog">' +
            '<strong>Save custom prompt</strong>' +
            '<p>Give this recipe a short name so you can find it again.</p>' +
            '<label for="ug-recipe-name-input">Prompt name</label>' +
            '<input id="ug-recipe-name-input" type="text" maxlength="80" autocomplete="off" required />' +
            '<div class="ug-recipe-name-actions">' +
              '<button type="button" class="btn ug-recipe-name-cancel" data-close-recipe-name>Cancel</button>' +
              '<button type="submit" class="btn btn-accent">Save prompt</button>' +
            '</div>' +
          '</form>';
        document.body.appendChild(el);
        el.addEventListener('click', function (ev) {
          if (ev.target.hasAttribute('data-close-recipe-name')) closeSavedVideoRecipeName(null);
        });
        el.querySelector('form').addEventListener('submit', function (ev) {
          ev.preventDefault();
          var input = el.querySelector('#ug-recipe-name-input');
          closeSavedVideoRecipeName(input ? input.value : '');
        });
        document.addEventListener('keydown', function (ev) {
          if (ev.key === 'Escape' && !el.hidden) closeSavedVideoRecipeName(null);
        });
      }
      el._resolveRecipeName = resolve;
      var input = el.querySelector('#ug-recipe-name-input');
      if (input) input.value = defaultValue || '';
      el.hidden = false;
      document.body.classList.add('modal-open');
      setTimeout(function () {
        el.classList.add('is-open');
        if (input) { input.focus(); input.select(); }
      }, 20);
    });
  }

  function closeSavedVideoRecipeName(value) {
    var el = document.getElementById('ug-recipe-name-dialog');
    if (!el || el.hidden) return;
    var resolve = el._resolveRecipeName;
    el._resolveRecipeName = null;
    el.classList.remove('is-open');
    document.body.classList.remove('modal-open');
    setTimeout(function () { el.hidden = true; }, 180);
    if (resolve) resolve(value);
  }

  // Deleting a private recipe deserves the same product-native confirmation as
  // saving one. This avoids Chrome/Safari's generic security-looking confirm
  // dialog and makes the destructive action explicit.
  function confirmSavedVideoRecipeDelete(label) {
    return new Promise(function (resolve) {
      var el = document.getElementById('ug-recipe-delete-dialog');
      if (!el) {
        el = document.createElement('div');
        // Reuse the proven saved-recipe naming modal shell. The landing page
        // ships this stylesheet, unlike the legacy site.css file.
        el.className = 'ug-recipe-name-dialog';
        el.id = 'ug-recipe-delete-dialog';
        el.hidden = true;
        el.innerHTML =
          '<div class="ug-recipe-name-backdrop" data-close-recipe-delete></div>' +
          '<div class="ug-recipe-name-box" aria-modal="true" role="dialog" aria-labelledby="ug-recipe-delete-title">' +
            '<strong id="ug-recipe-delete-title">Delete saved prompt?</strong>' +
            '<p class="ug-recipe-delete-copy"></p>' +
            '<div class="ug-recipe-name-actions">' +
              '<button type="button" class="btn ug-recipe-name-cancel ug-recipe-delete-cancel" data-close-recipe-delete>Keep it</button>' +
              '<button type="button" class="btn btn-accent ug-recipe-delete-confirm">Delete prompt</button>' +
            '</div>' +
          '</div>';
        document.body.appendChild(el);
        el.addEventListener('click', function (ev) {
          if (ev.target.hasAttribute('data-close-recipe-delete')) closeSavedVideoRecipeDelete(false);
          if (ev.target.classList.contains('ug-recipe-delete-confirm')) closeSavedVideoRecipeDelete(true);
        });
        document.addEventListener('keydown', function (ev) {
          if (ev.key === 'Escape' && !el.hidden) closeSavedVideoRecipeDelete(false);
        });
      }
      el._resolveRecipeDelete = resolve;
      var copy = el.querySelector('.ug-recipe-delete-copy');
      if (copy) copy.textContent = 'Remove “' + (label || 'this saved prompt') + '” from your saved prompts? This cannot be undone.';
      el.hidden = false;
      document.body.classList.add('modal-open');
      setTimeout(function () {
        el.classList.add('is-open');
        var cancel = el.querySelector('.ug-recipe-delete-cancel');
        if (cancel) cancel.focus();
      }, 20);
    });
  }

  function closeSavedVideoRecipeDelete(approved) {
    var el = document.getElementById('ug-recipe-delete-dialog');
    if (!el || el.hidden) return;
    var resolve = el._resolveRecipeDelete;
    el._resolveRecipeDelete = null;
    el.classList.remove('is-open');
    document.body.classList.remove('modal-open');
    setTimeout(function () { el.hidden = true; }, 180);
    if (resolve) resolve(Boolean(approved));
  }

  function showCheckout(show, reason) {
    var panel = document.getElementById('checkout-panel');
    if (!panel) return;
    if (show) {
      track('website_topup_opened', { reason: reason || 'manual' });
      track('website_pricing_viewed', { surface: 'modal' });
      var title = document.getElementById('topup-title');
      var copy = document.getElementById('topup-copy');
      if (reason === 'exit_post_gen') {
        if (title) title.textContent = t('exitOfferTitle', 'Wait - your first result unlocked a private deal');
        if (copy) copy.textContent = t('exitOfferCopy', 'Keep going now and get bonus credits added automatically to every pack.');
      } else {
        if (title) title.textContent = reason === 'empty' ? t('topupEmptyTitle', 'You are out of credits') : t('topupTitle', 'Ready to create more?');
        if (copy) copy.textContent = reason === 'empty' ? t('topupEmptyCopy', 'Choose a pack and keep generating in seconds.') : t('topupCopy', 'Choose a credit pack and keep creating.');
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

  var iconPassBusy = false;
  function refreshIcons() {
    // Lucide walks the whole document. Re-entering from a MutationObserver
    // while icons are being swapped used to pin the main thread so the tab
    // painted but refused every click. Skip if a pass is already running or
    // there is nothing left to replace.
    if (iconPassBusy) return;
    if (!window.lucide || typeof window.lucide.createIcons !== 'function') return;
    if (!document.querySelector('[data-lucide]')) return;
    iconPassBusy = true;
    try {
      window.lucide.createIcons();
    } finally {
      iconPassBusy = false;
    }
  }
  window.UG_REFRESH_ICONS = refreshIcons;

  function emitUi(name) {
    try { document.dispatchEvent(new CustomEvent(name)); } catch (e) {}
  }

  // Give page-specific UI layers first refusal on prompts that need richer
  // presentation. A cancelled event means that layer displayed the prompt;
  // pages without it keep the inline fallback below.
  function requestUi(name, detail) {
    try {
      var event = new CustomEvent(name, { cancelable: true, detail: detail || {} });
      document.dispatchEvent(event);
      return event.defaultPrevented;
    } catch (e) {
      return false;
    }
  }

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
        img.setAttribute('src', src.replace('brand-logo-fast.webp', 'brand-logo-light-fast.webp').replace('brand-logo-fast.png', 'brand-logo-light-fast.webp').replace('brand-logo.png', 'brand-logo-light-fast.webp'));
      } else {
        img.setAttribute('src', src.replace('brand-logo-light-fast.webp', 'brand-logo-fast.webp').replace('brand-logo-light-fast.png', 'brand-logo-fast.webp').replace('brand-logo-light.png', 'brand-logo-fast.webp'));
      }
    });
  }

  function initTheme() {
    var saved = '';
    try { saved = localStorage.getItem('ug_theme') || ''; } catch (e) {}
    // Light is the default on arrival regardless of OS preference: a paid
    // adult service reads as more legitimate on white, and first-time visitors
    // decide whether to trust the page long before they touch the toggle.
    // Only switch to dark if the visitor explicitly chose it.
    // The markup already ships data-theme="light", so this agrees with what is
    // painted and nothing flashes; a saved "dark" repaints once, on purpose.
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
      // Keep email offer/referral query parameters and the intended section
      // through OAuth. The backend safely merges google_login into this URL on
      // the way back instead of replacing its existing query.
      params.set('return_to', location.origin + location.pathname + location.search + location.hash);
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

  var lastSceneCheckUser = null;

  function updateWebAccount(session) {
    currentSession = session && session.ok ? session : null;
    // Scene mode is unlocked per account during the beta, and scenes.js asked
    // before anyone was signed in, so re-ask whenever the user changes.
    var uid = currentSession && currentSession.user ? String(currentSession.user.id) : '';
    if (uid !== lastSceneCheckUser) {
      lastSceneCheckUser = uid;
      if (uid && window.UG_RECHECK_SCENES) window.UG_RECHECK_SCENES();
    }
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
    // Conversion landing hides signup until Generate. Never force-show the
    // login box from a session refresh — that fought lp2-core's visibility
    // observer and froze the page. Reveal happens in revealLoginPrompt().
    if (login && authed) login.hidden = true;
    if (logout) logout.hidden = !authed;
    if (form) form.classList.remove('is-locked');
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
        var baseline = 0;  // most expensive $/credit (the smallest pack) = savings baseline
        packs.forEach(function (p) {
          var c = Number(p.credits || 0);
          if (c) baseline = Math.max(baseline, (Number(p.priceCents || 0) / c) / 100);
        });
        grid.innerHTML = packs.map(function (pack, idx) {
          var credits = Number(pack.credits || pack.baseCredits || 0);
          var perCredit = credits ? ((Number(pack.priceCents || 0) / credits) / 100) : 0;
          var savings = (baseline && perCredit) ? Math.round((1 - (perCredit / baseline)) * 100) : 0;
          // These are deliberate conversion anchors, not inferred from list
          // position. The Mega tier is for volume; the $99.99 tier remains the
          // highlighted value choice.
          var isPopular = pack.code === 'pack_200';
          var isBest = pack.code === 'pack_1000';
          var isMega = pack.code === 'pack_2000';
          var ribbon = isBest ? '<em class="pack-badge best">' + esc(t('bestValue', 'BEST VALUE')) + '</em>'
                    : isPopular ? '<em class="pack-badge pop">' + esc(t('mostPopular', 'MOST POPULAR')) + '</em>'
                    : isMega ? '<em class="pack-badge max">MAX CREDITS</em>' : '';
          var saveBadge = savings >= 5 ? '<span class="pack-save">−' + savings + '%</span>' : '';
          var planName = pack.title ? '<span class="pack-plan-name">' + esc(pack.title) + '</span>' : '';
          var creditLine = credits + ' ' + esc(t('creditsWord', 'credits'));
          // Per-credit price stays accurate for both one-credit images and
          // two-credit videos. Strike through the smallest pack's rate so the
          // saving remains visible without implying a generation count.
          var perCreditLine = perCredit ?
            ('<span class="pack-perimg">$' + perCredit.toFixed(2) + ' / ' + esc(t('creditWord', 'credit')) +
              (savings >= 10 ? ' <s>$' + baseline.toFixed(2) + '</s>' : '') + '</span>') : '';
          var cryptoButton = data.cryptoEnabled !== false ?
            '<button type="button" data-crypto-pack="' + esc(pack.code) + '"><i data-lucide="wallet"></i> ' + esc(t('payCrypto', 'Crypto')) + '</button>' :
            '';
          var cardButton = data.cardEnabled ?
            '<button type="button" class="pay-card-pack" data-card-pack="' + esc(pack.code) + '"><i data-lucide="credit-card"></i> ' + esc(t('payCard', 'Card')) + '</button>' :
            '';
          return (
            '<div class="pack-card ' + (isBest ? 'featured' : '') + '" data-pack-code="' + esc(pack.code) + '" style="--i:' + idx + '">' +
              ribbon + saveBadge + planName +
              '<strong class="pack-credits">' + creditLine + '</strong>' +
              packPriceHtml(pack) +
              perCreditLine +
              '<ul class="pack-perks">' +
                '<li><i data-lucide="check"></i> ' + esc(t('perkUnlock', 'Unlocks all presets + custom prompts')) + '</li>' +
                '<li><i data-lucide="check"></i> ' + esc(t('perkScenesVideos', 'Unlocks scenes + videos')) + '</li>' +
              '</ul>' +
              '<div class="pack-actions">' + cardButton + cryptoButton + '</div>' +
            '</div>'
          );
        }).join('');
        refreshIcons();
        grid.querySelectorAll('button[data-crypto-pack]').forEach(function (button) {
          button.addEventListener('click', function () {
            var code = button.getAttribute('data-crypto-pack');
            track('website_checkout_started', { method: 'crypto', code: code });
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
    track('website_checkout_started', { method: 'card', code: code });
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

  // One dropped poll must not lose a generation the user has already paid for.
  // Mobile connections blip, and a finished batch is a multi-megabyte response,
  // so a single "Failed to fetch" is retried rather than surfaced. Errors the
  // API actually returned carry .payload and are never retried.
  function pollGeneration(jobId, attempt) {
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
      .catch(function (err) {
        if (err && err.payload) throw err;
        if ((attempt || 0) >= 5) throw err;
        track('website_poll_retry', { attempt: (attempt || 0) + 1 });
        return new Promise(function (resolve) { setTimeout(resolve, 2000); })
          .then(function () { return pollGeneration(jobId, (attempt || 0) + 1); });
      });
  }

  function waitForGeneration(jobId, startedAt) {
    var started = startedAt || Date.now();
    return pollGeneration(jobId, 0)
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

  // A batch is a carousel, not a row of thumbnails: every image gets the full
  // frame and the user pages through them. Arrows drive a snapping scroller,
  // so a swipe on touch and a click on desktop end up in the same place.
  function buildGalleryNav(gallery, track, total) {
    var prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'ug-nav ug-nav-prev';
    prev.setAttribute('aria-label', t('prevImage', 'Previous image'));
    prev.innerHTML = '<i data-lucide="chevron-left"></i>';

    var next = document.createElement('button');
    next.type = 'button';
    next.className = 'ug-nav ug-nav-next';
    next.setAttribute('aria-label', t('nextImage', 'Next image'));
    next.innerHTML = '<i data-lucide="chevron-right"></i>';

    var count = document.createElement('p');
    count.className = 'ug-count';

    gallery.appendChild(prev);
    gallery.appendChild(next);
    gallery.appendChild(count);

    function index() {
      var w = track.clientWidth || 1;
      return Math.min(total - 1, Math.max(0, Math.round(track.scrollLeft / w)));
    }

    function sync() {
      var i = index();
      count.textContent = (i + 1) + ' / ' + total;
      prev.disabled = i <= 0;
      next.disabled = i >= total - 1;
    }

    function go(delta) {
      var w = track.clientWidth || 1;
      // plain scrollLeft, with the easing left to CSS scroll-behavior: a
      // scrollTo({behavior:'smooth'}) silently does nothing where the
      // compositor is not animating, which strands the arrows
      track.scrollLeft = Math.min(total - 1, Math.max(0, index() + delta)) * w;
      sync();
    }

    prev.addEventListener('click', function () { go(-1); });
    next.addEventListener('click', function () { go(1); });

    // the scroller is the source of truth: a swipe has to move the counter too
    var settle = 0;
    track.addEventListener('scroll', function () {
      window.clearTimeout(settle);
      settle = window.setTimeout(sync, 80);
    });
    window.addEventListener('resize', sync);
    sync();
  }

  function paintResults(images, videos, resultMeta) {
    var empty = document.getElementById('web-result-empty');
    var target = document.getElementById('web-results');
    if (!target) return;
    target.innerHTML = '';
    var list = images || [];
    var videoList = videos || [];

    var gallery = document.createElement('div');
    gallery.className = 'ug-gallery';
    var track = document.createElement('div');
    track.className = 'ug-track';
    gallery.appendChild(track);

    list.forEach(function (img, idx) {
      var url = 'data:' + (img.mime || 'image/jpeg') + ';base64,' + img.data;
      var name = 'undressgoon-' + (idx + 1) + '.jpg';
      // 'ug-result', not the old 'result-card': that name belonged to the
      // marquee, whose img rule (opacity: 0 until .loaded, object-fit: cover)
      // hid and cropped real results
      var card = document.createElement('div');
      card.className = 'ug-result';
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      var el = document.createElement('img');
      el.src = url;
      el.alt = t('generatedResult', 'Generated result') + ' ' + (idx + 1);
      a.appendChild(el);
      // an explicit button: tapping the picture to save it is not discoverable
      var dl = document.createElement('a');
      dl.className = 'result-download';
      dl.href = url;
      dl.download = name;
      dl.innerHTML = '<i data-lucide="download"></i> ' + esc(t('downloadImage', 'Download'));
      card.appendChild(a);
      card.appendChild(dl);
      track.appendChild(card);
    });

    videoList.forEach(function (item, idx) {
      var url = typeof item === 'string' ? item : (item && item.url) || '';
      if (!url) return;
      if (!/^https?:\/\//i.test(url) && url.charAt(0) === '/') url = apiUrl(url);
      var name = 'undressgoon-video-' + (idx + 1) + '.mp4';
      var card = document.createElement('div');
      card.className = 'ug-result ug-video-result';
      var video = document.createElement('video');
      video.controls = true;
      video.playsInline = true;
      video.preload = 'metadata';
      // Loading the cross-origin endpoint directly works as a download but some
      // browsers refuse to seek its protected FileResponse inside <video>.
      // Materialize the signed response as a same-document blob for reliable
      // metadata, duration and playback; retain the URL as a graceful fallback.
      fetch(url, { credentials: 'omit', cache: 'no-store' })
        .then(function (response) {
          if (!response.ok) throw new Error('Video fetch failed: ' + response.status);
          return response.blob();
        })
        .then(function (blob) {
          if (!blob.size) throw new Error('Video response was empty');
          var objectUrl = URL.createObjectURL(blob);
          video.src = objectUrl;
          video.load();
          window.addEventListener('beforeunload', function () {
            URL.revokeObjectURL(objectUrl);
          }, { once: true });
        })
        .catch(function () {
          video.src = url;
          video.load();
        });
      var dl = document.createElement('a');
      dl.className = 'result-download';
      dl.href = url;
      dl.download = name;
      dl.innerHTML = '<i data-lucide="download"></i> ' + esc(t('downloadVideo', 'Download video'));
      card.appendChild(video);
      card.appendChild(dl);
      track.appendChild(card);
    });

    var resultCount = list.length + videoList.length;
    if (resultCount) {
      target.appendChild(gallery);
      if (resultCount > 1) buildGalleryNav(gallery, track, resultCount);
      // results live in this response only; nothing is stored server-side
      var note = document.createElement('p');
      note.className = 'result-save-note';
      note.textContent = videoList.length
        ? t('saveVideoNote', 'We do not keep your video permanently. Download it now if you want to keep it.')
        : t('saveNote', 'We do not store your images. Download them now if you want to keep them.');
      target.appendChild(note);
      if (resultMeta && resultMeta.canSaveCustomRecipe && resultMeta.jobId) {
        var saveRecipe = document.createElement('button');
        saveRecipe.type = 'button';
        saveRecipe.className = 'save-video-recipe-btn';
        saveRecipe.innerHTML = '<i data-lucide="bookmark-plus"></i> ' + esc(t('saveVideoRecipe', 'Save this custom prompt'));
        saveRecipe.addEventListener('click', function () {
          askSavedVideoRecipeName(t('saveVideoRecipeDefault', 'My custom video')).then(function (title) {
            if (title === null) return;
            saveRecipe.disabled = true;
            saveRecipe.textContent = t('savingVideoRecipe', 'Saving...');
            saveCustomVideoRecipe(resultMeta.jobId, title).then(function () {
              var savedBox = document.getElementById('saved-video-recipes');
              if (savedBox) { savedBox.hidden = false; savedBox.open = true; }
              saveRecipe.textContent = t('videoRecipeSaved', 'Saved to My saved video prompts');
            }).catch(function (err) {
              saveRecipe.disabled = false;
              saveRecipe.innerHTML = '<i data-lucide="bookmark-plus"></i> ' + esc(t('saveVideoRecipe', 'Save this custom prompt'));
              setStatus(err.message || 'Could not save this prompt.', 'error');
              refreshIcons();
            });
          });
        });
        target.appendChild(saveRecipe);
      }
    }
    refreshIcons();
    if (empty) empty.hidden = !!resultCount;
    // Bring the finished result into view — on desktop this is the only
    // scroll; scrollResultIntoView no-ops when it is already on screen.
    if (resultCount) scrollResultIntoView(document.querySelector('.result-panel'));
    emitUi('ug:results-updated');
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
      ? t('signupClaim2', 'Sign up to claim your 2 free generations')
      : t('signupClaim1', 'Sign up, your first generation is free');
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
    emitUi('ug:results-updated');
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
    if (!document.getElementById('saved-video-recipes')) {
      var promptField = document.getElementById('web-prompt');
      var saved = document.createElement('details');
      saved.id = 'saved-video-recipes';
      saved.className = 'saved-video-recipes';
      saved.hidden = true;
      saved.innerHTML =
        '<summary><i data-lucide="bookmark"></i> ' + esc(t('savedVideoPrompts', 'My saved video prompts')) + '</summary>' +
        '<p class="saved-video-recipes-copy">' + esc(t('savedVideoPromptsHint', 'Reuse an exact custom recipe with a new photo. It will not be rewritten.')) + '</p>' +
        '<div class="saved-video-recipes-list"></div>';
      if (promptField) promptField.insertAdjacentElement('afterend', saved);
      else form.appendChild(saved);
    }
    if (!document.getElementById('video-double-length-row')) {
      var duration = document.createElement('label');
      duration.id = 'video-double-length-row';
      duration.className = 'video-double-length-row';
      duration.hidden = true;
      duration.innerHTML =
        '<input id="video-double-length" type="checkbox" />' +
        '<span><strong>' + esc(t('doubleVideoLength', 'Double video length')) + '</strong><small>for +2 credits</small></span>';
      var variationAnchor = document.getElementById('variation-row');
      if (variationAnchor) variationAnchor.insertAdjacentElement('afterend', duration);
      else form.appendChild(duration);
    }
  }

  // Free (never-purchased) users may only run the Fully Nude preset; everything
  // else — other presets + custom prompts — unlocks after any top-up.
  var FREE_PRESET_KEY = 'nude';
  // Catalogue served by the backend from presets.py (GET /web/presets). It is
  // the authoritative KEY LIST, so the bot and the site can never drift; the
  // prompt text stays server-side and is resolved from the key at generation
  // time. Labels stay local because each locale page ships translated ones.
  var remoteCatalogue = null;
  var remoteScenes = null;      // /web/scenes catalogue, so the picker never drifts
  var remoteVideos = null;      // reviewed production H3 catalogue
  var rerenderPresets = null;   // set by initPresets so a late fetch can repaint
  var selectedPresetKey = '';   // sent as `preset` on submit
  var selectedSavedVideoRecipeId = 0;
  var savedVideoRecipes = [];
  var renderSavedVideoRecipes = null;

  function loadPresetCatalogue() {
    return fetch(apiUrl('/web/presets'), { credentials: 'include' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data || !data.ok || !data.presets || !data.presets.length) return;
        remoteCatalogue = data;
        if (data.freePresetKey) FREE_PRESET_KEY = data.freePresetKey;
        if (rerenderPresets) rerenderPresets();
      })
      .catch(function () { /* keep the built-in list as a fallback */ });
  }

  function loadVideoCatalogue() {
    return fetch(apiUrl('/web/video-presets'), { credentials: 'include' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data || !data.ok) return;
        remoteVideos = data;
        if (rerenderPresets) rerenderPresets();
        document.dispatchEvent(new Event('ug:video-catalogue-updated'));
      })
      .catch(function () { /* keep the built-in production video catalogue */ });
  }

  function loadSavedVideoRecipes() {
    if (!(currentSession && currentSession.user)) {
      savedVideoRecipes = [];
      if (renderSavedVideoRecipes) renderSavedVideoRecipes();
      return Promise.resolve(savedVideoRecipes);
    }
    return fetch(apiUrl('/web/video-recipes'), { credentials: 'include' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        savedVideoRecipes = data && data.ok && Array.isArray(data.recipes) ? data.recipes : [];
        if (renderSavedVideoRecipes) renderSavedVideoRecipes();
        return savedVideoRecipes;
      })
      .catch(function () {
        savedVideoRecipes = [];
        if (renderSavedVideoRecipes) renderSavedVideoRecipes();
        return savedVideoRecipes;
      });
  }

  function saveCustomVideoRecipe(jobId, label) {
    return fetch(apiUrl('/web/video-recipes'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: jobId, label: label || '' })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || !data.ok) throw new Error(data.message || 'Could not save this prompt.');
        return loadSavedVideoRecipes().then(function () { return data.recipe; });
      });
    });
  }

  // Backend key list + local (translated) labels. Falls back to the hardcoded
  // UG_CONFIG catalogue, which still carries its own prompts, so a failed or
  // slow request degrades to the previous behaviour rather than an empty picker.
  function cataloguePresets(localPresets) {
    if (!remoteCatalogue || !remoteCatalogue.presets) return localPresets;
    var byKey = {};
    (localPresets || []).forEach(function (p) { byKey[p.key] = p; });
    return remoteCatalogue.presets.map(function (rp) {
      var local = byKey[rp.key];
      return {
        key: rp.key,
        category: rp.category,
        // a preset added server-side shows up immediately, in English, until
        // the locale page gets a translated label for it
        label: (local && local.label) || rp.label,
        prompt: local ? local.prompt : ''
      };
    });
  }
  // Scene catalogue from the backend. scenes.js already fetches /web/scenes for
  // the availability flag, so it hands the payload here rather than us issuing a
  // second request. Same contract as cataloguePresets: server owns the list,
  // local list only supplies labels, and a failed fetch degrades to the built-in
  // array instead of an empty picker.
  window.UG_APPLY_SCENE_CATALOGUE = function (payload) {
    var cat = payload && payload.scenes;
    if (!cat || !cat.presets || !cat.presets.length) return;
    remoteScenes = cat;
    if (rerenderPresets) rerenderPresets();
  };

  function sceneCatalogue(localScenes) {
    if (!remoteScenes || !remoteScenes.presets) return localScenes;
    var byKey = {};
    (localScenes || []).forEach(function (p) { byKey[p.key] = p; });
    return remoteScenes.presets.map(function (rp) {
      var local = byKey[rp.key];
      return {
        key: rp.key,
        category: rp.category,
        label: (local && local.label) || rp.label,
        // scene presets carry the KEY, not prose — the backend resolves it
        prompt: rp.key
      };
    });
  }

  function sceneCategories(localCats) {
    if (!remoteScenes || !remoteScenes.categories || !remoteScenes.categories.length) return localCats;
    var byKey = {};
    (localCats || []).forEach(function (c) { byKey[c.key] = c; });
    return remoteScenes.categories.map(function (rc) {
      var local = byKey[rc.key];
      return { key: rc.key, label: (local && local.label) || rc.label };
    });
  }

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
    var localPresets = CFG.presets || [];
    var presets = localPresets;
    if (!tabs || !grid || !prompt || !presets.length) return;

    var videoInput = document.querySelector('input[name="mode"][value="video"]');
    function applyVideoAvailability() {
      if (!videoInput) return;
      // Video is a public production feature. Render it live immediately and
      // let the backend remain the authority for authentication and credits.
      // A slow/unavailable catalogue request must never regress the UI to SOON.
      videoInput.disabled = false;
      var videoLabel = videoInput.parentElement;
      if (videoLabel) {
        videoLabel.classList.remove('video-coming-soon');
        videoLabel.classList.add('video-live');
        videoLabel.title = t('videoLiveTitle', 'Create an AI video from your photo');
        var videoBadge = videoLabel.querySelector('.video-soon-badge');
        if (videoBadge) videoBadge.textContent = 'NEW';
      }
    }
    applyVideoAvailability();

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
        + esc(activeMode() === 'video'
          ? t('writeOwnVideoPrompt', 'Write my own video prompt')
          : t('writeOwnPrompt', 'Write my own prompt'));
      refreshIcons();
    }
    if (writeOwn && !writeOwn.dataset.bound) {
      writeOwn.dataset.bound = '1';
      writeOwn.addEventListener('click', function () {
        if (!isBuyer()) { showNotice(t('lockedCustomTitle', 'Your free generation'), t('lockedCustomHint', 'Your free generation works with the Fully Nude preset. Top up to unlock every other outfit preset, scenes, videos, and custom prompts.')); return; }
        selected = '';
        selectedPresetKey = '';
        selectedSavedVideoRecipeId = 0;
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
    var videoCatsFallback = [
      { key: 'popular', label: t('videoTabPopular', 'Popular') },
      { key: 'couples', label: t('videoTabCouples', 'Couples') },
      { key: 'solo', label: t('videoTabSolo', 'Solo') },
      { key: 'fetish', label: t('videoTabFetish', 'Fetish') },
      { key: 'outfits', label: t('videoTabOutfits', 'Outfits') }
    ];
    var videoPresetsFallback = [
      { key: 'hmpussy_open_reveal', category: 'popular', label: t('videoShowPussy', 'Show pussy') },
      { key: 'topless_reveal', category: 'popular', label: t('videoTopless', 'Show boobs') },
      { key: 'hands_on_breast_play', category: 'popular', label: t('videoSqueezeBoobs', 'Squeeze boobs') },
      { key: 'ass_squeeze', category: 'popular', label: t('videoAssSqueeze', 'Ass squeeze') },
      { key: 'two_women_oral', category: 'couples', label: t('videoTwoWomenOral', 'Two Girls Oral') },
      { key: 'h3_native_doggy_visible_face', category: 'couples', label: t('videoDoggyStyle', 'Doggy Style') },
      { key: 'oral_pov', category: 'couples', label: t('videoDeepthroat', 'Deepthroat') },
      { key: 'submissive_begging', category: 'solo', label: t('videoSubmissive', 'Beg for It') },
      { key: 'post_workout_sweat', category: 'solo', label: t('videoSweat', 'Sweaty') },
      { key: 'oiled_body_caress', category: 'solo', label: t('videoOil', 'Oiled') },
      { key: 'feet_pantyhose_closeup', category: 'fetish', label: t('videoFeet', 'Feet') },
      { key: 'foot_play_pov', category: 'fetish', label: t('videoFootjob', 'Footjob') },
      { key: 'bdsm_whipped', category: 'fetish', label: t('videoWhipped', 'Whipped') },
      { key: 'black_lingerie_dance', category: 'outfits', label: t('videoLingerieDance', 'Lingerie dance') },
      { key: 'white_pantyhose_tease', category: 'outfits', label: t('videoPantyhose', 'Pantyhose') },
      { key: 'latex_hip_sway', category: 'outfits', label: t('videoLatex', 'Latex') }
    ];

    function videoCats() {
      if (remoteVideos) return remoteVideos.categories || [];
      return videoCatsFallback;
    }

    function videoPresets() {
      if (remoteVideos) {
        return (remoteVideos.presets || []).map(function (preset) {
          if (preset.key !== 'oral_pov') return preset;
          return Object.assign({}, preset, { label: t('videoDeepthroat', 'Deepthroat') });
        });
      }
      return videoPresetsFallback;
    }
    var requestedMode = '';
    var requestedModeApplied = false;
    try {
      requestedMode = new URLSearchParams(location.search || '').get('mode') || '';
    } catch (e) {}
    function applyRequestedMode() {
      if (requestedModeApplied || requestedMode !== 'video' || !videoInput || videoInput.disabled) return;
      videoInput.checked = true;
      active = (videoCats()[0] && videoCats()[0].key) || 'popular';
      selected = '';
      selectedPresetKey = '';
      prompt.value = '';
      showCustomPrompt(false);
      requestedModeApplied = true;
    }
    var presetPromptUpgrades = {
      nude: 'completely naked, fully exposed, no clothing at all, bare breasts with natural visible nipples and areolas, natural skin texture, same pose and same camera framing, clear recognizable face, realistic shadows on the body',
      oily: 'completely nude body covered in shiny oil, glistening skin, bare breasts with natural visible nipples and areolas, oil highlights on chest stomach hips and thighs, no clothing, clear face, preserve the original setting and background, lighting consistent with the original photo',
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
      { key: 'bbc', category: 'sex', label: 'BBC', prompt: 'bbc' },
      { key: 'blowjob_pov', category: 'oral', label: 'Blowjob (POV)', prompt: 'blowjob_pov' },
      { key: 'deepthroat', category: 'oral', label: 'Deepthroat', prompt: 'deepthroat' },
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
        esc(t('subjHead', 'Match your look, keep the body true to you (optional).')) + '</div>' +
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
      if (activeMode() === 'scene') return sceneCategories(sceneCats);
      if (activeMode() === 'video') return videoCats();
      return outfitCats;
    }

    function activePresets() {
      if (activeMode() === 'scene') return sceneCatalogue(scenePresets);
      if (activeMode() === 'video') return videoPresets();
      return cataloguePresets(presets);
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
      var video = mode === 'video';
      modeInputs.forEach(function (input) {
        if (input.parentElement) input.parentElement.classList.toggle('active', input.checked);
      });
      if (picker) picker.hidden = false;
      if (label) label.textContent = video
        ? t('chooseVideoLabel', 'PICK A VIDEO')
        : (scene
          ? t('chooseSceneLabel', 'PICK A SCENE')
          : t('presetPromptInstruction', 'CHOOSE A PRESET OR JUST DIRECTLY WRITE YOUR OWN PROMPT'));
      if (promptLabel) promptLabel.textContent = scene ? t('scenePromptLabel', 'Scene prompt') : t('promptLabel', 'Prompt');
      if (promptLabel && video) promptLabel.textContent = t('videoPromptLabel', 'Video prompt');
      prompt.required = true;
      if (clear) clear.hidden = true;
      var help = ensureSceneHelp();
      if (help) {
        help.hidden = !(scene || video);
        help.textContent = video
          ? t('videoHelp', 'Choose a video preset or write a detailed custom prompt. You can also describe anything you want the subject to say. More presets are on the way.')
          : t('sceneHelp', 'Pick a scene, then set your body details below so it comes out looking like you.');
      }
      prompt.placeholder = video
        ? t('videoPromptPlaceholder', 'Describe the movement, camera, framing, appearance, timing, sound, and any exact words you want the subject to say.')
        : (scene
          ? t('scenePromptPlaceholder', 'Example: riding him reverse cowgirl on a bed, POV from below')
          : t('promptPlaceholder', 'Example: tiny black micro bikini, glossy skin, bedroom mirror selfie'));
      // Scene/video modes hide the undress body controls.
      var adv = document.getElementById('advanced-options');
      if (adv) adv.style.display = (scene || video) ? 'none' : '';
      showSubject(scene);
      if (writeOwn) writeOwn.style.display = '';
      renderWriteOwn();
      // Only close the box when a catalogue scene is selected — closing it on
      // every mode sync would wipe a scene someone is mid-way through typing.
      if (scene && selected) showCustomPrompt(false);
    }

    function renderTabs() {
      var cats = activeCats();
      if (!cats.some(function (cat) { return cat.key === active; })) {
        active = cats[0].key;
      }
      tabs.innerHTML = cats.map(function (cat) {
        var selectedTab = cat.key === active;
        return '<button type="button" role="tab" aria-selected="' + (selectedTab ? 'true' : 'false') + '" class="' + (selectedTab ? 'active' : '') + '" data-cat="' + esc(cat.key) + '">' + esc(cat.label) + '</button>';
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
        var icon = mode === 'video' ? 'video' : (mode === 'scene' ? '' : (p.category === 'hot' ? 'flame' : (p.category === 'fantasy' ? 'sparkles' : 'shirt')));
        // Before the first top-up, only the backend-designated free outfit
        // preset is available. Everything else is visibly locked here so the
        // UI matches the server entitlement instead of failing after submit.
        var locked = !buyer && (mode !== 'outfit' || p.key !== FREE_PRESET_KEY);
        return '<button type="button" class="' + (p.key === selected ? 'active' : '') + (locked ? ' locked' : '') + '" data-key="' + esc(p.key) + '"' + (locked ? ' data-locked="1"' : '') + '><i data-lucide="' + icon + '"></i>' + esc(p.label) + (locked ? '<span class="preset-lock"><i data-lucide="lock"></i></span>' : '') + '</button>';
      }).join('');
      refreshIcons();
      grid.querySelectorAll('button').forEach(function (button) {
        button.addEventListener('click', function () {
          if (button.dataset.locked === '1') {
            // The status line sits below the fold, so the explanation was
            // invisible. Say it in a popup instead, without pushing packs.
            showNotice(
              mode === 'video' ? t('videoUnlockTitle', 'Unlock AI video') : t('lockedPresetTitle', 'Your free generation'),
              mode === 'video'
                ? t('videoUnlockHint', 'Video is available after your first top-up and costs 2 credits per generation.')
                : t('lockedPresetHint', 'Your free generation works with the Fully Nude preset. Top up to unlock every other outfit preset, scenes, videos, and custom prompts.')
            );
            return;
          }
          var key = button.getAttribute('data-key');
          var mode = activeMode();
          var preset = activePresets().find(function (p) { return p.key === key; });
          if (!preset) return;
          selected = preset.key;
          selectedPresetKey = mode === 'scene' ? '' : preset.key;
          // Invisible bridge: the backend resolves the key, so when the remote
          // catalogue is in use there is no prompt text to carry here.
          prompt.value = preset.prompt || preset.key;
          showCustomPrompt(false);
          var modeInput = document.querySelector('input[name="mode"][value="' + mode + '"]');
          if (modeInput) modeInput.checked = true;
          renderGrid();
        });
      });
    }

    if (clear) {
      clear.addEventListener('click', function () {
        if (!isBuyer()) { showNotice(t('lockedCustomTitle', 'Your free generation'), t('lockedCustomHint', 'Your free generation works with the Fully Nude preset. Top up to unlock every other outfit preset, scenes, videos, and custom prompts.')); return; }
        selected = '';
        selectedPresetKey = '';
        selectedSavedVideoRecipeId = 0;
        prompt.value = '';
        showCustomPrompt(true);
        renderGrid();
        prompt.focus();
      });
    }
    prompt.addEventListener('input', function () {
      selected = '';
      selectedPresetKey = '';
      selectedSavedVideoRecipeId = 0;
      renderGrid();
    });
    modeInputs.forEach(function (input) {
      input.addEventListener('change', function () {
        active = activeMode() === 'scene'
          ? sceneCats[0].key
          : (activeMode() === 'video' ? videoCats()[0].key : outfitCats[0].key);
        selected = '';
        selectedPresetKey = '';
        selectedSavedVideoRecipeId = 0;
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

    // SEO tool pages deep-link into a real preset instead of dropping every
    // search visitor onto the generic default. Unknown values are ignored.
    var requestedPreset = null;
    try {
      var requestedKey = new URLSearchParams(location.search || '').get('seo_preset') || '';
      requestedPreset = presets.find(function (p) { return p.key === requestedKey; }) || null;
    } catch (e) {}
    if (requestedPreset) {
      active = requestedPreset.category;
      selected = requestedPreset.key;
      selectedPresetKey = requestedPreset.key;
      prompt.value = requestedPreset.prompt || requestedPreset.key;
      showCustomPrompt(false);
    }

    applyRequestedMode();
    syncModeCopy();
    renderTabs();
    renderGrid();
    renderWriteOwn();
    rerenderPresets = function () {
      applyVideoAvailability();
      applyRequestedMode();
      syncModeCopy();
      renderTabs();
      renderGrid();
    };

    // First load: preselect the free Fully Nude preset so a new visitor lands
    // on a ready-to-run look — the one their free credit actually covers.
    if (!selected && activeMode() !== 'scene' && activeMode() !== 'video') {
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
    var doubleVideoLengthRow = document.getElementById('video-double-length-row');
    var doubleVideoLength = document.getElementById('video-double-length');
    var previewUrl = '';
    var selectedPersonSnapshot = null;
    var pendingGeneration = null;
    var savedRecipesBox = document.getElementById('saved-video-recipes');
    var savedRecipesList = savedRecipesBox && savedRecipesBox.querySelector('.saved-video-recipes-list');

    function syncSavedVideoRecipesVisibility() {
      if (!savedRecipesBox) return;
      savedRecipesBox.hidden = selectedModeValue() !== 'video' || !(currentSession && currentSession.user);
    }

    renderSavedVideoRecipes = function () {
      if (!savedRecipesBox || !savedRecipesList) return;
      syncSavedVideoRecipesVisibility();
      savedRecipesList.innerHTML = '';
      if (!savedVideoRecipes.length) {
        var empty = document.createElement('p');
        empty.className = 'saved-video-recipes-empty';
        empty.textContent = t('noSavedVideoPrompts', 'No saved prompts yet. Save one after a custom video you like.');
        savedRecipesList.appendChild(empty);
        refreshIcons();
        return;
      }
      // A saved recipe is useful only if it is discoverable. Keep the section
      // expanded whenever this account has recipes, including after reload.
      savedRecipesBox.open = true;
      savedVideoRecipes.forEach(function (recipe) {
        var row = document.createElement('div');
        row.className = 'saved-video-recipe';
        var copy = document.createElement('div');
        var name = document.createElement('strong');
        name.textContent = recipe.label || 'Saved video prompt';
        copy.appendChild(name);
        var actions = document.createElement('div');
        actions.className = 'saved-video-recipe-actions';
        var use = document.createElement('button');
        use.type = 'button';
        use.textContent = t('useSavedVideoPrompt', 'Use');
        use.addEventListener('click', function () {
          var clear = document.getElementById('preset-clear');
          if (clear) clear.click();
          selectedPresetKey = '';
          selectedSavedVideoRecipeId = Number(recipe.id || 0);
          if (doubleVideoLength) doubleVideoLength.checked = false;
          var prompt = document.getElementById('web-prompt');
          if (prompt) {
            prompt.value = recipe.originalPrompt || '';
            prompt.style.display = '';
            prompt.classList.add('is-open');
          }
          var promptLabel = document.querySelector('label[for="web-prompt"]');
          if (promptLabel) promptLabel.style.display = '';
          syncVariationControl();
          syncSavedVideoRecipesVisibility();
          setStatus(t('savedRecipeSelected', 'Saved recipe selected. Upload a photo, then generate.'), 'success');
        });
        var remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'saved-video-recipe-delete';
        remove.setAttribute('aria-label', t('deleteSavedVideoPrompt', 'Delete saved video prompt'));
        remove.innerHTML = '<i data-lucide="trash-2"></i>';
        remove.addEventListener('click', function () {
          confirmSavedVideoRecipeDelete(recipe.label).then(function (approved) {
            if (!approved) return;
            remove.disabled = true;
            fetch(apiUrl('/web/video-recipes/' + encodeURIComponent(String(recipe.id))), {
              method: 'DELETE', credentials: 'include'
            }).then(function (res) {
              return res.json().catch(function () { return {}; }).then(function (data) {
                if (!res.ok || !data.ok) throw new Error(data.message || 'Could not delete this prompt.');
                if (selectedSavedVideoRecipeId === Number(recipe.id)) selectedSavedVideoRecipeId = 0;
                return loadSavedVideoRecipes();
              });
            }).catch(function (err) {
              remove.disabled = false;
              setStatus(err.message || 'Could not delete this prompt.', 'error');
            });
          });
        });
        actions.appendChild(use);
        actions.appendChild(remove);
        row.appendChild(copy);
        row.appendChild(actions);
        savedRecipesList.appendChild(row);
      });
      refreshIcons();
    };

    if (!CFG.apiBase && location.protocol === 'file:') {
      setStatus(t('apiMissing', 'Set UG_CONFIG.apiBase to your bot backend URL before uploading to cPanel.'), 'error');
    }

    initGoogleLogin();
    initEmailLogin();
    refreshWebSession().then(function (session) {
      return validateSavedDiscountAfterLogin(session).then(function () {
        return loadVideoCatalogue().then(function () { return session; });
      });
    }).then(function (session) {
      return loadSavedVideoRecipes().then(function () { return session; });
    }).then(resumePendingGeneration);
    initPresets();
    loadPacks();
    initAccountControls();
    renderSavedVideoRecipes();

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
      if (selectedModeValue() === 'video') return 1;
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
      var video = selectedModeValue() === 'video';
      var doubleLengthAvailable = !!(
        remoteVideos && (remoteVideos.durationOptions || []).some(function (option) {
          return Number(option && option.seconds || 0) >= 16 && Number(option.costCredits || 0) >= 4;
        })
      );
      if (!doubleLengthAvailable && doubleVideoLength) doubleVideoLength.checked = false;
      if (video) {
        var isDoubleLength = !!(doubleVideoLength && doubleVideoLength.checked);
        if (doubleVideoLengthRow) doubleVideoLengthRow.hidden = !doubleLengthAvailable;
        variationSelect.value = '1';
        Array.prototype.forEach.call(variationSelect.options, function (option) {
          option.disabled = option.value !== '1';
          option.hidden = option.value !== '1';
        });
        var videoOption = variationSelect.querySelector('option[value="1"]');
        if (videoOption) videoOption.textContent = t('oneVideo', '1 video');
        var variationLabel = variationRow && variationRow.querySelector('label > span');
        if (variationLabel) variationLabel.textContent = t('videoLabel', 'Video');
        if (variationRow) variationRow.hidden = false;
        var videoCost = isDoubleLength ? 4 : 2;
        if (variationCost) variationCost.textContent = videoCost + ' ' + t('creditsWord', 'credits');
        if (submit && submit.dataset.busy !== '1') {
          submit.innerHTML = '<i data-lucide="video"></i> ' + t('generateVideo', 'Generate video') + ' · ' + videoCost + ' ' + t('creditsWord', 'credits');
          refreshIcons();
        }
        return;
      }
      if (doubleVideoLengthRow) doubleVideoLengthRow.hidden = true;
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
      var imageOption = variationSelect.querySelector('option[value="1"]');
      if (imageOption) imageOption.textContent = '1 ' + t('imageSingular', 'image');
      var imageLabel = variationRow && variationRow.querySelector('label > span');
      if (imageLabel) imageLabel.textContent = t('imagesLabel', 'Images');
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
      if (modeValue === 'video') {
        payload.set('variations', '1');
        if (doubleVideoLength && doubleVideoLength.checked) payload.append('double_video_length', '1');
        if (selectedSavedVideoRecipeId) payload.append('saved_video_recipe_id', String(selectedSavedVideoRecipeId));
        else if (selectedPresetKey) payload.append('video_preset', selectedPresetKey);
        else payload.append('video_prompt', prompt ? prompt.value.trim() : '');
      } else if (modeValue === 'scene') {
        // The invisible-prompt bridge holds the chosen scene KEY; send it as
        // `scene` and attach the subject attribute picks (skip the undress body
        // options — the subject selectors replace them here).
        payload.append('scene', prompt ? prompt.value.trim() : '');
        ['skin_tone', 'body_type', 'breast_size', 'butt_size', 'hair', 'height'].forEach(function (k) {
          var s = document.getElementById('subj-' + k);
          if (s && s.value && s.value !== 'auto') payload.append(k, s.value);
        });
      } else {
        // Preset key, resolved to its prompt server-side (presets.py). Omitted
        // for custom prompts, and harmless for older backends which just fall
        // back to reading the prompt text.
        if (selectedPresetKey) payload.append('preset', selectedPresetKey);
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
    if (doubleVideoLength) doubleVideoLength.addEventListener('change', syncVariationControl);
    document.querySelectorAll('input[name="mode"]').forEach(function (input) {
      input.addEventListener('change', function () {
        selectedSavedVideoRecipeId = 0;
        syncVariationControl();
        syncSavedVideoRecipesVisibility();
      });
    });
    document.addEventListener('ug:session-updated', function () {
      syncVariationControl();
      syncSavedVideoRecipesVisibility();
    });
    document.addEventListener('ug:video-catalogue-updated', syncVariationControl);
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
      emitUi('ug:generation-started');
      setStatus(t('readingUpload', 'Reading upload...'), 'working');
      paintResults([], []);
      updateGenerationLoader('preparing', Date.now());
      // site.js owns the generation, so it owns the preview lifecycle too
      startWorkingPreview(selectedPersonFile());
      payloadPromise
        .then(function (payload) {
          updateGenerationLoader('preparing', Date.now());
          setStatus(
            selectedModeValue() === 'video'
              ? t('generatingVideo', 'Generating your video. This can take a few minutes.')
              : t('generating', 'Generating... this usually takes under a minute.'),
            'working'
          );
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
          stopWorkingPreview(true);
          paintResults(data.images || [], data.videos || [], data);
          track('website_generation_success', {
            mode: selectedModeValue(),
            image_count: (data.images || []).length,
            video_count: (data.videos || []).length,
            balance: data.balance
          });
          setStatus(t('doneBalance', 'Done. Balance: {balance}.').replace('{balance}', formatCredits(data.balance)), 'success');
          return refreshWebSession();
        })
        .catch(function (err) {
          stopWorkingPreview(false);
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
              message: t('topUpUnlockMsg', 'Your free generation works with the Fully Nude preset. Top up to unlock every other outfit preset, scenes, videos, and custom prompts.'),
              actionLabel: t('unlockGetCredits', 'Unlock, get credits'),
              onAction: function () { showCheckout(true, 'locked_feature'); }
            });
          } else if (payload.code === 'not_authenticated') {
            // Signed-out: save their work, prompt sign-up; after signin the
            // generation runs for real (resumePendingGeneration).
            track('website_generation_not_authenticated', {});
            stashPending(payloadPromise);
            if (!requestUi('ug:auth-required', { reason: 'generation' })) {
              revealLoginPrompt();
              paintResultNotice({
                icon: '🔒',
                title: t('signUpToGenerateTitle', 'Sign up to generate'),
                message: signupCreditCopy() + ', ' + t('noCardNeeded', 'no card needed.'),
                actionLabel: t('continueGoogle', 'Continue with Google'),
                onAction: goToGoogleLogin
              });
            }
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
      if (snap.mode === 'video' && snap.doubleVideoLength) payload.append('double_video_length', '1');
      if (snap.mode === 'video' && snap.savedVideoRecipeId) {
        payload.append('saved_video_recipe_id', String(snap.savedVideoRecipeId));
      } else if (snap.mode === 'video' && snap.presetKey) {
        payload.append('video_preset', snap.presetKey);
      } else if (snap.mode === 'video') {
        payload.append('video_prompt', snap.prompt || '');
      } else if (snap.presetKey) {
        payload.append('preset', snap.presetKey);
      }
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
          presetKey: selectedPresetKey,
          savedVideoRecipeId: selectedSavedVideoRecipeId,
          doubleVideoLength: !!(doubleVideoLength && doubleVideoLength.checked),
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
      setStatus(t('signInToGenerate', 'Sign in to generate, your photo and prompt are saved.'), 'working');
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
            loadVideoCatalogue().then(resumePendingGeneration);
          })
          .catch(function () { if (verifyBtn) verifyBtn.disabled = false; showError('Network error. Try again.'); });
      });
    }

    if (!form) return;
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var payloadPromise = buildGenerationPayload();
      if (!payloadPromise) return;
      // Phones stack the panel below the whole form, so whatever answers this
      // tap (the working preview, or the sign-up card) is off screen and the
      // tap reads as dead. Both branches below write into this panel.
      if (isMobileView()) scrollResultIntoView(document.querySelector('.result-panel'));
      var authed = !!(currentSession && currentSession.user);
      track('website_generation_submit', { mode: selectedModeValue(), logged_in: authed });
      // Must be signed in to generate — save their work and prompt sign-up.
      if (!authed) {
        stashPending(payloadPromise);
        if (!requestUi('ug:auth-required', { reason: 'generation' })) {
          revealLoginPrompt();
          paintResultNotice({
            icon: '🔒',
            title: t('signUpToGenerateTitle', 'Sign up to generate'),
            message: signupCreditCopy() + ', ' + t('noCardNeeded', 'no card needed.'),
            actionLabel: t('continueGoogle', 'Continue with Google'),
            onAction: goToGoogleLogin
          });
        }
        return;
      }
      runGeneration(payloadPromise);
    });
  }

  // ===== Video examples ==================================================
  // Curated marketing videos live outside generated user results. Add files
  // to video-examples/ and name them in manifest.json; the homepage upgrades
  // from a clean unavailable state without any HTML changes.
  var VIDEO_EX_BASE = SITE_BASE + 'video-examples/';
  var VIDEO_EX_SEEN_KEY = 'ug_seen_video_examples';
  var SHOWCASE_EXAMPLES_PROMISE = null;

  function loadShowcaseExamples() {
    if (SHOWCASE_EXAMPLES_PROMISE) return SHOWCASE_EXAMPLES_PROMISE;
    if (!window.fetch || !CFG.apiBase) return Promise.resolve([]);
    SHOWCASE_EXAMPLES_PROMISE = fetch(apiUrl('/web/showcase'), { credentials: 'omit' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (body) {
        return body && Array.isArray(body.examples) ? body.examples : [];
      })
      .catch(function () { return []; });
    return SHOWCASE_EXAMPLES_PROMISE;
  }

  function videoExampleAsset(name) {
    var clean = String(name || '').replace(/\\/g, '/').replace(/^\/+/, '');
    // Keep manifest assets on our own origin and inside the dedicated folder.
    if (!clean || clean.indexOf('..') !== -1 || clean.indexOf('://') !== -1) return '';
    var src = VIDEO_EX_BASE + clean;
    return SITE_VERSION ? (src + '?v=' + encodeURIComponent(SITE_VERSION)) : src;
  }

  function videoExampleSeen() {
    try {
      var raw = window.sessionStorage.getItem(VIDEO_EX_SEEN_KEY);
      return raw ? String(raw).split(',') : [];
    } catch (e) { return []; }
  }

  function videoExampleMarkSeen(id) {
    if (!id) return;
    var seen = videoExampleSeen();
    if (seen.indexOf(id) === -1) seen.push(id);
    try { window.sessionStorage.setItem(VIDEO_EX_SEEN_KEY, seen.join(',')); } catch (e) {}
  }

  function videoExampleResetSeen(keep) {
    try { window.sessionStorage.setItem(VIDEO_EX_SEEN_KEY, keep || ''); } catch (e) {}
  }

  function initVideoExamples() {
    var imageHeading = document.getElementById('ex-heading');
    if (!imageHeading || document.getElementById('video-examples-heading')) return;
    var heroMount = document.querySelector('[data-hero-video-mount]');

    function paintVideoHero(examples, featured) {
      if (!heroMount) return;
      if (!examples || !examples.length) {
        heroMount.innerHTML =
          '<div class="hero-video-loading"><i data-lucide="video"></i><span>' +
            esc(t('videoExamplesSoonTitle', 'Video examples are temporarily unavailable')) +
          '</span></div>';
        refreshIcons();
        return;
      }
      // The Admin-selected featured upload replaces the legacy c → c2 pair.
      // Keep c → c2 as a safe fallback until the first upload is published.
      var item = featured || {
        id: 'c2',
        source: videoExampleAsset('c.webp'),
        video: videoExampleAsset('c2.mp4'),
        poster: videoExampleAsset('c.webp')
      };
      videoExampleMarkSeen(item.id);
      heroMount.innerHTML =
        '<div class="hero-video-frame">' +
          (item.source ? (
            '<figure class="hero-video-source">' +
              '<img src="' + esc(item.source) + '" alt="' +
                esc(t('videoExamplesSourceAlt', 'Source image for this AI video')) + '" decoding="async" />' +
              '<figcaption>' + esc(t('videoExamplesSource', 'Before')) + '</figcaption>' +
            '</figure>') : '') +
          '<div class="hero-video-after">' +
            '<video muted loop playsinline controls preload="metadata"' +
              (item.poster ? (' poster="' + esc(item.poster) + '"') : '') + '></video>' +
            '<span class="hero-video-after-label">' + esc(t('exAfter', 'After')) + '</span>' +
            '<span class="hero-video-sound"><i data-lucide="volume-2"></i>' +
              esc(t('videoExamplesSound', 'Includes sound')) + '</span>' +
          '</div>' +
        '</div>';
      var heroVideo = heroMount.querySelector('video');
      heroVideo.src = item.video;
      heroVideo.load();
      var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var saveData = navigator.connection && navigator.connection.saveData;
      var visible = false;
      function playHero() {
        if (!visible || reduceMotion || saveData) return;
        var attempt = heroVideo.play();
        if (attempt && attempt.catch) attempt.catch(function () {});
      }
      heroVideo.addEventListener('canplay', playHero);
      if (window.IntersectionObserver) {
        var observer = new IntersectionObserver(function (entries) {
          visible = !!(entries[0] && entries[0].isIntersecting);
          if (visible) playHero(); else heroVideo.pause();
        }, { threshold: 0.35 });
        observer.observe(heroVideo);
      } else {
        visible = true;
        playHero();
      }
      refreshIcons();
      track('hero_video_example_shown', { id: item.id });
    }

    var heading = document.createElement('section');
    heading.className = 'section video-examples-heading';
    heading.id = 'video-examples-heading';
    heading.setAttribute('aria-labelledby', 'video-examples-title');
    heading.innerHTML =
      '<div class="container">' +
        '<h2 class="section-title" id="video-examples-title">' +
          esc(t('videoExamplesTitle', 'Video result examples')) +
        '</h2>' +
        '<p class="video-examples-intro">' +
          esc(t('videoExamplesIntro', 'Watch our latest AI video results and shuffle through the collection.')) +
        '</p>' +
      '</div>';

    var mount = document.createElement('div');
    mount.id = 'video-examples-mount';
    imageHeading.parentNode.insertBefore(heading, imageHeading);
    imageHeading.parentNode.insertBefore(mount, imageHeading);

    function showEmpty() {
      paintVideoHero([]);
      mount.className = 'video-examples-mount is-empty';
      mount.innerHTML =
        '<section class="video-ex-wrap"><div class="container">' +
          '<div class="video-ex-empty">' +
            '<span class="video-ex-empty-icon"><i data-lucide="video"></i></span>' +
            '<strong>' + esc(t('videoExamplesSoonTitle', 'Video examples are temporarily unavailable')) + '</strong>' +
            '<span>' + esc(t('videoExamplesSoonCopy', 'Refresh the page to try loading the video gallery again.')) + '</span>' +
          '</div>' +
        '</div></section>';
      refreshIcons();
    }

    if (!window.fetch) { showEmpty(); return; }
    var manifestUrl = videoExampleAsset('manifest.json');
    Promise.all([
      fetch(manifestUrl, { credentials: 'same-origin' }).then(function (res) { return res.ok ? res.json() : null; }),
      loadShowcaseExamples()
    ])
      .then(function (loaded) {
        var body = loaded[0];
        var uploaded = loaded[1] || [];
        var raw = body && Array.isArray(body.examples) ? body.examples : [];
        var examples = [];
        for (var i = 0; i < raw.length; i++) {
          var item = raw[i] || {};
          var video = videoExampleAsset(item.video);
          if (!video) continue;
          examples.push({
            id: String(item.id || item.video || ('video-' + i)),
            video: video,
            source: videoExampleAsset(item.source),
            poster: videoExampleAsset(item.poster),
            title: String(item.title || t('videoExamplesDefaultTitle', 'AI video transformation'))
          });
        }
        var uploadedVideos = uploaded.filter(function (item) {
          return item && item.category === 'video' && item.sourceUrl && item.resultUrl;
        }).map(function (item) {
          return {
            id: String(item.id), video: apiUrl(item.resultUrl), source: apiUrl(item.sourceUrl),
            poster: apiUrl(item.sourceUrl), title: String(item.title || 'AI video transformation'), hero: !!item.hero
          };
        });
        // Admin uploads extend the curated cPanel collection; they must never
        // replace it. The featured flag only controls the homepage hero.
        if (uploadedVideos.length) examples = uploadedVideos.concat(examples);
        if (!examples.length) { showEmpty(); return; }
        var featured = uploadedVideos.filter(function (item) { return item.hero; })[0] || null;
        paintVideoHero(examples, featured);

        mount.className = 'video-examples-mount has-examples';
        mount.innerHTML =
          '<section class="video-ex-wrap"><div class="container">' +
            '<div class="video-ex-card">' +
              '<div class="video-ex-player">' +
                '<video id="video-example-player" muted loop playsinline controls preload="metadata"></video>' +
                '<figure class="video-ex-source" id="video-example-source-wrap">' +
                  '<img id="video-example-source" alt="' +
                    esc(t('videoExamplesSourceAlt', 'Source image for this AI video')) + '" decoding="async" />' +
                  '<figcaption>' + esc(t('videoExamplesSource', 'Before')) + '</figcaption>' +
                '</figure>' +
                '<span class="video-ex-badge"><i data-lucide="sparkles"></i>' +
                  esc(t('videoExamplesBadge', 'AI video')) + '</span>' +
              '</div>' +
              '<div class="video-ex-meta">' +
                '<strong id="video-example-name"></strong>' +
                '<span class="video-ex-sound"><i data-lucide="volume-2"></i>' +
                  esc(t('videoExamplesSound', 'Includes sound')) + '</span>' +
              '</div>' +
              '<p class="video-ex-note">' +
                esc(t('videoExamplesNote', 'Curated AI-generated examples.')) +
              '</p>' +
              '<div class="ex-actions video-ex-actions">' +
                '<button type="button" class="btn btn-accent" id="video-example-try">' +
                  esc(t('videoExamplesTry', 'Create my video')) + '</button>' +
                '<button type="button" class="btn ex-more" id="video-example-more">' +
                  '<i data-lucide="shuffle"></i>' + esc(t('videoExamplesShuffle', 'Show another video')) +
                '</button>' +
              '</div>' +
            '</div>' +
          '</div></section>';

        var player = mount.querySelector('#video-example-player');
        var sourceWrap = mount.querySelector('#video-example-source-wrap');
        var sourceImage = mount.querySelector('#video-example-source');
        var name = mount.querySelector('#video-example-name');
        var more = mount.querySelector('#video-example-more');
        var tryBtn = mount.querySelector('#video-example-try');
        var current = -1;
        var visible = false;
        var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var saveData = navigator.connection && navigator.connection.saveData;

        function canAutoplay() { return visible && !reduceMotion && !saveData; }
        function tryPlay() {
          if (!canAutoplay()) return;
          var attempt = player.play();
          if (attempt && attempt.catch) attempt.catch(function () {});
        }

        function chooseIndex() {
          var seen = videoExampleSeen();
          var choices = [];
          for (var idx = 0; idx < examples.length; idx++) {
            if (idx !== current && seen.indexOf(examples[idx].id) === -1) choices.push(idx);
          }
          if (!choices.length) {
            videoExampleResetSeen(current > -1 ? examples[current].id : '');
            for (var j = 0; j < examples.length; j++) if (j !== current) choices.push(j);
          }
          if (!choices.length) return current > -1 ? current : 0;
          return choices[Math.floor(Math.random() * choices.length)];
        }

        function paint(idx) {
          var item = examples[idx];
          if (!item) return;
          player.pause();
          player.removeAttribute('src');
          player.removeAttribute('poster');
          if (item.poster) player.poster = item.poster;
          if (item.source) {
            sourceImage.src = item.source;
            sourceWrap.hidden = false;
          } else {
            sourceImage.removeAttribute('src');
            sourceWrap.hidden = true;
          }
          player.src = item.video;
          player.load();
          current = idx;
          videoExampleMarkSeen(item.id);
          name.textContent = item.title;
          more.hidden = examples.length < 2;
          tryPlay();
          track('video_example_shown', { id: item.id, index: idx, total: examples.length });
        }

        player.addEventListener('canplay', tryPlay);
        player.addEventListener('error', function () {
          name.textContent = t('videoExamplesUnavailable', 'This video is temporarily unavailable.');
        });
        more.addEventListener('click', function () {
          var next = chooseIndex();
          track('video_example_shuffle', { from: current, to: next, total: examples.length });
          paint(next);
        });
        tryBtn.addEventListener('click', function () {
          track('video_example_try_click', {});
          var gen = document.getElementById('generate') ||
            document.querySelector('[data-web-generator]') ||
            document.querySelector('.generator-app');
          scrollToElement(gen, 'start');
          var videoMode = document.querySelector('input[name="mode"][value="video"]');
          if (videoMode && !videoMode.checked) videoMode.click();
        });

        if (window.IntersectionObserver) {
          var observer = new IntersectionObserver(function (entries) {
            visible = !!(entries[0] && entries[0].isIntersecting);
            if (visible) tryPlay(); else player.pause();
          }, { threshold: 0.45 });
          observer.observe(player);
        } else {
          visible = true;
        }

        refreshIcons();
        paint(chooseIndex());
      })
      .catch(showEmpty);
  }

  // ===== Admin-managed scene examples ==================================
  function initSceneExamples() {
    var imageHeading = document.getElementById('ex-heading');
    if (!imageHeading || document.getElementById('scene-examples-heading')) return;
    loadShowcaseExamples().then(function (items) {
      var scenes = (items || []).filter(function (item) {
        return item && item.category === 'scene' && item.sourceUrl && item.resultUrl;
      });
      if (!scenes.length) return;
      var heading = document.createElement('section');
      heading.className = 'section scene-examples-heading';
      heading.id = 'scene-examples-heading';
      heading.innerHTML = '<div class="container"><h2 class="section-title">' +
        esc(t('sceneExamplesTitle', 'Scene result examples')) + '</h2></div>';
      var mount = document.createElement('section');
      mount.className = 'scene-examples-wrap';
      mount.innerHTML = '<div class="container"><div class="scene-examples-grid">' +
        scenes.map(function (item) {
          return '<article class="scene-example-card"><div class="scene-example-media">' +
            '<figure><img src="' + esc(apiUrl(item.sourceUrl)) + '" alt="' +
              esc(t('videoExamplesSourceAlt', 'Source image for this AI result')) + '" loading="lazy"><figcaption>' +
              esc(t('videoExamplesSource', 'Before')) + '</figcaption></figure>' +
            '<figure><img src="' + esc(apiUrl(item.resultUrl)) + '" alt="' + esc(item.title || 'Generated scene') + '" loading="lazy"><figcaption>' +
              esc(t('exAfter', 'After')) + '</figcaption></figure>' +
            '</div><strong>' + esc(item.title || 'AI scene transformation') + '</strong></article>';
        }).join('') + '</div></div>';
      imageHeading.parentNode.insertBefore(heading, imageHeading);
      imageHeading.parentNode.insertBefore(mount, imageHeading);
    }).catch(function () {});
  }

  // ===== "Example of result": one before / after pair ==================
  // Pairs are dropped into examples/ as a1 + a2, b1 + b2, ... where 1 is the
  // original and 2 is the result. A generated static manifest names the files
  // for ordinary hosting; list.php can refresh that list dynamically on PHP
  // hosting. The old probe is kept only as a last-ditch fallback.
  var EX_BASE = SITE_BASE + 'examples/';
  // Pairs are swapped in place under the same a1/a2 names, so the URL alone is
  // not enough to tell a browser the picture changed. Stamping our own asset
  // version onto every request makes a redeploy fetch them again. Stored URLs
  // stay clean, so the extension hint still parses.
  var EX_VER = SITE_VERSION ? ('?v=' + encodeURIComponent(SITE_VERSION)) : '';

  function exSrc(url) { return url + EX_VER; }
  // uppercase variants too: phone cameras and Windows hand back .PNG / .JPG
  var EX_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.PNG', '.JPG', '.JPEG', '.WEBP'];
  var EX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

  function exTryLoad(src, cb) {
    var img = new Image();
    img.onload = function () { cb(img.naturalWidth ? src : null); };
    img.onerror = function () { cb(null); };
    img.src = exSrc(src);
  }

  // Existence check by HEAD: probing with an Image downloaded the whole file,
  // so simply looking for pairs pulled every example on the page. Only the
  // pair actually on screen is downloaded now.
  var EX_NO_FETCH = false;

  function exHead(url, cb) {
    if (EX_NO_FETCH || !window.fetch) { exTryLoad(url, cb); return; }
    fetch(exSrc(url), { method: 'HEAD' })
      .then(function (r) { cb(r.ok ? url : null); })
      .catch(function () {
        // A missing file RESOLVES with ok=false; only being unable to ask at
        // all rejects (a CSP that forgot connect-src 'self', an offline blip).
        // Treating that as "no examples" would silently empty the section, so
        // fall back to loading the image and stop trying to fetch.
        EX_NO_FETCH = true;
        exTryLoad(url, cb);
      });
  }

  // Every candidate extension at once. One at a time cost a round trip per
  // miss, and .jpg/.jpeg/.png all have to miss before .webp is even tried, so
  // the section could not paint until eight probes had come back in sequence.
  var EX_HINT = '';   // the extension that answered last; almost always right

  // deep: fall back to every extension when the hint misses. Worth it right
  // after a hit (the next pair may just be a different format) and for the
  // second half of a pair we know exists; not worth eight requests per letter
  // while walking off the end of the folder.
  // examples/manifest.json or examples/list.php names every pair in one call,
  // so the sweep below never has to run. Probing cost ~8 requests per letter
  // across the whole alphabet - a few hundred 404s on every visit, which
  // slowed the first paint on mobile for no reason. null = not asked yet,
  // {} = no manifest/list available, in which case we fall back to probing.
  var EX_MAP = null;
  var EX_MAP_WAIT = [];

  function exMapFromBody(body) {
    var map = {};
    var pairs = (body && body.pairs) || [];
    for (var i = 0; i < pairs.length; i++) {
      var p = pairs[i];
      if (!p || !p.letter || !p.before || !p.after) continue;
      map[p.letter + '1'] = EX_BASE + p.before;
      map[p.letter + '2'] = EX_BASE + p.after;
    }
    return map;
  }

  function exFetchJson(url) {
    return fetch(exSrc(url))
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function exManifest(cb) {
    if (EX_MAP) { cb(EX_MAP); return; }
    EX_MAP_WAIT.push(cb);
    if (EX_MAP_WAIT.length > 1) return;   // a fetch is already in flight
    var done = function (map) {
      EX_MAP = map;
      var waiting = EX_MAP_WAIT;
      EX_MAP_WAIT = [];
      for (var i = 0; i < waiting.length; i++) waiting[i](map);
    };
    if (!window.fetch) { done({}); return; }
    exFetchJson(EX_BASE + 'manifest.json')
      .then(function (staticBody) {
        var staticMap = exMapFromBody(staticBody);
        for (var k in staticMap) {
          if (Object.prototype.hasOwnProperty.call(staticMap, k)) {
            done(staticMap);
            return { done: true };
          }
        }
        return exFetchJson(EX_BASE + 'list.php');
      })
      .then(function (phpBody) {
        if (phpBody && phpBody.done) return;
        done(exMapFromBody(phpBody));
      });
  }

  function exMapHasAny() {
    for (var k in EX_MAP) {
      if (Object.prototype.hasOwnProperty.call(EX_MAP, k)) return true;
    }
    return false;
  }

  // Answering from the manifest is instant, but every caller here was written
  // against a fetch - exDiscover counts callbacks against a countdown, walk()
  // recurses from inside them, and initExamplePair assumed its work landed
  // after boot() had finished. Replying synchronously ran that entire chain
  // inside boot(), so anything that threw in it took the language switch, the
  // theme and the generator down with it. Hand the answer back on a fresh
  // task, exactly as the network used to.
  function exLater(cb, value) { window.setTimeout(function () { cb(value); }, 0); }

  function exResolve(name, deep, cb) {
    // Ask list.php once before probing anything. Every caller funnels through
    // here, so this single guard is what keeps the old 404 storm from firing
    // while the manifest is still in flight.
    if (EX_MAP === null) {
      exManifest(function () { exResolve(name, deep, cb); });
      return;
    }
    // the manifest knows the real filename outright - no request at all
    if (EX_MAP && EX_MAP[name]) { exLater(cb, EX_MAP[name]); return; }
    // A populated manifest is authoritative: a miss really means "no such
    // pair", so do not spend eight probes confirming it. An EMPTY manifest
    // means list.php was unavailable, so fall through to the old sweep.
    if (EX_MAP && exMapHasAny()) { exLater(cb, null); return; }
    // one request, not eight, once we know what these files are named
    if (EX_HINT) {
      exHead(EX_BASE + name + EX_HINT, function (hit) {
        if (hit) { cb(hit); return; }
        if (deep) exSweep(name, cb); else cb(null);
      });
      return;
    }
    exSweep(name, cb);
  }

  function exSweep(name, cb) {
    var hits = new Array(EX_EXTS.length);
    var left = EX_EXTS.length;
    EX_EXTS.forEach(function (ext, i) {
      exHead(EX_BASE + name + ext, function (hit) {
        hits[i] = hit;
        if (--left) return;
        for (var k = 0; k < hits.length; k++) {
          if (hits[k]) {                          // EX_EXTS order is priority
            EX_HINT = EX_EXTS[k];
            cb(hits[k]);
            return;
          }
        }
        cb(null);
      });
    });
  }

  // the pair at one alphabet position, or null if that letter has no pair
  function exPairAt(idx, deep, cb) {
    if (idx >= EX_ALPHABET.length) { cb(null); return; }
    var letter = EX_ALPHABET.charAt(idx);
    exResolve(letter + '1', deep, function (before) {
      if (!before) { cb(null); return; }
      exResolve(letter + '2', true, function (after) {
        // a lone "before" is a half-uploaded pair
        cb(after ? { before: before, after: after, letter: letter } : null);
      });
    });
  }

  var EX_LETTERS = null;    // every letter with a "before" file, mapped once
  var EX_SEEN_KEY = 'ug_seen_examples';

  // Nobody should be shown an example twice while one they have never seen is
  // still available. Kept in localStorage so it holds across visits, and by
  // letter rather than by index so adding pairs does not shuffle the record.
  function exSeen() {
    try {
      var raw = window.localStorage.getItem(EX_SEEN_KEY);
      return raw ? String(raw).split(',') : [];
    } catch (e) { return []; }
  }

  function exMarkSeen(letter) {
    if (!letter) return;
    var seen = exSeen();
    if (seen.indexOf(letter) > -1) return;
    seen.push(letter);
    try { window.localStorage.setItem(EX_SEEN_KEY, seen.join(',')); } catch (e) {}
  }

  function exResetSeen(keep) {
    try { window.localStorage.setItem(EX_SEEN_KEY, keep || ''); } catch (e) {}
  }

  // Map the whole folder before opening. Two bugs used to live here: only the
  // first EX_FIRST_BATCH letters were considered, and each was probed with the
  // hint extension alone. The hint comes from a1, so with a .png "a" every
  // letter whose before-shot is a .jpg was invisible — which is how a folder of
  // 22 pairs showed the same handful of pictures on every reload.
  //
  // Headers only, no pixels, and the visible pair loads from this same list, so
  // the cost is one HEAD per letter rather than a download per pair.
  function exDiscover(cb) {
    if (EX_LETTERS) { cb(EX_LETTERS); return; }
    var found = [];
    var left = EX_ALPHABET.length;
    for (var i = 0; i < EX_ALPHABET.length; i++) {
      (function (idx) {
        // deep: never let a wrong hint hide a letter
        exResolve(EX_ALPHABET.charAt(idx) + '1', true, function (hit) {
          if (hit) found.push(idx);
          if (--left) return;
          found.sort(function (a, b) { return a - b; });
          EX_LETTERS = found;
          cb(found);
        });
      })(i);
    }
  }

  function exOpening(cb) {
    // resolve one pair first so EX_HINT is set and the sweep above is cheap
    exPairAt(0, true, function (first) {
      exDiscover(function (pool) {
        if (!pool.length) { cb(first ? { pair: first, index: 0 } : null); return; }
        // an unseen pair first; everything seen means the visitor has been
        // through the folder, so the whole pool opens up again
        var seen = exSeen();
        var fresh = pool.filter(function (idx) {
          return seen.indexOf(EX_ALPHABET.charAt(idx)) === -1;
        });
        if (!fresh.length) { exResetSeen(); fresh = pool; }
        var pick = fresh[Math.floor(Math.random() * fresh.length)];
        exPairAt(pick, true, function (pair) {
          // a half-uploaded pair falls back to the one already in hand
          if (pair) { cb({ pair: pair, index: pick }); return; }
          cb(first ? { pair: first, index: 0 } : null);
        });
      });
    });
  }

  function initExamplePair() {
    var mount = document.getElementById('ex-mount');
    if (!mount) return;

    // Paint as soon as the opening pair is known. Waiting for the whole walk
    // is what made the section (and the link to it) show up late.
    exOpening(function (opening) {
      if (!opening) return;   // nothing uploaded yet: leave the slot empty
      var pairs = [opening.pair];
      var openedAt = opening.index;

      var alt = i18n.imgAlt || 'AI undress result';
      var section = document.createElement('section');
      section.className = 'ex-wrap';
      section.innerHTML =
        '<div class="container">' +
          '<p class="ex-kicker">' + esc(t('exKicker', 'Example of result')) + '</p>' +
          '<div class="ex-card">' +
            '<figure class="ex-pane">' +
              '<img id="ex-before" alt="' + esc(alt) + '" decoding="async" />' +
              '<figcaption class="ex-tag">' + esc(t('exBefore', 'Before')) + '</figcaption>' +
            '</figure>' +
            '<figure class="ex-pane">' +
              '<img id="ex-after" alt="' + esc(alt) + '" decoding="async" />' +
              '<figcaption class="ex-tag ex-tag-after">' + esc(t('exAfter', 'After')) + '</figcaption>' +
            '</figure>' +
          '</div>' +
          // nobody should mistake an example for a real customer's photo
          '<p class="ex-note">' + esc(t('exNote',
            'Everyone in these examples is AI generated and does not exist. ' +
            'We never store your photos.')) + '</p>' +
          '<div class="ex-actions">' +
            '<button type="button" class="btn btn-accent ex-try" id="ex-try">' +
              esc(t('exTry', 'Let me try')) + '</button>' +
            '<button type="button" class="btn ex-more" id="ex-more">' +
              esc(t('exMore', 'Show me another')) + '</button>' +
          '</div>' +
        '</div>';

      mount.appendChild(section);
      var heading = document.getElementById('ex-heading');
      if (heading) heading.hidden = false;

      // A link from the pitch column down to the example. Built here, not in
      // the HTML, so it only ever exists when there is something to scroll to.
      var peek = document.getElementById('ex-peek');
      if (peek && !document.querySelector('.lp2-pitch .hero-example')) {
        var peekBtn = document.createElement('button');
        peekBtn.type = 'button';
        peekBtn.className = 'ex-peek-btn';
        peekBtn.innerHTML =
          '<i data-lucide="images"></i><span>' +
          esc(t('exPeek', 'See the quality of our results')) +
          '</span><i data-lucide="arrow-down"></i>';
        peekBtn.addEventListener('click', function () {
          track('example_peek_click', {});
          scrollToElement(section, 'center');
        });
        peek.appendChild(peekBtn);
      }

      // the whole point of the example is to send them back to the generator
      var tryBtn = section.querySelector('#ex-try');
      tryBtn.addEventListener('click', function () {
        track('example_try_click', {});
        var gen = document.getElementById('generate') ||
          document.querySelector('[data-web-generator]') ||
          document.querySelector('.generator-app');
        scrollToElement(gen, 'start');
        var file = document.getElementById('person-photo');
        if (file && !(file.files && file.files.length)) file.focus();
      });

      var beforeEl = section.querySelector('#ex-before');
      var afterEl = section.querySelector('#ex-after');
      var moreBtn = section.querySelector('#ex-more');
      moreBtn.hidden = true;      // until a second pair turns up

      var current = 0;
      var busy = false;

      function paint(idx) {
        var pair = pairs[idx];
        exMarkSeen(pair.letter);
        busy = true;
        moreBtn.disabled = true;
        beforeEl.classList.remove('is-in');
        afterEl.classList.remove('is-in');
        // both halves are swapped together: a comparison showing one new and
        // one old image would be a lie
        var left = 2;
        function armed() {
          if (--left) return;
          beforeEl.src = exSrc(pair.before);
          afterEl.src = exSrc(pair.after);
          beforeEl.classList.add('is-in');
          afterEl.classList.add('is-in');
          busy = false;
          moreBtn.disabled = false;
          // The hero clone reads these two src attributes. Emitting when the
          // empty shell was mounted raced the image preloads: on a cold request
          // lp2-core checked too early, found no sources, and never retried.
          // Signal only after both halves have real URLs so the comparison is
          // deterministic on every visit.
          emitUi('ug:examples-ready');
        }
        exTryLoad(pair.before, armed);
        exTryLoad(pair.after, armed);
      }

      moreBtn.addEventListener('click', function () {
        if (busy || pairs.length < 2) return;
        var seen = exSeen();
        var fresh = [];
        for (var k = 0; k < pairs.length; k++) {
          if (k !== current && seen.indexOf(pairs[k].letter) === -1) fresh.push(k);
        }
        var repeat = !fresh.length;
        if (repeat) {
          // everything known has been shown: start the rotation over rather
          // than dead-ending, keeping the one on screen out of the draw
          exResetSeen(pairs[current].letter);
          for (var j = 0; j < pairs.length; j++) if (j !== current) fresh.push(j);
        }
        var next = fresh[Math.floor(Math.random() * fresh.length)];
        current = next;
        track('example_shuffle', { index: current, total: pairs.length, repeat: repeat });
        paint(current);
      });

      paint(current);
      refreshIcons();   // this section is built long after boot()'s icon pass
      track('example_shown', {});

      // The rest of the folder comes from the same map the opening used, so a
      // gap in the alphabet is simply absent from the list. The old walk
      // stepped letter by letter and gave up after three consecutive holes,
      // which meant a few deleted pairs could hide everything after them.
      var walk = function (list, i) {
        if (i >= list.length) return;
        var idx = list[i];
        if (idx === openedAt) { walk(list, i + 1); return; }   // already showing
        exPairAt(idx, true, function (pair) {
          if (pair) {                       // a lone "before" is half-uploaded
            pairs.push(pair);
            if (pairs.length === 2) moreBtn.hidden = false;
          }
          walk(list, i + 1);
        });
      };
      // off the critical path: the visible pair is already loading
      window.setTimeout(function () {
        exDiscover(function (pool) { walk(pool, 0); });
      }, 400);
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
    // Each step is independent, so one throwing must not silently cancel the
    // ones after it. That is what "the page opens but nothing is clickable"
    // was: an early step failed and the generator, language switch and theme
    // never got wired up. Report the failure and keep going.
    var steps = [
      ['presets', loadPresetCatalogue],
      ['video-presets', loadVideoCatalogue],
      ['ctas', normalizeCtas],
      ['language', initLanguageSwitch],
      ['theme', initTheme],
      ['discount', initDiscountCode],
      ['generator', initWebGenerator],
      ['referral', initReferralPage],
      ['sticky', initSticky],
      ['counter', initLiveCounter],
      ['toast', initToast],
      ['scene-examples', initSceneExamples],
      ['video-examples', initVideoExamples],
      ['icons', refreshIcons]
    ];
    for (var i = 0; i < steps.length; i++) {
      try {
        steps[i][1]();
      } catch (err) {
        if (window.console && console.error) {
          console.error('[boot] "' + steps[i][0] + '" failed; continuing', err);
        }
      }
    }
    // The hero contains an immediately discoverable, optimized comparison.
    // Hydrate the larger shuffleable gallery only after critical rendering so
    // its manifest and image requests cannot compete with the LCP resource.
    var loadExamples = function () {
      try { initExamplePair(); }
      catch (err) {
        if (window.console && console.error) console.error('[boot] "examples" failed; continuing', err);
      }
    };
    var exampleTarget = document.getElementById('ex-heading') || document.getElementById('ex-mount');
    if (exampleTarget && window.IntersectionObserver) {
      var exampleObserver = new IntersectionObserver(function (entries) {
        if (!entries.some(function (entry) { return entry.isIntersecting; })) return;
        exampleObserver.disconnect();
        loadExamples();
      }, { rootMargin: '0px' });
      exampleObserver.observe(exampleTarget);
    } else if (window.requestIdleCallback) {
      window.requestIdleCallback(loadExamples, { timeout: 2400 });
    } else {
      window.setTimeout(loadExamples, 1200);
    }
  }
})();
