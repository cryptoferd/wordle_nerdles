/**
 * Robust Wordle share parser.
 *
 * Fixes "Invalid row detected" false negatives caused by:
 * - emoji variation selectors (e.g., ⬛️ == U+2B1B U+FE0F)
 * - invisible format chars (ZWSP/ZWJ/ZWNJ, BOM, word joiner, soft hyphen)
 * - NBSP or internal whitespace inserted by copy/paste
 * - alternate square glyph code points (■ □ ◼ ◻) from font fallback
 *
 * Uses grapheme cluster splitting (Intl.Segmenter) when available.
 * Falls back to code-point splitting (Array.from) for older browsers.
 */

const MAX_TRIES = 6;

/**
 * Accept headers like:
 * - "Wordle 1753 5/6"
 * - "Wordle 1,753 5/6"
 * - "WORDLE 1753 X/6"
 * - "Wordle 1753 5/6*"  (hard-mode star)
 * - tolerate extra spaces around the slash
 */
const HEADER_RE = /^Wordle\s+([\d,]+)\s+([1-6Xx])\s*\/\s*6(?:\*+)?\s*$/i;

/**
 * Invisible / formatting characters commonly introduced by copy/paste:
 * - Variation Selectors: U+FE00..U+FE0F (incl. VS15/VS16)
 * - ZWSP: U+200B, ZWNJ: U+200C, ZWJ: U+200D
 * - WORD JOINER: U+2060
 * - BOM / ZWNBSP: U+FEFF
 * - SOFT HYPHEN: U+00AD
 */
const INVISIBLE_RE = /[\uFE00-\uFE0F\u200B\u200C\u200D\u2060\uFEFF\u00AD]/g;

/**
 * Remove internal whitespace (spaces, tabs, line/para separators, NBSP, etc.).
 * We keep this separate from trim() because trim() only removes at the ends.
 */
const INTERNAL_WHITESPACE_RE = /[\s\u00A0]+/gu;

// Canonical tiles used everywhere else in the app.
const CANON = {
  GRAY: '⬛',
  LIGHT: '⬜',
  YELLOW: '🟨',
  GREEN: '🟩',
};

// Map acceptable input tokens (single grapheme clusters) to canonical tiles.
const TOKEN_TO_CANON = new Map([
  // Standard Wordle tiles
  ['⬛', CANON.GRAY],
  ['⬜', CANON.LIGHT],
  ['🟨', CANON.YELLOW],
  ['🟩', CANON.GREEN],

  // Optional variants (accessibility or Wordle-like clones)
  ['🟧', CANON.YELLOW],
  ['🟦', CANON.GREEN],

  // Common fallback squares (text symbols)
  ['■', CANON.GRAY],
  ['□', CANON.LIGHT],
  ['◼', CANON.GRAY],
  ['◻', CANON.LIGHT],
]);

// Optional debug toggle: set globalThis.WORDLE_NERDLES_DEBUG = true;
const DEBUG = Boolean(globalThis.WORDLE_NERDLES_DEBUG);

let _segmenter = null;
function getSegmenter() {
  if (_segmenter) return _segmenter;
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    _segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  }
  return _segmenter;
}

/**
 * Split string into grapheme clusters if possible, else into Unicode code points.
 * - Intl.Segmenter => grapheme clusters (best)
 * - Array.from => code points (fallback; ok after stripping VS/ZWJ artifacts)
 */
function splitGraphemes(str) {
  const seg = getSegmenter();
  if (seg) return Array.from(seg.segment(str), (x) => x.segment);
  return Array.from(str);
}

/**
 * Debug helper: show hex code points in a string.
 * Iterates by code points using for...of on string.
 */
