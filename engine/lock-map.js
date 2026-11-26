import { expandRange, parseBoard } from './cards.js';

// Node IDs are local to one tree. Match the betting line and menu before
// transferring a strategy whose probabilities are indexed by action position.
export function remapLocks({ locks, fromSpot, fromTree, toSpot, toTree }) {
  const result = {
    locks: {},
    removed: Object.values(locks).reduce((sum, rows) => sum + Object.keys(rows).length, 0)
  };
  if (!result.removed || fromSpot.pot !== toSpot.pot || fromSpot.stack !== toSpot.stack) return result;
  const board = parseBoard(toSpot.board);
  if (!parseBoard(fromSpot.board).every(card => board.includes(card))) return result;
  const available = toSpot.ranges.map(range => new Set(expandRange(range, board).map(hand => hand.key)));

  function visit(oldNode, newNode) {
    if (oldNode.terminal || newNode.terminal || oldNode.actor !== newNode.actor) return;
    const rows = locks[oldNode.id];
    if (rows && oldNode.actions.length === newNode.actions.length &&
        oldNode.actions.every((action, i) => action.label === newNode.actions[i].label)) {
      for (const [key, mix] of Object.entries(rows)) {
        if (available[newNode.actor].has(key)) {
          (result.locks[newNode.id] ??= {})[key] = [...mix];
          result.removed--;
        }
      }
    }
    const children = new Map(newNode.actions.map(action => [action.label, action.to]));
    for (const action of oldNode.actions) {
      const to = children.get(action.label);
      if (to !== undefined) visit(fromTree.nodes[action.to], toTree.nodes[to]);
    }
  }
  visit(fromTree.nodes[fromTree.root], toTree.nodes[toTree.root]);
  return result;
}
