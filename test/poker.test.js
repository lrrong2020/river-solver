import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classAt, combosForClass, expandRange, formatCard, parseBoard,
  parseRange, rankHand, serializeRange
} from '../engine/cards.js';
import { buildTree } from '../engine/tree.js';

const board = parseBoard('2c 3d 7h 9s Jc');
const seat = (bets = [50, 100], raises = [3], allIn = false) => ({ bets, raises, allIn });
const setup = (changes = {}) => ({ pot: 10, stack: 100, raiseCap: 1, seats: [seat(), seat()], ...changes });
const at = (tree, node, label) => tree.nodes[node.actions.find(action => action.label === label)?.to];

test('matrix covers each of the 1,326 distinct unordered combos exactly once', () => {
  const all = [];
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j < 13; j++) {
      const members = combosForClass(classAt(i, j));
      assert.equal(members.length, i === j ? 6 : i < j ? 4 : 12);
      all.push(...members.map(c => c.key));
    }
  }
  assert.equal(all.length, 1326);
  assert.equal(new Set(all).size, 1326);
  assert.equal(classAt(0, 1), 'AKs');
  assert.equal(classAt(1, 0), 'AKo');
});

test('board input normalizes common formats and rejects duplicates and malformed cards', () => {
  assert.deepEqual(parseBoard('A♥10♣ KD,7s2d').map(formatCard), ['Ah', 'Tc', 'Kd', '7s', '2d']);
  assert.throws(() => parseBoard('As As 3s 4s 5s'), /unique/);
  assert.throws(() => parseBoard('XX 2h 3s 4s 5s'), /five/);
});

test('range classes, plus, intervals, weights, deletion and exact-combo overrides', () => {
  assert.equal(Object.keys(parseRange('99-JJ')).length, 18);
  assert.equal(Object.keys(parseRange('TT+')).length, 30);
  assert.equal(Object.keys(parseRange('AJs+')).length, 12);
  assert.equal(Object.keys(parseRange('A9s-AJs')).length, 12);
  assert.equal(Object.keys(parseRange('98s-65s')).length, 16);
  assert.equal(Object.keys(parseRange('AK')).length, 16);
  const start = parseRange('AKs:0.10 88+ 5♣4♦:.2');
  const result = parseRange('KhAh:0.5 AcKc:0 QdQs:0.0000005', start);
  assert.equal(result.AhKh, 0.5);
  assert.equal(result['5c4d'], 0.2);
  assert.equal(result.AsKs, 0.1);
  assert.equal(result.AcKc, undefined);
  assert.equal(start.AhKh, 0.1);
  assert.deepEqual(parseRange(serializeRange(result)), result);
  for (const invalid of ['AhAh', 'AX', '22s', 'AKs:1.2', 'TT:', 'QQ:NaN', 'ATs-AKo']) {
    assert.throws(() => parseRange(invalid));
  }
});

test('board removal excludes all blocked combos without mutating input weights', () => {
  const weights = parseRange('JJ 32o AhKh:0.75');
  const cleared = expandRange(weights, board);
  assert.equal(cleared.filter(c => c.handClass === 'JJ').length, 3);
  assert.equal(cleared.filter(c => c.handClass === '32o').length, 7);
  assert.equal(cleared.find(c => c.key === 'AhKh').weight, 0.75);
  assert.equal(Object.keys(weights).length, 19);
});

function showdown(boardText, handText) {
  const publicCards = parseBoard(boardText);
  const [hand] = expandRange(parseRange(handText), publicCards);
  return rankHand([...publicCards, ...hand.cards]);
}

test('showdowns handle board ties, wheel straights, flush kickers and two sets', () => {
  const royal = 'Ah Kh Qh Jh Th';
  assert.equal(showdown(royal, 'AdAs'), showdown(royal, '3s2c'));
  assert.ok(showdown('2h 3c 4d Ts 9h', '5sAc') > showdown('2h 3c 4d Ts 9h', 'ThTc'));
  assert.ok(showdown('2h 3c 4d Ts 9h', '5sAc') < showdown('2h 3c 4d Ts 9h', '6s5c'));
  assert.ok(showdown('Ah Kh 9h 7h 2d', 'Qh3s') > showdown('Ah Kh 9h 7h 2d', 'JhTh'));
  assert.ok(showdown('Ah Kh 9h 7h 2d', 'Qh3s') === showdown('Ah Kh 9h 7h 2d', 'Qh4d'));
  assert.ok(showdown('Ad As Kc Ks 3h', 'AhKh') > showdown('Ad As Kc Ks 3h', 'KhQc'));
});

