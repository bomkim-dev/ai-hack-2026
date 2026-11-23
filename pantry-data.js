export const foods = {
  pasta: { name: 'パスタ', unit: 'g', amount: 100, step: 1, pattern: /パスタ|スパゲッティ/u },
  onion: { name: '玉ねぎ', unit: '個', amount: 0.25, step: 0.25, pattern: /玉[ねネ]ギ|玉ねぎ|たまねぎ|玉葱/u },
  bacon: { name: 'ベーコン', unit: 'g', amount: 40, step: 1, pattern: /ベーコン/u },
  tuna: { name: 'ツナ缶', unit: '缶', amount: 1, step: 1, pattern: /ツナ|シーチキン/u },
};

export const equipment = {
  pot: { name: '鍋', pattern: /鍋|なべ/u },
  deepPan: { name: '深めのフライパン', pattern: /深[^、。]*フライパン/u },
  pan: { name: 'フライパン', pattern: /フライパン/u },
  strainer: { name: 'ざる', pattern: /ざる|ザル|笊/u },
};

export const statuses = { unknown: '未確認', present: 'ある', absent: 'ない' };
const storageKey = 'kitchen-guide:pantry:v1';
const handoffKey = 'kitchen-guide:pantry-handoff:v1';

export function emptyItem() {
  return { mode: 'status', status: 'unknown', date: '', dateType: 'best' };
}

export function loadPantry(storage) {
  const empty = { stock: {}, tools: {}, shopping: [], appliedCooks: [] };
  try {
    const saved = JSON.parse((storage ?? localStorage).getItem(storageKey) ?? 'null');
    return saved?.stock && saved.tools && Array.isArray(saved.shopping) && Array.isArray(saved.appliedCooks)
      ? saved : empty;
  } catch {
    return empty;
  }
}

export function savePantry(pantry, storage = localStorage) {
  storage.setItem(storageKey, JSON.stringify(pantry));
}

export function foodAvailability(item, amount) {
  if (!item) return 'unknown';
  if (item.mode === 'status') return item.status;
  return item.amount == null ? 'unknown' : item.amount >= amount ? 'present' : 'absent';
}

export function recommend(pantry) {
  const { stock, tools } = pantry;
  const protein = foodAvailability(stock.bacon, foods.bacon.amount) !== 'present' &&
    foodAvailability(stock.tuna, foods.tuna.amount) === 'present' ? 'tuna' : 'bacon';
  const pan = tools.deepPan === 'present' ? 'present' : tools.pan ?? 'unknown';
  const required = { pot: tools.pot ?? 'unknown', pan, strainer: tools.strainer ?? 'unknown' };
  const standardReady = Object.values(required).every(status => status === 'present');
  const method = !standardReady && tools.deepPan === 'present' ? 'onePan' : 'standard';
  const toolIds = method === 'onePan' ? ['deepPan'] :
    ['pot', tools.deepPan === 'present' ? 'deepPan' : 'pan', 'strainer'];
  const recipeIngredients = ['pasta', 'onion', protein].map(id => ({ id, amount: foods[id].amount }));
  return {
    protein,
    method,
    ingredients: recipeIngredients,
    toolIds,
    missingFood: recipeIngredients.map(({ id, amount }) => ({ id, status: foodAvailability(stock[id], amount) }))
      .filter(item => item.status !== 'present'),
    missingTools: Object.entries(method === 'onePan' ? { deepPan: 'present' } : required)
      .filter(([, status]) => status !== 'present').map(([id, status]) => ({ id, status })),
  };
}

export function expiryState(date, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return null;
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const days = (Date.parse(date) - start) / 86400000;
  return days < 0 ? 'past' : days <= 3 ? 'soon' : null;
}

export function validQuantity(id, amount) {
  return Number.isFinite(amount) && amount >= 0 && Number.isInteger(amount / foods[id].step);
}

