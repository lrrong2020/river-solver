import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRange } from '../engine/cards.js';
import { createSolver } from '../engine/solver.js';
import { buildTree } from '../engine/tree.js';

function near(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) < tolerance, `Expected ${expected}, received ${actual}`);
}

test('mixed locks on both seats produce the analytical response with a blocked bluff', () => {
  const spot = {
    board: '2c 3d 7h 9s Jc', pot: 2, stack: 4, raiseCap: 0,
    ranges: [parseRange('QdQh,QcQs'), parseRange('AcAs,Qh4s')],
    seats: [
      { bets: [], raises: [], allIn: false },
      { bets: [50], raises: [], allIn: false }
    ]
  };
  const { root, nodes } = buildTree(spot);
  const ipDecision = nodes[root].actions.find(a => a.kind === 'check').to;
  const oopDecision = nodes[ipDecision].actions.find(a => a.kind === 'bet').to;
  spot.locks = {
    [ipDecision]: { Qh4s: [0.4, 0.6] },
    [oopDecision]: { QdQh: [0.75, 0.25] }
  };
  const solver = createSolver(spot);

  function checkGain() {
    const metric = solver.evaluate().exploitabilityPct;
    const bettors = solver.inspect(ipDecision).combos;
    const catchers = solver.inspect(oopDecision).combos;
    near(bettors.find(hand => hand.key === 'Qh4s').frequency[1], 0.6);
    near(catchers.find(hand => hand.key === 'QdQh').frequency[1], 0.25);
    const bet = bettors.find(hand => hand.key === 'AcAs').frequency[1];
    const call = catchers.find(hand => hand.key === 'QcQs').frequency[1];

    // Three equally likely deals. Aces earn an extra 1 bb whenever called.
    // QcQs gains 3 bb by calling the bluff, loses 1 bb when calling aces.
    // QdQh blocks the bluff, and both mixed rows must stay fixed in a response.
    const ipGain = (1 - bet) * (0.25 + call) / 3;
    const oopGain = (1 - call) * (3 * 0.6 - bet) / 3;
    near(metric, 100 * (ipGain + oopGain) / (2 * spot.pot));
    return { bet, call };
  }

  checkGain();
  for (let i = 0; i < 200; i++) solver.iterate();
  const { bet, call } = checkGain();
  near(bet, 1, 0.001);
  near(call, 1, 0.001);
  // QdQh loses 0.25 bb to aces. QcQs loses 1 bb to aces and wins
  // 2 + 0.6 bb against the locked bluff.
  near(solver.inspect(root).actions[0].ev, 0.45, 0.001);
});
