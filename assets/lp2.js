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
    core.src = scriptBase() + 'lp2-core-r7.js?v=20260822-r15';
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
      if (form.classList.contains('is-locked')) form.classList.remove('is-locked');
      if (form.style.opacity !== '1') form.style.opacity = '1';
    }
    keepGeneratorActive();
    // site.js announces the completed auth/session repaint. This is the only
    // moment that can restore is-locked, so observing every class mutation was
    // both unnecessary and the source of a startup feedback loop.
    document.addEventListener('ug:session-updated', keepGeneratorActive);

    // If a saved generation resumes after auth, immediately reveal the existing
    // working animation/result stage. The core owns the single settled scroll.
    function revealGenerationProgress() {
      if (!submit || submit.dataset.busy !== '1' || !resultWrap || !stage) return;
      var wasHidden = resultWrap.hidden;
      resultWrap.hidden = false;
      stage.classList.add('is-generating');
      if (wasHidden && pitch) {
        window.setTimeout(function () { pitch.classList.add('is-gone'); }, 300);
      }
      if (window.UG_REFRESH_ICONS) window.UG_REFRESH_ICONS();
    }
    document.addEventListener('ug:generation-started', revealGenerationProgress);
    document.addEventListener('ug:session-updated', revealGenerationProgress);
    revealGenerationProgress();

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

    // Returning-user login button + generation gate. Reuse the real Google/email
    // controls so all existing auth handlers and pending-generation behavior stay intact.
    var style = document.createElement('style');
    style.id = 'ug-returning-login-style';
    style.textContent =
      '.web-form.is-locked{opacity:1!important}' +
      '.ug-header-login{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:38px;padding:8px 12px;border:1px solid var(--border);border-radius:11px;background:transparent;color:var(--text);font:inherit;font-size:.84rem;font-weight:850;cursor:pointer;white-space:nowrap}' +
      '.ug-header-login:hover{border-color:rgba(255,45,85,.58);background:rgba(255,45,85,.1)}' +
      '.ug-header-login svg{width:16px;height:16px}' +
      '.ug-login-open body{overflow:hidden}' +
      '.ug-login-modal[hidden]{display:none!important}' +
      '.ug-login-modal{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:18px}' +
      '.ug-login-backdrop{position:absolute;inset:0;background:rgba(3,3,6,.82);backdrop-filter:blur(8px)}' +
      '.ug-login-dialog{box-sizing:border-box;position:relative;width:min(520px,100%);max-height:calc(100dvh - 36px);overflow-y:auto;padding:28px;border:1px solid rgba(255,48,101,.58);border-radius:22px;background:radial-gradient(circle at 92% 0,rgba(181,35,209,.16),transparent 35%),linear-gradient(145deg,#1b1119,#101014 68%);color:#fff;box-shadow:0 28px 100px rgba(0,0,0,.7),0 0 42px rgba(255,35,91,.17);overscroll-behavior:contain}' +
      '.ug-login-dialog:before{content:"";position:absolute;left:28px;right:28px;top:0;height:3px;border-radius:0 0 8px 8px;background:linear-gradient(90deg,#ff174f,#ff3d74,#b52bd5)}' +
      '.ug-login-close{position:absolute;right:13px;top:12px;width:36px;height:36px;border:1px solid rgba(255,255,255,.1);border-radius:50%;background:rgba(255,255,255,.07);color:#fff;font-size:1.25rem;line-height:1;cursor:pointer}' +
      '.ug-login-close:hover{background:rgba(255,47,99,.18);border-color:rgba(255,47,99,.45)}' +
      '.ug-login-kicker{display:inline-flex;align-items:center;gap:7px;margin:0 44px 13px 0;padding:7px 10px;border:1px solid rgba(255,63,116,.4);border-radius:999px;background:rgba(255,33,91,.11);color:#ff789c;font-size:.72rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase}' +
      '.ug-login-kicker svg{width:15px;height:15px}' +
      '.ug-login-dialog h2{margin:0 38px 8px 0;color:#fff;font-size:clamp(1.35rem,4vw,1.65rem);line-height:1.15}' +
      '.ug-login-description{margin:0 0 20px;color:#fff;font-size:1.03rem;font-weight:600;line-height:1.55}' +
      '.ug-free-word{color:#5cf59a;font-weight:950;text-shadow:0 0 16px rgba(92,245,154,.24)}' +
      '.ug-login-body{display:grid;gap:10px}' +
      '.ug-login-body .login-choices{display:grid;gap:10px;margin:0}' +
      '.ug-login-body .email-auth{margin-top:0}' +
      '.ug-login-body .btn{width:100%}' +
      '.ug-login-body .btn-email{background:rgba(255,255,255,.035);border-color:rgba(255,255,255,.24);color:#fff}' +
      '.ug-login-body .btn-email:hover{background:rgba(255,47,99,.12);border-color:rgba(255,74,125,.58)}' +
      '.ug-login-body .btn-email .mlogo{color:#ff789c}' +
      '.ug-login-body .email-auth input{background:#17171c;border-color:rgba(255,255,255,.2);color:#fff}' +
      '.ug-login-body .email-auth input::placeholder{color:#9f96a0}' +
      '.ug-login-body .email-sent-copy,.ug-login-body .email-hint,.ug-login-body .link-btn{color:#c9c0ca}' +
      '.ug-login-body .email-hint strong,.ug-login-body .link-btn:hover{color:#fff}' +
      '.ug-login-modal.is-generation .ug-login-dialog{border-color:rgba(255,48,101,.72);box-shadow:0 28px 100px rgba(0,0,0,.72),0 0 54px rgba(255,35,91,.24)}' +
      '@media(max-width:560px){.ug-header-login{min-height:38px;padding:8px 9px;font-size:.78rem}.ug-login-modal{padding:8px}.ug-login-dialog{max-height:calc(100dvh - 16px);padding:22px 17px 18px;border-radius:18px}.ug-login-dialog:before{left:17px;right:17px}.ug-login-kicker{margin-bottom:11px}.ug-login-description{font-size:.96rem;margin-bottom:16px}}';
    document.head.appendChild(style);

    var headerLogin = document.getElementById('ug-header-login');
    var generateCta = headerRight.querySelector('[data-generate-cta]');
    if (!headerLogin) {
      headerLogin = document.createElement('button');
      headerLogin.type = 'button';
      headerLogin.id = 'ug-header-login';
      headerLogin.className = 'ug-header-login';
      headerLogin.hidden = true;
      headerLogin.innerHTML = '<i data-lucide="log-in"></i><span>' + copy({
        fr: 'Connexion', de: 'Login', es: 'Entrar', pt: 'Entrar', ja: 'ログイン', ru: 'Войти', zh: '登录'
      }, 'Log in') + '</span>';
      headerRight.insertBefore(headerLogin, generateCta || headerRight.firstChild);
    }

    var modal = document.createElement('div');
    modal.id = 'ug-returning-login-modal';
    modal.className = 'ug-login-modal';
    modal.hidden = true;
    modal.innerHTML =
      '<div class="ug-login-backdrop" data-ug-login-close></div>' +
      '<div class="ug-login-dialog" role="dialog" aria-modal="true" aria-labelledby="ug-login-title" aria-describedby="ug-login-description">' +
        '<button type="button" class="ug-login-close" aria-label="Close" data-ug-login-close>×</button>' +
        '<div class="ug-login-kicker"><i data-lucide="shield-check"></i><span id="ug-login-kicker"></span></div>' +
        '<h2 id="ug-login-title"></h2>' +
        '<p class="ug-login-description" id="ug-login-description"></p>' +
        '<div class="ug-login-body" id="ug-login-body"></div>' +
      '</div>';
    document.body.appendChild(modal);

    var modalBody = modal.querySelector('#ug-login-body');
    var modalKicker = modal.querySelector('#ug-login-kicker');
    var modalTitle = modal.querySelector('#ug-login-title');
    var modalDescription = modal.querySelector('#ug-login-description');
    var previousModalFocus = null;
    var authNodes = [
      login.querySelector('.login-choices'),
      document.getElementById('email-form'),
      document.getElementById('email-code-form'),
      document.getElementById('login-error')
    ].filter(Boolean);

    function restoreAuthNodes() {
      authNodes.forEach(function (node) { login.appendChild(node); });
    }
    function setLoginModalCopy(reason) {
      var generation = reason === 'generation';
      modal.classList.toggle('is-generation', generation);
      modalKicker.textContent = generation ? copy({
        fr:'Vérification sécurisée', de:'Sicherheitscheck', es:'Verificación segura', pt:'Verificação segura',
        ja:'安全確認', ru:'Безопасная проверка', zh:'安全验证'
      }, 'Secure verification') : copy({
        fr:'Accès au compte', de:'Kontozugang', es:'Acceso a la cuenta', pt:'Acesso à conta',
        ja:'アカウント', ru:'Доступ к аккаунту', zh:'账户登录'
      }, 'Account access');
      modalTitle.textContent = generation ? copy({
        fr:'Confirme que tu n’es pas un robot', de:'Bestätige, dass du kein Roboter bist', es:'Confirma que no eres un robot', pt:'Confirme que você não é um robô',
        ja:'ロボットではないことを確認', ru:'Подтвердите, что вы не робот', zh:'确认你不是机器人'
      }, 'Confirm you are not a robot') : copy({
        fr:'Bon retour', de:'Willkommen zurück', es:'Bienvenido de nuevo', pt:'Bem-vindo de volta',
        ja:'おかえりなさい', ru:'С возвращением', zh:'欢迎回来'
      }, 'Welcome back');
      if (generation) {
        modalDescription.innerHTML = copy({
          fr:'Connecte-toi pour lancer ta génération. Ta photo et tes réglages sont sauvegardés. Ta génération <strong class="ug-free-word">gratuite</strong> est prête.',
          de:'Melde dich an, um deine Generierung zu starten. Dein Foto und deine Einstellungen sind gespeichert. Deine <strong class="ug-free-word">kostenlose</strong> Generierung ist bereit.',
          es:'Inicia sesión para empezar tu generación. Tu foto y tus ajustes están guardados. Tu generación <strong class="ug-free-word">gratis</strong> está lista.',
          pt:'Entre para iniciar sua geração. Sua foto e suas configurações estão salvas. Sua geração <strong class="ug-free-word">grátis</strong> está pronta.',
          ja:'ログインして生成を開始してください。写真と設定は保存されています。<strong class="ug-free-word">無料</strong>生成の準備ができています。',
          ru:'Войдите, чтобы запустить генерацию. Фото и настройки сохранены. Ваша <strong class="ug-free-word">бесплатная</strong> генерация готова.',
          zh:'登录即可开始生成。你的照片和设置已保存。你的<strong class="ug-free-word">免费</strong>生成已准备好。'
        }, 'Sign in to start your generation. Your photo and settings are saved. Your <strong class="ug-free-word">free</strong> generation is ready.');
      } else {
        modalDescription.textContent = copy({
          fr:'Connecte-toi pour retrouver tes crédits et continuer à générer.',
          de:'Logge dich ein, um deine Credits zu nutzen und weiter zu generieren.',
          es:'Inicia sesión para acceder a tus créditos y seguir generando.',
          pt:'Entre para acessar seus créditos e continuar gerando.',
          ja:'ログインしてクレジットを確認し、生成を続けましょう。',
          ru:'Войдите, чтобы получить доступ к кредитам и продолжить генерацию.',
          zh:'登录以使用你的点数并继续生成。'
        }, 'Log in to access your credits and continue generating.');
      }
    }
    function openLoginModal(reason) {
      if (isAuthed()) return false;
      setLoginModalCopy(reason);
      previousModalFocus = document.activeElement;
      authNodes.forEach(function (node) { modalBody.appendChild(node); });
      login.hidden = true;
      modal.hidden = false;
      document.documentElement.classList.add('ug-login-open');
      var google = document.getElementById('google-login');
      if (google) window.setTimeout(function () { google.focus(); }, 30);
      if (window.UG_REFRESH_ICONS) window.UG_REFRESH_ICONS();
      return true;
    }
    function closeLoginModal(restoreFocus) {
      if (modal.hidden) return;
      modal.hidden = true;
      document.documentElement.classList.remove('ug-login-open');
      restoreAuthNodes();
      if (restoreFocus !== false && previousModalFocus && previousModalFocus.focus && document.contains(previousModalFocus)) {
        previousModalFocus.focus();
      }
      previousModalFocus = null;
    }
    function syncHeaderLogin() {
      headerLogin.hidden = isAuthed();
      if (isAuthed()) closeLoginModal(false);
    }

    headerLogin.addEventListener('click', function () { openLoginModal('account'); });
    document.addEventListener('ug:auth-required', function (event) {
      if (openLoginModal('generation')) event.preventDefault();
    });
    modal.addEventListener('click', function (event) {
      if (event.target && event.target.hasAttribute('data-ug-login-close')) closeLoginModal();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !modal.hidden) closeLoginModal();
    });

    function syncAfterSession() {
      syncHeaderLogin();
      window.setTimeout(revealGenerationProgress, 0);
      window.setTimeout(revealGenerationProgress, 80);
    }
    document.addEventListener('ug:session-updated', syncAfterSession);

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
