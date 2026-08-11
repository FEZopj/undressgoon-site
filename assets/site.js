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
  var i18n = CFG.i18n || {};
  var currentSession = null;
  var telegramLinkPoll = 0;

  function t(key, fallback) {
    return i18n && Object.prototype.hasOwnProperty.call(i18n, key) ? i18n[key] : fallback;
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

  function buildGallery() {
    var gallery = document.getElementById('gallery');
    if (!gallery) return;

    var overlayText = i18n.galleryCta || 'Make yours free →';
    var html = nums().map(function (n, idx) {
      // First row roughly eager on desktop; rest native-lazy
      var eager = idx < 4;
      return (
        '<a class="gallery-item" href="#generate" data-generate-cta data-n="' + n + '">' +
          '<img src="' + thumbUrl(n) + '" alt="' + (i18n.imgAlt || 'AI undress result') + '" ' +
            'width="480" height="600" decoding="async" loading="' + (eager ? 'eager' : 'lazy') + '" />' +
          '<div class="g-overlay"><span>' + overlayText + '</span></div>' +
        '</a>'
      );
    }).join('');

    gallery.innerHTML = html;

    gallery.querySelectorAll('.gallery-item').forEach(function (item) {
      var img = item.querySelector('img');
      if (img) onImgLoad(img, item);
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
      if ((window.scrollY || 0) < 200) return;
      toast.classList.add('show');
      try { sessionStorage.setItem('ug_toast', '1'); } catch (e) {}
      setTimeout(function () { toast.classList.remove('show'); }, 8000);
    }, 22000);
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

  function showCheckout(show, reason) {
    var panel = document.getElementById('checkout-panel');
    if (!panel) return;
    if (show) {
      var title = document.getElementById('topup-title');
      var copy = document.getElementById('topup-copy');
      if (title) title.textContent = reason === 'empty' ? t('topupEmptyTitle', 'You are out of credits') : t('topupTitle', 'Ready for another image?');
      if (copy) copy.textContent = reason === 'empty' ? t('topupEmptyCopy', 'Choose a pack and keep generating in seconds.') : t('topupCopy', 'Pick a pack and keep generating on the website.');
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

  function initGoogleLogin() {
    var link = document.getElementById('google-login');
    if (!link) return;
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
      }
      params.set('ug_fp', fp);
    } catch (e) { /* storage can be blocked */ }
    link.href = apiUrl('/web/auth/google/start') + '?' + params.toString();
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
        grid.innerHTML = (data.packs || []).map(function (pack, idx) {
          var badge = idx === 1 ? '<em>' + t('bestValue', 'Popular') + '</em>' : '';
          return (
            '<div class="pack-card ' + (idx === 1 ? 'featured' : '') + '">' +
              badge +
              '<i data-lucide="' + (idx === 1 ? 'gem' : 'coins') + '"></i>' +
              '<strong>' + pack.credits + ' ' + t('creditsWord', 'credits') + '</strong>' +
              '<span>' + pack.price + '</span>' +
              '<button type="button" data-pack="' + pack.code + '"><i data-lucide="bitcoin"></i> ' + t('payCrypto', 'Crypto') + '</button>' +
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
    var presets = CFG.presets || [];
    if (!tabs || !grid || !prompt || !presets.length) return;

    var cats = [
      { key: 'hot', label: t('tabHot', 'Hottest') },
      { key: 'clothes', label: t('tabClothes', 'Clothes') },
      { key: 'fantasy', label: t('tabFantasy', 'Fantasy') }
    ];
    var active = 'hot';
    var selected = '';

    function renderTabs() {
      tabs.innerHTML = cats.map(function (cat) {
        return '<button type="button" class="' + (cat.key === active ? 'active' : '') + '" data-cat="' + cat.key + '">' + cat.label + '</button>';
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
      grid.innerHTML = presets.filter(function (p) {
        return p.category === active;
      }).map(function (p) {
        var icon = p.category === 'hot' ? 'flame' : (p.category === 'fantasy' ? 'sparkles' : 'shirt');
        return '<button type="button" class="' + (p.key === selected ? 'active' : '') + '" data-key="' + p.key + '"><i data-lucide="' + icon + '"></i>' + p.label + '</button>';
      }).join('');
      refreshIcons();
      grid.querySelectorAll('button').forEach(function (button) {
        button.addEventListener('click', function () {
          var key = button.getAttribute('data-key');
          var preset = presets.find(function (p) { return p.key === key; });
          if (!preset) return;
          selected = preset.key;
          prompt.value = preset.prompt;
          var mode = document.querySelector('input[name="mode"][value="prompt"]');
          if (mode) mode.checked = true;
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

      payloadPromise
        .then(function (payload) {
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
          paintResults(data.images || []);
          setStatus(t('doneBalance', 'Done. Balance: {balance}.').replace('{balance}', formatCredits(data.balance)), 'success');
          return refreshWebSession();
        })
        .catch(function (err) {
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
    buildGallery();
    normalizeCtas();
    initWebGenerator();
    initSticky();
    initLiveCounter();
    initToast();
    refreshIcons();
  }
})();
