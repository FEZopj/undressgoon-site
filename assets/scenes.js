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

  // Show the "Scene v2" generator mode as a greyed-out "SOON" that can't be selected
  // until the backend reports the feature live (SCENE_ENABLED=true). Flip the env
  // to enable/disable without any redeploy.
  function applySceneAvailability(enabled, beta) {
    var radio = document.querySelector('input[name="mode"][value="scene"]');
    var label = document.getElementById("scene-mode-label");
    var badge = document.getElementById("scene-mode-badge");
    if (!radio || !label) return;
    radio.disabled = !enabled;
    label.classList.toggle("scene-coming-soon", !enabled);
    label.title = enabled ? "" : "Coming soon";
    if (badge) {
      if (enabled) {
        badge.textContent = "NEW";
        badge.style.background = "var(--accent,#ff3d6e)";
      } else {
        badge.textContent = "SOON";
        badge.style.background = "var(--muted,#9b9ba8)";
      }
    }
    if (!enabled && radio.checked) {
      var prompt = document.querySelector('input[name="mode"][value="prompt"]');
      if (prompt) { prompt.checked = true; prompt.dispatchEvent(new Event("change", { bubbles: true })); }
    }
  }

  var announced = false;

  function check() {
    return fetch(API + "/web/scenes", { credentials: "include" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        applySceneAvailability(!!(d && d.enabled), !!(d && d.beta));
        // Hand the catalogue to site.js so its picker is always the server's
        // list — otherwise a preset removed server-side lingers as a dead button.
        if (window.UG_APPLY_SCENE_CATALOGUE) window.UG_APPLY_SCENE_CATALOGUE(d);
        if (!announced) { renderAnnouncement(d && d.announcement); announced = true; }
      })
      .catch(function () { /* silent — Scene mode stays hidden */ });
  }

  // Availability is per-account while scenes are in beta, and this runs before
  // the session is known, so site.js calls it again once someone signs in.
  window.UG_RECHECK_SCENES = check;

  function boot() {
    applySceneAvailability(false); // default hidden until the backend confirms
    check();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
