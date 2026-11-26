import { classAt, combosForClass, expandRange, formatCard, parseBoard, parseRange, serializeRange } from './engine/cards.js';
import { buildTree } from './engine/tree.js';
import { remapLocks } from './engine/lock-map.js';
import { openLockEditor } from './ui/lock-editor.js';
import { exampleSpot } from './example.js';

const $ = id => document.getElementById(id);
const role = ['Out of position', 'In position'];
const seatName = ['OOP', 'IP'];
const pips = {c:'♣',d:'♦',h:'♥',s:'♠'};
const suits = {c:'clubs',d:'diamonds',h:'hearts',s:'spades'};
const suitColor = {c:'green',d:'blue',h:'red',s:''};
const classes = Array.from({length:169}, (_,i) => classAt(Math.floor(i / 13), i % 13));
const spot = exampleSpot();
const sizing = spot.seats.map(s => ({bets:s.bets.join(', '), raises:s.raises.join(', '), allIn:s.allIn}));
let board = parseBoard(spot.board);
let rangeSeat = 0, treeSeat = 0, version = 0, nextRun = 0, nextRequest = 0;
let worker, run, lastBrush = 100, view = 'setup', previewPath;
let draftLocks = {}, locksPending = false;
const modal = $('modal');

function errorMessage(error) {
  $('error').textContent = error ? (error.message || String(error)) : '';
  $('error').hidden = !error;
}
function changed() {
  version++;
  errorMessage(null);
  refreshControls();
}
function dialog(title, html) {
  $('dialog-title').textContent = title;
  $('dialog-body').innerHTML = html;
  if (!modal.open) modal.showModal();
}
modal.querySelector('.close').onclick = () => modal.close();
modal.onclick = event => { if (event.target === modal && !event.target.matches(':hover')) modal.close(); };

function showView(name) {
  view = name;
  $('setup').hidden = name !== 'setup';
  $('results').hidden = name !== 'results';
  $('page-title').textContent = name === 'setup' ? 'River workspace' : 'Strategy explorer';
  for (const key of ['setup','results']) {
    $('nav-' + key).classList.toggle('active', key === name);
    $('nav-' + key).setAttribute('aria-pressed', String(key === name));
  }
  if (view === 'results') {
    renderResults();
    inspectNode();
  }
}
$('nav-setup').onclick = () => showView('setup');
$('nav-results').onclick = () => showView('results');

function renderBoard() {
  $('cards').innerHTML = board.map(id => {
    const [r,s] = formatCard(id);
    return '<span class="card ' + suitColor[s] + '" aria-label="' + r + ' of ' + suits[s] + '"><b>' +
      (r === 'T' ? '10' : r) + '</b><i>' + pips[s] + '</i></span>';
  }).join('');
}
$('edit-board').onclick = () => {
  dialog('Edit river board', '<form id="board-form" class="modal-body"><label class="field">Five board cards<input id="board-input" spellcheck="false" autocomplete="off" autofocus></label><p class="hint">Use rank and suit, for example Ks 9d 6s 2h 2c.</p><p class="form-error" role="alert"></p><div class="modal-actions"><button class="primary" type="submit">Apply board</button></div></form>');
  $('board-input').value = spot.board;
  $('board-form').onsubmit = event => {
    event.preventDefault();
    try {
      const newBoard = parseBoard($('board-input').value);
      const newText = newBoard.map(formatCard).join(' ');
      if (newText !== spot.board) {
        board = newBoard;
        spot.board = newText;
        renderBoard();
        renderRange();
        changed();
      }
      modal.close();
    } catch (error) { modal.querySelector('.form-error').textContent = error.message; }
  };
};

function seatSwitcher(id, current, select) {
  const box = $(id);
  box.innerHTML = '';
  seatName.forEach((name,index) => {
    const button = document.createElement('button');
    button.textContent = name;
    button.setAttribute('aria-label', role[index]);
    button.setAttribute('aria-pressed', String(current === index));
    button.classList.toggle('selected', current === index);
    button.onclick = () => {select(index); $(id).children[index].focus();};
    box.append(button);
  });
}

