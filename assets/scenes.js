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

  // Hide the "Scene" generator mode until the backend reports the feature live
  // (SCENE_ENABLED=true) — so it never appears before the worker is rebuilt.
  function applySceneAvailability(enabled) {
    var radio = document.querySelector('input[name="mode"][value="scene"]');
    if (!radio || !radio.parentElement) return;
    radio.parentElement.style.display = enabled ? "" : "none";
    if (!enabled && radio.checked) {
      var prompt = document.querySelector('input[name="mode"][value="prompt"]');
      if (prompt) { prompt.checked = true; prompt.dispatchEvent(new Event("change", { bubbles: true })); }
    }
  }

  function boot() {
    applySceneAvailability(false); // default hidden until the backend confirms
    fetch(API + "/web/scenes", { credentials: "include" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        applySceneAvailability(!!(d && d.enabled));
        renderAnnouncement(d && d.announcement);
      })
      .catch(function () { /* silent — Scene mode stays hidden */ });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
