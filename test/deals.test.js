import test from 'node:test';
import assert from 'node:assert/strict';
import { expandRange, parseBoard, parseRange, rankHand } from '../engine/cards.js';
import { buildTree } from '../engine/tree.js';
import { createSolver } from '../engine/solver.js';

// Independent small-game oracle: enumerate private deals and pure responses.
// A pure response can depend on one's own cards and observed bets only.
test('reported exploitability matches exhaustive best responses with weighted blockers', () => {
  const spot = {
    board: '2c 3d 7h 9s Jc',
    pot: 4, stack: 8, raiseCap: 1,
    ranges: [parseRange('AsJh,QsQd:0.4,5s4s:0.7'), parseRange('AcAs:0.7,JsJh,5d4d:0.2')],
    seats: Array.from({ length: 2 }, () => ({ bets: [50], raises: [2], allIn: false }))
  };
  const board = parseBoard(spot.board);
  const ranges = spot.ranges.map(weights => expandRange(weights, board));
  const tree = buildTree(spot);
  const solver = createSolver(spot);
  for (let i = 0; i < 7; i++) solver.iterate();
  const report = solver.evaluate();
  const strategy = new Map();
  for (const node of Object.values(tree.nodes)) {
    if (node.terminal) continue;
    const inspection = solver.inspect(node.id);
    strategy.set(node.id, new Map(inspection.combos.map(combo => [combo.key, combo.frequency])));
  }
  const deals = [];
  for (const oop of ranges[0]) {
    for (const ip of ranges[1]) {
      if (oop.cards.some(card => ip.cards.includes(card))) continue;
      deals.push({
        hands: [oop, ip],
        ranks: [oop, ip].map(hand => rankHand([...board, ...hand.cards])),
        mass: oop.weight * ip.weight
      });
    }
  }
  const total = deals.reduce((sum, deal) => sum + deal.mass, 0);

  function bestResponse(player) {
    const decisions = Object.values(tree.nodes).filter(node => node.actor === player);
    const choices = new Map();
    function value(id, deal) {
      const node = tree.nodes[id];
      if (node.terminal) {
        const diff = deal.ranks[player] - deal.ranks[1 - player];
        const share = node.terminal === 'fold' ? Number(node.winner === player)
          : diff === 0 ? 0.5 : Number(diff > 0);
        return share * (spot.pot + node.committed[0] + node.committed[1]) - node.committed[player];
      }
      if (node.actor === player) return value(node.actions[choices.get(id)].to, deal);
      const frequencies = strategy.get(id).get(deal.hands[node.actor].key);
      return node.actions.reduce((ev, action, i) => ev + frequencies[i] * value(action.to, deal), 0);
    }
    function search(index, possibleDeals) {
      if (index === decisions.length) {
        return possibleDeals.reduce((ev, deal) => ev + deal.mass * value(tree.root, deal), 0);
      }
      const node = decisions[index];
      return Math.max(...node.actions.map((_, i) => {
        choices.set(node.id, i);
        return search(index + 1, possibleDeals);
      }));
    }
    return ranges[player].reduce((ev, hand) =>
      ev + search(0, deals.filter(deal => deal.hands[player].key === hand.key)), 0) / total;
  }

  const gain = bestResponse(0) + bestResponse(1) - spot.pot;
  const expected = 100 * gain / (2 * spot.pot);
  assert.ok(Math.abs(report.exploitabilityPct - expected) < 1e-8,
    `solver reported ${report.exploitabilityPct}% vs exhaustive ${expected}%`);
});
