import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRange } from '../engine/cards.js';
import { createSolver } from '../engine/solver.js';
import { buildTree } from '../engine/tree.js';

// IP can check or bet one into two. Queens beat the two 54o combos and lose to AA.
function bluffGame() {
  const game = {
    board: '2c 3d 7h 9s Jc', pot: 2, stack: 4, raiseCap: 0,
    ranges: [parseRange('QdQh'), parseRange('AcAs,5c4d,5h4s')],
    seats: [[], [50]].map(bets => ({ bets, raises: [], allIn: false })),
    locks: {}
  };
  const tree = buildTree(game);
  const bettor = tree.nodes[tree.nodes[tree.root].actions[0].to];
  const caller = tree.nodes[bettor.actions.find(a => a.kind === 'bet').to];
  return { game, bettor, caller };
}

test('a mixed exact-combo lock persists while its opponent and sibling combos adapt', () => {
  const { game, bettor, caller } = bluffGame();
  const bluff = 0.8;
  game.locks[bettor.id] = { '5c4d': [0.2, bluff] };
  const solver = createSolver(game);
  for (const count of [0, 1, 19, 180]) {
    for (let i = 0; i < count; i++) solver.iterate();
    const report = solver.evaluate();
    const info = solver.inspect(bettor.id);
    const bet = key => info.combos.find(combo => combo.key === key).frequency[1];
    const call = solver.inspect(caller.id).actions[1].frequency;
    assert.deepEqual(info.combos.find(c => c.key === '5c4d').frequency, [0.2, bluff]);

    // Since the forced bluff alone justifies calling, OOP's best response is
    // to call every bet. IP can optimize AA and the other 54o combo only.
    const oopBest = (4 + bluff + bet('5h4s') - bet('AcAs')) / 3;
    const bluffEV = 2 - 3 * call;
    const ipBest = (2 + call + bluff * bluffEV + Math.max(0, bluffEV)) / 3;
    const exploitability = 100 * (oopBest + ipBest - 2) / 4;
    assert.ok(Math.abs(report.exploitabilityPct - exploitability) < 1e-10);
    if (solver.iterations === 200) {
      assert.ok(call > 0.999 && bet('AcAs') > 0.999);
      assert.ok(bet('5h4s') < 0.001 && report.exploitabilityPct < 0.01);
    }
  }
});

test('locks on both seats are enforced even when an earlier lock rules out a line', () => {
  const { game, bettor, caller } = bluffGame();
  game.locks[bettor.id] = Object.fromEntries(Object.keys(game.ranges[1]).map(key => [key, [1, 0]]));
  game.locks[caller.id] = { QdQh: [0.25, 0.75] };
  const solver = createSolver(game);
  for (let i = 0; i < 5; i++) solver.iterate();
  assert.ok(solver.evaluate().exploitabilityPct < 1e-10);
  const info = solver.inspect(caller.id);
  assert.equal(info.reachable, false);
  assert.deepEqual(info.combos[0].frequency, [0.25, 0.75]);
  assert.deepEqual(info.combos[0].ev, [null, null]);
});

test('invalid locks identify malformed strategies, missing decisions, or inactive combos', () => {
  const { game, bettor, caller } = bluffGame();
  const bad = (locks, message) => assert.throws(() => createSolver({ ...game, locks }), message);
  bad(null, /map/);
  bad({ [bettor.id]: [] }, /map/);
  bad({ 1000: {} }, /decision node/);
  bad({ [caller.actions[0].to]: { QdQh: [] } }, /decision node/);
  bad({ [bettor.id]: { QdQh: [0, 1] } }, /outside the acting range/);
  bad({ [bettor.id]: { '2c2d': [0, 1] } }, /outside the acting range/);
  for (const mix of [[1], [0.5, 0.1], [NaN, 1], [2, -1], Array(2), [0, '1']]) {
    bad({ [bettor.id]: { AcAs: mix } }, /frequenc/);
  }
});
