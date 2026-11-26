import test from 'node:test';
import assert from 'node:assert/strict';
import { expandRange, parseBoard, parseRange, rankHand } from '../engine/cards.js';
import { buildTree } from '../engine/tree.js';
import { createSolver } from '../engine/solver.js';

const defaultSeat = { bets: [], raises: [], allIn: false };
function spot(overrides = {}) {
  return {
    board: '2c 3d 7h 9s Jc',
    pot: 2, stack: 4, raiseCap: 0,
    ranges: [parseRange('QhQd'), parseRange('AcAs,5c4d')],
    seats: [defaultSeat, { ...defaultSeat, bets: [50] }],
    ...overrides,
  };
}
function nodeAfter(tree, ...kinds) {
  let node = tree.nodes[tree.root];
  for (const kind of kinds) {
    const action = node.actions.find(a => a.kind === kind);
    assert.ok(action, 'Missing ' + kind);
    node = tree.nodes[action.to];
  }
  return node;
}
function close(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) < tolerance, actual + ' differs from ' + expected);
}

test('converges to the analytical half-pot river bluffing equilibrium', () => {
  const game = spot();
  const tree = buildTree(game);
  const solver = createSolver(game);
  for (let i = 0; i < 1500; i++) solver.iterate();
  const metrics = solver.evaluate();
  assert.ok(metrics.exploitabilityPct < 0.1);
  const ip = nodeAfter(tree, 'check');
  const bets = ip.actions.findIndex(action => action.kind === 'bet');
  const ipHands = solver.inspect(ip.id).combos;
  close(ipHands.find(hand => hand.handClass === 'AA').frequency[bets], 1, .02);
  close(ipHands.find(hand => hand.handClass === '54o').frequency[bets], 1 / 3, .02);
  const facedBet = nodeAfter(tree, 'check', 'bet');
  const decision = solver.inspect(facedBet.id);
  const call = facedBet.actions.findIndex(a => a.kind === 'call');
  close(decision.combos[0].frequency[call], 2 / 3, .02);
  close(decision.actions[call].ev, 0, .02);
  close(decision.reachProbability, 2 / 3, .02);
  close(solver.inspect(tree.root).actions[0].ev, 2 / 3, .02);
});

test('checkdown hand weights and chip EV agree with explicit compatible deal enumeration', () => {
  const game = spot({
    ranges: [parseRange('AcAs,AcKh:0.3,QsQd:0.6,4s5s:0.1'), parseRange('AcKh:0.25,AsKs:0.8,AcAs,QdQh,4s6s:0.7')],
    seats: [defaultSeat, defaultSeat],
  });
  const board = parseBoard(game.board);
  const [hero, villain] = game.ranges.map(range => expandRange(range, board));
  let total = 0;
  const rows = hero.map(hand => {
    let mass = 0;
    let chips = 0;
    for (const other of villain) {
      if (hand.cards.some(c => other.cards.includes(c))) continue;
      const weight = hand.weight * other.weight;
      const sign = Math.sign(rankHand([...board, ...hand.cards]) - rankHand([...board, ...other.cards]));
      mass += weight;
      chips += weight * (sign + 1) * game.pot / 2;
    }
    total += mass;
    return { key: hand.key, mass, chips };
  });
  const solver = createSolver(game);
  solver.iterate();
  close(solver.evaluate().exploitabilityPct, 0);
  const root = solver.inspect(buildTree(game).root);
  for (const expected of rows) {
    const combo = root.combos.find(hand => hand.key === expected.key);
    close(combo.weight, expected.mass / total);
    close(combo.ev[0], expected.chips / expected.mass);
  }
  close(root.actions[0].ev, rows.reduce((n, row) => n + row.chips, 0) / total);
});

