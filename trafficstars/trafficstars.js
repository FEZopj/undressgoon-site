(function () {
  'use strict';

  function track(event, props) {
    if (typeof window.ugTrack === 'function') window.ugTrack(event, props || {});
  }

  function params() {
    try { return new URLSearchParams(location.search || ''); }
    catch (e) { return new URLSearchParams(); }
  }

  function persistTrafficParams() {
    var p = params();
    var keys = ['click_id', 'campaign_id', 'campaign', 'creative_id', 'site_id', 'adspot_id', 'geo', 'region'];
    var payload = {};
    keys.forEach(function (key) {
      var value = p.get(key);
      if (value) payload[key] = value;
    });
    if (payload.click_id) {
      try { sessionStorage.setItem('ug_trafficstars_click', JSON.stringify(payload)); } catch (e) {}
      track('trafficstars_landing_click_received', {
        campaign_id: payload.campaign_id || '',
        creative_id: payload.creative_id || '',
        site_id: payload.site_id || ''
      });
    }
  }

  function improveGoogleReturnUrl() {
    var link = document.getElementById('google-login');
    if (!link) return;
    link.addEventListener('click', function () {
      track('trafficstars_google_login_clicked', {});
    });
  }

  function trackCtas() {
    document.querySelectorAll('[data-generate-cta]').forEach(function (el) {
      el.addEventListener('click', function () {
        track('trafficstars_start_cta_clicked', { text: (el.textContent || '').trim() });
      });
    });
  }

  function boot() {
    persistTrafficParams();
    improveGoogleReturnUrl();
    trackCtas();
    track('trafficstars_landing_viewed', {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
