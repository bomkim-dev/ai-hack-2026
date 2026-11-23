import {
  foods, equipment, statuses, emptyItem, loadPantry, savePantry, recommend, expiryState, foodAvailability,
  parsePantrySpeech, validQuantity, stageCookingSelection, takeCookingSelection,
  pendingCookingUsage, clearCookingUsage, applyCookingUsage,
} from './pantry-data.js';

const find = id => document.getElementById(id);
const status = find('status');
const pantry = loadPantry();
const finished = location.hash === '#usage' ? pendingCookingUsage() : null;
const demo = new URLSearchParams(location.search).get('demo') === '1';
const cookingPage = new URL('./index.html', location);
if (demo) cookingPage.searchParams.set('demo', '1');
find('home-link').href = cookingPage;
document.querySelector('[data-cook-only]').href = cookingPage;

function save() {
  try {
    savePantry(pantry);
    status.textContent = '';
  } catch {
    status.textContent = '保存できませんでした。ブラウザの設定を確認してください。';
  }
}

const option = (value, label, current) => `<option value="${value}" ${value === current ? 'selected' : ''}>${label}</option>`;
const statusOptions = current => Object.entries(statuses).map(([key, label]) => option(key, label, current)).join('');
const amountValue = amount => Number.isFinite(amount) ? amount : '';
const dateValue = date => /^\d{4}-\d{2}-\d{2}$/u.test(date) ? date : '';

function updateExpiry(row, value) {
  const state = expiryState(value);
  row.querySelector('.expiry').textContent = state === 'past' ? '表示の日付を過ぎています。' :
    state === 'soon' ? '表示の日付まであと3日以内です。' : '';
}

function renderIngredients() {
  const target = find('ingredients');
  target.innerHTML = Object.entries(foods).map(([id, food]) => {
    const item = pantry.stock[id] ?? emptyItem();
    return `<div class="item" data-food="${id}">
      <strong>${food.name}</strong>
      <div class="row">
        <label>管理方法 <select data-field="mode" aria-label="${food.name}の管理方法">
          ${option('status', 'ある・ない', item.mode)}${option('quantity', '数量', item.mode)}</select></label>
        ${item.mode === 'quantity'
          ? `<label>残り <input data-field="amount" aria-label="${food.name}の数量" type="number" min="0" step="${food.step}" value="${amountValue(item.amount)}"> ${food.unit}</label>`
          : `<label>在庫 <select data-field="status" aria-label="${food.name}の在庫">${statusOptions(item.status)}</select></label>`}
      </div>
      <details ${item.date ? 'open' : ''}>
        <summary>期限を記録</summary>
        <div class="row">
          <select data-field="dateType" aria-label="${food.name}の期限の種類">
            ${option('best', '賞味期限', item.dateType)}${option('use', '消費期限', item.dateType)}</select>
          <input data-field="date" aria-label="${food.name}の期限" type="date" value="${dateValue(item.date)}">
        </div>
        <p class="expiry hint"></p>
      </details>
    </div>`;
  }).join('');
  for (const row of target.querySelectorAll('[data-food]')) updateExpiry(row, pantry.stock[row.dataset.food]?.date);
}

function renderTools() {
  find('tools').innerHTML = Object.entries(equipment).map(([id, tool]) =>
    `<div class="item row"><label>${tool.name} <select data-tool="${id}">${statusOptions(pantry.tools[id])}</select></label></div>`).join('');
}

function renderShopping() {
  const pick = find('manual-shopping').querySelector('select');
  const available = Object.keys(foods).filter(id => !pantry.shopping.includes(id));
  pick.innerHTML = available.map(id => option(id, foods[id].name, '')).join('');
  find('manual-shopping').hidden = available.length === 0;
  find('shopping').innerHTML = pantry.shopping.length ? pantry.shopping.map(id =>
    `<div class="item row"><span>${foods[id].name}</span><button type="button" data-buy="${id}">購入済み</button>
    <button type="button" data-remove="${id}" aria-label="${foods[id].name}をリストから削除">削除</button></div>`).join('') : '<p>買い出しリストは空です。</p>';
}

function currentRoute() {
  return recommend(pantry, { demo, recipeId: find('pantry-recipe').value });
}

