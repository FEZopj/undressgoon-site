<?php
/**
 * UndressGoon mail relay.
 *
 * Lets the Railway backend send email through THIS cPanel server's local mailer
 * (Exim), bypassing Railway's outbound-SMTP block. The backend POSTs JSON here
 * over HTTPS; this script sends it via your own noreply mailbox.
 *
 * SETUP:
 *   1. This file auto-deploys with the site (it holds no secret).
 *   2. Create public_html/mailrelay.secret.php ONCE via cPanel File Manager:
 *          <?php $UG_RELAY_SECRET = 'your-long-random-secret';
 *      It is NOT in git / .cpanel.yml, so redeploys never overwrite it.
 *   3. In Railway set:  EMAIL_RELAY_URL=https://undressgoon.app/mailrelay.php
 *                       EMAIL_RELAY_SECRET=<the same secret>
 *                       MARKETING_FROM_EMAIL=noreply@undressgoon.app
 *   4. Make sure noreply@undressgoon.app exists as a cPanel email account.
 *
 * PHP source is executed, not served, so the secret is not web-readable.
 */

// ── Secret (from a non-deployed sibling file, or an env var) ────────────────
$RELAY_SECRET = getenv('UG_RELAY_SECRET');
if (!$RELAY_SECRET) {
    $secretFile = __DIR__ . '/mailrelay.secret.php';
    if (is_file($secretFile)) {
        include $secretFile;
        if (isset($UG_RELAY_SECRET)) {
            $RELAY_SECRET = $UG_RELAY_SECRET;
        }
    }
}
if (!$RELAY_SECRET) {
    $RELAY_SECRET = 'REPLACE_WITH_A_LONG_RANDOM_SECRET';
}

header('Content-Type: application/json');
header('X-Robots-Tag: noindex');

function fail($code, $msg) {
    http_response_code($code);
    echo json_encode(array('ok' => false, 'error' => $msg));
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail(405, 'method_not_allowed');
}

$got = isset($_SERVER['HTTP_X_RELAY_SECRET']) ? $_SERVER['HTTP_X_RELAY_SECRET'] : '';
if ($RELAY_SECRET === 'REPLACE_WITH_A_LONG_RANDOM_SECRET' || !hash_equals($RELAY_SECRET, $got)) {
    fail(401, 'unauthorized');
}

$raw  = file_get_contents('php://input');
$data = json_decode($raw, true);
if (!is_array($data)) {
    fail(400, 'bad_json');
}

$to      = isset($data['to']) ? trim($data['to']) : '';
$subject = isset($data['subject']) ? (string) $data['subject'] : '';
$html    = isset($data['html']) ? (string) $data['html'] : '';
$text    = isset($data['text']) ? (string) $data['text'] : '';
$fromEmail = (isset($data['fromEmail']) && $data['fromEmail']) ? trim($data['fromEmail']) : 'noreply@undressgoon.app';
$fromName  = isset($data['fromName']) ? (string) $data['fromName'] : 'UndressGoon';
$replyTo   = (isset($data['replyTo']) && $data['replyTo']) ? trim($data['replyTo']) : $fromEmail;

if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
    fail(400, 'bad_recipient');
}
if ($subject === '' || ($html === '' && $text === '')) {
    fail(400, 'empty_message');
}
if (!filter_var($fromEmail, FILTER_VALIDATE_EMAIL)) {
    fail(400, 'bad_from');
}

// Multipart/alternative so clients that prefer HTML get the branded template
// and plain-text clients still get a readable fallback.
$boundary = 'ug_' . bin2hex(random_bytes(12));
$fromHdr  = $fromName !== ''
    ? mb_encode_mimeheader($fromName, 'UTF-8') . ' <' . $fromEmail . '>'
    : $fromEmail;

$headers  = array();
$headers[] = 'From: ' . $fromHdr;
$headers[] = 'Reply-To: ' . $replyTo;
$headers[] = 'MIME-Version: 1.0';
$headers[] = 'Content-Type: multipart/alternative; boundary="' . $boundary . '"';

$plain = $text !== '' ? $text : trim(html_entity_decode(strip_tags($html), ENT_QUOTES, 'UTF-8'));
$rich  = $html !== '' ? $html : nl2br(htmlspecialchars($text, ENT_QUOTES, 'UTF-8'));

$body  = '--' . $boundary . "\r\n";
$body .= "Content-Type: text/plain; charset=UTF-8\r\n";
$body .= "Content-Transfer-Encoding: 8bit\r\n\r\n";
$body .= $plain . "\r\n\r\n";
$body .= '--' . $boundary . "\r\n";
$body .= "Content-Type: text/html; charset=UTF-8\r\n";
$body .= "Content-Transfer-Encoding: 8bit\r\n\r\n";
$body .= $rich . "\r\n\r\n";
$body .= '--' . $boundary . "--\r\n";

$subjectEnc = mb_encode_mimeheader($subject, 'UTF-8');
$ok = @mail($to, $subjectEnc, $body, implode("\r\n", $headers), '-f' . $fromEmail);

if ($ok) {
    echo json_encode(array('ok' => true));
} else {
    fail(500, 'send_failed');
}
