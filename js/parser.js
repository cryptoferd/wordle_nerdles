const VALID_ROW_REGEX = /^[⬛⬜🟨🟩]{5}$/u;

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

  // Accept:
  // Wordle 1751 3/6
  // Wordle 1,751 3/6
  const headerMatch = header.match(/^Wordle\s+([\d,]+)\s+([1-6X])\/6$/i);

  if (!headerMatch) {
    throw new Error('Header must look like: Wordle 1751 3/6');
  }

  const puzzleNumber = Number(headerMatch[1].replace(/,/g, ''));
  const rawScore = headerMatch[2].toUpperCase();
  const solved = rawScore !== 'X';
  const score = solved ? Number(rawScore) : null;

  const rows = cleaned.slice(1);

  const validRowRegex = /^[⬛⬜🟨🟩]{5}$/;
  for (const row of rows) {
    if (!validRowRegex.test(row)) {
      throw new Error(`Invalid row detected: ${row}`);
    }
  }

  if (solved && rows.length !== score) {
    throw new Error(`Expected ${score} rows, but found ${rows.length}.`);
  }

  if (!solved && rows.length !== 6) {
    throw new Error('A failed game must contain 6 rows.');
  }

  return {
    game: 'Wordle',
    puzzleNumber,
    score,
    maxTries: 6,
    solved,
    rows,
  };
}

export function renderMiniGrid(rows) {
  return rows.map((row) => {
    const cells = [...row].map((char) => {
      let className = 'gray';
      if (char === '🟩') className = 'green';
      else if (char === '🟨') className = 'yellow';
      else if (char === '⬜') className = 'light';
      return `<span class="tile ${className}"></span>`;
    }).join('');

    return `<div class="mini-row">${cells}</div>`;
  }).join('');
}