function renderRoute() {
  const route = currentRoute();
  find('route').textContent = `${foods[route.protein].name}と玉ねぎの${route.method === 'onePan' ? 'ワンパン' : ''}パスタ`;
  const missing = [...route.missingFood.map(item => ({ ...item, name: foods[item.id].name })),
    ...route.missingTools.map(item => ({ ...item, name: equipment[item.id].name }))];
  find('missing').innerHTML = missing.map(item =>
    `<li>${item.name}：${item.status === 'unknown' ? '要確認' : '不足'}</li>`).join('');
  const choices = route.missingFood.filter(item => item.status === 'absent' && !pantry.shopping.includes(item.id));
  find('shopping-options').innerHTML = choices.length ? `<form id="add-shopping" class="row">
    ${choices.map(({ id }) => `<label><input type="checkbox" name="item" value="${id}"> ${foods[id].name}</label>`).join('')}
    <button>選んだ食材を買い出しに追加</button></form>` : '';
  find('open-cooking').disabled = missing.length > 0;
}

find('ingredients').addEventListener('change', event => {
  const input = event.target;
  const row = input.closest('[data-food]');
  if (!row || !input.dataset.field) return;
  const { food: id } = row.dataset;
  const { field } = input.dataset;
  const item = pantry.stock[id] ?? emptyItem();
  if (field === 'mode') {
    pantry.stock[id] = input.value === 'quantity'
      ? { ...item, mode: 'quantity', amount: null }
      : { ...item, mode: 'status', status: foodAvailability(item, foods[id].step) };
    renderIngredients();
    find('ingredients').querySelector(`[data-food="${id}"] [data-field="${input.value === 'quantity' ? 'amount' : 'status'}"]`).focus();
  } else if (field === 'amount' && !input.validity.valid) {
    input.reportValidity();
    return;
  } else {
    pantry.stock[id] = { ...item, [field]: field === 'amount' ? (input.value === '' ? null : input.valueAsNumber) : input.value };
    if (field === 'date') updateExpiry(row, input.value);
  }
  save();
  renderRoute();
});

find('tools').addEventListener('change', event => {
  const id = event.target.dataset.tool;
  if (!Object.hasOwn(equipment, id)) return;
  pantry.tools[id] = event.target.value;
  save();
  renderRoute();
});

let voiceChanges = [];
find('voice').addEventListener('submit', event => {
  event.preventDefault();
  voiceChanges = parsePantrySpeech(find('utterance').value, pantry);
  find('voice-summary').textContent = voiceChanges.map(({ id, kind, value }) => {
    const food = foods[id];
    if (kind === 'quantityRequired') return `${food.name}の数量を教えてください。`;
    if (kind === 'tool') return `${equipment[id].name}：${statuses[value]}`;
    return `${food.name}：${value.mode === 'quantity' ? `${value.amount}${food.unit}` : statuses[value.status]}`;
  }).join('\n') || '食材名と、ある・ない、または数量を伝えてください。';
  find('apply-voice').hidden = !voiceChanges.some(change => change.kind !== 'quantityRequired');
});

find('utterance').addEventListener('input', () => {
  voiceChanges = [];
  find('apply-voice').hidden = true;
  find('voice-summary').textContent = '';
});

find('apply-voice').addEventListener('click', () => {
  for (const { id, kind, value } of voiceChanges) {
    if (kind === 'tool') pantry.tools[id] = value;
    if (kind === 'stock') pantry.stock[id] = value;
  }
  save();
  voiceChanges = [];
  find('apply-voice').hidden = true;
  find('utterance').value = '';
  find('voice-summary').textContent = '反映した食材と道具を確認できます。';
  renderIngredients();
  renderTools();
  renderRoute();
});

function addToShopping(event) {
  event.preventDefault();
  const items = new FormData(event.target).getAll('item').filter(id => Object.hasOwn(foods, id));
  if (!items.length) return;
  pantry.shopping = [...new Set([...pantry.shopping, ...items])];
  save();
  renderShopping();
  renderRoute();
}
find('shopping-options').addEventListener('submit', addToShopping);
find('manual-shopping').addEventListener('submit', addToShopping);

