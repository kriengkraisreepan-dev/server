'use strict';

// Brand guide (CONTENT_PIPELINE §4) as code: colour tokens, embedded fonts and the logo.
// Fonts and logo are files inside this app and go into the page as data: URLs, so a render
// never needs the internet (A5 acceptance).
const fs = require('node:fs');
const path = require('node:path');

/** §4.1 colour tokens. Templates use only these (checked by test/content.test.js). */
const COLORS = Object.freeze({
  navy: '#0C1D55',
  'navy-deep': '#0C0C1A',
  gold: '#D9AB54',
  'gold-light': '#EFE19E',
  'gold-dark': '#9A6725',
  white: '#FAFAFA',
  'accent-red': '#C8102E',
});

/** §4.2 fonts: Google Fonts (SIL OFL 1.1, licences in fonts/), Thai + Latin subsets. */
const THAI_RANGE = 'U+02D7,U+0303,U+0331,U+0E01-0E5B,U+200C-200D,U+25CC';
const LATIN_RANGE = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const FONT_FACES = Object.freeze([
  { family: 'Kanit', weight: 600, subset: 'thai', file: 'kanit-thai-600-normal.woff2' },
  { family: 'Kanit', weight: 600, subset: 'latin', file: 'kanit-latin-600-normal.woff2' },
  { family: 'Kanit', weight: 700, subset: 'thai', file: 'kanit-thai-700-normal.woff2' },
  { family: 'Kanit', weight: 700, subset: 'latin', file: 'kanit-latin-700-normal.woff2' },
  { family: 'Sarabun', weight: 400, subset: 'thai', file: 'sarabun-thai-400-normal.woff2' },
  { family: 'Sarabun', weight: 400, subset: 'latin', file: 'sarabun-latin-400-normal.woff2' },
  { family: 'Sarabun', weight: 500, subset: 'thai', file: 'sarabun-thai-500-normal.woff2' },
  { family: 'Sarabun', weight: 500, subset: 'latin', file: 'sarabun-latin-500-normal.woff2' },
  { family: 'Zilla Slab', weight: 700, subset: 'latin', file: 'zilla-slab-latin-700-normal.woff2' },
]);

const FONTS_DIR = path.join(__dirname, 'fonts');
const LOGO_FILE = path.join(__dirname, 'brand', 'logo-small.webp');

let cachedFontCss = null;
let cachedLogo = null;

function fontFaceCss() {
  if (cachedFontCss) return cachedFontCss;
  cachedFontCss = FONT_FACES.map((f) => {
    const b64 = fs.readFileSync(path.join(FONTS_DIR, f.file)).toString('base64');
    return `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};font-display:block;` +
      `src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${f.subset === 'thai' ? THAI_RANGE : LATIN_RANGE};}`;
  }).join('\n');
  return cachedFontCss;
}

/** Logo with the white background removed (made from brand/logo-master.jpg), as a data: URL. */
function logoDataUrl() {
  if (!cachedLogo) cachedLogo = `data:image/webp;base64,${fs.readFileSync(LOGO_FILE).toString('base64')}`;
  return cachedLogo;
}

function colorVarsCss() {
  return ':root{' + Object.entries(COLORS).map(([k, v]) => `--${k}:${v};`).join('') + '}';
}

/** §4.3 forbidden words (gambling, guarantees). Not "แทง" alone: "แทงสนุก" is normal snooker talk. */
const FORBIDDEN_WORDS = Object.freeze([/พนัน/, /ได้เงิน/, /การันตี/, /ถูกที่สุด/, /ที่สุดในประเทศ/, /เดิมพัน/, /\bbet(s|ting)?\b/i, /gambl/i, /casino/i]);

/** @returns {string|null} the first forbidden word found */
function findForbidden(text) {
  const t = String(text || '');
  for (const re of FORBIDDEN_WORDS) {
    const m = re.exec(t);
    if (m) return m[0];
  }
  return null;
}

module.exports = { COLORS, FONT_FACES, fontFaceCss, logoDataUrl, colorVarsCss, FORBIDDEN_WORDS, findForbidden };
