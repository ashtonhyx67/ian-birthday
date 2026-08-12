/* ═══════════════════════════════════════════════════════════════════════════
   publish-content.mjs — put the letters and photos INTO the website.

   Why this exists
   ───────────────
   Anything added through the hidden newsroom is saved in the browser you
   added it on. It is not part of the site, so nobody else can ever see it.
   This script puts everything into the project itself, where it gets pushed
   and served to every visitor.

   It does two jobs, and you can use either or both:

     PHOTOS   Every image sitting in the photos/ folder is listed in
              CONFIG.photos, in name order. Just drop your pictures in
              there — no newsroom, no backup file, full quality.

     LETTERS  If a newsroom backup (.json) is named or found in this folder,
              its letters go into CONFIG.messages, and any photos stored
              inside it are written out into photos/ as real image files.

   How to use it
   ─────────────
     Put your pictures in photos/, then from the project folder run:

         node tools/publish-content.mjs

     It will also pick up a backup file lying in the folder. To name one:

         node tools/publish-content.mjs ian-gazette-backup.json

     Then:  git add -A && git commit -m "Add photos" && git push

   Captions (optional)
   ───────────────────
   Make a file photos/captions.txt with one line per picture:

         beach.jpg   | Blackpool, before the seagull incident
         party.jpg   | The night of the great cake incident

   index.html is rewritten in place, with the previous version kept as
   index.html.bak, so nothing is ever lost.
   ═══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';

const ROOT      = process.cwd();
const HTML      = path.join(ROOT, 'index.html');
const PHOTO_DIR = path.join(ROOT, 'photos');
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
const UNVIEWABLE = new Set(['.heic', '.heif', '.tif', '.tiff', '.bmp', '.raw', '.cr2', '.nef', '.dng']);
const BIG_FILE  = 1_500_000;                     // nag above roughly 1.5 MB

if (!fs.existsSync(HTML)) die('index.html is not here. Run this from the project folder.');
fs.mkdirSync(PHOTO_DIR, { recursive: true });

/* ── which backup file, if any ──────────────────────────────────────────── */
let backupPath = process.argv[2] || null;
if (backupPath && !fs.existsSync(backupPath)) {
  die(`I cannot find "${backupPath}" — check the name and that it is in this folder.`);
}
if (!backupPath) {
  const found = fs.readdirSync(ROOT).filter(f => /backup.*\.json$/i.test(f) || /^gazette.*\.json$/i.test(f));
  if (found.length === 1) { backupPath = found[0]; note(`using the backup file ${found[0]}`); }
  else if (found.length > 1) die(`There are several backup files here:\n  ${found.join('\n  ')}\nName the one you want:\n\n  node tools/publish-content.mjs ${found[0]}`);
}

let backup = { messages: [], photos: [] };
if (backupPath) {
  try { backup = JSON.parse(fs.readFileSync(backupPath, 'utf8')); }
  catch (e) { die(`"${backupPath}" is not readable JSON — is it really the backup file?\n${e.message}`); }
}
const messages = Array.isArray(backup.messages) ? backup.messages : [];

/* ── 1. photos held inside the backup become real files ─────────────────── */
const EXT_OF = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const captionFromBackup = new Map();
let extracted = 0;

(Array.isArray(backup.photos) ? backup.photos : []).forEach((p, i) => {
  const src = p && p.src ? String(p.src) : '';
  if (!src.startsWith('data:')) return;                       // a URL: nothing to write out
  const m = /^data:([^;,]+)[^,]*,(.*)$/s.exec(src);
  if (!m) { warn(`picture ${i + 1} in the backup is not a readable image, skipped`); return; }

  const ext  = EXT_OF[m[1].toLowerCase()] || 'jpg';
  const name = `from-backup-${String(i + 1).padStart(2, '0')}.${ext}`;
  fs.writeFileSync(path.join(PHOTO_DIR, name), Buffer.from(decodeURIComponent(m[2]), 'base64'));
  if (p.cap) captionFromBackup.set(name, p.cap);
  extracted++;
});

