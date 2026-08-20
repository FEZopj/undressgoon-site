/* ==========================================================================
   UndressGoon — landing variant B (lp2) behaviour.

   Purely presentational. site.js still owns the whole funnel (auth, credits,
   the RunPod job, painting results); this only decides what the stage looks
   like while that happens.

   Its job:

   1. Result takes the stage. When a generation starts, the pitch column slides
      down out of the way and the result panel rises into the same spot, so the
      user's eye stays where it already was. The pitch is moved below the stage
      rather than destroyed, so the selling copy is still on the page.

   The "working on your photo" preview lives in site.js, so the control page
   gets it too.

   The page arrives on the black theme because that is the CSS default (:root)
   and site.js only switches to light when the visitor picked it before, so the
   theme toggle keeps working.
   ========================================================================== */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    var stage = document.querySelector('.lp2-stage');
    var pitch = document.querySelector('.lp2-pitch');
    var resultWrap = document.getElementById('lp2-stage-result');
    var form = document.getElementById('web-generate-form');
    if (!stage || !resultWrap) return;

    var preview = document.getElementById('lp2-preview');
    var canvas = document.getElementById('lp2-preview-canvas');
    var label = document.getElementById('lp2-preview-label');
    var previewTimer = 0;
    var pitchTimer = 0;

    // ---- 1. hand the stage over to the result ---------------------------
    function showResultStage() {
      if (!resultWrap.hidden) return;
      resultWrap.hidden = false;
      stage.classList.add('is-generating');
      // collapse the pitch only after its fade finishes, so the result does
      // not jump up mid-animation
      if (pitch) {
        window.clearTimeout(pitchTimer);
        pitchTimer = window.setTimeout(function () {
          pitch.classList.add('is-gone');
        }, 300);
      }
      if (window.UG_REFRESH_ICONS) window.UG_REFRESH_ICONS();
    }

    // ---- wire it to the real generation ---------------------------------
    if (form) {
      // capture phase: run before site.js's own submit handler, and only when
      // the form is actually going to run, so a validation error does not
      // wipe the pitch away for nothing
      form.addEventListener('submit', function () {
        var consent = document.getElementById('web-consent');
        var file = document.getElementById('person-photo');
        var chosen = file && file.files && file.files[0];
        if (!chosen || !consent || !consent.checked) return;
        showResultStage();
        // On mobile the stage is stacked, so the result can sit well below the
        // fold and tapping Generate would look like nothing happened. Scroll to
        // it, and verify afterwards: smooth scrolling is ignored in some
        // contexts, so fall back to a hard jump rather than leaving the user
        // staring at the form.
        scrollToResult();
      }, true);
    }

    function scrollToResult() {
      var top = function () {
        return resultWrap.getBoundingClientRect().top + window.pageYOffset - 72;
      };
      try {
        window.scrollTo({ top: top(), behavior: 'smooth' });
      } catch (e) {
        window.scrollTo(0, top());
      }
      // if the smooth scroll never ran, jump
      window.setTimeout(function () {
        var r = resultWrap.getBoundingClientRect();
        if (r.top > window.innerHeight * 0.9 || r.bottom < 0) {
          window.scrollTo(0, top());
        }
      }, 450);
    }

    // Results arriving (or the panel being cleared on failure) end the preview.
    var results = document.getElementById('web-results');
    if (results) {
      try {
        new MutationObserver(function () {
          if (results.children.length) {
            showResultStage();  // safety net for any path that skips submit
          }
        }).observe(results, { childList: true });
      } catch (e) { /* no-op */ }
    }

    // ---- mobile: trust strip sits under the generator ---------------------
    var trust = document.querySelector('.lp2-pitch .lp2-trust');
    var genCol = document.querySelector('.lp2-col-gen');
    var pitchHost = document.querySelector('.lp2-pitch');
    if (trust && pitchHost && genCol && window.matchMedia) {
      var slot = document.createElement('div');
      slot.className = 'lp2-trust-mobile';
      genCol.appendChild(slot);
      var mq = window.matchMedia('(max-width: 980px)');
      var place = function () {
        if (mq.matches) { if (trust.parentNode !== slot) slot.appendChild(trust); }
        else if (trust.parentNode !== pitchHost) pitchHost.appendChild(trust);
      };
      place();
      if (mq.addEventListener) mq.addEventListener('change', place);
      else if (mq.addListener) mq.addListener(place);
      window.addEventListener('resize', place);
    }
  });
})();
