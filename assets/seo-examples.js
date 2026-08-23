(function () {
  'use strict';

  // Keep the SEO pages on the same six-pair rotation as the homepage. The
  // session value prevents the visitor from seeing the exact same pair again
  // immediately when moving between the homepage and a tool page.
  var pairs = ['a', 'c', 'g', 'j', 'r', 'z'];
  var random = window.crypto && window.crypto.getRandomValues
    ? window.crypto.getRandomValues(new Uint32Array(1))[0]
    : Math.floor(Math.random() * 4294967296);
  var index = random % pairs.length;

  try {
    var previous = window.sessionStorage.getItem('ug-hero-example');
    if (pairs[index] === previous) {
      index = (index + 1 + (random % (pairs.length - 1))) % pairs.length;
    }
    window.sessionStorage.setItem('ug-hero-example', pairs[index]);
  } catch (error) {}

  var pair = pairs[index];
  var before = '/assets/hero-examples/' + pair + '1';
  window.UG_SEO_EXAMPLE = pair;
  window.UG_WRITE_SEO_EXAMPLE = function (side, alt, highPriority) {
    var base = '/assets/hero-examples/' + pair + side;
    document.write(
      '<img src="' + base + '-480.webp?v=20260823-r20" ' +
      'srcset="' + base + '-240.webp?v=20260823-r20 240w, ' +
      base + '-480.webp?v=20260823-r20 480w" ' +
      'sizes="(max-width: 980px) calc(50vw - 28px), 230px" ' +
      'width="480" height="600" alt="' + alt + '" decoding="async"' +
      (highPriority ? ' fetchpriority="high"' : '') + '>'
    );
  };

  document.write(
    '<link rel="preload" href="' + before + '-480.webp?v=20260823-r20" ' +
    'imagesrcset="' + before + '-240.webp?v=20260823-r20 240w, ' +
    before + '-480.webp?v=20260823-r20 480w" ' +
    'imagesizes="(max-width: 980px) calc(50vw - 28px), 230px" ' +
    'as="image" type="image/webp" fetchpriority="high">'
  );
})();
