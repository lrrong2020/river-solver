import { expandRange, parseBoard, rankHand } from './cards.js';
import { buildTree } from './tree.js';

// A row is the same private hand for both players. A zero weight excludes that
// hand from a seat's range. Sorting once lets every showdown sweep whole ranks.
function prepareHands(spot) {
  const board = parseBoard(spot.board);
  const ranges = spot.ranges.map(range => expandRange(range, board).filter(hand => hand.weight > 0));
  if (ranges.some(range => !range.length)) {
    throw new Error('Both players need a nonempty range after board removal.');
  }
  const unique = new Map();
  for (const range of ranges) {
    for (const hand of range) {
      if (!unique.has(hand.key)) {
        unique.set(hand.key, { ...hand, rank: rankHand([...board, ...hand.cards]) });
      }
    }
  }
  const hands = Array.from(unique.values()).sort((a, b) => a.rank - b.rank);
  const rowByKey = new Map(hands.map((hand, row) => [hand.key, row]));
  const weights = ranges.map(range => {
    const result = new Float64Array(hands.length);
    const sum = range.reduce((total, hand) => total + hand.weight, 0);
    for (const hand of range) result[rowByKey.get(hand.key)] = hand.weight / sum;
    return result;
  });
  return { hands, weights, rowByKey };
}

function createPayouts(hands, pot) {
  const count = hands.length;
  const first = Uint8Array.from(hands, hand => hand.cards[0]);
  const second = Uint8Array.from(hands, hand => hand.cards[1]);
  const ends = [];
  for (let i = 0; i < count; i++) {
    if (i + 1 === count || hands[i].rank !== hands[i + 1].rank) ends.push(i + 1);
  }
  const totals = new Float64Array(52);
  const weaker = new Float64Array(52);
  const positiveRows = new Uint16Array(count);
  let positiveCount = 0;

  function totalMass(reach) {
    totals.fill(0);
    positiveCount = 0;
    let total = 0;
    for (let i = 0; i < count; i++) {
      const w = reach[i];
      if (w > 0) positiveRows[positiveCount++] = i;
      total += w;
      totals[first[i]] += w;
      totals[second[i]] += w;
    }
    return total;
  }

  // Cancellation can hide a very small compatible tail. Sum it directly;
  // only nonzero opponent holdings are candidates on these sparse branches.
  function exactMass(i, reach, showdown) {
    let total = 0;
    for (let k = 0; k < positiveCount; k++) {
      const j = positiveRows[k];
      if (first[j] === first[i] || first[j] === second[i] ||
          second[j] === first[i] || second[j] === second[i]) continue;
      total += showdown ? reach[j] * Math.sign(hands[i].rank - hands[j].rank) : reach[j];
    }
    return total;
  }

  function compatibleMass(i, reach, total) {
    const mass = total - totals[first[i]] - totals[second[i]] + reach[i];
    return total > 0 && mass <= total * 1e-9 ? exactMass(i, reach, false) : mass;
  }

  function compatible(reach, out) {
    const total = totalMass(reach);
    for (let i = 0; i < count; i++) {
      out[i] = compatibleMass(i, reach, total);
    }
  }

  function terminal(node, player, reach, out) {
    if (node.terminal === 'fold') {
      // Each seat owns half the starting pot in centered (zero-sum) units.
      // Only the folder's investment changes hands; return the unmatched raise.
      const folder = 1 - node.winner;
      const value = (pot / 2 + node.committed[folder]) * (node.winner === player ? 1 : -1);
      const total = totalMass(reach);
      for (let i = 0; i < count; i++) {
        out[i] = value * compatibleMass(i, reach, total);
      }
      return;
    }
    const value = pot / 2 + Math.min(...node.committed);
    const total = totalMass(reach);
    weaker.fill(0);
    let weakMass = 0;
    let start = 0;
    for (const end of ends) {
      for (let i = start; i < end; i++) {
        out[i] = weakMass - weaker[first[i]] - weaker[second[i]];
      }
      for (let i = start; i < end; i++) {
        weakMass += reach[i];
        weaker[first[i]] += reach[i];
        weaker[second[i]] += reach[i];
      }
      for (let i = start; i < end; i++) {
        // Strictly stronger/weaker hands can never be the identical combo.
        const strong = (total - weakMass) - (totals[first[i]] - weaker[first[i]])
          - (totals[second[i]] - weaker[second[i]]);
        const mass = total - totals[first[i]] - totals[second[i]] + reach[i];
        const signedMass = total > 0 && mass <= total * 1e-9
          ? exactMass(i, reach, true) : out[i] - strong;
        out[i] = value * signedMass;
      }
      start = end;
    }
  }
  return { compatible, terminal };
}

