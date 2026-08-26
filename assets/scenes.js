/* ==========================================================================
   UndressGoon — site announcement banner.

   The Scenes feature itself lives in the main generator (site.js, mode=scene).
   This tiny script only renders the admin-settable "NEW …" header banner from
   the backend /web/scenes response. Self-contained; fails silent.
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
    check();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