function available(handClass) {
  return combosForClass(handClass).filter(c => !board.includes(c.cards[0]) && !board.includes(c.cards[1]));
}
function renderRangeCell(button) {
  const handClass = button.dataset.hand;
  const members = available(handClass);
  const weights = members.map(c => spot.ranges[rangeSeat][c.key] || 0);
  const mean = weights.reduce((a,b) => a+b,0)/(weights.length || 1);
  const mixed = weights.some(v => v !== weights[0]);
  button.className = 'cell ' + (handClass.length === 2 ? 'pair' : handClass.endsWith('s') ? 'suited' : 'offsuit') +
    (mean ? '' : ' empty') + (mixed ? ' mixed' : '');
  button.style.background = mean ? 'hsl(99 27% ' + (27 + mean * 38) + '%)' : '';
  button.style.color = mean ? (mean > .5 ? '#152116' : '#f4fbef') : '';
  button.disabled = !weights.length;
  const info = handClass + ' · ' + Math.round(mean * 100) + '% average' + (mixed ? ' · mixed weights' : '') +
    ' · ' + weights.filter(Boolean).length + ' of ' + weights.length + ' combos';
  button.title = info;
  button.setAttribute('aria-label', info);
}
function rangeCount() {
  const count = expandRange(spot.ranges[rangeSeat],board).length;
  $('range-count').textContent = count + ' combo' + (count === 1 ? '' : 's');
}
function renderRange() {
  seatSwitcher('range-seats', rangeSeat, index => {rangeSeat = index; renderRange();});
  $('range-role').textContent = role[rangeSeat];
  for (const button of $('matrix').children) renderRangeCell(button);
  rangeCount();
}
function paint(button) {
  if (!button || button.disabled) return;
  const weight = $('brush-weight').valueAsNumber / 100;
  if (!(weight >= 0 && weight <= 1)) {
    errorMessage(new Error('Brush weight must be between 0% and 100%.'));
    return;
  }
  const range = spot.ranges[rangeSeat];
  let dirty = false;
  for (const {key} of available(button.dataset.hand)) {
    if ((range[key] || 0) === weight) continue;
    if (weight) range[key] = weight;
    else delete range[key];
    dirty = true;
  }
  if (dirty) {renderRangeCell(button); rangeCount(); changed();}
}
for (const handClass of classes) {
  const button = document.createElement('button');
  button.textContent = handClass;
  button.dataset.hand = handClass;
  $('matrix').append(button);
}
let painting = null;
$('matrix').onpointerdown = event => {
  if (event.button !== 0) return;
  const cell = event.target.closest('.cell');
  if (!cell) return;
  event.preventDefault();
  painting = event.pointerId;
  $('matrix').setPointerCapture(painting);
  paint(cell);
};
$('matrix').onpointermove = event => {
  if (painting !== event.pointerId) return;
  const cell = document.elementFromPoint(event.clientX,event.clientY)?.closest('#matrix .cell');
  paint(cell);
};
$('matrix').onlostpointercapture = () => {painting = null;};
$('matrix').onclick = event => {if (event.detail === 0) paint(event.target.closest('.cell'));};
$('brush-weight').oninput = () => {
  const weight = $('brush-weight').valueAsNumber;
  if (weight > 0 && weight <= 100) lastBrush = weight;
  $('erase').setAttribute('aria-pressed', String(weight === 0));
};
$('erase').onclick = () => {
  $('brush-weight').value = $('brush-weight').valueAsNumber === 0 ? lastBrush : 0;
  $('brush-weight').oninput();
};
$('paste').onclick = () => {
  dialog('Edit ' + seatName[rangeSeat] + ' range', '<form class="modal-body" id="range-form"><label class="field">Range notation<textarea id="range-text" rows="5" spellcheck="false" autofocus></textarea></label><p class="hint">Use classes, intervals or exact combos. Append a weight from 0 to 1. Later entries override earlier ones, e.g. AA, 99-JJ, AKs, AhKh:0.5.</p><p class="form-error" role="alert"></p><div class="modal-actions"><button type="button" id="merge-range" class="quiet">Merge with current</button><button class="primary" type="submit">Apply range</button></div></form>');
  $('range-text').value = serializeRange(spot.ranges[rangeSeat]);
  const apply = merge => {
    try {
      const updated = parseRange($('range-text').value,merge ? spot.ranges[rangeSeat] : {});
      spot.ranges[rangeSeat] = updated;
      renderRange(); changed(); modal.close();
    } catch (error) { modal.querySelector('.form-error').textContent = error.message; }
  };
  $('range-form').onsubmit = event => {event.preventDefault(); apply(false);};
  $('merge-range').onclick = () => apply(true);
};

