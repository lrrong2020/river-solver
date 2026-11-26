// Express the starting mix in hundredths of a percent, distributing rounding
// remainders so the editable fields add up to exactly 100%.
function percentages(mix) {
  const units = mix.map(p => p * 10000);
  const rounded = units.map(Math.floor);
  const remainder = 10000 - rounded.reduce((sum, p) => sum + p, 0);
  const order = units.map((p, i) => i).sort((a, b) =>
    (units[b] - rounded[b]) - (units[a] - rounded[a]));
  for (let i = 0; i < remainder; i++) rounded[order[i]]++;
  return rounded.map(p => p / 100);
}

function startingMix(combos, locks, actionCount) {
  const totalReach = combos.reduce((sum, c) => sum + c.weight, 0);
  const mix = Array(actionCount).fill(0);
  for (const combo of combos) {
    const weight = totalReach > 0 ? combo.weight / totalReach : 1 / combos.length;
    const frequencies = locks[combo.key] || combo.frequency;
    frequencies.forEach((value, i) => { mix[i] += weight * value; });
  }
  return percentages(mix);
}

function options(select, values, preferred) {
  select.replaceChildren(...values.map(([value, label]) => new Option(label, value)));
  if (values.some(([value]) => value === preferred)) select.value = preferred;
}

// The dialog edits one public decision. On save it returns a new set of rows
// so the policy and combo frequencies in the displayed solve stay intact.
export function openLockEditor({ dialog, node, path, combos, locks, handClass, onSave }) {
  dialog('Node lock', `
    <form id="lock-form" class="modal-body" novalidate>
      <div class="lock-location"><strong id="lock-seat"></strong><span id="lock-history" class="hint"></span></div>
      <label class="field">Apply to<select id="lock-scope">
        <option value="range">Entire acting range</option>
        <option value="class">Hand class</option>
        <option value="combo">Exact combo</option>
      </select></label>
      <div class="lock-selectors">
        <label class="field" id="lock-class-field" hidden>Hand class<select id="lock-class"></select></label>
        <label class="field" id="lock-combo-field" hidden>Exact combo<select id="lock-combo"></select></label>
      </div>
      <p class="hint" id="lock-coverage"></p>
      <label class="field">Strategy to lock<select id="lock-mode">
        <option value="shared">Use one mix for selected combos</option>
        <option value="individual">Keep each combo’s solved frequencies</option>
      </select></label>
      <div id="lock-mix">
        <div id="lock-frequencies"></div>
        <output id="lock-total" aria-live="polite"></output>
      </div>
      <p class="form-error" role="alert" id="lock-error" hidden></p>
      <div class="lock-footer"><button type="button" class="text-btn" id="unlock-selection">Unlock selection</button>
        <div class="modal-actions"><button type="submit" class="quiet">Save lock</button>
        <button type="submit" value="solve" class="primary">Save and re-solve</button></div>
      </div>
    </form>`);
  const el = id => document.getElementById(id);
  const scope = el('lock-scope');
  const classes = el('lock-class');
  const exact = el('lock-combo');
  const mode = el('lock-mode');
  const error = el('lock-error');
  el('lock-seat').textContent = node.actor === 0 ? 'Out of position' : 'In position';
  el('lock-history').textContent = path.map(step => step.label).join(' › ');
  const groupNames = [...new Set(combos.map(c => c.handClass))].sort();
  options(classes, groupNames.map(c => [c, c]), handClass);
  const previouslyLocked = combos.filter(c => locks[c.key]);
  let firstKey;
  if (previouslyLocked.length === 1) {
    scope.value = 'combo';
    classes.value = previouslyLocked[0].handClass;
    firstKey = previouslyLocked[0].key;
  } else if (previouslyLocked.length && previouslyLocked.length < combos.length) {
    const firstClass = previouslyLocked[0].handClass;
    if (previouslyLocked.every(c => c.handClass === firstClass) &&
        combos.filter(c => c.handClass === firstClass).length === previouslyLocked.length) {
      scope.value = 'class';
      classes.value = firstClass;
    } else {
      scope.append(new Option('Previously locked combos', 'locked'));
      scope.value = 'locked';
    }
  }
  const inputs = node.actions.map(action => {
    const label = document.createElement('label');
    label.className = 'lock-frequency';
    const title = document.createElement('span');
    title.textContent = action.label;
    const box = document.createElement('span');
    box.className = 'num-box';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '100';
    input.step = 'any';
    input.setAttribute('aria-label', action.label + ' frequency (%)');
    const suffix = document.createElement('span');
    suffix.textContent = '%';
    box.append(input, suffix);
    label.append(title, box);
    el('lock-frequencies').append(label);
    return input;
  });

  let selected = [];
  function validate() {
    const values = inputs.map(input => input.valueAsNumber);
    const total = values.reduce((sum, value) => sum + value, 0);
    const valid = values.every(v => Number.isFinite(v) && v >= 0 && v <= 100) && Math.abs(total - 100) < 1e-7;
    const display = el('lock-total');
    display.textContent = Number.isFinite(total) ? 'Total ' + Number(total.toFixed(6)) + '%' : 'Enter a frequency for each action.';
    display.classList.toggle('invalid', !valid);
    return valid;
  }
  function showSelection() {
    const needsClass = scope.value === 'combo' || scope.value === 'class';
    el('lock-class-field').hidden = !needsClass;
    el('lock-combo-field').hidden = scope.value !== 'combo';
    el('lock-class-field').parentElement.hidden = !needsClass;
    const members = combos.filter(c => c.handClass === classes.value);
    options(exact, members.map(c => [c.key, c.key]), firstKey ?? exact.value);
    firstKey = undefined;
    selected = scope.value === 'locked' ? previouslyLocked : scope.value === 'range' ? combos : scope.value === 'class' ? members :
      members.filter(c => c.key === exact.value);
    const count = selected.filter(c => locks[c.key]).length;
    el('lock-coverage').textContent = selected.length + (selected.length === 1 ? ' combo selected' : ' combos selected') +
      ' · ' + count + ' locked';
    el('unlock-selection').disabled = !count;
    const values = startingMix(selected, locks, node.actions.length);
    inputs.forEach((input, i) => { input.value = values[i]; });
    validate();
    error.hidden = true;
  }
  scope.onchange = classes.onchange = exact.onchange = showSelection;
  mode.onchange = () => {
    el('lock-mix').hidden = mode.value === 'individual';
    error.hidden = true;
  };
  inputs.forEach(input => { input.oninput = () => { validate(); error.hidden = true; }; });
  el('lock-form').onsubmit = event => {
    event.preventDefault();
    let fixed;
    if (mode.value === 'shared') {
      if (!validate()) {
        error.textContent = 'Enter frequencies from 0% to 100% that add up to 100%.';
        error.hidden = false;
        return;
      }
      const total = inputs.reduce((sum, input) => sum + input.valueAsNumber, 0);
      fixed = inputs.map(input => input.valueAsNumber / total);
    }
    const updated = { ...locks };
    for (const c of selected) updated[c.key] = (fixed ?? c.frequency).slice();
    onSave(updated, event.submitter?.value === 'solve');
  };
  el('unlock-selection').onclick = () => {
    const updated = { ...locks };
    for (const c of selected) delete updated[c.key];
    onSave(updated, false);
  };
  showSelection();
}
