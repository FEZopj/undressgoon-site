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

  // Preserve the actual entry page and external source for the entire visit.
  // This lets an SEO article -> generator -> purchase journey remain attached
  // to the article even after document.referrer becomes an internal URL.
  var SESS_LANDING = 'ug_ph_landing';
  var FIRST_LANDING = 'ug_ph_landing_first';

  function classifyChannel(referrer) {
    var medium = String(campaign.utm_medium || '').toLowerCase();
    if (/cpc|ppc|paid|display|banner|native/.test(medium)) return 'paid';
    if (/email|newsletter/.test(medium)) return 'email';
    if (/affiliate|partner|referral/.test(medium)) return 'affiliate';
    if (Object.keys(campaign).length) return 'campaign';
    if (!referrer) return 'direct';
    try {
      var hostName = new URL(referrer).hostname.toLowerCase();
      if (hostName === location.hostname.toLowerCase()) return 'internal';
      if (/(^|\.)(google|bing|yahoo|duckduckgo|yandex|baidu)\./.test(hostName)) return 'organic';
      return 'referral';
    } catch (e) { return 'unknown'; }
  }

  function computeLandingAttribution() {
    try {
      var saved = sessionStorage.getItem(SESS_LANDING);
      if (saved) return JSON.parse(saved) || {};
    } catch (e) {}
    var entry = {
      landing_path: location.pathname || '/',
      landing_url: location.href.split('#')[0].slice(0, 500),
      landing_referrer: String(document.referrer || '').slice(0, 500),
      traffic_channel: classifyChannel(document.referrer || '')
    };
    if (window.UG_SEO_TOPIC) entry.landing_seo_topic = String(window.UG_SEO_TOPIC).slice(0, 80);
    try {
      sessionStorage.setItem(SESS_LANDING, JSON.stringify(entry));
      if (!localStorage.getItem(FIRST_LANDING)) localStorage.setItem(FIRST_LANDING, JSON.stringify(entry));
    } catch (e) {}
    return entry;
  }

  var landingAttribution = computeLandingAttribution();

  function firstTouchCampaign() {
    try { return JSON.parse(localStorage.getItem(FIRST_CAMPAIGN) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function firstTouchLanding() {
    try { return JSON.parse(localStorage.getItem(FIRST_LANDING) || '{}') || {}; }
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
      page_type: window.UG_PAGE_TYPE || 'landing',
      seo_topic: window.UG_SEO_TOPIC || '',
      // Landing identifier, kept so historical variant_b data still lines up
      // with today's. The lp2 design won and became the index, so nothing sets
      // UG_VARIANT any more; a page can still set it for the next test.
      landing_variant: window.UG_VARIANT || 'control'
    };
    // Attach campaign attribution to every event so email-driven visits and the
    // conversions that follow can be segmented by utm_campaign in PostHog.
    Object.keys(campaign).forEach(function (k) { out[k] = campaign[k]; });
    Object.keys(landingAttribution).forEach(function (k) { out[k] = landingAttribution[k]; });
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

  /*
   * Generator state guard.
   *
   * A saved video recipe is stored in site.js as selectedSavedVideoRecipeId.
   * Selecting a normal video preset updates selectedPresetKey but older builds
   * did not clear that saved-recipe id. site.js then preferred the stale recipe
   * id when building /web/generate, so the visible preset and actual generation
   * could disagree. analytics.js executes before site.js on every localized
   * landing, so guard the request boundary until the state reset lives directly
   * beside the preset picker code.
   */
  (function installVideoPresetRequestGuard() {
    var nativeFetch = window.fetch;
    if (!nativeFetch || nativeFetch.__ugVideoPresetGuard) return;

    function guardedFetch(input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var opts = init || {};
        var body = opts.body;
        if (/\/web\/generate(?:[?#]|$)/.test(String(url)) &&
            typeof FormData !== 'undefined' && body instanceof FormData) {
          var mode = document.querySelector('input[name="mode"]:checked');
          var activePreset = document.querySelector('#preset-grid button.active[data-key]');
          if (mode && mode.value === 'video' && activePreset && activePreset.dataset.locked !== '1') {
            var key = activePreset.getAttribute('data-key');
            if (key) {
              body.delete('saved_video_recipe_id');
              body.delete('video_prompt');
              body.set('video_preset', key);
            }
          }
        }
      } catch (e) {
        // Never let a defensive request guard block generation.
      }
      return nativeFetch.apply(this, arguments);
    }

    guardedFetch.__ugVideoPresetGuard = true;
    window.fetch = guardedFetch;
  })();

  window.ugTrack = send;
  window.ugIdentify = identify;

  if (enabled) {
    var pv = { url: location.href.split('#')[0] };
    if (Object.keys(campaign).length) {
      pv.$set = campaign;  // latest-touch campaign on the person
    }
    // Organic/direct visits often have no UTM campaign at all. Persist their
    // first landing page too, otherwise only paid/campaign visitors would get
    // person-level first-touch properties in PostHog.
    var first = firstTouchCampaign();
    var firstLanding = firstTouchLanding();
    var once = {};
    Object.keys(first).forEach(function (k) { once['initial_' + k] = first[k]; });
    Object.keys(firstLanding).forEach(function (k) { once['initial_' + k] = firstLanding[k]; });
    if (Object.keys(once).length) pv.$set_once = once;  // never overwritten
    send('$pageview', pv);
    // Explicit funnel entry event (same data as $pageview, but named so the
    // A/B funnel "landing_view -> ... -> purchase" is easy to build in PostHog).
    send('landing_view', { url: location.href.split('#')[0] });
    document.addEventListener('click', function (event) {
      var target = event.target && event.target.closest && event.target.closest(
        '[data-generate-cta], [data-seo-cta], [data-affiliate-cta], #google-login, #account-topup, #account-link-telegram, #telegram-link, #copy-referral'
      );
      if (!target) return;
      send('website_click', {
        action: target.id || target.getAttribute('data-generate-cta') || 'cta',
        text: (target.textContent || '').trim().slice(0, 80),
        destination: String(target.getAttribute('href') || '').slice(0, 240)
      });
      if (target.hasAttribute('data-seo-cta')) {
        send('seo_cta_click', {
          topic: window.UG_SEO_TOPIC || '',
          destination: String(target.getAttribute('href') || '').slice(0, 240)
        });
      }
    }, { passive: true });
  }
})();
