// Work in hundredths of a big blind to ensure equivalent wagers share a branch.
const UNIT = 100;
const MAX_NODES = 4096;

function chips(amount, label) {
  const value = Math.round(amount * UNIT);
  if (!Number.isFinite(amount) || value <= 0 || !Number.isSafeInteger(value) ||
      Math.abs(amount * UNIT - value) > 1e-7) {
    throw new Error(label + ' must be positive, with at most two decimal places.');
  }
  return value;
}

function validateSizes(list, raises) {
  const lower = raises ? 1 : 0;
  if (!Array.isArray(list) || list.some(size => !Number.isFinite(size) || size <= lower)) {
    throw new Error(raises ? 'Raise multiples must be greater than 1.' : 'Bet percentages must be positive.');
  }
}

export function buildTree({ pot, stack, raiseCap, seats }) {
  const initialPot = chips(pot, 'Starting pot');
  const effective = chips(stack, 'Effective stack');
  if (!Number.isSafeInteger(raiseCap) || raiseCap < 0) throw new Error('Raise cap must be a nonnegative integer.');
  if (!Array.isArray(seats) || seats.length !== 2) throw new Error('Provide sizing settings for both players.');
  for (const seat of seats) {
    validateSizes(seat.bets, false);
    validateSizes(seat.raises, true);
  }

  const nodes = {};
  let count = 0;

  function create(actor, committed, terminal = null, winner = null) {
    if (count >= MAX_NODES) throw new Error('Betting tree exceeds 4,096 nodes. Reduce the sizes or raise cap.');
    const id = String(count++);
    nodes[id] = { id, actor, committed: committed.map(x => x / UNIT), actions: [], terminal, winner };
    return nodes[id];
  }

  function decision(actor, committed, checked, raises, lastIncrease) {
    if (raises > 100) throw new Error('Betting line exceeds 100 raises. Reduce the raise cap.');
    const node = create(actor, committed);
    const other = 1 - actor;
    const facing = committed[other] > committed[actor];
    const add = (kind, label, child) => node.actions.push({ kind, label, to: child.id });
    if (facing) {
      add('fold', 'Fold', create(null, committed, 'fold', other));
      add('call', 'Call', create(null, [committed[other], committed[other]], 'showdown'));
      // All-in callers have equal effective stacks, so no side pots or further raises.
      if (raises >= raiseCap || committed[other] === effective) return node;
    } else {
      add('check', 'Check', checked ? create(null, committed, 'showdown') :
        decision(other, committed, true, raises, lastIncrease));
    }

    const seat = seats[actor];
    const totals = new Set();
    const minimum = facing ? committed[other] + lastIncrease : UNIT;
    for (const size of facing ? seat.raises : seat.bets) {
      const target = facing ? committed[other] * size : initialPot * size / 100;
      totals.add(Math.min(effective, Math.max(minimum, Math.round(target))));
    }
    if (seat.allIn) totals.add(effective);
    for (const total of [...totals].sort((a, b) => a - b)) {
      const updated = committed.slice();
      updated[actor] = total;
      const label = (facing ? 'Raise to ' : 'Bet ') + total / UNIT + ' bb' + (total === effective ? ' (all-in)' : '');
      const child = decision(other, updated, false, raises + Number(facing), total - committed[other]);
      add(facing ? 'raise' : 'bet', label, child);
    }
    return node;
  }
  const root = decision(0, [0, 0], false, 0, UNIT);
  return { root: root.id, nodes };
}