function spokenQuantity(phrase, food) {
  const quantity = phrase.match(/(\d+(?:\.\d+)?)\s*(?:g|グラム|個|缶|つ)/iu);
  if (quantity) return Number(quantity[1]);
  if (food.unit === '個' && /半(?:分|玉|個)?/u.test(phrase)) return 0.5;
  const japanese = phrase.match(/([一二三四五六七八九])(?:つ|缶|個)/u);
  return japanese ? '〇一二三四五六七八九'.indexOf(japanese[1]) : null;
}

export function parsePantrySpeech(text, pantry) {
  const changes = new Map();
  const clauses = text.normalize('NFKC').replace(/なくて\s*/gu, 'ない。').replace(/(ない|ある|あります|ありません|持っている)(?:けど|けれど)\s*/gu, '$1。').split(/[。!?、\n]+/u);
  for (const clause of clauses) {
    const food = Object.entries(foods).find(([, item]) => item.pattern.test(clause));
    const tool = Object.entries(equipment).find(([, item]) => item.pattern.test(clause));
    if (/[?？]|ですか|あるかな|わからない|分からない/u.test(clause)) continue;
    const absent = /ない|ありません|切らして/u.test(clause);
    const present = /ある|あります|持って/u.test(clause);
    if (food) {
      const [id, definition] = food;
      const current = pantry.stock[id] ?? emptyItem();
      const quantity = spokenQuantity(clause, definition);
      if (!absent && !present && quantity == null) continue;
      if (current.mode === 'quantity' || quantity != null) {
        const amount = absent ? 0 : quantity;
        if (!validQuantity(id, amount)) {
          changes.set(id, { kind: 'quantityRequired', id });
        } else {
          changes.set(id, { kind: 'stock', id, value: { mode: 'quantity', amount, date: current.date, dateType: current.dateType } });
        }
      } else {
        changes.set(id, { kind: 'stock', id, value: { ...current, status: absent ? 'absent' : 'present' } });
      }
    } else if (tool && (absent || present)) {
      const [id] = tool;
      changes.set(id, { kind: 'tool', id, value: absent ? 'absent' : 'present' });
    }
  }
  return [...changes.values()];
}

export function stageCookingSelection(route, storage = sessionStorage) {
  const selection = {
    cookId: crypto.randomUUID(),
    protein: route.protein,
    method: route.method,
    ingredients: route.ingredients,
    tools: route.toolIds,
  };
  storage.setItem(handoffKey, JSON.stringify(selection));
  return selection;
}

export function takeCookingSelection(storage = sessionStorage) {
  const value = storage.getItem(handoffKey);
  storage.removeItem(handoffKey);
  return value ? JSON.parse(value) : null;
}

export function applyCookingUsage(selection, entries, storage = localStorage) {
  const pantry = loadPantry(storage);
  if (!selection?.cookId || pantry.appliedCooks.includes(selection.cookId)) return 'unchanged';
  const permitted = new Set(selection.ingredients.map(item => item.id));
  const seen = new Set();
  const nextStock = { ...pantry.stock };
  for (const { id, amount, status } of entries) {
    const current = nextStock[id];
    if (!permitted.has(id) || seen.has(id) || !current) throw new Error('Invalid consumption item');
    seen.add(id);
    if (current.mode === 'quantity') {
      if (!validQuantity(id, amount) || current.amount == null || amount > current.amount) {
        throw new Error('Invalid consumption amount');
      }
      nextStock[id] = { ...current, amount: current.amount - amount };
    } else {
      if (!['present', 'absent'].includes(status)) throw new Error('Invalid remaining status');
      nextStock[id] = { ...current, status };
    }
  }
  if (!entries.length) return 'unchanged';
  savePantry({ ...pantry, stock: nextStock, appliedCooks: [...pantry.appliedCooks, selection.cookId] }, storage);
  return 'updated';
}

const finishKey = 'kitchen-guide:pantry-finish:v1';

export function stageCookingUsage(selection, ingredients = selection.ingredients, storage = sessionStorage) {
  storage.setItem(finishKey, JSON.stringify({ selection, ingredients }));
}

export function pendingCookingUsage(storage = sessionStorage) {
  return JSON.parse(storage.getItem(finishKey) ?? 'null');
}

export function clearCookingUsage(storage = sessionStorage) {
  storage.removeItem(finishKey);
}
