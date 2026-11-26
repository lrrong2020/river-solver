export const RANKS = 'AKQJT98765432';
const SUITS = 'cdhs';
const unicodeSuits = { '♣': 'c', '♦': 'd', '♥': 'h', '♠': 's' };

function normalizeCards(text) {
  return text.replace(/10/gi, 'T').replace(/[♣♦♥♠]/g, suit => unicodeSuits[suit]);
}

function parseCard(code) {
  const rank = 12 - RANKS.indexOf(code[0].toUpperCase());
  return rank * 4 + SUITS.indexOf(code[1].toLowerCase());
}

export function formatCard(id) {
  if (!Number.isInteger(id) || id < 0 || id > 51) throw new Error('Invalid card ID.');
  return RANKS[12 - (id >> 2)] + SUITS[id % 4];
}

export function parseBoard(text) {
  const compact = normalizeCards(text).replace(/[\s,]+/g, '');
  if (!/^(?:[2-9TJQKA][cdhs]){5}$/i.test(compact)) {
    throw new Error('Enter exactly five board cards, for example 2c 3d 7h 9s Jc.');
  }
  const cards = compact.match(/../g).map(parseCard);
  if (new Set(cards).size !== 5) throw new Error('Each board card must be unique.');
  return cards;
}

export function classAt(row, col) {
  if (row === col) return RANKS[row] + RANKS[row];
  return row < col ? RANKS[row] + RANKS[col] + 's' : RANKS[col] + RANKS[row] + 'o';
}

const classes = new Map();
const combos = new Map();
for (let row = 0; row < 13; row++) {
  for (let col = 0; col < 13; col++) {
    const handClass = classAt(row, col);
    const members = [];
    for (let first = 0; first < 4; first++) {
      for (let second = 0; second < 4; second++) {
        if (row === col && first >= second) continue;
        if (row < col && first !== second) continue;
        if (row > col && first === second) continue;
        const cards = [
          (12 - Math.min(row, col)) * 4 + first,
          (12 - Math.max(row, col)) * 4 + second
        ];
        const key = cards.map(formatCard).join('');
        const combo = { key, cards, handClass };
        members.push(combo);
        combos.set(key, combo);
      }
    }
    classes.set(handClass, members);
  }
}

export function combosForClass(handClass) {
  const members = classes.get(handClass);
  if (!members) throw new Error('Unknown hand class ' + handClass + '.');
  return members;
}

function classParts(text) {
  const match = /^([2-9TJQKA])([2-9TJQKA])([so]?)$/i.exec(text);
  if (!match) throw new Error('Invalid hand class ' + text + '.');
  const hi = RANKS.indexOf(match[1].toUpperCase());
  const lo = RANKS.indexOf(match[2].toUpperCase());
  const suit = match[3].toLowerCase();
  if (hi > lo || (hi === lo && suit)) throw new Error('Invalid hand class ' + text + '.');
  return { hi, lo, suit };
}

function expandClassInterval(text) {
  const plus = text.endsWith('+');
  const parts = (plus ? text.slice(0, -1) : text).split('-');
  if (parts.length > 2 || (plus && parts.length !== 1)) throw new Error('Invalid range ' + text + '.');
  const start = classParts(parts[0]);
  let end = parts.length === 2 ? classParts(parts[1]) : start;
  const pair = start.hi === start.lo;
  if (plus) end = pair ? { hi: 0, lo: 0, suit: '' } : { ...start, lo: start.hi + 1 };
  const hiDelta = end.hi - start.hi;
  const loDelta = end.lo - start.lo;
  if (start.suit !== end.suit || pair !== (end.hi === end.lo) ||
      (hiDelta !== 0 && hiDelta !== loDelta)) {
    throw new Error('Use matching hand types and a fixed high rank or a diagonal interval in ' + text + '.');
  }
  const keys = [];
  for (let i = 0; i <= Math.abs(loDelta); i++) {
    const hi = start.hi + i * Math.sign(hiDelta);
    const lo = start.lo + i * Math.sign(loDelta);
    const ranks = RANKS[hi] + RANKS[lo];
    const suffixes = pair || start.suit ? [start.suit] : ['s', 'o'];
    for (const suffix of suffixes) {
      for (const { key } of combosForClass(ranks + suffix)) keys.push(key);
    }
  }
  return keys;
}