let purchasedId;
const purchase = find('purchase');
find('shopping').addEventListener('click', event => {
  const { buy, remove } = event.target.dataset;
  if (remove) {
    pantry.shopping = pantry.shopping.filter(id => id !== remove);
    purchase.hidden = true;
    save();
    renderShopping();
    renderRoute();
  }
  if (!buy) return;
  purchasedId = buy;
  const food = foods[buy];
  const detailed = pantry.stock[buy]?.mode === 'quantity';
  purchase.innerHTML = `<p>${food.name}を購入済みにします。</p>${detailed
    ? `<label>買った量 <input name="amount" type="number" min="${food.step}" step="${food.step}"> ${food.unit}</label><p class="hint">数量が不明なら在庫更新をスキップできます。</p>`
    : '<label><input name="record" type="checkbox" checked> 在庫を「ある」にする</label>'}
    <div class="row"><button>購入を確定</button><button type="button" data-cancel>キャンセル</button></div>`;
  purchase.hidden = false;
  purchase.querySelector('input').focus();
});

purchase.addEventListener('click', event => {
  if (event.target.hasAttribute('data-cancel')) purchase.hidden = true;
});

purchase.addEventListener('submit', event => {
  event.preventDefault();
  const current = pantry.stock[purchasedId] ?? emptyItem();
  const form = new FormData(purchase);
  if (current.mode === 'quantity' && form.get('amount')) {
    const amount = Number(form.get('amount'));
    pantry.stock[purchasedId] = { ...current, amount: (current.amount ?? 0) + amount };
  } else if (current.mode === 'status' && form.has('record')) {
    pantry.stock[purchasedId] = { ...current, status: 'present' };
  }
  pantry.shopping = pantry.shopping.filter(id => id !== purchasedId);
  purchase.hidden = true;
  save();
  renderShopping();
  renderRoute();
});

find('pantry-recipe-choice').hidden = demo;
find('pantry-recipe').addEventListener('change', renderRoute);

find('open-cooking').addEventListener('click', () => {
  try {
    stageCookingSelection(currentRoute());
    location.assign(cookingPage);
  } catch {
    status.textContent = '調理情報を渡せませんでした。ブラウザの設定を確認してください。';
  }
});

document.querySelector('[data-cook-only]').addEventListener('click', () => {
  try { takeCookingSelection(); } catch { /* A direct start also works without storage. */ }
});

const usage = find('usage');
function finishUsage(message) {
  clearCookingUsage();
  usage.hidden = true;
  status.textContent = message;
}

function renderUsage() {
  find('pantry-content').hidden = true;
  find('finish').hidden = false;
  if (!finished) {
    usage.hidden = true;
    status.textContent = '確認待ちの調理はありません。';
    return;
  }
  find('usage-items').innerHTML = finished.ingredients.filter(({ id }) => pantry.stock[id]).map(({ id, amount }) => {
    const current = pantry.stock[id];
    const food = foods[id];
    if (current.mode === 'quantity' && current.amount == null) return '';
    return `<div class="item"><label>${food.name} ${current.mode === 'quantity'
      ? `<input name="${id}" data-mode="quantity" aria-label="${food.name}の使用量" type="number" min="0" step="${food.step}" value="${amountValue(amount)}"> ${food.unit}使用`
      : `<select name="${id}" data-mode="status" aria-label="${food.name}の残り">
        ${option('', '変更しない', '')}${option('present', '残っている', '')}${option('absent', '使い切った', '')}</select>`}</label></div>`;
  }).join('');
}

usage.addEventListener('submit', event => {
  event.preventDefault();
  if (!finished) return;
  const entries = [...usage.querySelectorAll('[data-mode]')].filter(field => field.value !== '').map(field =>
    field.dataset.mode === 'quantity' ? { id: field.name, amount: field.valueAsNumber } : { id: field.name, status: field.value });
  try {
    const result = applyCookingUsage(finished.selection, entries);
    finishUsage(result === 'updated' ? '在庫を更新しました。' : '在庫に変更はありません。');
  } catch {
    status.textContent = '在庫を変更できませんでした。使った量と現在の在庫を確認してください。';
  }
});
find('skip-usage').addEventListener('click', () => finishUsage('在庫の更新をスキップしました。'));

if (location.hash === '#usage') {
  renderUsage();
} else {
  renderIngredients();
  renderTools();
  renderShopping();
  renderRoute();
}
