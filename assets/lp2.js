/* ==========================================================================
   UndressGoon — conversion landing behaviour.

   site.js owns auth, credits, generation and checkout. This layer only shapes
   the landing funnel: let visitors build first, ask for signup on Generate,
   expose every standard preset to the free credit, surface proof earlier, keep
   the sticky CTA out of the active funnel, and sell the second generation hard.
   ========================================================================== */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    // Keep conversion-only CSS separate from the large shared stylesheet.
    (function loadConversionStyles() {
      if (document.getElementById('ug-conversion-r7-css')) return;
      var scripts = document.getElementsByTagName('script');
      for (var i = scripts.length - 1; i >= 0; i--) {
        var src = scripts[i].getAttribute('src') || '';
        if (src.indexOf('lp2.js') === -1) continue;
        var href = src.replace(/lp2\.js(?:\?.*)?$/, 'conversion-r7.css?v=20260822-r7');
        var link = document.createElement('link');
        link.id = 'ug-conversion-r7-css';
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
        break;
      }
    })();

    var stage = document.querySelector('.lp2-stage');
    var pitch = document.querySelector('.lp2-pitch');
    var resultWrap = document.getElementById('lp2-stage-result');
    var results = document.getElementById('web-results');
    var form = document.getElementById('web-generate-form');
    var login = document.getElementById('login-box');
    var siteAccount = document.getElementById('site-account');
    var sticky = document.getElementById('sticky-cta');
    if (!stage || !resultWrap || !form) return;

    var pitchTimer = 0;
    var authRequested = false;
    var generationWasFree = false;
    var heroExamplePainted = false;
    var enforcingLogin = false;
    var enforcingSticky = false;

    // The old animated jump CTA is unnecessary once proof is surfaced in the hero.
    var examplePeek = document.getElementById('ex-peek');
    if (examplePeek) examplePeek.remove();

    function lang() {
      return String(document.documentElement.lang || 'en').toLowerCase().split('-')[0];
    }

    function copy(map, fallback) {
      return map[lang()] || fallback;
    }

    function isAuthed() {
      return !!(siteAccount && !siteAccount.hidden);
    }

    function isSignedOut() {
      return !isAuthed();
    }

    function topBelowHeader(el) {
      if (!el) return;
      var header = document.querySelector('header');
      var headerHeight = header ? Math.ceil(header.getBoundingClientRect().height) : 0;
      var top = el.getBoundingClientRect().top + window.pageYOffset - headerHeight - 14;
      var maxTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo(0, Math.max(0, Math.min(top, maxTop)));
    }

    function scrollLoginBox() {
      var land = function () { topBelowHeader(login); };
      window.setTimeout(land, 20);
      window.setTimeout(land, 260);
    }

    function styleLoginPrompt() {
      if (!login || isAuthed() || !authRequested) return;
      login.hidden = false;
      var p = document.getElementById('login-box-copy');
      if (p) {
        p.innerHTML =
          '<strong class="login-ready-title">' +
          copy({
            fr: 'Ta génération est prête.',
            de: 'Deine Generierung ist bereit.',
            es: 'Tu generación está lista.',
            pt: 'Sua geração está pronta.',
            ja: '生成の準備ができました。',
            ru: 'Ваша генерация готова.',
            zh: '你的生成已准备好。'
          }, 'Your generation is ready.') +
          '</strong><span>' +
          copy({
            fr: ' Inscris-toi pour la lancer — ta photo et tes réglages sont sauvegardés. Première génération gratuite, sans carte.',
            de: ' Registriere dich, um sie zu starten — Foto und Einstellungen sind gespeichert. Erste Generierung gratis, keine Karte nötig.',
            es: ' Regístrate para iniciarla — tu foto y ajustes están guardados. Primera generación gratis, sin tarjeta.',
            pt: ' Cadastre-se para iniciar — sua foto e configurações estão salvas. Primeira geração grátis, sem cartão.',
            ja: ' 開始するには登録してください。写真と設定は保存済みです。初回生成は無料、カード不要です。',
            ru: ' Зарегистрируйтесь, чтобы запустить её — фото и настройки сохранены. Первая генерация бесплатна, карта не нужна.',
            zh: ' 注册即可开始——照片和设置已保存。首次生成免费，无需信用卡。'
          }, ' Sign up to start it — your photo and settings are saved. First generation free, no card required.') +
          '</span>';
      }
      scrollLoginBox();
    }

    // Hide signup on arrival. site.js may try to reveal it after session refresh,
    // so keep enforcing this until the visitor actually presses Generate.
    function syncLoginVisibility() {
      if (!login || enforcingLogin) return;
      enforcingLogin = true;
      if (isAuthed()) {
        authRequested = false;
        if (!login.hidden) login.hidden = true;
      } else if (!authRequested) {
        if (!login.hidden) login.hidden = true;
      } else {
        if (login.hidden) login.hidden = false;
        styleLoginPrompt();
      }
      enforcingLogin = false;
    }

    syncLoginVisibility();
    try {
      if (login) {
        new MutationObserver(function () { syncLoginVisibility(); })
          .observe(login, { attributes: true, attributeFilter: ['hidden'] });
      }
      if (siteAccount) {
        new MutationObserver(function () {
          syncLoginVisibility();
          unlockStandardPresets();
        }).observe(siteAccount, { attributes: true, attributeFilter: ['hidden'] });
      }
    } catch (e) { /* old browser */ }

    // ---- headline + trust -------------------------------------------------
    function tuneHeroCopy() {
      var h1 = document.querySelector('.lp2-pitch h1');
      if (h1) {
        h1.textContent = copy({
          fr: 'Importe une photo. Obtiens un nude IA et plus en ~60 secondes.',
          de: 'Foto hochladen. KI-Nacktbild & mehr in ~60 Sekunden.',
          es: 'Sube una foto. Obtén un desnudo con IA y más en ~60 segundos.',
          pt: 'Envie uma foto. Gere um nude com IA e muito mais em ~60 segundos.',
          ja: '写真をアップロード。AIヌードなどを約60秒で生成。',
          ru: 'Загрузите фото. Получите AI-нюд и другие образы примерно за 60 секунд.',
          zh: '上传照片。约 60 秒生成 AI 裸照及更多效果。'
        }, 'Upload a photo. Get an AI nude & more in ~60 seconds.');
      }

      var heading = document.querySelector('#ex-heading .section-title');
      if (heading) {
        heading.textContent = copy({
          fr: 'Exemples de résultats',
          de: 'Beispielergebnisse',
          es: 'Ejemplos de resultados',
          pt: 'Exemplos de resultados',
          ja: '生成例',
          ru: 'Примеры результатов',
          zh: '效果示例'
        }, 'Example results');
      }

      var trust = document.querySelector('.lp2-trust');
      if (trust) {
        var items = [
          ['eye-off', copy({
            fr: 'Aucune galerie publique.',
            de: 'Keine öffentliche Galerie.',
            es: 'Sin galería pública.',
            pt: 'Sem galeria pública.',
            ja: '公開ギャラリーなし。',
            ru: 'Без публичной галереи.',
            zh: '无公开图库。'
          }, 'No public gallery.')],
          ['badge-dollar-sign', copy({
            fr: 'Aucun abonnement.',
            de: 'Kein Abo.',
            es: 'Sin suscripción.',
            pt: 'Sem assinatura.',
            ja: 'サブスクなし。',
            ru: 'Без подписки.',
            zh: '无订阅。'
          }, 'No subscription.')],
          ['rotate-ccw', copy({
            fr: 'Les générations échouées sont remboursées.',
            de: 'Fehlgeschlagene Generierungen werden erstattet.',
            es: 'Las generaciones fallidas se reembolsan.',
            pt: 'Gerações com falha são reembolsadas.',
            ja: '失敗した生成はクレジット返却。',
            ru: 'Неудачные генерации возвращаются.',
            zh: '生成失败会退还点数。'
          }, 'Failed generations refunded.')],
          ['timer', copy({
            fr: 'Résultats en ~60 s.',
            de: 'Ergebnisse in ~60 Sek.',
            es: 'Resultados en ~60 s.',
            pt: 'Resultados em ~60 s.',
            ja: '約60秒で結果。',
            ru: 'Результат примерно за 60 сек.',
            zh: '约 60 秒出结果。'
          }, 'Results in ~60s.')]
        ];
        var nodes = trust.querySelectorAll(':scope > div');
        nodes.forEach(function (node, idx) {
          if (!items[idx]) return;
          node.innerHTML = '<i data-lucide="' + items[idx][0] + '"></i><span><strong>' +
            items[idx][1] + '</strong></span>';
        });
        if (window.UG_REFRESH_ICONS) window.UG_REFRESH_ICONS();
      }
    }
    tuneHeroCopy();

    // ---- standard presets are valid for the one free generation -----------
    function unlockStandardPresets() {
      var mode = document.querySelector('input[name="mode"]:checked');
      if (mode && mode.value !== 'prompt') return; // scenes stay paywalled
      var grid = document.getElementById('preset-grid');
      if (!grid) return;
      grid.querySelectorAll('button[data-locked="1"]').forEach(function (button) {
        button.removeAttribute('data-locked');
        button.classList.remove('locked');
        var lock = button.querySelector('.preset-lock');
        if (lock) lock.remove();
      });
    }

    var presetGrid = document.getElementById('preset-grid');
    if (presetGrid) {
      try {
        new MutationObserver(function () {
          window.setTimeout(unlockStandardPresets, 0);
        }).observe(presetGrid, { childList: true, subtree: true });
      } catch (e) {}
      unlockStandardPresets();
    }
    document.addEventListener('click', function (event) {
      if (event.target && event.target.closest &&
          (event.target.closest('#preset-tabs button') || event.target.closest('.mode-row label'))) {
        window.setTimeout(unlockStandardPresets, 0);
      }
    }, true);

    // ---- one strong before/after earlier ----------------------------------
    function paintHeroExample() {
      if (heroExamplePainted) return true;
      var before = document.getElementById('ex-before');
      var after = document.getElementById('ex-after');
      if (!before || !after || !before.getAttribute('src') || !after.getAttribute('src')) return false;
      var proof = document.querySelector('.lp2-pitch .lp2-proof');
      if (!proof) return false;

      var mount = document.createElement('div');
      mount.className = 'hero-example';
      mount.innerHTML =
        '<div class="hero-ex-label">' +
        copy({
          fr: 'Exemple réel',
          de: 'Beispiel',
          es: 'Ejemplo',
          pt: 'Exemplo',
          ja: '生成例',
          ru: 'Пример',
          zh: '效果示例'
        }, 'Example result') +
        '</div>' +
        '<div class="hero-ex-card">' +
          '<figure class="hero-ex-pane"><img src="' + before.getAttribute('src') + '" alt="" decoding="async">' +
            '<figcaption>' + copy({fr:'Avant',de:'Vorher',es:'Antes',pt:'Antes',ja:'変換前',ru:'До',zh:'之前'}, 'Before') + '</figcaption></figure>' +
          '<figure class="hero-ex-pane"><img src="' + after.getAttribute('src') + '" alt="" decoding="async">' +
            '<figcaption class="after">' + copy({fr:'Après',de:'Nachher',es:'Después',pt:'Depois',ja:'変換後',ru:'После',zh:'之后'}, 'After') + '</figcaption></figure>' +
        '</div>';
      proof.insertAdjacentElement('afterend', mount);
      heroExamplePainted = true;
      return true;
    }

    var exampleMount = document.getElementById('ex-mount');
    if (exampleMount) {
      try {
        new MutationObserver(function () {
          window.setTimeout(paintHeroExample, 20);
          window.setTimeout(paintHeroExample, 250);
        }).observe(exampleMount, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
      } catch (e) {}
      paintHeroExample();
    }

    // ---- result stage -----------------------------------------------------
    function showResultStage() {
      if (!resultWrap.hidden) return;
      resultWrap.hidden = false;
      stage.classList.add('is-generating');
      if (pitch) {
        window.clearTimeout(pitchTimer);
        pitchTimer = window.setTimeout(function () {
          pitch.classList.add('is-gone');
        }, 300);
      }
      if (window.UG_REFRESH_ICONS) window.UG_REFRESH_ICONS();
    }

    function scrollToResult() {
      var top = function () {
        return resultWrap.getBoundingClientRect().top + window.pageYOffset - 72;
      };
      try { window.scrollTo({ top: top(), behavior: 'smooth' }); }
      catch (e) { window.scrollTo(0, top()); }
      window.setTimeout(function () {
        var r = resultWrap.getBoundingClientRect();
        if (r.top > window.innerHeight * 0.9 || r.bottom < 0) window.scrollTo(0, top());
      }, 450);
    }

    function removeDuplicateSignupNotice() {
      if (!results || !isSignedOut() || !authRequested) return false;
      var card = results.querySelector('.result-notice');
      var google = card && card.querySelector('#rn-action');
      if (!card || !google) return false;
      card.remove();
      if (!results.children.length) resultWrap.hidden = true;
      styleLoginPrompt();
      return true;
    }

    function freeUserSignal() {
      // Custom prompt stays locked until a purchase. That makes it a stable,
      // non-invasive signal that the account is still on its free entitlement.
      var custom = document.querySelector('.write-own-btn');
      return !!(custom && custom.classList.contains('locked'));
    }

    function openTopup() {
      var btn = document.getElementById('account-topup');
      if (btn) {
        btn.click();
        return;
      }
      var fallback = document.querySelector('[data-topup], #web-topup, #topup-button');
      if (fallback) fallback.click();
    }

    function paintPostFreeOffer() {
      if (!results || document.getElementById('post-free-offer')) return;
      var offer = document.createElement('div');
      offer.id = 'post-free-offer';
      offer.className = 'post-free-offer';
      offer.innerHTML =
        '<span class="post-free-kicker">' +
          copy({fr:'RÉSULTAT GRATUIT TERMINÉ',de:'GRATIS-ERGEBNIS FERTIG',es:'RESULTADO GRATIS LISTO',pt:'RESULTADO GRÁTIS PRONTO',ja:'無料生成完了',ru:'БЕСПЛАТНЫЙ РЕЗУЛЬТАТ ГОТОВ',zh:'免费生成完成'}, 'FREE RESULT COMPLETE') +
        '</span>' +
        '<h3>' +
          copy({fr:'Tu aimes le résultat ? Continue sans limite.',de:'Gefällt dir das Ergebnis? Mach direkt weiter.',es:'¿Te gusta el resultado? Sigue creando.',pt:'Gostou do resultado? Continue criando.',ja:'気に入った？そのまま続けよう。',ru:'Нравится результат? Продолжайте.',zh:'喜欢这个效果？继续生成。'}, 'Like the result? Keep going.') +
        '</h3>' +
        '<p>' +
          copy({
            fr:'Génère encore avec tous les presets, débloque les prompts personnalisés et crée jusqu’à 4 images à la fois.',
            de:'Nutze weiter alle Presets, schalte eigene Prompts frei und generiere bis zu 4 Bilder auf einmal.',
            es:'Sigue usando todos los presets, desbloquea prompts personalizados y genera hasta 4 imágenes a la vez.',
            pt:'Continue com todos os presets, desbloqueie prompts personalizados e gere até 4 imagens de uma vez.',
            ja:'すべてのプリセットを使い続け、カスタムプロンプトを解放し、一度に最大4枚生成。',
            ru:'Продолжайте со всеми пресетами, откройте свои промпты и генерируйте до 4 изображений за раз.',
            zh:'继续使用全部预设，解锁自定义提示词，并一次生成最多 4 张图片。'
          }, 'Keep using every preset, unlock custom prompts, and generate up to 4 images at once.') +
        '</p>' +
        '<div class="post-free-benefits">' +
          '<span>✓ ' + copy({fr:'Packs à achat unique',de:'Einmalige Credit-Pakete',es:'Packs de pago único',pt:'Pacotes de compra única',ja:'買い切りクレジット',ru:'Разовые пакеты кредитов',zh:'一次性点数包'}, 'One-time credit packs') + '</span>' +
          '<span>✓ ' + copy({fr:'Aucun abonnement',de:'Kein Abo',es:'Sin suscripción',pt:'Sem assinatura',ja:'サブスクなし',ru:'Без подписки',zh:'无订阅'}, 'No subscription') + '</span>' +
          '<span>✓ ' + copy({fr:'Crédits sans expiration',de:'Credits verfallen nie',es:'Los créditos no caducan',pt:'Créditos não expiram',ja:'クレジット無期限',ru:'Кредиты не сгорают',zh:'点数永不过期'}, 'Credits never expire') + '</span>' +
        '</div>' +
        '<button type="button" class="btn btn-accent btn-pulse" id="post-free-topup">' +
          copy({fr:'Générer encore',de:'Noch eins generieren',es:'Generar otra',pt:'Gerar outra',ja:'もう1枚生成',ru:'Создать ещё',zh:'再生成一张'}, 'Generate another') +
        '</button>' +
        '<small>' + copy({fr:'Choisis simplement un pack de crédits pour continuer.',de:'Wähle einfach ein Credit-Paket, um weiterzumachen.',es:'Elige un pack de créditos para continuar.',pt:'Escolha um pacote de créditos para continuar.',ja:'クレジットパックを選ぶだけで続けられます。',ru:'Выберите пакет кредитов и продолжайте.',zh:'选择点数包即可继续。'}, 'Pick a credit pack and continue immediately.') + '</small>';
      results.appendChild(offer);
      var btn = document.getElementById('post-free-topup');
      if (btn) btn.addEventListener('click', openTopup);
      if (typeof window.ugTrack === 'function') window.ugTrack('website_post_free_offer_viewed', {});
    }

    function resultLooksSuccessful() {
      if (!results) return false;
      return !!results.querySelector('img, a[href^="data:image"], a[download]');
    }

    if (results) {
      try {
        new MutationObserver(function () {
          if (removeDuplicateSignupNotice()) return;
          if (!results.children.length) return;
          if (resultLooksSuccessful()) {
            showResultStage();
            if (generationWasFree) {
              paintPostFreeOffer();
              generationWasFree = false;
            }
            scrollToResult();
          } else if (!isSignedOut()) {
            showResultStage();
          }
        }).observe(results, { childList: true, subtree: true });
      } catch (e) {}
    }

    // Capture runs before site.js's submit handler. That lets us mark signup as
    // intentional before site.js reveals the auth controls and lets us remember
    // whether this run is the user's free entitlement.
    form.addEventListener('submit', function () {
      var consent = document.getElementById('web-consent');
      var file = document.getElementById('person-photo');
      var chosen = file && file.files && file.files[0];
      if (!chosen || !consent || !consent.checked) return;

      if (isSignedOut()) {
        authRequested = true;
        generationWasFree = true;
        window.setTimeout(function () {
          syncLoginVisibility();
          styleLoginPrompt();
          removeDuplicateSignupNotice();
        }, 30);
        window.setTimeout(function () {
          syncLoginVisibility();
          styleLoginPrompt();
          removeDuplicateSignupNotice();
        }, 320);
        return;
      }

      generationWasFree = freeUserSignal();
      showResultStage();
      scrollToResult();
    }, true);

    // ---- sticky CTA -------------------------------------------------------
    function generatorActive() {
      var generator = document.getElementById('generate');
      if (!generator) return false;
      var r = generator.getBoundingClientRect();
      return r.bottom > 70 && r.top < window.innerHeight - 30;
    }

    function enforceSticky() {
      if (!sticky || enforcingSticky) return;
      enforcingSticky = true;
      var active = generatorActive() || authRequested || stage.classList.contains('is-generating');
      if (active && sticky.classList.contains('show')) sticky.classList.remove('show');
      enforcingSticky = false;
    }
    if (sticky) {
      window.addEventListener('scroll', enforceSticky, { passive: true });
      window.addEventListener('resize', enforceSticky);
      try {
        new MutationObserver(enforceSticky).observe(sticky, { attributes: true, attributeFilter: ['class'] });
      } catch (e) {}
      enforceSticky();
    }

    // ---- mobile: trust strip stays below the generator --------------------
    var trust = document.querySelector('.lp2-pitch .lp2-trust');
    var genCol = document.querySelector('.lp2-col-gen');
    var pitchHost = document.querySelector('.lp2-pitch');
    if (trust && pitchHost && genCol && window.matchMedia) {
      var slot = document.createElement('div');
      slot.className = 'lp2-trust-mobile';
      genCol.appendChild(slot);
      var mq = window.matchMedia('(max-width: 980px)');
      var place = function () {
        if (mq.matches) {
          if (trust.parentNode !== slot) slot.appendChild(trust);
        } else if (trust.parentNode !== pitchHost) {
          pitchHost.appendChild(trust);
        }
      };
      place();
      if (mq.addEventListener) mq.addEventListener('change', place);
      else if (mq.addListener) mq.addListener(place);
      window.addEventListener('resize', place);
    }

    // Final delayed passes after site.js has painted session/presets/examples.
    window.setTimeout(function () {
      syncLoginVisibility();
      tuneHeroCopy();
      unlockStandardPresets();
      paintHeroExample();
      enforceSticky();
    }, 120);
    window.setTimeout(function () {
      syncLoginVisibility();
      unlockStandardPresets();
      paintHeroExample();
      enforceSticky();
    }, 650);
  });
})();
