/* ═══════════════════════════════════════════════════════════════════════════
   publish-content.mjs — put the letters and photos INTO the website.

   Why this exists
   ───────────────
   Anything added through the hidden newsroom is saved in the browser you
   added it on. It is not part of the site, so nobody else can ever see it.
   This script takes the newsroom's backup file and moves everything into the
   project itself: photos become real image files in photos/, letters become
   entries in CONFIG.messages. Commit, push, and every visitor sees them.

   How to use it
   ─────────────
     1. On the computer where you added everything, open the site, go to the
        newsroom (top-left corner), Backup tab, "Download the backup".
     2. Put that .json file in this folder.
     3. From the project folder run:

            node tools/publish-content.mjs ian-gazette-backup.json

     4. git add -A && git commit -m "Add the letters and photos" && git push

   It rewrites index.html in place and keeps a copy of the old one as
   index.html.bak, so nothing is lost if you change your mind.
   ═══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';

const ROOT      = process.cwd();
const HTML      = path.join(ROOT, 'index.html');
const PHOTO_DIR = path.join(ROOT, 'photos');

const backupPath = process.argv[2];
if (!backupPath) {
  die('Tell me which backup file to read, e.g.\n\n  node tools/publish-content.mjs ian-gazette-backup.json');
}
if (!fs.existsSync(backupPath)) die(`I cannot find "${backupPath}" — check the name and that it is in this folder.`);
if (!fs.existsSync(HTML))       die('index.html is not here. Run this from the project folder.');

let backup;
try { backup = JSON.parse(fs.readFileSync(backupPath, 'utf8')); }
catch (e) { die(`"${backupPath}" is not readable JSON — is it really the backup file?\n${e.message}`); }

const messages = Array.isArray(backup.messages) ? backup.messages : [];
const photos   = Array.isArray(backup.photos)   ? backup.photos   : [];
if (!messages.length && !photos.length) die('That backup is empty — there is nothing to publish.');

/* ── 1. photos become real files ────────────────────────────────────────── */
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const written = [];

photos.forEach((p, i) => {
  if (!p || !p.src) return;
  const src = String(p.src);

  // already a normal path or URL: keep it as it is, nothing to write out
  if (!src.startsWith('data:')) { written.push({ src, cap: p.cap || '' }); return; }

  const m = /^data:([^;,]+)[^,]*,(.*)$/s.exec(src);
  if (!m) { warn(`picture ${i + 1} is not a readable image, skipped`); return; }

  const ext  = EXT[m[1].toLowerCase()] || 'jpg';
  const name = `photo-${String(i + 1).padStart(2, '0')}.${ext}`;
  const buf  = Buffer.from(decodeURIComponent(m[2]), 'base64');

  fs.writeFileSync(path.join(PHOTO_DIR, name), buf);
  written.push({ src: `photos/${name}`, cap: p.cap || '', bytes: buf.length });
});

/* ── 2. build the two CONFIG blocks ─────────────────────────────────────── */
const q = s => JSON.stringify(String(s));

const photoBlock = written.length
  ? 'photos: [\n' + written.map(p =>
      p.cap ? `    {src: ${q(p.src)}, cap: ${q(p.cap)}},`
            : `    ${q(p.src)},`
    ).join('\n') + '\n  ],'
  : 'photos: [],';

const msgBlock = messages.length
  ? 'messages: [\n' + messages.filter(m => m && m.t).map(m =>
      `    {n: ${q(m.n || 'A friend')}, t: ${q(m.t)}},`
    ).join('\n') + '\n  ],'
  : 'messages: [],';

/* ── 3. splice them into index.html ─────────────────────────────────────── */
let html = fs.readFileSync(HTML, 'utf8');
const before = html;

const r1 = replaceArray(html, 'photos', photoBlock);   html = r1.text;
const r2 = replaceArray(html, 'messages', msgBlock);   html = r2.text;

if (!r1.found && !r2.found) {
  die('I could not find the photos: or messages: lines in index.html — nothing was changed.\n' +
      'Has the CONFIG block at the top of the file been renamed?');
}
if (html === before) {
  console.log('\n  Everything in that backup is already published — nothing to change.\n');
  process.exit(0);
}

fs.writeFileSync(HTML + '.bak', before);
fs.writeFileSync(HTML, html);

/* ── 4. say what happened ───────────────────────────────────────────────── */
const totalBytes = written.reduce((n, p) => n + (p.bytes || 0), 0);
console.log('');
console.log(`  letters published : ${messages.length}`);
console.log(`  photos published  : ${written.length}${totalBytes ? `  (${(totalBytes / 1048576).toFixed(1)} MB in photos/)` : ''}`);
console.log(`  index.html updated, previous version saved as index.html.bak`);
console.log('');
console.log('  Now put it live:');
console.log('    git add -A');
console.log('    git commit -m "Add the letters and photos"');
console.log('    git push');
console.log('');

/* Replaces `photos: [ ... ],` or `messages: [ ... ],` inside CONFIG, matching
   brackets properly so a "]" inside somebody's message cannot break it. */
function replaceArray(text, key, block) {
  const m0 = new RegExp(`^([ \\t]*)${key}\\s*:\\s*\\[`, 'm').exec(text);
  if (!m0) return { text, found: false };
  const start  = m0.index;
  const indent = m0[1];

  const open = text.indexOf('[', start);
  let depth = 0, i = open, inStr = false, quote = '', esc = false;

  for (; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; quote = c; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) return { text, found: false };

  let end = i + 1;
  if (text[end] === ',') end++;                       // swallow the trailing comma
  const tail = /^[ \t]*\/\/[^\n]*/.exec(text.slice(end));
  if (tail) end += tail[0].length;                    // and the old trailing note

  return {
    text: text.slice(0, start) + indent + block.replace(/\n/g, '\n' + indent) + text.slice(end),
    found: true
  };
}

function warn(msg) { console.warn(`  ! ${msg}`); }
function die(msg)  { console.error(`\n${msg}\n`); process.exit(1); }