function dot(a, b) {
  let value = 0;
  for (let i = 0; i < a.length; i++) value += a[i] * b[i];
  return value;
}

function lockEntries(value, label) {
  if (!value || typeof value !== 'object' ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error(label + ' must be a map.');
  }
  return Object.entries(value);
}

function applyNodeLocks(locks, states, weights, rowByKey) {
  for (const [id, combos] of lockEntries(locks, 'Node locks')) {
    const state = states.get(id);
    if (!state || state.node.terminal) throw new Error('Node lock requires a decision node. Invalid node ' + id + '.');
    const { actor, actions } = state.node;
    for (const [key, frequencies] of lockEntries(combos, 'Combos locked at node ' + id)) {
      const row = rowByKey.get(key);
      if (row === undefined || !weights[actor][row]) {
        throw new Error('Cannot lock ' + key + ' at node ' + id + '. The combo is outside the acting range.');
      }
      if (!Array.isArray(frequencies) || frequencies.length !== actions.length) {
        throw new Error('Lock for ' + key + ' requires one frequency per legal action.');
      }
      let sum = 0;
      for (const f of frequencies) {
        if (!Number.isFinite(f) || f < 0 || f > 1) {
          throw new Error('Lock frequencies for ' + key + ' must be numbers from 0 to 1.');
        }
        sum += f;
      }
      if (Math.abs(1 - sum) > 1e-9) throw new Error('Lock frequencies for ' + key + ' must sum to 1.');

      state.locked ??= new Uint8Array(rowByKey.size);
      state.locked[row] = 1;
      for (let a = 0; a < actions.length; a++) {
        state.current[a][row] = state.average[a][row] = frequencies[a] / sum;
      }
    }
  }
}