export function describeCodepoints(str) {
  const out = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    out.push(`U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
  }
  return out.join(' ');
}

function sanitizeLine(line) {
  return line.normalize('NFC').replace(/\r/g, '').trim();
}

function sanitizeRow(row) {
  return row
    .normalize('NFC')
    .replace(INVISIBLE_RE, '')
    .replace(INTERNAL_WHITESPACE_RE, '')
    .trim();
}

function rowDebugObject(rawRow, cleanedRow) {
  const graphemes = splitGraphemes(cleanedRow);
  return {
    rawRow,
    cleanedRow,
    rawRowJson: JSON.stringify(rawRow),
    cleanedRowJson: JSON.stringify(cleanedRow),
    rawCodepoints: describeCodepoints(rawRow),
    cleanedCodepoints: describeCodepoints(cleanedRow),
    graphemeCount: graphemes.length,
    graphemes: graphemes.map((g) => ({
      tile: g,
      codepoints: describeCodepoints(g),
      canonical: TOKEN_TO_CANON.get(g) || null,
    })),
  };
}

function parseGridRow(rawRow, lineNumber) {
  const cleaned = sanitizeRow(rawRow);
  const graphemes = splitGraphemes(cleaned);

  if (graphemes.length !== 5) {
    const details = rowDebugObject(rawRow, cleaned);
    if (DEBUG) console.warn('Wordle row length mismatch:', details);

    throw new Error(
      [
        `Invalid row detected (line ${lineNumber}).`,
        `Expected 5 tiles, found ${graphemes.length}.`,
        `Raw: ${rawRow}`,
        `Cleaned: ${cleaned}`,
        `Raw codepoints: ${describeCodepoints(rawRow)}`,
        `Cleaned codepoints: ${describeCodepoints(cleaned)}`,
      ].join('\n')
    );
  }

  const canonTiles = [];
  for (const g of graphemes) {
    const canon = TOKEN_TO_CANON.get(g);
    if (!canon) {
      const details = rowDebugObject(rawRow, cleaned);
      if (DEBUG) console.warn('Wordle row contains unknown tile:', details);

      throw new Error(
        [
          `Invalid row detected (line ${lineNumber}).`,
          `Unknown tile: "${g}"`,
          `Allowed: ⬛ ⬜ 🟨 🟩 (plus optional variants like 🟧 🟦 and ■ □ ◼ ◻).`,
          `Raw: ${rawRow}`,
          `Cleaned: ${cleaned}`,
          `Raw codepoints: ${describeCodepoints(rawRow)}`,
          `Cleaned codepoints: ${describeCodepoints(cleaned)}`,
        ].join('\n')
      );
    }
    canonTiles.push(canon);
  }

  // Return a canonical 5-tile string compatible with existing UI and storage.
  return canonTiles.join('');
}

export function parseWordleShare(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('No share text provided.');
  }

  const lines = text
    .normalize('NFC')
    .replace(/\r/g, '')
    .split('\n')
    .map(sanitizeLine)
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error('Invalid Wordle share text: expected a header + rows.');
  }

  const header = lines[0];
  const match = header.match(HEADER_RE);
  if (!match) {
    throw new Error(
      'Header must look like: "Wordle 1753 5/6" (commas "1,753" and optional "*" are supported).'
    );
  }

  const puzzleNumber = Number(match[1].replace(/,/g, ''));
  const scoreToken = match[2].toUpperCase();
  const solved = scoreToken !== 'X';
  const score = solved ? Number(scoreToken) : null;

  const rawRows = lines.slice(1);
  const rows = rawRows.map((row, idx) => parseGridRow(row, idx + 2));

  if (solved && rows.length !== score) {
    throw new Error(`Expected ${score} rows, but found ${rows.length}.`);
  }

  if (!solved && rows.length !== MAX_TRIES) {
    throw new Error('A failed game must contain 6 rows.');
  }

  return {
    game: 'Wordle',
    puzzleNumber,
    score,
    solved,
    maxTries: MAX_TRIES,
    rows,
  };
}

export function renderMiniGrid(rows) {
  return rows
    .map((row) => {
      // Row is canonicalized to 5 tiles, safe to iterate by code points.
      const cells = [...row]
        .map((char) => {
          let className = 'gray';
          if (char === '🟩') className = 'green';
          else if (char === '🟨') className = 'yellow';
          else if (char === '⬜') className = 'light';
          return `<span class="tile ${className}"></span>`;
        })
        .join('');

      return `<div class="mini-row">${cells}</div>`;
    })
    .join('');
}