function renderSizing() {
  seatSwitcher('tree-seats', treeSeat, index => {treeSeat = index; renderSizing();});
  for (const name of ['bets','raises']) $(name).value = sizing[treeSeat][name];
  $('all-in').checked = sizing[treeSeat].allIn;
}
for (const name of ['bets','raises']) $(name).oninput = () => {sizing[treeSeat][name] = $(name).value; changed();};
$('all-in').onchange = () => {sizing[treeSeat].allIn = $('all-in').checked; changed();};
for (const name of ['pot','stack','raise-cap']) $(name).oninput = changed;
for (const name of ['target','iterations']) $(name).oninput = () => errorMessage(null);
function sizes(text,label) {
  if (!text.trim()) return [];
  const tokens = text.trim().split(/[,\s]+/);
  if (tokens.some(t => !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(t))) throw new Error('Enter ' + label + ' as numbers separated by commas, or leave the field empty.');
  return tokens.map(Number);
}
function currentSpot() {
  return {...spot,
    pot:$('pot').valueAsNumber, stack:$('stack').valueAsNumber, raiseCap:$('raise-cap').valueAsNumber,
    ranges:spot.ranges.map(r => ({...r})),
    seats:sizing.map(s => ({bets:sizes(s.bets,'opening bets'),raises:sizes(s.raises,'raise multiples'),allIn:s.allIn}))
  };
}
function publicNode(tree,path) {return tree.nodes[path.at(-1).id];}
function pathHtml(path) {
  return '<div class="path" aria-label="Action history">' + path.map((item,i) =>
    (i ? '<span aria-hidden="true">›</span>' : '') + (i < path.length-1 ?
      '<button data-back="' + i + '">' + item.label + '</button>' :
      '<span class="current">' + item.label + '</span>')).join('') + '</div>';
}
function treeDetail(spot,node) {
  const pot = spot.pot + node.committed[0] + node.committed[1];
  if (node.terminal === 'fold') return seatName[node.winner] + ' wins by fold';
  return (node.terminal ? 'Showdown' : seatName[node.actor] + ' to act') + ' · ' + n(pot) + ' bb in pot';
}
function navigationHtml(tree,path,game) {
  const node = publicNode(tree,path);
  return '<div class="path-section">' + pathHtml(path) + '<h3>' + treeDetail(game,node) +
    '</h3><div class="branch-actions">' + node.actions.map((a,i) =>
    '<button class="quiet" data-forward="' + i + '">' + a.label + '</button>').join('') + '</div></div>';
}
function bindPath(el,tree,path,refresh) {
  el.querySelectorAll('[data-back]').forEach(btn => btn.onclick = () => {path.splice(Number(btn.dataset.back)+1);refresh();});
  el.querySelectorAll('[data-forward]').forEach(btn => btn.onclick = () => {
    const action = publicNode(tree,path).actions[Number(btn.dataset.forward)];
    path.push({id:action.to,label:action.label}); refresh();
  });
}
$('preview-tree').onclick = () => {
  try {
    const game = currentSpot(), tree = buildTree(game);
    errorMessage(null);
    previewPath = [{id:tree.root,label:'River start'}];
    const update = () => {
      dialog('Betting tree preview', '<div class="modal-body"><p class="hint">' + Object.keys(tree.nodes).length +
        ' nodes · ' + n(game.pot) + ' bb starting pot</p>' + navigationHtml(tree,previewPath,game) + '</div>');
      bindPath($('dialog-body'),tree,previewPath,update);
    };
    update();
  } catch (error) { errorMessage(error); }
};

