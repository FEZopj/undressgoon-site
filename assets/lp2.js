/* ========================================================================== 
   UndressGoon — landing variant B (lp2) behaviour.

   site.js owns the product funnel (auth, credits, generation and results).
   This file owns the landing-stage presentation plus a few mobile flow guards
   that depend on that presentation: signed-out scrolling, auth CTA parity,
   and returning free users to the preset their free generation can use.
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

    // The examples sit immediately below the generator now, so the animated
    // "See the quality of our results" jump CTA is unnecessary visual noise.
    // Remove its mount before site.js's async example loader can populate it.
    var examplePeek = document.getElementById('ex-peek');
    if (examplePeek) examplePeek.remove();

    var pitchTimer = 0;
    var lockedPresetAttempt = false;

    // ---- 1. hand the stage over to the result ---------------------------
    function showResultStage() {
      if (!resultWrap.hidden) return;
      resultWrap.hidden = false;
      stage.classList.add('is-generating');
      // Collapse the pitch only after its fade finishes, so the result does
      // not jump up mid-animation.
      if (pitch) {
        window.clearTimeout(pitchTimer);
        pitchTimer = window.setTimeout(function () {
          pitch.classList.add('is-gone');
        }, 300);
      }
      if (window.UG_REFRESH_ICONS) window.UG_REFRESH_ICONS();
    }

    function isSignedOut() {
      var login = document.getElementById('login-box');
      return !!(login && !login.hidden);
    }

    function topBelowHeader(el) {
      if (!el) return;
      var header = document.querySelector('header');
      var headerHeight = header ? Math.ceil(header.getBoundingClientRect().height) : 0;
      var top = el.getBoundingClientRect().top + window.pageYOffset - headerHeight - 14;
      var maxTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo(0, Math.max(0, Math.min(top, maxTop)));
    }

    // site.js also scrolls when it paints the auth notice. On mobile that can
    // leave the signup CTA half-hidden above the sticky header. Re-land after
    // its smooth scroll has started, then once more after it has settled.
    function settleSignupNoticeScroll() {
      var land = function () {
        var notice = document.querySelector('#web-results .result-notice');
        topBelowHeader(notice || document.getElementById('login-box'));
      };
      window.setTimeout(land, 40);
      window.setTimeout(land, 380);
    }

    function scrollLoginBox() {
      var land = function () { topBelowHeader(document.getElementById('login-box')); };
      window.setTimeout(land, 20);
      window.setTimeout(land, 260);
    }

    function openEmailLogin() {
      var start = document.getElementById('email-login-start');
      var formEl = document.getElementById('email-form');
      var input = document.getElementById('email-input');
      if (start && !start.hidden) {
        start.click();
      } else if (formEl) {
        formEl.hidden = false;
      }
      scrollLoginBox();
      window.setTimeout(function () { if (input) input.focus(); }, 300);
    }

    // The result-card signup CTA used to expose only Google even though the
    // actual login box supports both Google and email. Mirror the email option
    // into that card and reuse the already-bound email flow from site.js.
    function enhanceSignupNotice() {
      if (!isSignedOut()) return false;
      var card = document.querySelector('#web-results .result-notice');
      if (!card) return false;
      var primary = card.querySelector('#rn-action');
      if (!primary || !/google/i.test(primary.textContent || '')) return false;
      if (!card.querySelector('#rn-action-email')) {
        var emailStart = document.getElementById('email-login-start');
        var email = document.createElement('button');
        email.type = 'button';
        email.id = 'rn-action-email';
        email.className = 'btn btn-email rn-cta';
        email.textContent = emailStart && emailStart.textContent.trim()
          ? emailStart.textContent.trim()
          : 'Continue with Email';
        email.addEventListener('click', function () {
          openEmailLogin();
        });
        primary.insertAdjacentElement('afterend', email);
      }
      settleSignupNoticeScroll();
      return true;
    }

    // ---- wire it to the real generation ---------------------------------
    if (form) {
      // Capture phase: run before site.js's own submit handler. Signed-out
      // users should NOT be scrolled to the generic result position here;
      // site.js will paint the signup card and the observer below lands that
      // card precisely below the sticky header.
      form.addEventListener('submit', function () {
        var consent = document.getElementById('web-consent');
        var file = document.getElementById('person-photo');
        var chosen = file && file.files && file.files[0];
        if (!chosen || !consent || !consent.checked) return;
        if (isSignedOut()) return;
        showResultStage();
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
      // If the smooth scroll never ran, jump.
      window.setTimeout(function () {
        var r = resultWrap.getBoundingClientRect();
        if (r.top > window.innerHeight * 0.9 || r.bottom < 0) {
          window.scrollTo(0, top());
        }
      }, 450);
    }

    // Results arriving (or the panel being cleared on failure) end the pitch.
    // When that result is the signed-out signup notice, also add the email path
    // and correct the mobile landing position after site.js's own scroll.
    var results = document.getElementById('web-results');
    if (results) {
      try {
        new MutationObserver(function () {
          if (!results.children.length) return;
          showResultStage();
          enhanceSignupNotice();
        }).observe(results, { childList: true, subtree: true });
      } catch (e) { /* no-op */ }
      enhanceSignupNotice();
    }

    // ---- free preset guard ------------------------------------------------
    // A free user can tap a locked look while the Hottest/Clothes/Fantasy
    // category remains on that locked look. After they acknowledge the notice,
    // put the UI back onto the usable free Fully Nude preset automatically.
    function selectFreePreset() {
      var promptMode = document.querySelector('input[name="mode"][value="prompt"]');
      if (promptMode && !promptMode.checked) {
        promptMode.checked = true;
        promptMode.dispatchEvent(new Event('change', { bubbles: true }));
      }
      window.setTimeout(function () {
        var hot = document.querySelector('#preset-tabs button[data-cat="hot"]');
        if (hot && !hot.classList.contains('active')) hot.click();
        window.setTimeout(function () {
          var free = document.querySelector('#preset-grid button[data-key="nude"]');
          if (free) free.click();
        }, 0);
      }, 0);
    }

    document.addEventListener('click', function (event) {
      var locked = event.target && event.target.closest && event.target.closest('#preset-grid button[data-locked="1"]');
      if (locked) lockedPresetAttempt = true;
    }, true);

    document.addEventListener('click', function (event) {
      var target = event.target && event.target.closest ? event.target.closest('.ug-notice-ok') : null;
      if (target && lockedPresetAttempt) {
        lockedPresetAttempt = false;
        // hideNotice() finishes after 180 ms; restore the preset just after it.
        window.setTimeout(selectFreePreset, 210);
        return;
      }
      if (event.target && event.target.closest && event.target.closest('.ug-notice-backdrop')) {
        lockedPresetAttempt = false;
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') lockedPresetAttempt = false;
    });

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
