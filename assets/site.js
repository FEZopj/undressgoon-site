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
  var packOffer = null;
  var firstGenerationDone = false;
  var exitOfferArmed = false;

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

    // Marquee cards are animated with transforms, which makes lazy hydration
    // unreliable in some browsers. The thumb set is small, so load it directly.
    var ids = nums();

    function cardHtml(n, eager) {
      var alt = i18n.imgAlt || 'AI undress result';
      return (
        '<div class="result-card" data-n="' + n + '">' +
          '<img src="' + thumbUrl(n) + '" alt="' + alt + '" width="480" height="600" ' +
            'decoding="async" loading="' + (eager ? 'eager' : 'auto') + '" ' +
            (eager ? 'fetchpriority="high" ' : '') + '/>' +
        '</div>'
      );
    }

    // First 4 paint immediately; rest hydrate when near viewport. Duplicate track for loop.
    var html = ids.map(function (n, idx) { return cardHtml(n, idx < 4); }).join('');
    marquee.innerHTML = html + html;

    marquee.querySelectorAll('.result-card').forEach(function (card) {
      var img = card.querySelector('img');
      if (!img) return;
      if (img.getAttribute('src')) {
        onImgLoad(img, card);
        return;
      }
      // Placeholder shimmer until hydrated
    });
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

  // Live "generating now" counter — soft social proof
  function initLiveCounter() {
    var el = document.getElementById('live-count');
    if (!el) return;
    var base = 18 + Math.floor(Math.random() * 22); // 18–39
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
    document.querySelectorAll('[data-generate-cta]').forEach(function (a) {
      a.setAttribute('href', '#generate');
      a.removeAttribute('target');
      a.removeAttribute('rel');
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

  function offerSummary() {
    var promo = packOffer && packOffer.promo;
    if (promo && promo.active && Number(promo.bonusPercent || 0) > 0) {
      return '+' + Number(promo.bonusPercent || 0) + '% bonus credits on every pack';
    }
    if (promo && promo.active && Number(promo.extraCredits || 0) > 0) {
      return '+' + Number(promo.extraCredits || 0) + ' bonus credits on every pack';
    }
    return t('specialPackOffer', 'Special credit packs unlocked');
  }

  function updateModalPromo(reason) {
    var promo = document.querySelector('.modal-promo span');
    if (!promo) return;
    if (reason === 'exit_post_gen') {
      promo.textContent = t('firstResultOffer', 'First result bonus: {offer}.').replace('{offer}', offerSummary());
      return;
    }
    promo.textContent = t('modalPromoDefault', 'Special credit packs: bigger bundles drop your per-image cost.');
  }

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
        img.setAttribute('src', src.replace('brand-logo.png', 'brand-logo-light.png'));
      } else {
        img.setAttribute('src', src.replace('brand-logo-light.png', 'brand-logo.png'));
      }
    });
  }

  function initTheme() {
    var saved = '';
    try { saved = localStorage.getItem('ug_theme') || ''; } catch (e) {}
    if (!saved && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      saved = 'light';
    }
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

  function initGoogleLogin() {
    var link = document.getElementById('google-login');
    if (!link) return;
    function updateHref() {
      var params = new URLSearchParams(location.search || '');
      params.delete('google_login');
      params.delete('web_login');
      params.set('return_to', location.origin + location.pathname);
      try {
        var fp = localStorage.getItem('ug_fp');
        if (!fp) {
          var bytes = new Uint8Array(16);
          if (window.crypto && window.crypto.getRandomValues) {
            window.crypto.getRandomValues(bytes);
            fp = Array.prototype.map.call(bytes, function (b) {
              return b.toString(16).padStart(2, '0');
            }).join('');
          } else {
            fp = String(Date.now()) + Math.random().toString(16).slice(2);
          }
          localStorage.setItem('ug_fp', fp);
        } else {
          fp = String(fp).slice(0, 96);
        }
        params.set('ug_fp', fp);
      } catch (e) { /* storage can be blocked */ }
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
    var telegramNote = document.getElementById('telegram-link-note');
    var user = currentSession && currentSession.user;
    var authed = !!user;
    var toast = document.getElementById('reengage-toast');

    if (account) account.textContent = authed ? ('@' + (user.username || user.id)) : t('notLoggedIn', 'Not logged in');
    if (balance) balance.textContent = authed ? formatCredits(user.credits) : t('loginToSeeCredits', 'Login to see credits');
    if (login) login.hidden = authed;
    if (logout) logout.hidden = !authed;
    if (form) form.classList.toggle('is-locked', !authed);
    if (submit) submit.disabled = !authed;
    if (siteAccount) siteAccount.hidden = !authed;
    if (accountName) accountName.textContent = authed ? userLabel(user) : t('myAccount', 'My account');
    if (accountCredits) accountCredits.textContent = authed ? formatCredits(user.credits) : '';
    if (accountAvatar) accountAvatar.textContent = authed ? userInitial(user) : 'U';
    if (accountEmail) accountEmail.textContent = authed ? (user.email || userLabel(user)) : t('signedIn', 'Signed in');
    if (accountMenuCredits) accountMenuCredits.textContent = authed ? formatCredits(user.credits) : '';
    if (toast && authed) toast.classList.remove('show');
    var linked = !!(currentSession && currentSession.telegram && currentSession.telegram.linked);
    if (accountLinkTelegram) accountLinkTelegram.innerHTML = linked ? '<i data-lucide="check"></i> ' + t('telegramLinkedShort', 'Telegram linked') : '<i data-lucide="send"></i> ' + t('linkTelegram', 'Link Telegram');
    if (telegramLink) telegramLink.innerHTML = linked ? '<i data-lucide="check"></i> ' + t('telegramLinkedShort', 'Telegram linked') : '<i data-lucide="send"></i> ' + t('linkTelegram', 'Link Telegram');
    if (telegramNote) telegramNote.textContent = linked ? t('telegramLinkedNote', 'Card checkout is ready for this account.') : t('telegramLinkNote', 'Crypto stays here. Card checkout opens Telegram after you link it once.');
    updateReferral(currentSession && currentSession.referral, authed);
    refreshIcons();
  }

  function updateReferral(referral, authed) {
    var card = document.getElementById('referral-card');
    var input = document.getElementById('referral-link');
    var copy = document.getElementById('referral-copy');
    if (!card || !input) return;
    var active = !!(authed && referral && referral.enabled && referral.link);
    card.hidden = !active;
    if (!active) return;
    input.value = referral.link;
    if (copy) {
      var inviteTemplate = Number(referral.count || 0) === 1 ?
        t('referralSingular', 'Earn {reward} credits per active referral. {count} active invite so far.') :
        t('referralPlural', 'Earn {reward} credits per active referral. {count} active invites so far.');
      copy.textContent = inviteTemplate
        .replace('{reward}', String(referral.rewardCredits))
        .replace('{count}', String(referral.count));
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
        grid.innerHTML = (data.packs || []).map(function (pack, idx) {
          var badge = idx === 1 ? '<em>' + esc(t('bestValue', 'Popular')) + '</em>' : '';
          var baseCredits = Number(pack.baseCredits || pack.credits || 0);
          var bonusCredits = Number(pack.bonusCredits || 0);
          var creditLine = bonusCredits > 0 ?
            baseCredits + ' + ' + bonusCredits + ' ' + esc(t('freeCreditsWord', 'free')) :
            Number(pack.credits || baseCredits) + ' ' + esc(t('creditsWord', 'credits'));
          var bonusLine = bonusCredits > 0 ?
            '<small class="pack-bonus">' + Number(pack.credits || (baseCredits + bonusCredits)) + ' ' + esc(t('creditsTotal', 'credits total')) + '</small>' :
            '';
          return (
            '<div class="pack-card ' + (idx === 1 ? 'featured' : '') + '">' +
              badge +
              '<i data-lucide="coins"></i>' +
              '<strong>' + creditLine + '</strong>' +
              bonusLine +
              '<span>' + esc(pack.price) + '</span>' +
              '<button type="button" data-pack="' + esc(pack.code) + '"><i data-lucide="bitcoin"></i> ' + esc(t('payCrypto', 'Crypto')) + '</button>' +
            '</div>'
          );
        }).join('');
        refreshIcons();
        grid.querySelectorAll('button[data-pack]').forEach(function (button) {
          button.addEventListener('click', function () {
            var code = button.getAttribute('data-pack');
            button.disabled = true;
            button.textContent = t('opening', 'Opening...');
            setStatus(t('creatingCheckout', 'Creating secure crypto checkout...'), 'working');
            fetch(apiUrl('/web/crypto/create'), {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: code })
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
                setStatus(err.message || t('checkoutFail', 'Could not create checkout.'), 'error');
                button.disabled = false;
                button.textContent = t('payCrypto', 'Pay crypto');
              });
          });
        });
      })
      .catch(function () {});
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
          setStatus(t('telegramLinked', 'Telegram is linked. Card checkout is ready.'), 'success');
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
          setStatus(t('telegramLinked', 'Telegram is linked. Card checkout is ready.'), 'success');
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
    if (currentSession.telegram && currentSession.telegram.linked) {
      window.open(BOT_URL, '_blank', 'noopener');
      return;
    }
    requestTelegramLink();
  }

  function initAccountControls() {
    var trigger = document.getElementById('site-account-trigger');
    var menu = document.getElementById('site-account-menu');
    var topup = document.getElementById('account-topup');
    var linkTelegram = document.getElementById('account-link-telegram');
    var modalLink = document.getElementById('telegram-link');
    var cardPay = document.getElementById('card-pay');
    var close = document.getElementById('topup-close');
    var logout = document.getElementById('account-logout');

    if (topup) topup.innerHTML = '<i data-lucide="coins"></i> ' + t('getCredits', 'Get credits');
    var support = document.querySelector('.account-menu a[href*="start=support"]');
    if (support) support.innerHTML = '<i data-lucide="message-circle"></i> ' + t('contactSupport', 'Contact support');
    if (logout) logout.innerHTML = '<i data-lucide="log-out"></i> ' + t('logout', 'Logout');
    if (cardPay) cardPay.innerHTML = '<i data-lucide="credit-card"></i> ' + t('payCard', 'Pay by card');

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
    if (cardPay) cardPay.addEventListener('click', openCardCheckout);
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

    var outfitCats = [
      { key: 'hot', label: t('tabHot', 'Hottest') },
      { key: 'clothes', label: t('tabClothes', 'Clothes') },
      { key: 'fantasy', label: t('tabFantasy', 'Fantasy') }
    ];
    var sceneCats = [
      { key: 'mirror', label: t('tabMirror', 'Mirror') },
      { key: 'room', label: t('tabRoom', 'Room') },
      { key: 'cinematic', label: t('tabCinematic', 'Cinematic') }
    ];
    var scenePresets = CFG.scenePresets || [
      {
        key: 'scene_mirror',
        category: 'mirror',
        label: 'Nude Mirror',
        prompt: 'fully naked bedroom mirror selfie, bare breasts, no clothing, warm bedside lighting, confident pose, clear face, full body visible, realistic phone photo, detailed background'
      },
      {
        key: 'scene_hotel',
        category: 'room',
        label: 'Hotel Nude',
        prompt: 'fully nude in a luxury hotel suite, bare breasts, standing near the bed, soft evening light, seductive confident pose, clear face, realistic skin texture, full body in frame'
      },
      {
        key: 'scene_bathroom',
        category: 'mirror',
        label: 'Shower Mirror',
        prompt: 'fully naked bathroom mirror selfie after shower, bare breasts, wet skin, bright vanity lights, phone held to the side, clear face, realistic casual photo'
      },
      {
        key: 'scene_neon',
        category: 'cinematic',
        label: 'Neon Nude',
        prompt: 'cinematic fully nude in a neon-lit bedroom, bare breasts, pink and blue light, standing pose, glossy skin, clear recognizable face, full body, high detail'
      },
      {
        key: 'scene_locker',
        category: 'room',
        label: 'Locker Nude',
        prompt: 'fully naked in a private locker room, bare breasts, mirror wall, athletic confident pose, realistic indoor lighting, clear face, full body visible, detailed environment'
      },
      {
        key: 'scene_sofa',
        category: 'cinematic',
        label: 'Sofa Nude',
        prompt: 'fully nude sitting on a modern sofa, bare breasts, relaxed seductive pose, warm studio lighting, clear face, full body composition, realistic photo detail'
      }
    ];
    var active = 'hot';
    var selected = '';
    var sceneHelp = null;

    function activeMode() {
      var checked = document.querySelector('input[name="mode"]:checked');
      return checked && checked.value === 'portrait' ? 'portrait' : 'prompt';
    }

    function activeCats() {
      return activeMode() === 'portrait' ? sceneCats : outfitCats;
    }

    function activePresets() {
      return activeMode() === 'portrait' ? scenePresets : presets;
    }

    function ensureSceneHelp() {
      if (sceneHelp || !picker) return sceneHelp;
      sceneHelp = document.createElement('p');
      sceneHelp.className = 'scene-help';
      picker.insertBefore(sceneHelp, tabs);
      return sceneHelp;
    }

    function syncModeCopy() {
      var scene = activeMode() === 'portrait';
      modeInputs.forEach(function (input) {
        if (input.parentElement) input.parentElement.classList.toggle('active', input.checked);
      });
      if (label) label.textContent = t('presetPromptInstruction', 'CHOOSE A PRESET OR JUST DIRECTLY WRITE YOUR OWN PROMPT');
      if (promptLabel) promptLabel.textContent = scene ? t('scenePromptLabel', 'Scene prompt') : t('promptLabel', 'Prompt');
      if (clear) clear.hidden = true;
      var help = ensureSceneHelp();
      if (help) {
        help.hidden = !scene;
        help.textContent = t('sceneHelp', 'Scenes work best when you describe the room, lighting, pose, framing, and mood. Use one of these as a starting point.');
      }
      prompt.placeholder = scene ?
        t('scenePlaceholder', 'Example: fully nude in a luxury hotel suite, bare breasts, warm evening light, confident pose, clear face, full body in frame') :
        t('promptPlaceholder', 'Example: tiny black micro bikini, glossy skin, bedroom mirror selfie');
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
      grid.innerHTML = activePresets().filter(function (p) {
        return p.category === active;
      }).map(function (p) {
        var icon = mode === 'portrait' ? 'camera' : (p.category === 'hot' ? 'flame' : (p.category === 'fantasy' ? 'sparkles' : 'shirt'));
        return '<button type="button" class="' + (p.key === selected ? 'active' : '') + '" data-key="' + esc(p.key) + '"><i data-lucide="' + icon + '"></i>' + esc(p.label) + '</button>';
      }).join('');
      refreshIcons();
      grid.querySelectorAll('button').forEach(function (button) {
        button.addEventListener('click', function () {
          var key = button.getAttribute('data-key');
          var mode = activeMode();
          var preset = activePresets().find(function (p) { return p.key === key; });
          if (!preset) return;
          selected = preset.key;
          prompt.value = preset.prompt;
          var modeInput = document.querySelector('input[name="mode"][value="' + (mode === 'portrait' ? 'portrait' : 'prompt') + '"]');
          if (modeInput) modeInput.checked = true;
          renderGrid();
          prompt.focus();
        });
      });
    }

    if (clear) {
      clear.addEventListener('click', function () {
        selected = '';
        prompt.value = '';
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
        active = activeMode() === 'portrait' ? sceneCats[0].key : outfitCats[0].key;
        selected = '';
        prompt.value = '';
        syncModeCopy();
        renderTabs();
        renderGrid();
        prompt.focus();
      });
    });

    syncModeCopy();
    renderTabs();
    renderGrid();
  }

  function initWebGenerator() {
    var root = document.querySelector('[data-web-generator]');
    if (!root) return;

    var file = document.getElementById('person-photo');
    var fileName = document.getElementById('upload-name');
    var uploadZone = document.querySelector('.upload-zone');
    var uploadPreview = document.getElementById('upload-preview');
    var form = document.getElementById('web-generate-form');
    var logout = document.getElementById('web-logout');
    var submit = document.getElementById('web-submit');
    var previewUrl = '';

    if (!CFG.apiBase && location.protocol === 'file:') {
      setStatus(t('apiMissing', 'Set UG_CONFIG.apiBase to your bot backend URL before uploading to cPanel.'), 'error');
    }

    initGoogleLogin();
    refreshWebSession();
    initPresets();
    loadPacks();
    initAccountControls();

    function clearUploadPreview() {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = '';
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
    }

    function buildGenerationPayload() {
      var consent = document.getElementById('web-consent');
      var prompt = document.getElementById('web-prompt');
      var mode = document.querySelector('input[name="mode"]:checked');
      var chosen = selectedPersonFile();

      if (!chosen) {
        setStatus(t('missingPhoto', 'Upload a person photo first.'), 'error');
        if (file) file.focus();
        return null;
      }
      if (!/image\/(jpeg|png|webp)/i.test(chosen.type || '')) {
        setStatus(t('badPhotoType', 'Upload a valid JPG, PNG, or WebP photo.'), 'error');
        if (file) file.focus();
        return null;
      }
      if (chosen.size > 12 * 1024 * 1024) {
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
      payload.append('mode', mode ? mode.value : 'prompt');
      payload.append('terms_accepted', '1');
      payload.append('variations', '1');
      payload.append('person_name', chosen.name || 'upload.jpg');
      payload.append('person', chosen, chosen.name || 'upload.jpg');
      return readFileAsDataUrl(chosen).then(function (dataUrl) {
        payload.append('person_b64', dataUrl);
        return payload;
      });
    }

    if (file) {
      file.addEventListener('change', function () {
        updateUploadPreview();
      });
    }

    if (logout) {
      logout.addEventListener('click', function () {
        fetch(apiUrl('/web/logout'), { method: 'POST', credentials: 'include' })
          .finally(function () {
            updateWebAccount(null);
            initGoogleLogin();
          });
      });
    }

    var copyReferral = document.getElementById('copy-referral');
    if (copyReferral) {
      copyReferral.addEventListener('click', function () {
        var input = document.getElementById('referral-link');
        if (!input || !input.value) return;
        navigator.clipboard.writeText(input.value).then(function () {
          copyReferral.innerHTML = '<i data-lucide="check"></i> ' + t('copied', 'Copied');
          refreshIcons();
          setTimeout(function () {
            copyReferral.innerHTML = '<i data-lucide="copy"></i> ' + t('copy', 'Copy');
            refreshIcons();
          }, 1800);
        }).catch(function () {
          input.select();
          document.execCommand('copy');
        });
      });
    }

    if (!form) return;
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var payloadPromise = buildGenerationPayload();
      if (!payloadPromise) return;
      if (submit) submit.disabled = true;
      setStatus(t('readingUpload', 'Reading upload...'), 'working');
      paintResults([]);
      updateGenerationLoader('preparing', Date.now());

      payloadPromise
        .then(function (payload) {
          updateGenerationLoader('preparing', Date.now());
          setStatus(t('generating', 'Generating... this usually takes under a minute.'), 'working');
          return fetch(apiUrl('/web/generate'), {
            method: 'POST',
            credentials: 'include',
            body: payload
          });
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
          firstGenerationDone = true;
          armExitOffer();
          paintResults(data.images || []);
          setStatus(t('doneBalance', 'Done. Balance: {balance}.').replace('{balance}', formatCredits(data.balance)), 'success');
          return refreshWebSession();
        })
        .catch(function (err) {
          hideGenerationLoader(true);
          var payload = err.payload || {};
          if (payload.code === 'insufficient_credits') {
            showCheckout(true, 'empty');
            setStatus(t('outOfCredits', 'You are out of credits. Pick a pack to keep generating.'), 'error');
          } else if (payload.code === 'not_authenticated') {
            setStatus(t('loginFirst', 'Login with Google first.'), 'error');
            updateWebAccount(null);
          } else {
            setStatus(err.message || t('genericError', 'Something went wrong.'), 'error');
          }
        })
        .finally(function () {
          refreshWebSession().then(function (data) {
            if (submit) submit.disabled = !(data && data.ok);
          });
        });
    });
  }

  // Boot ASAP
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  function boot() {
    preloadCritical();
    buildMarquee();
    normalizeCtas();
    initTheme();
    initWebGenerator();
    initSticky();
    initLiveCounter();
    initToast();
    refreshIcons();
  }
})();
