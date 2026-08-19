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

  // Campaign attribution (utm_* + discount) captured from the landing URL, kept
  // for the whole visit (sessionStorage) so every page carries it, plus a
  // first-touch copy (localStorage) for the person's initial source.
  var CAMPAIGN_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  var SESS_CAMPAIGN = 'ug_ph_campaign';
  var FIRST_CAMPAIGN = 'ug_ph_campaign_first';

  function computeCampaign() {
    var camp = {};
    var params;
    try { params = new URLSearchParams(location.search || ''); } catch (e) { params = null; }
    if (params) {
      CAMPAIGN_KEYS.forEach(function (k) {
        var v = params.get(k);
        if (v) camp[k] = String(v).slice(0, 120);
      });
      var disc = params.get('discount') || params.get('coupon');
      if (disc) camp.discount_code = String(disc).slice(0, 60);
    }
    try {
      if (Object.keys(camp).length) {
        sessionStorage.setItem(SESS_CAMPAIGN, JSON.stringify(camp));
        if (!localStorage.getItem(FIRST_CAMPAIGN)) {
          localStorage.setItem(FIRST_CAMPAIGN, JSON.stringify(camp));
        }
      } else {
        var saved = sessionStorage.getItem(SESS_CAMPAIGN);
        if (saved) camp = JSON.parse(saved) || {};
      }
    } catch (e) { /* storage blocked — session-only attribution */ }
    return camp;
  }

  var campaign = computeCampaign();

  function firstTouchCampaign() {
    try { return JSON.parse(localStorage.getItem(FIRST_CAMPAIGN) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function safeProps(properties) {
    var input = properties || {};
    var out = {
      site: 'undressgoon',
      surface: 'website',
      path: location.pathname || '/',
      title: document.title || '',
      referrer: document.referrer || '',
      language: document.documentElement.lang || navigator.language || '',
      // A/B landing identifier: pages set window.UG_VARIANT ('variant_b' on
      // lp2.html); everything else is the control. Attached to EVERY event so
      // the whole funnel (signup -> generation -> purchase) segments by variant.
      landing_variant: window.UG_VARIANT || 'control'
    };
    // Attach campaign attribution to every event so email-driven visits and the
    // conversions that follow can be segmented by utm_campaign in PostHog.
    Object.keys(campaign).forEach(function (k) { out[k] = campaign[k]; });
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
    // Must match the backend's distinct_id (config.py / web/server.py identify
    // the same account as the raw id, no prefix) so browser events merge with
    // server-side payment/generation events onto one person.
    currentDistinctId = String(userId);
    try { localStorage.setItem(storageKey, currentDistinctId); } catch (e) {}
    send('$identify', {
      '$anon_distinct_id': anonId,
      '$set': safeProps(properties || {})
    });
  }

  window.ugTrack = send;
  window.ugIdentify = identify;

  if (enabled) {
    var pv = { url: location.href.split('#')[0] };
    if (Object.keys(campaign).length) {
      pv.$set = campaign;  // latest-touch campaign on the person
      var first = firstTouchCampaign();
      var once = {};
      Object.keys(first).forEach(function (k) { once['initial_' + k] = first[k]; });
      pv.$set_once = once;  // first-touch, never overwritten
    }
    send('$pageview', pv);
    // Explicit funnel entry event (same data as $pageview, but named so the
    // A/B funnel "landing_view -> ... -> purchase" is easy to build in PostHog).
    send('landing_view', { url: location.href.split('#')[0] });
    document.addEventListener('click', function (event) {
      var target = event.target && event.target.closest && event.target.closest(
        '[data-generate-cta], #google-login, #account-topup, #account-link-telegram, #telegram-link, #copy-referral'
      );
      if (!target) return;
      send('website_click', {
        action: target.id || target.getAttribute('data-generate-cta') || 'cta',
        text: (target.textContent || '').trim().slice(0, 80)
      });
    }, { passive: true });
  }
})();
