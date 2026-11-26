import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRange } from '../engine/cards.js';
import { remapLocks } from '../engine/lock-map.js';
import { buildTree } from '../engine/tree.js';

const spot = {
  board: '2c 3d 7h 9s Jc', pot: 10, stack: 40, raiseCap: 1,
  seats: [{ bets: [50, 100], raises: [3] }, { bets: [50], raises: [2] }],
  ranges: [parseRange('QsQh'), parseRange('AcAs,5c4d')]
};
const tree = buildTree(spot);
const afterHalfPot = tree.nodes[tree.root].actions.find(a => a.label === 'Bet 5 bb').to;
const locks = {
  [tree.root]: { QhQs: [0, 1, 0] },
  [afterHalfPot]: { AcAs: [0, .2, .8], '5c4d': [1, 0, 0] }
};
function transfer(toSpot) {
  const toTree = buildTree(toSpot);
  return { toTree, ...remapLocks({ locks, fromSpot: spot, fromTree: tree, toSpot, toTree }) };
}

test('locks follow betting histories across renumbering and lose only excluded combos', () => {
  const result = transfer({
    ...spot, seats: [spot.seats[0], { ...spot.seats[1], bets: [] }],
    ranges: [spot.ranges[0], parseRange('5c4d:0.5')]
  });
  const newId = result.toTree.nodes['0'].actions.find(a => a.label === 'Bet 5 bb').to;
  assert.notEqual(newId, afterHalfPot);
  assert.deepEqual(result.locks, { '0': locks['0'], [newId]: { '5c4d': [1, 0, 0] } });
  assert.equal(result.removed, 1);
  assert.notEqual(result.locks[newId]['5c4d'], locks[afterHalfPot]['5c4d']);
});

test('locks expire when the action line, action mix dimensions, or river spot change', () => {
  for (const edit of [
    { seats: [{ ...spot.seats[0], bets: [60, 100] }, spot.seats[1]] },
    { stack: 20 }, { pot: 12 }, { board: '2c 3d 7h 9s Jd' }
  ]) {
    const { locks: mapped, removed } = transfer({ ...spot, ...edit });
    assert.deepEqual(mapped, {});
    assert.equal(removed, 3);
  }
  const { locks: mapped, removed } = transfer({ ...spot, raiseCap: 0 });
  assert.deepEqual(mapped, { '0': locks['0'] });
  assert.equal(removed, 2);
});
