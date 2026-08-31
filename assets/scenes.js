/* ==========================================================================
   UndressGoon — live catalogue helpers + shared storefront polish.

   The Scenes feature itself lives in the main generator (site.js, mode=scene).
   This script refreshes the server-side scene catalogue/announcement and owns
   lightweight UI polish that must stay shared across every localized landing.
   ========================================================================== */
(function () {
  "use strict";
  var UG = window.UG_CONFIG || {};
  var API = String(UG.apiBase || "").replace(/\/+$/, "");

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function renderAnnouncement(a) {
    if (!a || !a.enabled || !a.text) return;
    try { if (sessionStorage.getItem("ugsc_ann_dismissed") === a.text) return; } catch (e) {}
    var mount = document.getElementById("ug-announce-root");
    var bar = document.createElement("div");
    bar.className = "ugsc-announce";
    bar.innerHTML =
      (a.href ? '📣 <a href="' + esc(a.href) + '">' + esc(a.text) + "</a>" : "📣 " + esc(a.text)) +
      '<span class="ugsc-x" title="Dismiss">&times;</span>';
    bar.querySelector(".ugsc-x").onclick = function () {
      try { sessionStorage.setItem("ugsc_ann_dismissed", a.text); } catch (e) {}
      bar.remove();
    };
    if (mount) mount.appendChild(bar);
    else document.body.insertBefore(bar, document.body.firstChild);
  }

  // Scene is a public production feature. Keep it selectable from first paint;
  // the catalogue request only refreshes presets and announcements.
  function applySceneAvailability() {
    var radio = document.querySelector('input[name="mode"][value="scene"]');
    var label = document.getElementById("scene-mode-label");
    if (!radio || !label) return;
    radio.disabled = false;
  }

  /* -----------------------------------------------------------------------
     Top-up modal conversion treatment.

     Pack codes are intentionally used instead of array positions. The backend
     documents these codes as stable order identifiers, so MOST POPULAR cannot
     silently jump to another tier when pack ordering changes.
     ----------------------------------------------------------------------- */
  function installTopupStyles() {
    if (document.getElementById("ug-topup-redesign-r1")) return;
    var style = document.createElement("style");
    style.id = "ug-topup-redesign-r1";
    style.textContent = `
      #checkout-panel .topup-dialog {
        width: min(1400px, calc(100vw - 34px));
        padding: 30px 32px 24px;
        border-radius: 28px;
        border: 1px solid rgba(255,255,255,.12);
        background:
          radial-gradient(circle at 42% -14%, rgba(255,45,85,.20), transparent 35%),
          radial-gradient(circle at 96% 8%, rgba(139,92,246,.13), transparent 30%),
          linear-gradient(145deg,#17171d,#0b0b0f 72%);
        box-shadow: 0 35px 130px rgba(0,0,0,.72), 0 0 80px rgba(255,45,85,.08);
      }
      #checkout-panel .topup-dialog > h3 {
        font-size: clamp(1.65rem,2.4vw,2.35rem);
        letter-spacing: -.03em;
        margin-top: 5px;
      }
      #checkout-panel .topup-dialog > p {
        max-width: 760px;
        font-size: .96rem;
        margin-top: 7px;
      }
      #checkout-panel .pack-grid {
        grid-template-columns: repeat(5,minmax(0,1fr));
        gap: 15px;
        align-items: stretch;
        margin-top: 20px;
        overflow: visible;
      }
      #checkout-panel .pack-card {
        isolation: isolate;
        min-width: 0;
        min-height: 330px;
        padding: 34px 18px 18px;
        border-radius: 20px;
        border: 1px solid rgba(255,255,255,.11);
        background: linear-gradient(165deg,rgba(255,255,255,.065),rgba(255,255,255,.018) 45%,rgba(0,0,0,.08));
        box-shadow: 0 14px 34px rgba(0,0,0,.25);
        gap: 8px;
        transition: transform .18s ease,border-color .18s ease,box-shadow .18s ease,background .18s ease;
      }
      #checkout-panel .pack-card:hover {
        transform: translateY(-5px);
        border-color: rgba(255,255,255,.22);
        box-shadow: 0 22px 48px rgba(0,0,0,.42);
      }
      #checkout-panel .pack-card .pack-credits {
        font-size: 1.3rem;
        line-height: 1.08;
        letter-spacing: -.02em;
        margin-top: 4px;
      }
      #checkout-panel .pack-card .pack-price {
        display: flex;
        align-items: baseline;
        gap: 7px;
        min-height: 42px;
        font-size: 2rem;
        font-weight: 950;
        line-height: 1;
        letter-spacing: -.045em;
        color: #fff;
      }
      #checkout-panel .pack-card .pack-price.discounted { flex-wrap: wrap; }
      #checkout-panel .pack-card .pack-price.discounted s {
        font-size: .86rem;
        color: var(--muted);
        font-weight: 800;
        letter-spacing: 0;
      }
      #checkout-panel .pack-card .pack-price.discounted b {
        font-size: 2rem;
        color: #fff;
      }
      #checkout-panel .pack-card .pack-gens {
        font-size: .77rem;
        color: #ff91ab;
        margin-top: -2px;
      }
      #checkout-panel .pack-card .pack-perks {
        margin: 7px 0 10px;
        gap: 7px;
        font-size: .78rem;
        line-height: 1.3;
        color: #d9d9e2;
      }
      #checkout-panel .pack-card .pack-perks li {
        display: flex;
        align-items: flex-start;
        gap: 7px;
      }
      #checkout-panel .pack-card .pack-perks svg {
        flex: 0 0 15px;
        width: 15px;
        height: 15px;
        margin-top: 1px;
        color: #61ee91;
      }
      #checkout-panel .pack-card .pack-actions {
        display: grid;
        grid-template-columns: 1fr;
        gap: 8px;
        margin-top: auto;
      }
      #checkout-panel .pack-card .pack-actions button {
        min-height: 43px;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,.13);
        background: rgba(255,255,255,.065);
        color: #fff;
        font: inherit;
        font-size: .82rem;
        font-weight: 900;
        cursor: pointer;
        transition: transform .15s ease,border-color .15s ease,background .15s ease,box-shadow .15s ease;
      }
      #checkout-panel .pack-card .pack-actions button:hover {
        transform: translateY(-1px);
        border-color: rgba(255,91,130,.55);
        background: rgba(255,45,85,.13);
      }
      #checkout-panel .pack-card .pack-actions .pay-card-pack {
        border-color: rgba(255,74,116,.48);
        background: linear-gradient(135deg,rgba(255,45,85,.92),rgba(205,39,124,.92));
        box-shadow: 0 9px 24px rgba(255,45,85,.19);
      }
      #checkout-panel .pack-card .pack-badge {
        top: -11px;
        left: 50%;
        right: auto;
        transform: translateX(-50%);
        padding: 6px 12px;
        border-radius: 999px;
        font-size: .67rem;
        letter-spacing: .07em;
        box-shadow: 0 7px 20px rgba(0,0,0,.35);
        white-space: nowrap;
      }
      #checkout-panel .pack-card .pack-save {
        top: 10px;
        right: 10px;
        left: auto;
        padding: 4px 7px;
        z-index: 4;
        box-shadow: 0 5px 14px rgba(0,0,0,.22);
      }

      #checkout-panel .pack-card.popular-hero {
        z-index: 5;
        border: 2px solid #ff3d6e;
        background:
          radial-gradient(circle at 50% 0,rgba(255,76,124,.24),transparent 42%),
          linear-gradient(165deg,rgba(255,45,85,.14),rgba(34,17,31,.72) 50%,rgba(18,12,21,.95));
        box-shadow:
          0 0 0 1px rgba(255,91,135,.18),
          0 20px 55px rgba(255,35,91,.30),
          0 0 54px rgba(181,43,213,.18);
        transform: translateY(-7px) scale(1.025);
      }

      /* landing.css gives every card a staggered pack-in animation whose
         keyframes end at transform:none. Animations override the normal
         transform property while they run, so the hero used to render at 1x
         and then snap to scale(1.025) when the animation ended. Keep the hero
         at its final emphasized size from the first painted frame. */
      #checkout-panel.is-open .pack-card.popular-hero {
        animation: none !important;
      }

      #checkout-panel .pack-card.popular-hero:hover {
        transform: translateY(-10px) scale(1.035);
        box-shadow:
          0 0 0 1px rgba(255,120,153,.26),
          0 28px 68px rgba(255,35,91,.38),
          0 0 66px rgba(181,43,213,.22);
      }
      #checkout-panel .pack-card.popular-hero:before {
        content: '';
        position: absolute;
        inset: -2px;
        z-index: -1;
        border-radius: 21px;
        background: linear-gradient(135deg,rgba(255,45,85,.54),rgba(181,43,213,.22),rgba(255,107,138,.5));
        filter: blur(15px);
        opacity: .44;
        pointer-events: none;
      }
      #checkout-panel .pack-card.popular-hero .pack-badge.pop {
        background: linear-gradient(90deg,#ff174f,#ff4c7b);
        color: #fff;
        box-shadow: 0 8px 25px rgba(255,23,79,.42);
      }
      #checkout-panel .pack-card.popular-hero .pack-credits {
        color: #fff;
        font-size: 1.38rem;
      }
      #checkout-panel .pack-card.popular-hero .pack-price,
      #checkout-panel .pack-card.popular-hero .pack-price b {
        font-size: 2.18rem;
        text-shadow: 0 0 24px rgba(255,95,137,.16);
      }
      #checkout-panel .pack-card.popular-hero .pack-actions .pay-card-pack {
        min-height: 47px;
        background: linear-gradient(135deg,#ff174f,#ff477a 56%,#c92f9b);
        border-color: #ff668e;
        box-shadow: 0 11px 30px rgba(255,23,79,.32);
      }

      #checkout-panel .pack-card.value-anchor {
        border: 1.5px solid rgba(246,196,90,.62);
        background:
          radial-gradient(circle at 50% 0,rgba(246,196,90,.11),transparent 40%),
          linear-gradient(165deg,rgba(255,255,255,.055),rgba(28,24,18,.25));
        box-shadow: 0 18px 42px rgba(0,0,0,.31),0 0 28px rgba(246,196,90,.07);
      }
      #checkout-panel .pack-card.value-anchor .pack-badge.best {
        background: linear-gradient(90deg,#f3b83f,#ffd976);
        color: #261700;
        box-shadow: 0 8px 22px rgba(243,184,63,.24);
      }
      #checkout-panel .pack-card.value-anchor .pack-price { color: #ffe4a0; }
      #checkout-panel .pack-card.mega-anchor {
        border-color: rgba(137,102,255,.58);
        background:
          radial-gradient(circle at 50% 0,rgba(137,102,255,.14),transparent 42%),
          linear-gradient(165deg,rgba(82,55,140,.20),rgba(23,18,40,.25));
      }
      #checkout-panel .pack-card .pack-badge.max {
        background: linear-gradient(90deg,#7354e8,#a78bfa);
        color: #fff;
        box-shadow: 0 8px 22px rgba(124,92,240,.28);
      }
      #checkout-panel .topup-note {
        display: block;
        text-align: center;
        margin-top: 15px;
        font-size: .76rem;
      }

      html[data-theme='light'] #checkout-panel .topup-dialog {
        border-color: rgba(17,19,26,.11);
        background:
          radial-gradient(circle at 42% -14%,rgba(255,45,85,.14),transparent 35%),
          radial-gradient(circle at 96% 8%,rgba(139,92,246,.09),transparent 30%),
          linear-gradient(145deg,#fff,#f4f5fa 74%);
        box-shadow: 0 35px 110px rgba(28,35,55,.24);
      }
      html[data-theme='light'] #checkout-panel .pack-card {
        border-color: rgba(17,19,26,.11);
        background: linear-gradient(165deg,#fff,#f7f7fb);
        box-shadow: 0 14px 32px rgba(34,40,60,.09);
      }
      html[data-theme='light'] #checkout-panel .pack-card .pack-price { color: #14151b; }
      html[data-theme='light'] #checkout-panel .pack-card .pack-perks { color: #414555; }
      html[data-theme='light'] #checkout-panel .pack-card .pack-actions button {
        color: #1d1f27;
        border-color: rgba(17,19,26,.13);
        background: #fff;
      }
      html[data-theme='light'] #checkout-panel .pack-card .pack-actions .pay-card-pack {
        color: #fff;
        background: linear-gradient(135deg,#ff2d55,#d52d82);
        border-color: #ff5c7d;
      }
      html[data-theme='light'] #checkout-panel .pack-card.popular-hero {
        border-color: #ff315f;
        background:
          radial-gradient(circle at 50% 0,rgba(255,76,124,.17),transparent 42%),
          linear-gradient(165deg,#fff7fa,#fff 58%,#faf7ff);
        box-shadow: 0 20px 55px rgba(255,45,85,.20),0 0 45px rgba(181,43,213,.10);
      }
      html[data-theme='light'] #checkout-panel .pack-card.popular-hero .pack-price { color: #15151b; }
      html[data-theme='light'] #checkout-panel .pack-card.value-anchor {
        background:
          radial-gradient(circle at 50% 0,rgba(246,196,90,.15),transparent 42%),
          linear-gradient(165deg,#fffdf6,#fff);
      }
      html[data-theme='light'] #checkout-panel .pack-card.value-anchor .pack-price { color: #8a5b00; }
      html[data-theme='light'] #checkout-panel .pack-card.mega-anchor {
        background:
          radial-gradient(circle at 50% 0,rgba(137,102,255,.13),transparent 42%),
          linear-gradient(165deg,#fbfaff,#fff);
      }

      @media(max-width:900px) {
        #checkout-panel.topup-modal { padding: 12px; align-items: center; }
        #checkout-panel .topup-dialog {
          width: min(100%,760px);
          max-height: calc(100dvh - 24px);
          padding: 25px 18px 20px;
          border-radius: 22px;
        }
        #checkout-panel .pack-grid {
          display: grid;
          grid-template-columns: none;
          grid-auto-flow: column;
          grid-auto-columns: minmax(245px,72vw);
          gap: 13px;
          overflow-x: auto;
          overflow-y: visible;
          padding: 12px 5px 18px;
          margin-left: -5px;
          margin-right: -5px;
          scroll-snap-type: x mandatory;
          scrollbar-width: thin;
        }
        #checkout-panel .pack-card { min-height: 315px; scroll-snap-align: center; }
        #checkout-panel .pack-card.popular-hero { transform: none; }
        #checkout-panel .pack-card.popular-hero:hover { transform: translateY(-3px); }
        #checkout-panel .topup-note { text-align: left; }
      }
      @media(max-width:520px) {
        #checkout-panel.topup-modal { padding: 0; align-items: end; }
        #checkout-panel .topup-dialog {
          width: 100%;
          max-height: 94dvh;
          border-radius: 24px 24px 0 0;
          padding: 23px 15px calc(18px + env(safe-area-inset-bottom,0px));
        }
        #checkout-panel .pack-grid {
          grid-auto-columns: minmax(252px,84vw);
          margin-top: 15px;
        }
        #checkout-panel .pack-card {
          min-height: 305px;
          padding-left: 17px;
          padding-right: 17px;
        }
        #checkout-panel .pack-card .pack-price { font-size: 1.9rem; }
      }
      @media(prefers-reduced-motion:reduce) {
        #checkout-panel .pack-card.popular-hero,
        #checkout-panel .pack-card.popular-hero:hover { transform: none !important; }
        #checkout-panel .pack-card.popular-hero:before { display: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function patchTopupCards() {
    var grid = document.getElementById("pack-grid");
    if (!grid) return;

    var popular = grid.querySelector('[data-pack-code="pack_200"]');   // $24.99 / 32 credits
    var best = grid.querySelector('[data-pack-code="pack_1000"]');      // $99.99 / 160 credits
    var mega = grid.querySelector('[data-pack-code="pack_2000"]');      // $199.99 / 360 credits
    if (!popular || !best || !mega) return;

    grid.querySelectorAll(".pack-card").forEach(function (card) {
      card.classList.remove("featured", "popular-hero", "value-anchor", "mega-anchor");
    });
    popular.classList.add("featured", "popular-hero");
    best.classList.add("value-anchor");
    mega.classList.add("mega-anchor");

    // Move the localized MOST POPULAR ribbon rather than recreating English copy.
    var popularBadges = Array.prototype.slice.call(grid.querySelectorAll(".pack-badge.pop"));
    var ribbon = popularBadges[0] || null;
    if (!ribbon) {
      ribbon = document.createElement("em");
      ribbon.className = "pack-badge pop";
      ribbon.textContent = "MOST POPULAR";
    }
    if (ribbon.parentNode !== popular) popular.insertBefore(ribbon, popular.firstChild);
    popularBadges.slice(1).forEach(function (badge) { badge.remove(); });

    // Preserve BEST VALUE on the high-price anchor even if upstream rendering changes.
    var bestBadge = best.querySelector(".pack-badge.best");
    if (!bestBadge) {
      bestBadge = grid.querySelector(".pack-badge.best");
      if (bestBadge) best.insertBefore(bestBadge, best.firstChild);
    }
    if (!bestBadge) {
      bestBadge = document.createElement("em");
      bestBadge.className = "pack-badge best";
      bestBadge.textContent = "BEST VALUE";
      best.insertBefore(bestBadge, best.firstChild);
    }

    var maxBadge = mega.querySelector(".pack-badge.max");
    if (!maxBadge) {
      maxBadge = grid.querySelector(".pack-badge.max");
      if (maxBadge) mega.insertBefore(maxBadge, mega.firstChild);
    }
    if (!maxBadge) {
      maxBadge = document.createElement("em");
      maxBadge.className = "pack-badge max";
      maxBadge.textContent = "MAX CREDITS";
      mega.insertBefore(maxBadge, mega.firstChild);
    }
  }

  function initTopupRedesign() {
    installTopupStyles();
    var grid = document.getElementById("pack-grid");
    if (!grid) return;
    patchTopupCards();
    var observer = new MutationObserver(function () { patchTopupCards(); });
    observer.observe(grid, { childList: true, subtree: false });
  }

  var announced = false;

  function check() {
    return fetch(API + "/web/scenes", { credentials: "include" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        applySceneAvailability();
        // Hand the catalogue to site.js so its picker is always the server's
        // list — otherwise a preset removed server-side lingers as a dead button.
        if (window.UG_APPLY_SCENE_CATALOGUE) window.UG_APPLY_SCENE_CATALOGUE(d);
        if (!announced) { renderAnnouncement(d && d.announcement); announced = true; }
      })
      .catch(function () { /* keep the production-first state */ });
  }

  // Availability is per-account while scenes are in beta, and this runs before
  // the session is known, so site.js calls it again once someone signs in.
  window.UG_RECHECK_SCENES = check;

  function boot() {
    applySceneAvailability();
    initTopupRedesign();
    check();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