function n(value) {return Number.isFinite(value) ? value.toLocaleString('en-US',{maximumFractionDigits:2}) : '—';}
function pct(value) {
  return Number.isFinite(value) ? ((value > 0 && value < .0001) ? '<0.01' : n(value*100)) + '%' : '—';
}
const reasons = {target:'Target reached',limit:'Iteration limit reached',stopped:'Stopped by user',error:'Solve failed'};
function refreshControls() {
  const active = run?.busy;
  $('run').innerHTML = active ? '<span aria-hidden="true">■</span> Stop solve' : '<span aria-hidden="true">▶</span> Run solve';
  $('run').disabled = Boolean(active && run.stopping);
  $('status').classList.toggle('busy',Boolean(active));
  $('status').textContent = active ? (run.stopping ? 'Stopping…' : 'Solving · ' + n(run.iterations) + ' iterations') :
    (run?.version !== undefined && run.version !== version ? 'Spot changed' :
      locksPending ? 'Lock changes pending' : reasons[run?.reason] || 'Ready to solve');
}
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
    worker.onmessage = onWorkerMessage;
    worker.onerror = event => {
      if (run) {run.busy = false; run.pending = null; run.reason = 'error';}
      worker.terminate(); worker = null;
      errorMessage(new Error(event.message || 'Solver worker failed to load.'));
      refreshControls(); if (view === 'results') renderResults();
    };
  }
  return worker;
}
$('run').onclick = () => {
  if (run?.busy) {
    worker.postMessage({type:'stop',runId:run.id});
    run.stopping = true; refreshControls(); return;
  }
  startSolve();
};
function startSolve() {
  try {
    const game = currentSpot(), tree = buildTree(game);
    const ranges = game.ranges.map(r => expandRange(r,board));
    if (!ranges.every(r => r.length)) throw new Error('Both players need at least one combo available on this board.');
    if (!ranges[0].some(a => ranges[1].some(b => b.cards.every(c => !a.cards.includes(c))))) throw new Error('These ranges contain no compatible deal.');
    const target = $('target').valueAsNumber, maxIterations = $('iterations').valueAsNumber;
    if (!Number.isFinite(target) || target < 0) throw new Error('Enter a nonnegative exploitability target.');
    if (!Number.isSafeInteger(maxIterations) || maxIterations < 1) throw new Error('Enter a positive integer iteration limit.');
    const mapped = run && Object.keys(draftLocks).length
      ? remapLocks({locks:draftLocks, fromSpot:run.game, fromTree:run.tree, toSpot:game, toTree:tree})
      : {locks:{}, removed:0};
    game.locks = mapped.locks;
    const sameSpot = run?.version === version;
    const path = sameSpot ? run.path.slice() : [{id:tree.root,label:'River start'}];
    const selection = sameSpot ? run.selection : null;
    const runner = getWorker();
    draftLocks = {...game.locks};
    locksPending = false;
    run = {id:++nextRun, version,game,tree,path,busy:true,removedLocks:mapped.removed,
      iterations:0,elapsedMs:0,target,maxIterations,selection,result:null,pending:null};
    errorMessage(null);
    runner.postMessage({type:'start',runId:run.id,spot:game,target,maxIterations});
    refreshControls(); showView('results');
  } catch (error) {errorMessage(error);}
}
function inspectNode() {
  if (!run || !worker || !run.iterations || run.reason === 'error') return;
  if (run.pending) {run.reinspect = true;return;}
  run.pending = ++nextRequest;
  worker.postMessage({type:'inspect',runId:run.id,nodeId:run.path.at(-1).id,requestId:run.pending});
}
function onWorkerMessage({data}) {
  if (!run || data.runId !== run.id) return;
  if (data.type === 'inspection') {
    if (data.requestId !== run.pending) return;
    run.pending = null;
    if (data.nodeId === run.path.at(-1).id) {
      run.result = data.result;
      if (view === 'results') renderInspection();
    }
    if (run.reinspect && view === 'results') {run.reinspect = false;inspectNode();}
    return;
  }
  if (data.type === 'error') {
    errorMessage(data.message);
    run.busy = false; run.pending = null; run.reason = 'error';
  } else {
    Object.assign(run,{iterations:data.iterations,elapsedMs:data.elapsedMs,exploitabilityPct:data.exploitabilityPct});
    if (data.type === 'done') {run.busy = false;run.reason = data.reason;}
  }
  refreshControls();
  if (view === 'results') {
    renderMetrics();
    if (data.type !== 'error') inspectNode();
    else renderInspection();
  }
}