test('folding to a raise costs zero additional chips and calling returns only future winnings', () => {
  const game = spot({
    ranges: [parseRange('AcAs'), parseRange('QhQd')], raiseCap: 1,
    seats: [{ ...defaultSeat, bets: [50] }, { ...defaultSeat, raises: [3] }],
  });
  const tree = buildTree(game);
  const solver = createSolver(game);
  const decision = nodeAfter(tree, 'bet', 'raise');
  const info = solver.inspect(decision.id);
  const ev = Object.fromEntries(decision.actions.map((a, i) => [a.kind, info.actions[i].ev]));
  close(ev.fold, 0);
  // OOP already put in one. Winning a pot of eight after calling two nets six.
  close(ev.call, 6);
  const foldLeaf = solver.inspect(nodeAfter(tree, 'bet', 'raise', 'fold').id);
  assert.equal(foldLeaf.actor, null);
  assert.equal(foldLeaf.reachable, true);
  assert.deepEqual(foldLeaf.combos, []);
  close(foldLeaf.reachProbability, 1 / 12);
});

test('marks impossible holdings and rejects empty joint deals', () => {
  const game = spot({ ranges: [parseRange('AcAs,KsKh'), parseRange('AcAd')] });
  const result = createSolver(game).inspect('0');
  const blocked = result.combos.find(hand => hand.handClass === 'AA');
  close(blocked.weight, 0);
  assert.deepEqual(blocked.ev, [null]);
  assert.throws(() => createSolver(spot({ ranges: [parseRange('AcAs'), parseRange('AcAd')] })), /compatible deal/);
  assert.throws(() => createSolver(spot({ board: '2c 2c 7h 9s Jc' })), /unique/);
});

test('tiny compatible opponent weights retain their full conditional EV', () => {
  const game = spot({
    ranges: [parseRange('AcKh'), { ...parseRange('AcAs'), ...parseRange('QdQh:0.000000000000000001') }],
    seats: [defaultSeat, { ...defaultSeat, bets: [50] }],
  });
  const tree = buildTree(game);
  const solver = createSolver(game);
  const decision = nodeAfter(tree, 'check', 'bet');
  const info = solver.inspect(decision.id);
  const ev = Object.fromEntries(decision.actions.map((a, i) => [a.kind, info.actions[i].ev]));
  close(ev.call, -1);
  close(ev.fold, 0);
  close(info.reachProbability, .5);
  const root = solver.inspect(tree.root);
  // With uniform downstream strategies, checks and folds return zero and
  // calling a bet loses one chip on one quarter of deals.
  close(root.actions[0].ev, -.25);
});

test('worker reports stop, target and limit; retains evaluated results and ignores stale requests', async () => {
  // Exercise the worker protocol while controlling when browser messages arrive.
  const messages = [];
  globalThis.self = { postMessage(message) { messages.push(message); } };
  try {
    await import('../worker.js');
    const send = data => self.onmessage({ data });
    send({ type: 'start', runId: 1, spot: spot(), target: 0, maxIterations: 10000000 });
    send({ type: 'stop', runId: 1 });
    assert.equal(messages.at(-1).reason, 'stopped');
    send({ type: 'inspect', runId: 1, nodeId: '0', requestId: 9 });
    assert.equal(messages.at(-1).type, 'inspection');
    assert.equal(messages.at(-1).requestId, 9);
    close(messages.at(-1).result.reachProbability, 1);

    send({ type: 'start', runId: 2, spot: spot(), target: 0, maxIterations: 1 });
    assert.equal(messages.at(-1).reason, 'limit');
    assert.equal(messages.at(-1).iterations, 1);
    const length = messages.length;
    send({ type: 'inspect', runId: 1, nodeId: '0' });
    assert.equal(messages.length, length);

    send({ type: 'start', runId: 3, spot: spot({ seats: [defaultSeat, defaultSeat] }) });
    assert.equal(messages.at(-1).reason, 'target');
    close(messages.at(-1).exploitabilityPct, 0);
  } finally {
    delete globalThis.self;
  }
});
