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

    // Horizontal marquees sit in the viewport height — native lazy often never fires.
    // Keep original numeric order (1, 2, 3…); hydrate off-screen cards via IntersectionObserver.
    var ids = nums();

    function cardHtml(n, eager) {
      var alt = i18n.imgAlt || 'AI undress result';
      if (eager) {
        return (
          '<div class="result-card" data-n="' + n + '">' +
            '<img src="' + thumbUrl(n) + '" alt="' + alt + '" width="480" height="600" ' +
              'decoding="async" loading="eager" fetchpriority="high" />' +
          '</div>'
        );
      }
      return (
        '<div class="result-card" data-n="' + n + '">' +
          '<img data-src="' + thumbUrl(n) + '" alt="' + alt + '" width="480" height="600" decoding="async" />' +
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

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var card = entry.target;
          var img = card.querySelector('img[data-src]');
          if (img) {
            img.src = img.getAttribute('data-src');
            img.removeAttribute('data-src');
            onImgLoad(img, card);
          }
          io.unobserve(card);
        });
      }, { root: null, rootMargin: '200px 400px', threshold: 0.01 });

      marquee.querySelectorAll('.result-card').forEach(function (card) {
        if (card.querySelector('img[data-src]')) io.observe(card);
      });
    } else {
      // Fallback: load all thumbs (still tiny WebPs)
      marquee.querySelectorAll('img[data-src]').forEach(function (img) {
        img.src = img.getAttribute('data-src');
        img.removeAttribute('data-src');
        onImgLoad(img, img.parentElement);
      });
    }
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

  function showCheckout(show) {
    var panel = document.getElementById('checkout-panel');
    if (panel) panel.hidden = !show;
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
    link.href = apiUrl('/web/auth/google/start') + '?' + params.toString();
  }

  function updateWebAccount(session) {
    var account = document.getElementById('web-account');
    var balance = document.getElementById('web-balance');
    var login = document.getElementById('login-box');
    var logout = document.getElementById('web-logout');
    var form = document.getElementById('web-generate-form');
    var submit = document.getElementById('web-submit');
    var user = session && session.user;
    var authed = !!user;

    if (account) account.textContent = authed ? ('@' + (user.username || user.id)) : 'Not logged in';
    if (balance) balance.textContent = authed ? (user.credits + ' credit' + (user.credits === 1 ? '' : 's') + ' available') : 'Login to see credits';
    if (login) login.hidden = authed;
    if (logout) logout.hidden = !authed;
    if (form) form.classList.toggle('is-locked', !authed);
    if (submit) submit.disabled = !authed;
    if (authed) showCheckout(Number(user.credits || 0) <= 0);
    updateReferral(session && session.referral, authed);
    if (authed && user.consentAccepted) {
      var consent = document.getElementById('web-consent');
      if (consent) consent.checked = true;
    }
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
      copy.textContent = 'Earn ' + referral.rewardCredits + ' credits per active referral. ' +
        referral.count + ' active invite' + (referral.count === 1 ? '' : 's') + ' so far.';
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
          return (
            '<div class="pack-card ' + (idx === 1 ? 'featured' : '') + '">' +
              '<i data-lucide="coins"></i>' +
              '<strong>' + pack.credits + ' credits</strong>' +
              '<span>' + pack.price + '</span>' +
              '<button type="button" data-pack="' + pack.code + '"><i data-lucide="bitcoin"></i> Pay crypto</button>' +
            '</div>'
          );
        }).join('');
        refreshIcons();
        grid.querySelectorAll('button[data-pack]').forEach(function (button) {
          button.addEventListener('click', function () {
            var code = button.getAttribute('data-pack');
            button.disabled = true;
            button.textContent = 'Opening...';
            setStatus('Creating secure crypto checkout...', 'working');
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
                setStatus(err.message || 'Could not create checkout.', 'error');
                button.disabled = false;
                button.textContent = 'Pay crypto';
              });
          });
        });
      })
      .catch(function () {});
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
      el.alt = 'Generated result ' + (idx + 1);
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
      { key: 'hot', label: 'Hottest' },
      { key: 'clothes', label: 'Clothes' },
      { key: 'fantasy', label: 'Fantasy' }
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
    var form = document.getElementById('web-generate-form');
    var logout = document.getElementById('web-logout');
    var submit = document.getElementById('web-submit');

    if (!CFG.apiBase && location.protocol === 'file:') {
      setStatus('Set UG_CONFIG.apiBase to your bot backend URL before uploading to cPanel.', 'error');
    }

    initGoogleLogin();
    refreshWebSession();
    initPresets();
    loadPacks();

    if (file && fileName) {
      file.addEventListener('change', function () {
        fileName.textContent = file.files && file.files[0] ? file.files[0].name : 'JPG, PNG, or WebP up to 12 MB';
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
          copyReferral.innerHTML = '<i data-lucide="check"></i> Copied';
          refreshIcons();
          setTimeout(function () {
            copyReferral.innerHTML = '<i data-lucide="copy"></i> Copy';
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
      if (submit) submit.disabled = true;
      setStatus('Generating... this usually takes under a minute.', 'working');
      paintResults([]);

      fetch(apiUrl('/web/generate'), {
        method: 'POST',
        credentials: 'include',
        body: new FormData(form)
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
          setStatus('Done. Balance: ' + data.balance + ' credit' + (data.balance === 1 ? '' : 's') + '.', 'success');
          return refreshWebSession();
        })
        .catch(function (err) {
          var payload = err.payload || {};
          if (payload.code === 'insufficient_credits') {
            showCheckout(true);
            setStatus('Out of credits. Top up below to keep generating.', 'error');
          } else if (payload.code === 'not_authenticated') {
            setStatus('Login with Google first.', 'error');
            updateWebAccount(null);
          } else {
            setStatus(err.message || 'Something went wrong.', 'error');
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
