/* ==========================================================================
   UndressGoon — "Scenes" feature (explicit PonyRealism generate-then-swap)

   Self-contained. Does NOT touch site.js — worst case it renders nothing and
   the rest of the site is unaffected. Reuses the site's existing config
   (window.UG_CONFIG.apiBase / .botUrl) and web session cookie.

   Renders:
     #ug-announce-root  -> the "NEW" announcement banner (from /web/scenes)
     #ug-scenes-root    -> the Scenes catalogue + subject selectors + generate
   ========================================================================== */
(function () {
  "use strict";
  var UG = window.UG_CONFIG || {};
  var API = String(UG.apiBase || "").replace(/\/+$/, ""); // "" = same origin
  var BOT = UG.botUrl || "https://t.me/goonmasterbotbot?start=web";
  var api = function (p) { return API + p; };

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  var state = { scenes: null, cat: null, selected: null, photo: null, cost: 1 };

  // ---- Announcement banner ------------------------------------------------
  function renderAnnouncement(a) {
    if (!a || !a.enabled || !a.text) return;
    try { if (sessionStorage.getItem("ugsc_ann_dismissed") === a.text) return; } catch (e) {}
    var mount = document.getElementById("ug-announce-root");
    var bar = el("div", "ugsc-announce");
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

  // ---- Boot ---------------------------------------------------------------
  function boot() {
    var root = document.getElementById("ug-scenes-root");
    var haveAnnounce = document.getElementById("ug-announce-root");
    if (!root && !haveAnnounce) return;
    fetch(api("/web/scenes"), { credentials: "include" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        renderAnnouncement(d && d.announcement);
        if (!root) return;
        if (!d || !d.ok || !d.enabled || !d.scenes) { hideSection(root); return; }
        state.scenes = d.scenes;
        state.cost = d.costPerImage || 1;
        state.cat = d.scenes.categories[0] && d.scenes.categories[0].key;
        // Reveal the (default-hidden) section + hero CTA now that the backend
        // confirms Scenes is live — safe to ship the site before the backend.
        var sec = root.closest("section"); if (sec) sec.style.display = "";
        var cta = document.getElementById("ug-scenes-cta"); if (cta) cta.style.display = "";
        render(root);
      })
      .catch(function () { if (root) hideSection(root); });
  }

  function hideSection(root) {
    // If the feature is off/unreachable, hide the whole wrapping section so we
    // don't leave an empty gap on the page.
    var sec = root.closest("section") || root;
    sec.style.display = "none";
  }

  // ---- Render -------------------------------------------------------------
  function render(root) {
    root.innerHTML = "";

    var head = el("div", "ugsc-head");
    var title = el("div", "ugsc-title");
    title.appendChild(el("h2", null, "🔥 Scenes"));
    title.appendChild(el("span", "ugsc-new", "New"));
    head.appendChild(title);
    head.appendChild(el("p", "ugsc-sub",
      "Put yourself into a real scene. Upload one clear face photo, pick a scene, and tune the details so it looks like you."));
    root.appendChild(head);

    var cats = el("div", "ugsc-cats");
    state.scenes.categories.forEach(function (c) {
      var chip = el("div", "ugsc-cat" + (c.key === state.cat ? " active" : ""),
        (c.emoji ? c.emoji + " " : "") + esc(c.label));
      chip.onclick = function () { state.cat = c.key; render(root); };
      cats.appendChild(chip);
    });
    root.appendChild(cats);

    var grid = el("div", "ugsc-grid");
    state.scenes.presets
      .filter(function (p) { return p.category === state.cat; })
      .forEach(function (p) {
        var card = el("div", "ugsc-card" + (state.selected === p.key ? " sel" : ""));
        card.appendChild(el("div", "ugsc-emoji", esc(p.emoji || "🔥")));
        card.appendChild(el("div", "ugsc-label", esc(p.label)));
        if (p.teaser) card.appendChild(el("div", "ugsc-teaser", esc(p.teaser)));
        card.onclick = function () {
          state.selected = p.key;
          root.querySelectorAll(".ugsc-card").forEach(function (n) { n.classList.remove("sel"); });
          card.classList.add("sel");
          updateGo();
        };
        grid.appendChild(card);
      });
    root.appendChild(grid);

    // config panel
    var panel = el("div", "ugsc-panel");
    panel.appendChild(el("h3", null, "Your photo & details"));
    panel.appendChild(el("p", "ugsc-step",
      "The face is locked from your photo. Pick your body details so the generated body matches you."));

    // upload
    var zone = el("label", "ugsc-upload-zone");
    var input = el("input"); input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
    var main = el("span", "ugsc-upload-main", "🖼️ Choose a face photo");
    var sub = el("span", "ugsc-upload-sub", "JPG, PNG or WebP · clear, front-facing works best");
    var thumb = el("img", "ugsc-thumb"); thumb.style.display = "none";
    input.onchange = function () {
      var f = input.files && input.files[0];
      state.photo = f || null;
      if (f) { main.textContent = "✅ " + f.name; thumb.src = URL.createObjectURL(f); thumb.style.display = "inline-block"; }
      else { main.textContent = "🖼️ Choose a face photo"; thumb.style.display = "none"; }
      updateGo();
    };
    zone.appendChild(input); zone.appendChild(main); zone.appendChild(sub); zone.appendChild(thumb);
    panel.appendChild(zone);

    // attributes
    var attrs = el("div", "ugsc-attrs"); attrs.style.marginTop = "16px";
    state.scenes.attributes.forEach(function (a) {
      var field = el("label", "ugsc-field");
      field.appendChild(el("span", null, esc(a.label)));
      var sel = el("select"); sel.dataset.attr = a.key;
      a.options.forEach(function (o) {
        var opt = el("option", null, esc(o.label)); opt.value = o.value; sel.appendChild(opt);
      });
      field.appendChild(sel); attrs.appendChild(field);
    });
    panel.appendChild(attrs);

    // variations
    var row = el("div", "ugsc-row");
    var varField = el("label", "ugsc-field");
    varField.appendChild(el("span", null, "Images"));
    var vars = el("select", "ugsc-vars"); vars.id = "ugsc-vars";
    [1, 2, 3, 4].forEach(function (n) {
      var c = n * state.cost;
      var o = el("option", null, n + " image" + (n > 1 ? "s" : "") + " · " + c + " credit" + (c > 1 ? "s" : ""));
      o.value = n; vars.appendChild(o);
    });
    varField.appendChild(vars); row.appendChild(varField);
    panel.appendChild(row);

    // consent
    var consent = el("label", "ugsc-consent");
    var cb = el("input"); cb.type = "checkbox"; cb.id = "ugsc-consent"; cb.onchange = updateGo;
    consent.appendChild(cb);
    consent.appendChild(el("span", null,
      'I confirm I am 18+ and have the rights and consent to use this photo. The person is a consenting adult. ' +
      '<a href="terms.html">Terms</a> · <a href="acceptable-use.html">Acceptable Use</a> · <a href="consent.html">Consent</a>'));
    panel.appendChild(consent);

    var go = el("button", "ugsc-go"); go.id = "ugsc-go"; go.textContent = "Generate scene"; go.disabled = true;
    go.onclick = generate;
    panel.appendChild(go);

    panel.appendChild(el("div", "ugsc-status"));
    panel.appendChild(el("div", "ugsc-results"));
    root.appendChild(panel);
    updateGo();
  }

  function updateGo() {
    var go = document.getElementById("ugsc-go");
    if (!go) return;
    var c = document.getElementById("ugsc-consent");
    go.disabled = !(state.selected && state.photo && c && c.checked);
  }

  function setStatus(html) {
    var s = document.querySelector("#ug-scenes-root .ugsc-status");
    if (s) s.innerHTML = html || "";
  }

  // ---- Generate + poll ----------------------------------------------------
  function generate() {
    var go = document.getElementById("ugsc-go");
    var root = document.getElementById("ug-scenes-root");
    if (!state.selected || !state.photo) return;
    go.disabled = true;
    root.querySelector(".ugsc-results").innerHTML = "";
    setStatus("Uploading…");

    var fd = new FormData();
    fd.append("mode", "scene");
    fd.append("scene", state.selected);
    fd.append("person", state.photo);
    fd.append("variations", (document.getElementById("ugsc-vars") || {}).value || "1");
    fd.append("terms_accepted", "1");
    root.querySelectorAll(".ugsc-attrs select").forEach(function (sel) {
      if (sel.value && sel.value !== "auto") fd.append(sel.dataset.attr, sel.value);
    });

    fetch(api("/web/generate"), { method: "POST", credentials: "include", body: fd })
      .then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (res) {
        if (res.s === 401) {
          setStatus('Please sign in first — <a href="#generate">use the sign-in box above</a>.');
          go.disabled = false; return;
        }
        if (res.s === 402) {
          setStatus((res.j && res.j.message ? esc(res.j.message) + " " : "Out of credits. ") +
            '<a href="' + esc(BOT) + '">Top up to generate scenes →</a>');
          go.disabled = false; return;
        }
        if (!res.j || !res.j.ok || !res.j.jobId) {
          setStatus(esc((res.j && res.j.message) || "Could not start generation."));
          go.disabled = false; return;
        }
        poll(res.j.jobId);
      })
      .catch(function () { setStatus("Network error. Try again."); go.disabled = false; });
  }

  function poll(jobId) {
    var tries = 0;
    setStatus("Generating your scene… this usually takes 30–60s.");
    var iv = setInterval(function () {
      tries++;
      fetch(api("/web/generation/" + encodeURIComponent(jobId)), { credentials: "include" })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j || !j.ok) { clearInterval(iv); setStatus("Generation expired. Try again."); reEnable(); return; }
          if (j.status === "queued" || j.status === "running") {
            if (tries > 180) { clearInterval(iv); setStatus("Timed out. Try again."); reEnable(); }
            return;
          }
          clearInterval(iv);
          if (j.status === "done" && j.images && j.images.length) {
            setStatus("Done!" + (j.balance != null ? " " + j.balance + " credits left." : ""));
            showResults(j.images);
          } else {
            setStatus(esc(j.message || "Generation failed. Your credit was refunded."));
          }
          reEnable();
        })
        .catch(function () { /* transient — keep polling */ });
    }, 2000);
  }

  function reEnable() { updateGo(); }

  function showResults(images) {
    var wrap = document.querySelector("#ug-scenes-root .ugsc-results");
    if (!wrap) return;
    wrap.innerHTML = "";
    images.forEach(function (im) {
      var img = el("img");
      img.src = "data:" + (im.mime || "image/jpeg") + ";base64," + im.data;
      wrap.appendChild(img);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
