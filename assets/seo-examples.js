(function () {
  'use strict';

  // Use every approved pair in a shuffled bag. A pair cannot repeat until the
  // visitor has seen the complete pool, and the bag is shared with the main
  // landing page so navigation between pages also advances the rotation.
  var pairs = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'p', 'q', 'r', 's', 't', 'v', 'w', 'z'];
  function randomIndex(max) {
    var value = window.crypto && window.crypto.getRandomValues
      ? window.crypto.getRandomValues(new Uint32Array(1))[0]
      : Math.floor(Math.random() * 4294967296);
    return value % max;
  }
  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = randomIndex(i + 1);
      var swap = list[i];
      list[i] = list[j];
      list[j] = swap;
    }
    return list;
  }

  var pair = pairs[randomIndex(pairs.length)];
  try {
    var previous = window.sessionStorage.getItem('ug-hero-example');
    var stored = JSON.parse(window.sessionStorage.getItem('ug-example-rotation-v3') || '[]');
    var seen = {};
    var bag = Array.isArray(stored) ? stored.filter(function (item) {
      if (pairs.indexOf(item) === -1 || seen[item]) return false;
      seen[item] = true;
      return true;
    }) : [];
    if (!bag.length) bag = shuffle(pairs.slice());
    if (bag.length > 1 && bag[0] === previous) {
      var next = 1 + randomIndex(bag.length - 1);
      var first = bag[0];
      bag[0] = bag[next];
      bag[next] = first;
    }
    pair = bag.shift();
    window.sessionStorage.setItem('ug-example-rotation-v3', JSON.stringify(bag));
    window.sessionStorage.setItem('ug-hero-example', pair);
  } catch (error) {}

  var before = '/assets/hero-examples/' + pair + '1';
  window.UG_SEO_EXAMPLE = pair;
  window.UG_WRITE_SEO_EXAMPLE = function (side, alt, highPriority) {
    var base = '/assets/hero-examples/' + pair + side;
    document.write(
      '<img src="' + base + '-480.webp?v=20260823-r24" ' +
      'srcset="' + base + '-240.webp?v=20260823-r24 240w, ' +
      base + '-480.webp?v=20260823-r24 480w" ' +
      'sizes="(max-width: 980px) calc(50vw - 28px), 230px" ' +
      'width="480" height="600" alt="' + alt + '" decoding="async"' +
      (highPriority ? ' fetchpriority="high"' : '') + '>'
    );
  };

  document.write(
    '<link rel="preload" href="' + before + '-480.webp?v=20260823-r24" ' +
    'imagesrcset="' + before + '-240.webp?v=20260823-r24 240w, ' +
    before + '-480.webp?v=20260823-r24 480w" ' +
    'imagesizes="(max-width: 980px) calc(50vw - 28px), 230px" ' +
    'as="image" type="image/webp" fetchpriority="high">'
  );
})();