function renderResults() {
  if (!run) {
    $('results').innerHTML = '<div class="panel empty-state"><h2>No strategy yet</h2><p class="empty-copy">Run the river spot to explore actions, frequencies, and hand values.</p><button class="quiet" id="back-setup">Edit spot</button></div>';
    $('back-setup').onclick = () => showView('setup');
    return;
  }
  const constrained = Object.keys(run.game.locks).length > 0;
  $('results').innerHTML = (run.version !== version ?
    '<div class="notice" role="status">These results belong to the previous spot. Run the edited spot to update them.</div>' : '') +
    (locksPending ? '<div class="notice lock-notice" role="status"><span>Lock changes are pending. The displayed strategy is from the last solve.</span><div class="branch-actions"><button class="text-btn" id="discard-locks">Discard changes</button><button class="quiet" id="resolve-locks">Re-solve</button></div></div>' : '') +
    (run.removedLocks ? '<div class="notice" role="status">' + run.removedLocks + ' combo lock' + (run.removedLocks === 1 ? ' was' : 's were') + ' removed after the spot changed.</div>' : '') +
    '<div class="metrics panel"><div class="metric"><span>' + (constrained ? 'Constrained exploitability' : 'Exploitability') + ' · % of pot</span><strong id="metric-exploit"></strong></div><div class="metric"><span>Iterations</span><strong id="metric-iter"></strong></div><div class="metric"><span>Elapsed time</span><strong id="metric-time"></strong></div></div>' +
    '<div class="result-layout"><aside class="side"><section class="panel"><div class="panel-header"><h2>Action history</h2></div><div id="node-nav" class="section-body"></div></section>' +
    '<section class="panel"><div class="panel-header"><h2>Range strategy</h2></div><div id="action-mix" class="section-body"></div><div id="lock-panel"></div></section></aside>' +
    '<section class="panel hand-panel"><div class="panel-header"><h2>Strategy by hand</h2><span class="muted result-seat" id="result-seat"></span></div><div id="strategy-panel"></div></section></div>';
  if ($('resolve-locks')) $('resolve-locks').onclick = startSolve;
  if ($('discard-locks')) $('discard-locks').onclick = () => saveLocks({...run.game.locks});
  renderMetrics();
  renderNav();
  renderInspection();
}
function renderMetrics() {
  if (!$('metric-iter')) return;
  $('metric-exploit').textContent = Number.isFinite(run.exploitabilityPct) ?
    ((run.exploitabilityPct > 0 && run.exploitabilityPct < .001) ? '<0.001%' :
    run.exploitabilityPct.toLocaleString('en-US',{maximumFractionDigits:3}) + '%') : '—';
  $('metric-exploit').title = (Object.keys(run.game.locks).length ? 'Average best-response gain with the node locks held fixed. ' :
    'Average best-response gain in this betting tree. ') + 'Target ' + run.target + '% of the starting pot.';
  $('metric-iter').textContent = n(run.iterations);
  $('metric-time').textContent = n(run.elapsedMs/1000) + ' s';
}
function renderNav() {
  const panel = $('node-nav');
  if (!panel) return;
  panel.innerHTML = '<p class="hint">' + run.game.board + ' · ' + n(run.game.stack) + ' bb effective</p>' +
    navigationHtml(run.tree,run.path,run.game);
  bindPath(panel,run.tree,run.path,() => {
    run.selection = null; run.result = null;
    renderNav(); renderInspection(); inspectNode();
  });
}
function actionColors(node) {
  const wagerCount = node.actions.filter(a => ['bet','raise'].includes(a.kind)).length;
  let k = 0;
  return node.actions.map(a => {
    if (a.kind === 'fold') return '#9db6d0';
    if (a.kind === 'check' || a.kind === 'call') return '#a9cd99';
    const phase = wagerCount > 1 ? k++/(wagerCount-1) : 0;
    return 'hsl(' + (39-32*phase) + ' 68% ' + (72-7*phase) + '%)';
  });
}
function dividedBackground(values,colors) {
  const only = values.findIndex(v => v > 0);
  if (only >= 0 && values.every((v,i) => i === only || !v)) return colors[only];
  let offset = 0;
  const stops = [];
  values.forEach((value,i) => {
    if (!value) return;
    const start = offset;
    offset += value * 100;
    stops.push(colors[i] + ' ' + start + '% ' + offset + '%');
  });
  return stops.length ? 'linear-gradient(to right,' + stops.join(',') + ')' : '';
}
function groupedCombos(result) {
  const data = new Map();
  for (const combo of result.combos) {
    if (!data.has(combo.handClass)) data.set(combo.handClass,{mass:0,combos:[],mix:result.actions.map(() => 0)});
    const group = data.get(combo.handClass);
    group.combos.push(combo);group.mass += combo.weight;
    combo.frequency.forEach((f,i) => group.mix[i] += f * combo.weight);
  }
  for (const group of data.values()) if (group.mass) group.mix = group.mix.map(v => v/group.mass);
  return data;
}

