<?php
// Lists the before/after example files actually present in this folder.
//
// The site used to discover them by probing: for every letter a-z it asked the
// server for a1.jpg, a1.jpeg, a1.png, a1.webp and the four uppercase variants,
// so a folder of a dozen pairs cost ~200 requests and filled the console with
// 404s on every visit. One call here replaces the whole sweep.
//
// Images are dropped straight into this folder on the server (they are not in
// git), which is why the front end cannot know the names ahead of time.
// site.js keeps the old probe as a fallback, so if PHP is ever disabled the
// section still fills in — just slowly.

header('Content-Type: application/json; charset=utf-8');
// The gallery changes when someone uploads a pair; a short cache keeps this
// cheap without pinning a stale list for the rest of the day.
header('Cache-Control: public, max-age=300');

$out = array();

$dir = __DIR__;
$handle = @opendir($dir);
if ($handle !== false) {
    while (($entry = readdir($handle)) !== false) {
        // strictly <letter><1|2>.<ext> — anything else in the folder (README,
        // this script, stray uploads) is ignored rather than served as a pair.
        if (preg_match('/^([a-z])([12])\.(jpg|jpeg|png|webp)$/i', $entry, $m)) {
            $letter = strtolower($m[1]);
            $slot = $m[2] === '1' ? 'before' : 'after';
            if (!isset($out[$letter])) {
                $out[$letter] = array('letter' => $letter);
            }
            // When the same shot exists in several formats, serve the lightest.
            // readdir order is not defined, so without this a 2 MB .png could
            // win over a 200 KB .jpg of the same picture from one deploy to the
            // next. Dropping a lighter copy next to a heavy one now replaces it
            // with no need to delete anything.
            $ext = strtolower($m[3]);
            $rank = array('webp' => 0, 'jpg' => 1, 'jpeg' => 2, 'png' => 3);
            $score = isset($rank[$ext]) ? $rank[$ext] : 9;
            $key = $slot . '_rank';
            if (!isset($out[$letter][$slot]) || $score < $out[$letter][$key]) {
                $out[$letter][$slot] = $entry;
                $out[$letter][$key] = $score;
            }
        }
    }
    closedir($handle);
}

// Only complete pairs are useful: a lone "before" is a half-finished upload.
$pairs = array();
foreach ($out as $letter => $pair) {
    if (isset($pair['before']) && isset($pair['after'])) {
        unset($pair['before_rank'], $pair['after_rank']);
        $pairs[] = $pair;
    }
}

usort($pairs, function ($a, $b) {
    return strcmp($a['letter'], $b['letter']);
});

echo json_encode(array('ok' => true, 'pairs' => $pairs));