export function parseRange(text, base = {}) {
  const result = { ...base };
  for (const token of text.split(/[\s,;]+/).filter(Boolean)) {
    const fields = token.split(':');
    if (fields.length > 2 || (fields.length === 2 && !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(fields[1]))) {
      throw new Error('Invalid range weight in ' + token + '.');
    }
    const weight = fields.length === 2 ? Number(fields[1]) : 1;
    if (weight < 0 || weight > 1) throw new Error('Weights must be between 0 and 1 in ' + token + '.');
    const hand = normalizeCards(fields[0]);
    let keys;
    if (/^(?:[2-9TJQKA][cdhs]){2}$/i.test(hand)) {
      const [a, b] = hand.match(/../g).map(parseCard);
      if (a === b) throw new Error('A combo cannot contain the same card twice.');
      const ordered = (a >> 2) > (b >> 2) || ((a >> 2) === (b >> 2) && a < b);
      keys = [ordered ? formatCard(a) + formatCard(b) : formatCard(b) + formatCard(a)];
    } else {
      keys = expandClassInterval(hand);
    }
    for (const key of keys) {
      if (weight === 0) delete result[key];
      else result[key] = weight;
    }
  }
  return result;
}

// Preserve off-board combos so an edited range also round-trips on other runouts.
export function serializeRange(weights) {
  const tokens = [];
  const token = (key, w) => w === 1 ? key : key + ':' + w;
  for (const [name, members] of classes) {
    const firstWeight = weights[members[0].key] || 0;
    if (members.every(({ key }) => (weights[key] || 0) === firstWeight)) {
      if (firstWeight) tokens.push(token(name, firstWeight));
    } else {
      for (const { key } of members) if (weights[key]) tokens.push(token(key, weights[key]));
    }
  }
  return tokens.join(', ');
}

export function expandRange(weights, board) {
  const blocked = new Set(board);
  const list = [];
  for (const [key, weight] of Object.entries(weights)) {
    const combo = combos.get(key);
    if (!combo || !Number.isFinite(weight) || weight < 0 || weight > 1) {
      throw new Error('Invalid range entry for ' + key + '.');
    }
    if (weight && !blocked.has(combo.cards[0]) && !blocked.has(combo.cards[1])) list.push({ ...combo, weight });
  }
  return list;
}

// All categories use five base-13 kicker digits so scores compare directly.
function score(category, ranks) {
  let value = category;
  for (let i = 0; i < 5; i++) value = 13 * value + (ranks[i] ?? 0);
  return value;
}

function straightHigh(mask) {
  for (let top = 12; top >= 4; top--) {
    const run = 31 << (top - 4);
    if ((mask & run) === run) return top;
  }
  return (mask & 4111) === 4111 ? 3 : -1; // A, 2, 3, 4, 5
}

export function rankHand(cards) {
  if (cards.length !== 7 || new Set(cards).size !== 7 ||
      cards.some(card => !Number.isInteger(card) || card < 0 || card >= 52)) {
    throw new Error('Hand evaluation requires seven distinct cards.');
  }
  const counts = new Uint8Array(13);
  const suitCounts = new Uint8Array(4);
  const suitMasks = new Uint16Array(4);
  let mask = 0;
  for (const card of cards) {
    const rank = card >> 2;
    const suit = card % 4;
    counts[rank]++;
    suitCounts[suit]++;
    suitMasks[suit] |= 1 << rank;
    mask |= 1 << rank;
  }
  const flushSuit = suitCounts.findIndex(n => n >= 5);
  if (flushSuit >= 0) {
    const straightFlush = straightHigh(suitMasks[flushSuit]);
    if (straightFlush >= 0) return score(8, [straightFlush]);
  }
  const distinct = [];
  const pairs = [];
  const trips = [];
  let quad = -1;
  for (let rank = 12; rank >= 0; rank--) {
    if (counts[rank]) distinct.push(rank);
    if (counts[rank] >= 2) pairs.push(rank);
    if (counts[rank] >= 3) trips.push(rank);
    if (counts[rank] === 4) quad = rank;
  }
  if (quad >= 0) return score(7, [quad, distinct.find(rank => rank !== quad)]);
  if (trips.length && pairs.length >= 2) return score(6, [trips[0], pairs.find(rank => rank !== trips[0])]);
  if (flushSuit >= 0) return score(5, distinct.filter(rank => suitMasks[flushSuit] & (1 << rank)));
  const straight = straightHigh(mask);
  if (straight >= 0) return score(4, [straight]);
  if (trips.length) return score(3, [trips[0], ...distinct.filter(rank => rank !== trips[0]).slice(0, 2)]);
  if (pairs.length >= 2) return score(2, [pairs[0], pairs[1], distinct.find(rank => rank !== pairs[0] && rank !== pairs[1])]);
  if (pairs.length) return score(1, [pairs[0], ...distinct.filter(rank => rank !== pairs[0]).slice(0, 3)]);
  return score(0, distinct);
}