function sameLocks(left, right) {
  const ids = Object.keys(left);
  if (ids.length !== Object.keys(right).length) return false;
  return ids.every(id => {
    const original = right[id];
    if (!original) return false;
    const keys = Object.keys(left[id]);
    return keys.length === Object.keys(original).length && keys.every(key => {
      const a = left[id][key], b = original[key];
      return b && a.length === b.length && a.every((p,i) => p === b[i]);
    });
  });
}

function saveLocks(next, solve = false) {
  draftLocks = next;
  locksPending = !sameLocks(draftLocks, run.game.locks);
  modal.close();
  refreshControls();
  renderResults();
  if (solve) startSolve();
}

function showLockList() {
  dialog('All node locks', '<div class="modal-body"><div id="lock-list"></div>' +
    '<button class="quiet" id="clear-locks">Clear all locks</button></div>');
  function visit(id, path) {
    const node = run.tree.nodes[id];
    if (draftLocks[id]) {
      const count = Object.keys(draftLocks[id]).length;
      const button = document.createElement('button');
      button.className = 'quiet lock-list-item';
      button.textContent = path.map(step => step.label).join(' › ') + ' · ' + seatName[node.actor] +
        ' · ' + count + (count === 1 ? ' combo' : ' combos');
      button.onclick = () => {
        run.path = path;
        run.result = null;
        run.selection = null;
        modal.close();
        renderNav(); renderInspection(); inspectNode();
      };
      $('lock-list').append(button);
    }
    for (const action of node.actions) visit(action.to, [...path, {id:action.to, label:action.label}]);
  }
  visit(run.tree.root, [{id:run.tree.root, label:'River start'}]);
  $('clear-locks').onclick = () => saveLocks({});
}

function renderLockPanel(node) {
  const panel = $('lock-panel');
  const decisions = Object.keys(draftLocks).length;
  const rows = draftLocks[node.id] || {};
  const count = Object.keys(rows).length;
  const editable = !node.terminal && node.actions.length > 1;
  panel.hidden = !editable && !decisions;
  if (panel.hidden) return;
  const current = run.version === version;
  panel.innerHTML = '<div class="lock-tools">' +
    (editable ? '<button class="quiet" id="edit-lock">' + (count ? 'Edit node lock' : 'Lock strategy') + '</button>' : '') +
    (decisions ? '<button class="text-btn" id="view-locks">All locks (' + decisions + ')</button>' : '') + '</div>';
  if (count || (!current && editable)) {
    const status = document.createElement('p');
    status.className = 'hint';
    status.textContent = current
      ? count + (count === 1 ? ' combo locked' : ' combos locked') + ' at this decision.'
      : 'Solve the edited spot to lock its strategy.';
    panel.append(status);
  }
  if ($('view-locks')) $('view-locks').onclick = showLockList;
  if (!editable) return;
  const control = $('edit-lock');
  control.disabled = !current || !run.result?.combos.length;
  control.onclick = () => openLockEditor({
    dialog, node, path:run.path, combos:run.result.combos, locks:rows, handClass:run.selection,
    onSave: (nodeRows, solve) => {
      const next = {...draftLocks};
      if (Object.keys(nodeRows).length) next[node.id] = nodeRows;
      else delete next[node.id];
      saveLocks(next, solve);
    }
  });
}