/* ── 2. read captions.txt ───────────────────────────────────────────────── */
const capFile = path.join(PHOTO_DIR, 'captions.txt');
const captions = new Map(captionFromBackup);
if (fs.existsSync(capFile)) {
  for (const line of fs.readFileSync(capFile, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('|');
    if (i === -1) continue;
    captions.set(t.slice(0, i).trim(), t.slice(i + 1).trim());
  }
}

/* ── 3. every image in photos/, in a sensible order ─────────────────────── */
const all = fs.readdirSync(PHOTO_DIR).filter(f => fs.statSync(path.join(PHOTO_DIR, f)).isFile());

const skipped = all.filter(f => UNVIEWABLE.has(path.extname(f).toLowerCase()));
const files   = all.filter(f => IMAGE_EXT.has(path.extname(f).toLowerCase()))
                   .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

if (!files.length && !messages.length) {
  die('There are no images in photos/ and no letters to publish.\n' +
      'Copy your pictures into the photos/ folder and run this again.');
}

const heavy = [];
const entries = files.map(f => {
  const bytes = fs.statSync(path.join(PHOTO_DIR, f)).size;
  if (bytes > BIG_FILE) heavy.push(`${f} (${(bytes / 1048576).toFixed(1)} MB)`);
  return { src: `photos/${f}`, cap: captions.get(f) || '', bytes };
});

/* ── 4. build the CONFIG blocks and splice them in ──────────────────────── */
const q = s => JSON.stringify(String(s));

const photoBlock = entries.length
  ? 'photos: [\n' + entries.map(p =>
      p.cap ? `    {src: ${q(p.src)}, cap: ${q(p.cap)}},` : `    ${q(p.src)},`
    ).join('\n') + '\n  ],'
  : 'photos: [],';

const msgBlock = messages.length
  ? 'messages: [\n' + messages.filter(m => m && m.t).map(m =>
      `    {n: ${q(m.n || 'A friend')}, t: ${q(m.t)}},`
    ).join('\n') + '\n  ],'
  : null;                                        // no backup given: leave the letters alone

let html = fs.readFileSync(HTML, 'utf8');
const before = html;

const r1 = replaceArray(html, 'photos', photoBlock); html = r1.text;
let r2 = { found: true };
if (msgBlock) { r2 = replaceArray(html, 'messages', msgBlock); html = r2.text; }

if (!r1.found && !r2.found) {
  die('I could not find the photos: or messages: lines in index.html — nothing was changed.\n' +
      'Has the CONFIG block at the top of the file been renamed?');
}
if (html !== before) {
  fs.writeFileSync(HTML + '.bak', before);
  fs.writeFileSync(HTML, html);
}

/* ── 5. say what happened ───────────────────────────────────────────────── */
const totalBytes = entries.reduce((n, p) => n + p.bytes, 0);
console.log('');
console.log(`  photos published  : ${entries.length}${totalBytes ? `  (${(totalBytes / 1048576).toFixed(1)} MB total)` : ''}`);
if (extracted) console.log(`                      ${extracted} of them pulled out of the backup file`);
console.log(`  letters published : ${msgBlock ? messages.length : 'unchanged (no backup file given)'}`);
console.log(html === before ? '  index.html already said exactly this — nothing to change.'
                            : '  index.html updated, previous version saved as index.html.bak');

if (skipped.length) {
  console.log('');
  warn(`these are NOT formats a browser can show, so they were left out:`);
  skipped.forEach(f => console.log(`      ${f}`));
  console.log(`      Save them as JPEG or PNG and run this again.`);
}
if (heavy.length) {
  console.log('');
  warn(`these are large and will make the page slow to load:`);
  heavy.forEach(f => console.log(`      ${f}`));
  console.log(`      Shrinking them to about 1600px wide is plenty.`);
}
console.log('');
console.log('  Now put it live:');
console.log('    git add -A');
console.log('    git commit -m "Add the photos"');
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

function note(msg) { console.log(`  · ${msg}`); }
function warn(msg) { console.warn(`  ! ${msg}`); }
function die(msg)  { console.error(`\n${msg}\n`); process.exit(1); }