export function createSolver(spot) {
  const { root, nodes } = buildTree(spot);
  const { hands, weights, rowByKey } = prepareHands(spot);
  const pot = spot.pot;
  const count = hands.length;
  const payouts = createPayouts(hands, pot);
  const vector = () => new Float64Array(count);
  const temp = vector();
  payouts.compatible(weights[1], temp);
  const dealMass = dot(weights[0], temp);
  if (!(dealMass > 0)) throw new Error('The two ranges have no compatible deal on this board.');

  // Each node stores four action tables. Reject excessive trees before the
  // browser allocates the tables, leaving the editor available for a smaller tree.
  const edges = Object.values(nodes).reduce((n, node) => n + node.actions.length, 0);
  if (edges * count * 4 * Float64Array.BYTES_PER_ELEMENT > 192 * 1024 * 1024) {
    throw new Error('This tree is too large to solve locally. Reduce the sizes, raise cap, or range width.');
  }

  const states = new Map();
  const parents = new Map();
  const frames = [];
  function prepare(id, depth) {
    const node = nodes[id];
    const state = { node, children: [] };
    states.set(id, state);
    if (!node.terminal) {
      const n = node.actions.length;
      const tables = () => Array.from({ length: n }, vector);
      state.regrets = tables();
      state.sums = tables();
      state.current = tables();
      state.average = tables();
      for (const policy of [state.current, state.average]) {
        for (const row of policy) row.fill(1 / n);
      }
      frames[depth] ??= { nextReach: vector(), values: [] };
      while (frames[depth].values.length < n) frames[depth].values.push(vector());
      state.children = node.actions.map((action, index) => {
        parents.set(action.to, { parent: state, action: index });
        return prepare(action.to, depth + 1);
      });
    }
    return state;
  }
  const rootState = prepare(root, 0);
  if (spot.locks !== undefined) applyNodeLocks(spot.locks, states, weights, rowByKey);
  let iterations = 0;
  let evaluated = null;

  function normalize(source, target, locked) {
    const n = source.length;
    for (let i = 0; i < count; i++) {
      if (locked?.[i]) continue;
      let sum = 0;
      for (let a = 0; a < n; a++) sum += source[a][i];
      for (let a = 0; a < n; a++) target[a][i] = sum > 0 ? source[a][i] / sum : 1 / n;
    }
  }

  // Vector values exclude own reach and include opponent reach. This is what
  // lets a player compare deviations even after an action they never take.
  function traverse(state, player, own, opponent, out, depth, mode) {
    const { node, children } = state;
    if (node.terminal) {
      payouts.terminal(node, player, opponent, out);
      return;
    }
    const { nextReach, values } = frames[depth];
    const n = children.length;
    const policy = mode === 'train' ? state.current : state.average;
    const acting = node.actor === player;
    for (let a = 0; a < n; a++) {
      const prob = policy[a];
      let nextOwn = own;
      let nextOpponent = opponent;
      if (acting && mode === 'train') {
        const sums = state.sums[a];
        for (let i = 0; i < count; i++) {
          nextReach[i] = own[i] * prob[i];
          if (!state.locked?.[i]) sums[i] += iterations * nextReach[i];
        }
        nextOwn = nextReach;
      } else if (!acting) {
        for (let i = 0; i < count; i++) nextReach[i] = opponent[i] * prob[i];
        nextOpponent = nextReach;
      }
      traverse(children[a], player, nextOwn, nextOpponent, values[a], depth + 1, mode);
    }
    if (acting && mode === 'best') {
      out.set(values[0]);
      for (let a = 1; a < n; a++) {
        for (let i = 0; i < count; i++) out[i] = Math.max(out[i], values[a][i]);
      }
      // A best response can choose freely only at unlocked information sets.
      // A locked mixed action still branches with its prescribed probabilities.
      if (state.locked) {
        for (let i = 0; i < count; i++) {
          if (!state.locked[i]) continue;
          let value = 0;
          for (let a = 0; a < n; a++) value += policy[a][i] * values[a][i];
          out[i] = value;
        }
      }
      return;
    }
    out.fill(0);
    for (let a = 0; a < n; a++) {
      const v = values[a];
      if (acting) {
        for (let i = 0; i < count; i++) out[i] += policy[a][i] * v[i];
      } else {
        for (let i = 0; i < count; i++) out[i] += v[i];
      }
    }
    if (acting && mode === 'train') {
      for (let a = 0; a < n; a++) {
        const regrets = state.regrets[a];
        for (let i = 0; i < count; i++) {
          if (!state.locked?.[i]) regrets[i] = Math.max(0, regrets[i] + values[a][i] - out[i]);
        }
      }
      normalize(state.regrets, state.current, state.locked);
    }
  }

  function iterate() {
    iterations++;
    for (let p = 0; p < 2; p++) {
      traverse(rootState, p, weights[p], weights[1 - p], temp, 0, 'train');
    }
  }

  function evaluate() {
    if (evaluated?.iterations === iterations) return evaluated;
    for (const state of states.values()) {
      if (!state.node.terminal) normalize(state.sums, state.average, state.locked);
    }
    let bestResponseSum = 0;
    for (let p = 0; p < 2; p++) {
      traverse(rootState, p, weights[p], weights[1 - p], temp, 0, 'best');
      bestResponseSum += dot(weights[p], temp) / dealMass;
    }
    evaluated = {
      iterations,
      exploitabilityPct: 100 * Math.max(0, bestResponseSum) / (2 * pot),
    };
    return evaluated;
  }

  function inspect(id) {
    const state = states.get(id);
    if (!state) throw new Error('Unknown tree node.');
    const path = [];
    for (let parent = parents.get(id); parent; parent = parents.get(parent.parent.node.id)) {
      path.push(parent);
    }
    const reaches = weights.map(w => w.slice());
    for (const { parent, action } of path.reverse()) {
      const reach = reaches[parent.node.actor];
      const prob = parent.average[action];
      for (let i = 0; i < count; i++) reach[i] *= prob[i];
    }
    const { node } = state;
    const p = node.actor ?? 0;
    const oppMass = vector();
    payouts.compatible(reaches[1 - p], oppMass);
    const mass = dot(reaches[p], oppMass);
    const result = {
      actor: node.actor, reachable: mass > 0, reachProbability: mass / dealMass,
      actions: [], combos: [],
    };
    if (node.terminal) return result;
    const values = state.children.map(child => {
      const out = vector();
      traverse(child, p, reaches[p], reaches[1 - p], out, path.length + 1, 'average');
      return out;
    });
    const offset = pot / 2 + node.committed[p];
    result.actions = node.actions.map(action => ({
      label: action.label, frequency: mass ? 0 : null, ev: mass ? 0 : null,
    }));
    for (let i = 0; i < count; i++) {
      if (!weights[p][i]) continue;
      const { cards, key, handClass } = hands[i];
      const weight = mass ? reaches[p][i] * oppMass[i] / mass : 0;
      const frequency = state.average.map(probs => probs[i]);
      const ev = values.map(v => weight ? offset + v[i] / oppMass[i] : null);
      result.combos.push({ cards, key, handClass, weight, frequency, ev });
      if (weight) {
        for (let a = 0; a < result.actions.length; a++) {
          result.actions[a].frequency += weight * frequency[a];
          result.actions[a].ev += weight * ev[a];
        }
      }
    }
    return result;
  }
  return { iterate, evaluate, inspect, get iterations() { return iterations; } };
}