function renderInspection() {
  if (!$('strategy-panel')) return;
  const result = run.result;
  const node = publicNode(run.tree,run.path);
  renderLockPanel(node);
  $('result-seat').textContent = node.actor === null ? 'Terminal node' : role[node.actor];
  if (!result || !result.reachable || node.terminal) {
    const title = !result ? (run.reason === 'error' ? 'Strategy unavailable' : 'Evaluating strategy…') :
      !result.reachable ? 'Unreachable line' : treeDetail(run.game,node);
    const sub = !result ? '' : !result.reachable ? 'No compatible deals reach this line under the evaluated strategy.' :
      'This line ends here. Choose an earlier action to inspect its strategy.';
    $('strategy-panel').innerHTML = '<div class="empty-state"><h3>' + title + '</h3><p class="empty-copy">' + sub + '</p></div>';
    $('action-mix').innerHTML = '<p class="hint">' + (result?.reachable ? 'No further actions.' : 'No action frequencies available.') + '</p>';
    return;
  }
  const colors = actionColors(node);
  $('action-mix').innerHTML = '<p class="hint">Line reach · ' + pct(result.reachProbability) + '</p><div class="stacked">' +
    result.actions.map((a,i) => '<span style="background:' + colors[i] + ';width:' + a.frequency*100 + '%"></span>').join('') +
    '</div><div class="action-list">' + result.actions.map((a,i) => '<div class="action-row"><span class="swatch" style="background:' +
    colors[i] + '"></span><span>' + a.label + '</span><span class="percent">' + pct(a.frequency) + '</span></div>').join('') + '</div>';
  const groups = groupedCombos(result);
  if (!groups.get(run.selection)?.mass) {
    run.selection = [...groups.entries()].sort((a,b) => b[1].mass - a[1].mass)[0]?.[0];
  }
  const handButtons = classes.map(c => {
    const group = groups.get(c);
    const data = group?.mass ? ' style="color:#172019;background:' + dividedBackground(group.mix,colors) +
      '" title="' + c + ' · ' + pct(group.mass) + ' of acting range"' : ' disabled';
    return '<button class="cell ' + (c === run.selection ? 'marked' : '') + '" data-hand="' + c + '"' + data + '>' + c + '</button>';
  }).join('');
  $('strategy-panel').innerHTML = '<div class="range-meta"><span>Select a hand class to inspect its combos</span></div><div class="matrix-wrap"><div class="matrix" id="result-matrix" role="group" aria-label="Strategy by hand class">' + handButtons +
    '</div></div><div class="combo-section" id="combos"></div>';
  $('result-matrix').onclick = event => {
    const cell = event.target.closest('.cell');
    if (!cell || cell.disabled) return;
    $('result-matrix').querySelector('.marked')?.classList.remove('marked');
    run.selection = cell.dataset.hand;
    cell.classList.add('marked');
    renderCombos(groups.get(run.selection),result.actions);
  };
  renderCombos(groups.get(run.selection),result.actions);
}
function renderCombos(group,actions) {
  if (!group) {$('combos').textContent = 'No combos reach this decision.';return;}
  const cols = actions.map(a => '<th colspan="2" scope="colgroup">' + a.label + '</th>').join('');
  const labels = actions.map(() => '<th scope="col">Frequency</th><th scope="col">EV (bb)</th>').join('');
  const appliedRows = run.game.locks[run.path.at(-1).id] || {};
  const rows = group.combos.map(c => '<tr><td>' + c.cards.map(id => {
    const [r,s] = formatCard(id);
    return (r === 'T' ? '10' : r) + pips[s];
  }).join(' ') + (appliedRows[c.key] ? ' <small class="lock-tag">Locked</small>' : '') +
    '</td><td>' + pct(c.weight) + '</td>' + actions.map((_,i) => '<td>' + (c.weight ? pct(c.frequency[i]) : '—') +
    '</td><td>' + n(c.ev[i]) + '</td>').join('') + '</tr>').join('');
  $('combos').innerHTML = '<div class="combo-title"><h3>' + run.selection + ' combos</h3><span class="hint">' + pct(group.mass) +
    ' of acting range</span></div><p class="hint combo-caption">EV is net of chips invested from this decision onward.</p><div class="table-scroll"><table><thead><tr><th scope="col" rowspan="2">Combo</th><th scope="col" rowspan="2">Share</th>' + cols +
    '</tr><tr>' + labels + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

$('pot').value = spot.pot;
$('stack').value = spot.stack;
$('raise-cap').value = spot.raiseCap;
renderBoard();
renderRange();
renderSizing();
refreshControls();
