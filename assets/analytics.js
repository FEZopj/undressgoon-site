(function () {
  'use strict';

  var cfg = window.UG_ANALYTICS || {};
  var token = cfg.posthogToken || '';
  var host = String(cfg.posthogHost || '').replace(/\/+$/, '');
  var enabled = !!(token && host && /^https:\/\//i.test(host));
  var storageKey = 'ug_ph_distinct';
  var currentDistinctId = '';

  function randomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'ug_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
  }

  function getDistinctId() {
    if (currentDistinctId) return currentDistinctId;
    try {
      currentDistinctId = localStorage.getItem(storageKey) || '';
      if (!currentDistinctId) {
        currentDistinctId = randomId();
        localStorage.setItem(storageKey, currentDistinctId);
      }
    } catch (e) {
      currentDistinctId = currentDistinctId || randomId();
    }
    return currentDistinctId;
  }

  function safeProps(properties) {
    var input = properties || {};
    var out = {
      site: 'undressgoon',
      surface: 'website',
      path: location.pathname || '/',
      title: document.title || '',
      referrer: document.referrer || '',
      language: document.documentElement.lang || navigator.language || ''
    };
    Object.keys(input).forEach(function (key) {
      var value = input[key];
      if (value == null) return;
      if (/prompt|image|photo|file|base64|email/i.test(key)) return;
      out[key] = value;
    });
    return out;
  }

  function send(event, properties) {
    if (!enabled || !event) return;
    var payload = JSON.stringify({
      api_key: token,
      event: event,
      distinct_id: getDistinctId(),
      properties: safeProps(properties)
    });
    var url = host + '/capture/';
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([payload], { type: 'application/json' });
        if (navigator.sendBeacon(url, blob)) return;
      }
    } catch (e) { /* fall through */ }
    try {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        mode: 'cors',
        credentials: 'omit',
        keepalive: true
      }).catch(function () {});
    } catch (e) { /* analytics must never break the site */ }
  }

  function identify(userId, properties) {
    if (!enabled || !userId) return;
    var anonId = getDistinctId();
    currentDistinctId = 'web_' + String(userId);
    try { localStorage.setItem(storageKey, currentDistinctId); } catch (e) {}
    send('$identify', {
      '$anon_distinct_id': anonId,
      '$set': safeProps(properties || {})
    });
  }

  window.ugTrack = send;
  window.ugIdentify = identify;

  if (enabled) {
    send('$pageview', { url: location.href.split('#')[0] });
    document.addEventListener('click', function (event) {
      var target = event.target && event.target.closest && event.target.closest(
        '[data-generate-cta], #google-login, #account-topup, #account-link-telegram, #telegram-link, #card-pay, #copy-referral'
      );
      if (!target) return;
      send('website_click', {
        action: target.id || target.getAttribute('data-generate-cta') || 'cta',
        text: (target.textContent || '').trim().slice(0, 80)
      });
    }, { passive: true });
  }
})();
