export function parseWordleShare(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('No share text provided.');
  }

  const cleaned = text
    .trim()
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (cleaned.length < 2) {
    throw new Error('Invalid Wordle share text.');
  }

  const header = cleaned[0];
  const headerMatch = header.match(/^Wordle\s+([\d,]+)\s+([1-6X])\/6$/i);

  if (!headerMatch) {
    throw new Error('Header must look like: Wordle 1751 3/6');
  }

  const puzzleNumber = Number(headerMatch[1].replace(/,/g, ''));
  const rawScore = headerMatch[2].toUpperCase();
  const solved = rawScore !== 'X';
  const score = solved ? Number(rawScore) : null;

  const rows = cleaned.slice(1);

  const normalizeRow = (row) =>
    Array.from(row.normalize('NFKC'))
      .filter((ch) => !['\uFE0F', '\uFE0E', '\u200D'].includes(ch))
      .join('');

  const normalizedRows = rows.map(normalizeRow);
  const validTiles = new Set(['⬛', '⬜', '🟨', '🟩']);

  for (let i = 0; i < normalizedRows.length; i += 1) {
    const chars = Array.from(normalizedRows[i]);
    if (chars.length !== 5 || chars.some((ch) => !validTiles.has(ch))) {
      throw new Error(`Invalid row detected: ${rows[i]}`);
    }
  }

  if (solved && normalizedRows.length !== score) {
    throw new Error(`Expected ${score} rows, but found ${normalizedRows.length}.`);
  }

  if (!solved && normalizedRows.length !== 6) {
    throw new Error('A failed game must contain 6 rows.');
  }

  return {
    game: 'Wordle',
    puzzleNumber,
    score,
    maxTries: 6,
    solved,
    rows: normalizedRows,
  };
}

export function tileClass(symbol) {
  if (symbol === '🟩') return 'green';
  if (symbol === '🟨') return 'yellow';
  if (symbol === '⬜') return 'light';
  return 'gray';
}

export function renderMiniGrid(rows) {
  return rows
    .map(
      (row) => `
        <div class="mini-row">
          ${Array.from(row)
            .map((tile) => `<span class="tile ${tileClass(tile)}"></span>`)
            .join('')}
        </div>
      `
    )
    .join('');
}