test('seven-card evaluator agrees with independent exhaustive five-card choice', () => {
  function fiveScore(cards) {
    const ranks = cards.map(c => c >> 2).sort((a, b) => b - a);
    const groups = [...new Set(ranks)].map(rank => ({
      rank, count: ranks.filter(r => r === rank).length
    })).sort((a, b) => b.count - a.count || b.rank - a.rank);
    const shape = groups.map(g => g.count).join('');
    const flush = cards.every(c => c % 4 === cards[0] % 4);
    const run = shape === '11111' && ranks[0] - ranks[4] === 4;
    const wheel = ranks.join(',') === '12,3,2,1,0';
    const straight = run || wheel;
    let category = 0;
    if (straight && flush) category = 8;
    else if (shape === '41') category = 7;
    else if (shape === '32') category = 6;
    else if (flush) category = 5;
    else if (straight) category = 4;
    else if (shape === '311') category = 3;
    else if (shape === '221') category = 2;
    else if (shape === '2111') category = 1;
    const kickers = straight ? [wheel ? 3 : ranks[0]] : groups.map(g => g.rank);
    while (kickers.length < 5) kickers.push(0);
    return kickers.reduce((sum, digit) => sum * 13 + digit, category);
  }
  let seed = 73;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  }
  for (let i = 0; i < 600; i++) {
    const deck = Array.from({ length: 52 }, (_, card) => card);
    const hand = Array.from({ length: 7 }, () => deck.splice(Math.floor(random() * deck.length), 1)[0]);
    let best = -1;
    for (let a = 0; a < 7; a++) {
      for (let b = a + 1; b < 7; b++) {
        best = Math.max(best, fiveScore(hand.filter((_, ix) => ix !== a && ix !== b)));
      }
    }
    assert.equal(rankHand(hand), best, hand.map(formatCard).join(' '));
  }
});

test('opening sizes, check-through and a single raise per line', () => {
  const tree = buildTree(setup());
  const root = tree.nodes[tree.root];
  assert.deepEqual(root.actions.map(a => a.label), ['Check', 'Bet 5 bb', 'Bet 10 bb']);
  assert.equal(at(tree, at(tree, root, 'Check'), 'Check').terminal, 'showdown');
  const raise = at(tree, at(tree, root, 'Bet 5 bb'), 'Raise to 15 bb');
  assert.deepEqual(raise.actions.map(a => a.kind), ['fold', 'call']);
  const fold = at(tree, raise, 'Fold');
  assert.deepEqual(fold.committed, [5, 15]);
  assert.equal(fold.winner, 1);
  assert.equal(fold.terminal, 'fold');
  assert.deepEqual(at(tree, raise, 'Call').committed, [15, 15]);
});

test('enforces minimums, short all-ins and collapsed duplicate sizes', () => {
  const tree = buildTree(setup({ pot: 2, stack: 3.4, raiseCap: 4, seats: [seat([10, 50, 200], [1.1], true), seat([], [3])] }));
  const root = tree.nodes[tree.root];
  assert.deepEqual(root.actions.map(a => a.label), ['Check', 'Bet 1 bb', 'Bet 3.4 bb (all-in)']);
  const raise = at(tree, at(tree, root, 'Bet 1 bb'), 'Raise to 3 bb');
  const short = at(tree, raise, 'Raise to 3.4 bb (all-in)');
  assert.deepEqual(short.actions.map(a => a.kind), ['fold', 'call']);
  const deep = buildTree(setup({ pot: 2, stack: 20, raiseCap: 2, seats: [seat([50], [1.1]), seat([], [3])] }));
  const facing = at(deep, at(deep, deep.nodes['0'], 'Bet 1 bb'), 'Raise to 3 bb');
  assert.equal(facing.actions.at(-1).label, 'Raise to 5 bb');
  const tiny = buildTree(setup({ stack: 0.4 }));
  assert.deepEqual(tiny.nodes['0'].actions.map(a => a.label), ['Check', 'Bet 0.4 bb (all-in)']);
});

test('empty opening sizes force a check, blind precision and tree budget are validated', () => {
  const tree = buildTree(setup({ seats: [seat([]), seat([50])] }));
  assert.deepEqual(tree.nodes[tree.root].actions.map(a => a.label), ['Check']);
  assert.throws(() => buildTree(setup({ stack: 0 })), /positive/);
  assert.throws(() => buildTree(setup({ pot: 0.123 })), /decimal/);
  assert.throws(() => buildTree(setup({ raiseCap: -1 })), /nonnegative/);
  assert.throws(() => buildTree(setup({ seats: [seat([0]), seat()] })), /positive/);
  assert.throws(() => buildTree(setup({ stack: 100000, raiseCap: 8, seats: [seat([50], [2, 3, 4]), seat([50], [2, 3, 4])] })), /4,096/);
});
