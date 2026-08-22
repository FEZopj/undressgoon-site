/* UndressGoon landing loader: stable conversion core + returning-user UX layer. */
(function () {
  'use strict';

  function scriptBase() {
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].getAttribute('src') || '';
      if (src.indexOf('lp2.js') !== -1) return src.replace(/lp2\.js(?:\?.*)?$/, '');
    }
    return 'assets/';
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  // The core ships as a real <script defer> tag ahead of this file, so it has
  // already executed (defer preserves document order) and was fetched in
  // parallel with the page instead of after it. Injecting it here cost a full
  // serialized round trip on every visit - the page painted, then the core
  // arrived and visibly rearranged it. Keep the injection only as a fallback
  // for cached HTML that predates the static tag.
  if (window.__LP2_CORE_READY) {
    ready(enhance);
  } else {
    var core = document.createElement('script');
    core.src = scriptBase() + 'lp2-core-r7.js?v=20260822-r8';
    core.async = false;
    core.onload = function () { ready(enhance); };
    document.head.appendChild(core);
  }

  function enhance() {
    var form = document.getElementById('web-generate-form');
    var login = document.getElementById('login-box');
    var account = document.getElementById('site-account');
    var headerRight = document.querySelector('.header-right');
    var stage = document.querySelector('.lp2-stage');
    var resultWrap = document.getElementById('lp2-stage-result');
    var pitch = document.querySelector('.lp2-pitch');
    var submit = document.getElementById('web-submit');
    if (!form || !login || !headerRight) return;

    function lang() {
      return String(document.documentElement.lang || 'en').toLowerCase().split('-')[0];
    }
    function copy(map, fallback) {
      return map[lang()] || fallback;
    }
    function isAuthed() {
      return !!(account && !account.hidden);
    }

    // Keep the acquisition form looking fully usable before signup.
    function keepGeneratorActive() {
      form.classList.remove('is-locked');
      form.style.opacity = '1';
    }
    keepGeneratorActive();
    try {
      new MutationObserver(keepGeneratorActive)
        .observe(form, { attributes: true, attributeFilter: ['class'] });
    } catch (e) {}

    // If a saved generation resumes after auth, immediately reveal the existing
    // working animation/result stage and scroll to it.
    function revealGenerationProgress() {
      if (!submit || submit.dataset.busy !== '1' || !resultWrap || !stage) return;
      var wasHidden = resultWrap.hidden;
      resultWrap.hidden = false;
      stage.classList.add('is-generating');
      if (wasHidden && pitch) {
        window.setTimeout(function () { pitch.classList.add('is-gone'); }, 300);
      }
      if (wasHidden) {
        var land = function () {
          var header = document.querySelector('header');
          var offset = (header ? Math.ceil(header.getBoundingClientRect().height) : 0) + 12;
          var top = resultWrap.getBoundingClientRect().top + window.pageYOffset - offset;
          window.scrollTo(0, Math.max(0, top));
        };
        window.setTimeout(land, 25);
        window.setTimeout(land, 320);
      }
      if (window.UG_REFRESH_ICONS) window.UG_REFRESH_ICONS();
    }
    if (submit) {
      try {
        new MutationObserver(revealGenerationProgress)
          .observe(submit, { attributes: true, attributeFilter: ['data-busy', 'disabled'] });
      } catch (e) {}
      revealGenerationProgress();
    }

    // Sell the breadth of the product instead of a short outfit list.
    var cats = document.querySelector('.lp2-cats');
    if (cats) {
      cats.textContent = copy({
        fr: 'Nudes · Retouches de tenues · Scènes sexuelles · Looks fétiche · Prompts personnalisés',
        de: 'Nudes · Outfit-Edits · Sexszenen · Fetisch-Looks · Eigene Prompts',
        es: 'Desnudos · Edición de outfits · Escenas sexuales · Looks fetiche · Prompts personalizados',
        pt: 'Nudes · Edições de roupa · Cenas de sexo · Looks fetiche · Prompts personalizados',
        ja: 'ヌード · 衣装編集 · セックスシーン · フェティッシュ · カスタムプロンプト',
        ru: 'Нюд · Смена образа · Секс-сцены · Фетиш-образы · Свои промпты',
        zh: '裸照 · 服装编辑 · 性爱场景 · 情趣造型 · 自定义提示词'
      }, 'Nudes · Outfit edits · Sex scenes · Fetish looks · Custom prompts');
    }

    // Correct stale Fully-Nude-only lock copy from cached site.js/locales.
    function patchFreeNotice() {
      var notice = document.getElementById('ug-notice');
      if (!notice || notice.hidden) return;
      var msg = notice.querySelector('.ug-notice-msg');
      if (!msg) return;
      var desired = copy({
        fr: 'Ta génération gratuite couvre tous les presets Outfit Edit. Les scènes et les prompts personnalisés se débloquent dès que tu recharges.',
        de: 'Deine kostenlose Generierung gilt für alle Outfit-Edit-Presets. Szenen und eigene Prompts werden nach dem ersten Aufladen freigeschaltet.',
        es: 'Tu generación gratis cubre todos los presets de Outfit Edit. Las escenas y los prompts personalizados se desbloquean al recargar.',
        pt: 'Sua geração grátis cobre todos os presets de Outfit Edit. Cenas e prompts personalizados são desbloqueados ao recarregar.',
        ja: '無料生成ではすべての Outfit Edit プリセットを利用できます。シーンとカスタムプロンプトはチャージ後に解放されます。',
        ru: 'Бесплатная генерация доступна для всех пресетов Outfit Edit. Сцены и свои промпты открываются после пополнения.',
        zh: '免费生成可使用全部 Outfit Edit 预设。充值后可解锁场景和自定义提示词。'
      }, 'Your free generation covers all Outfit Edit presets. Scenes and custom prompts unlock whenever you top up.');
      if (msg.textContent !== desired) msg.textContent = desired;
    }

    document.addEventListener('click', function (event) {
      var target = event.target && event.target.closest ? event.target : null;
      if (!target) return;
      if (target.closest('.write-own-btn.locked') ||
          target.closest('#preset-grid button[data-locked="1"]') ||
          target.closest('[data-scene-locked="1"]')) {
        window.setTimeout(patchFreeNotice, 0);
        window.setTimeout(patchFreeNotice, 40);
      }
    }, true);

    try {
      new MutationObserver(function () {
        var msg = document.querySelector('#ug-notice:not([hidden]) .ug-notice-msg');
        if (!msg) return;
        if (/Fully Nude|free generation|génération gratuite|generación gratis|geração grátis/i.test(String(msg.textContent || ''))) {
          patchFreeNotice();
        }
      }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    } catch (e) {}

    // Deterministic logout: stop the legacy handler before it can navigate or
    // leave the UI half-reset. POST the API, then reload the clean landing page.
    document.addEventListener('click', function (event) {
      var button = event.target && event.target.closest ? event.target.closest('#account-logout') : null;
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      if (button.dataset.loggingOut === '1') return;
      button.dataset.loggingOut = '1';
      button.disabled = true;

      var cfg = window.UG_CONFIG || {};
      var apiBase = String(cfg.apiBase || '').replace(/\/$/, '');
      var currentLang = lang();
      var localized = ['fr', 'de', 'es', 'pt', 'ja', 'ru', 'zh'].indexOf(currentLang) !== -1;
      var landing = localized ? '/' + currentLang + '/' : '/';

      fetch(apiBase + '/web/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      }).catch(function () {
        // Even if the request fails at the network layer, never send the user
        // to an API/error page; return to the landing and let session refresh decide.
      }).finally(function () {
        window.location.replace(landing);
      });
    }, true);

    // Returning-user login button + modal. Reuse the real Google/email controls
    // so all existing auth handlers and pending-generation behavior stay intact.
    var style = document.createElement('style');
    style.id = 'ug-returning-login-style';
    style.textContent =
      '.web-form.is-locked{opacity:1!important}' +
      '.ug-header-login{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:38px;padding:8px 12px;border:1px solid var(--border);border-radius:11px;background:transparent;color:var(--text);font:inherit;font-size:.84rem;font-weight:850;cursor:pointer;white-space:nowrap}' +
      '.ug-header-login:hover{border-color:rgba(255,45,85,.58);background:rgba(255,45,85,.1)}' +
      '.ug-header-login svg{width:16px;height:16px}' +
      '.ug-login-open body{overflow:hidden}' +
      '.ug-login-modal[hidden]{display:none!important}' +
      '.ug-login-modal{position:fixed;inset:0;z-index:900;display:grid;place-items:center;padding:18px}' +
      '.ug-login-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.72);backdrop-filter:blur(5px)}' +
      '.ug-login-dialog{position:relative;width:min(440px,100%);padding:22px;border:1px solid var(--border);border-radius:18px;background:var(--surface);box-shadow:0 28px 90px rgba(0,0,0,.55)}' +
      '.ug-login-close{position:absolute;right:11px;top:10px;width:34px;height:34px;border:0;border-radius:50%;background:rgba(255,255,255,.07);color:var(--text);font-size:1.2rem;cursor:pointer}' +
      '.ug-login-dialog h2{margin:0 38px 5px 0;font-size:1.25rem}' +
      '.ug-login-dialog>p{margin:0 0 16px;color:var(--muted);font-size:.9rem}' +
      '.ug-login-body{display:grid;gap:10px}' +
      '.ug-login-body .login-choices{display:grid;gap:9px}' +
      '.ug-login-body .btn{width:100%}' +
      '@media(max-width:560px){.ug-header-login{min-height:38px;padding:8px 9px;font-size:.78rem}.ug-login-dialog{padding:18px 14px}}';
    document.head.appendChild(style);

    var headerLogin = document.createElement('button');
    headerLogin.type = 'button';
    headerLogin.id = 'ug-header-login';
    headerLogin.className = 'ug-header-login';
    headerLogin.hidden = true;
    headerLogin.innerHTML = '<i data-lucide="log-in"></i><span>' + copy({
      fr: 'Connexion', de: 'Login', es: 'Entrar', pt: 'Entrar', ja: 'ログイン', ru: 'Войти', zh: '登录'
    }, 'Log in') + '</span>';
    var generateCta = headerRight.querySelector('[data-generate-cta]');
    headerRight.insertBefore(headerLogin, generateCta || headerRight.firstChild);

    var modal = document.createElement('div');
    modal.id = 'ug-returning-login-modal';
    modal.className = 'ug-login-modal';
    modal.hidden = true;
    modal.innerHTML =
      '<div class="ug-login-backdrop" data-ug-login-close></div>' +
      '<div class="ug-login-dialog" role="dialog" aria-modal="true" aria-labelledby="ug-login-title">' +
        '<button type="button" class="ug-login-close" aria-label="Close" data-ug-login-close>×</button>' +
        '<h2 id="ug-login-title">' + copy({
          fr:'Bon retour', de:'Willkommen zurück', es:'Bienvenido de nuevo', pt:'Bem-vindo de volta',
          ja:'おかえりなさい', ru:'С возвращением', zh:'欢迎回来'
        }, 'Welcome back') + '</h2>' +
        '<p>' + copy({
          fr:'Connecte-toi pour retrouver tes crédits et continuer à générer.',
          de:'Logge dich ein, um deine Credits zu nutzen und weiter zu generieren.',
          es:'Inicia sesión para acceder a tus créditos y seguir generando.',
          pt:'Entre para acessar seus créditos e continuar gerando.',
          ja:'ログインしてクレジットを確認し、生成を続けましょう。',
          ru:'Войдите, чтобы получить доступ к кредитам и продолжить генерацию.',
          zh:'登录以使用你的点数并继续生成。'
        }, 'Log in to access your credits and continue generating.') + '</p>' +
        '<div class="ug-login-body" id="ug-login-body"></div>' +
      '</div>';
    document.body.appendChild(modal);

    var modalBody = modal.querySelector('#ug-login-body');
    var authNodes = [
      login.querySelector('.login-choices'),
      document.getElementById('email-form'),
      document.getElementById('email-code-form'),
      document.getElementById('login-error')
    ].filter(Boolean);

    function restoreAuthNodes() {
      authNodes.forEach(function (node) { login.appendChild(node); });
    }
    function openLoginModal() {
      if (isAuthed()) return;
      authNodes.forEach(function (node) { modalBody.appendChild(node); });
      modal.hidden = false;
      document.documentElement.classList.add('ug-login-open');
      var google = document.getElementById('google-login');
      if (google) window.setTimeout(function () { google.focus(); }, 30);
      if (window.UG_REFRESH_ICONS) window.UG_REFRESH_ICONS();
    }
    function closeLoginModal() {
      if (modal.hidden) return;
      modal.hidden = true;
      document.documentElement.classList.remove('ug-login-open');
      restoreAuthNodes();
    }
    function syncHeaderLogin() {
      headerLogin.hidden = isAuthed();
      if (isAuthed()) closeLoginModal();
    }

    headerLogin.addEventListener('click', openLoginModal);
    modal.addEventListener('click', function (event) {
      if (event.target && event.target.hasAttribute('data-ug-login-close')) closeLoginModal();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !modal.hidden) closeLoginModal();
    });

    try {
      if (account) {
        new MutationObserver(function () {
          syncHeaderLogin();
          window.setTimeout(revealGenerationProgress, 0);
          window.setTimeout(revealGenerationProgress, 80);
        }).observe(account, { attributes: true, attributeFilter: ['hidden'] });
      }
    } catch (e) {}

    window.setTimeout(function () {
      syncHeaderLogin();
      revealGenerationProgress();
    }, 450);
    window.setTimeout(function () {
      syncHeaderLogin();
      revealGenerationProgress();
    }, 1000);

    if (window.UG_REFRESH_ICONS) window.UG_REFRESH_ICONS();
  }
})();
