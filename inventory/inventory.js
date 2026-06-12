import {
  db,
  collection,
  doc,
  setDoc,
  serverTimestamp,
} from '../firebase.js';

const INVENTORY_STATUSES = ['High', 'Moderate', 'Low', 'Critically Low', 'Out'];
const SUPPLY_SECTIONS = [
  {
    id: 'poolChemistry',
    label: 'Pool Chemistry Supplies',
    items: [
      { id: 'r001_reagent', label: 'R-001 reagent (DPD reagent 1)' },
      { id: 'r002_reagent', label: 'R-002 reagent (DPD reagent 2)' },
      { id: 'r004_reagent', label: 'R-004 reagent (pH indicator)' },
    ],
  },
  {
    id: 'firstAid',
    label: 'First Aid Supplies',
    items: [
      { id: 'bandaids', label: 'Bandaids' },
      { id: 'gauze', label: 'Gauze' },
      { id: 'roller_bandages', label: 'Roller bandages' },
      { id: 'sanitation_wipes', label: 'Sanitation wipes' },
      { id: 'sting_relief', label: 'Sting relief' },
      { id: 'antibiotic_gel', label: 'Antibiotic gel' },
      { id: 'disposable_gloves', label: 'Disposable gloves' },
    ],
  },
  {
    id: 'cleaning',
    label: 'Cleaning Supplies',
    items: [
      { id: 'toilet_paper', label: 'Toilet paper' },
      { id: 'paper_towels', label: 'Paper towels' },
      { id: 'black_trash_bags', label: 'Black trash bags' },
      { id: 'clear_trash_bags', label: 'Clear trash bags' },
      { id: 'disinfectant_spray', label: 'Disinfectant spray' },
      { id: 'glass_cleaner', label: 'Glass cleaner' },
      { id: 'scrub_pads', label: 'Scrub pads' },
      { id: 'hand_soap', label: 'Hand soap' },
      { id: 'toilet_bowl_cleaner', label: 'Toilet bowl cleaner' },
    ],
  },
];

let poolsCache = [];
let urgentRowCounter = 0;
let weeklyCustomRowCounter = 0;

const els = {
  formType: document.getElementById('inventoryFormType'),
  form: document.getElementById('inventoryForm'),
  facility: document.getElementById('inventoryFacilitySelect'),
  directions: document.getElementById('inventoryDirections'),
  weekly: document.getElementById('weeklyInventoryFields'),
  urgent: document.getElementById('urgentInventoryFields'),
  addItem: document.getElementById('inventoryAddItemBtn'),
  submit: document.getElementById('inventorySubmitBtn'),
  message: document.getElementById('inventoryMessage'),
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getPoolName(pool) {
  return (pool?.name || pool?.id || '').toString().trim();
}

function getPoolSupplyInfo(pool) {
  const info = pool?.supplyInfo || {};
  return info && typeof info === 'object' ? info : {};
}

function getSupplySetting(pool, itemId) {
  const existing = getPoolSupplyInfo(pool)[itemId];
  return {
    enabled: existing?.enabled !== false,
    type: (existing?.type || '').toString().trim(),
  };
}

function getSelectedPool() {
  const id = els.facility?.value || '';
  return poolsCache.find((pool) => pool.id === id || getPoolName(pool) === id) || null;
}

function setMessage(text, isError = false) {
  if (!els.message) return;
  els.message.textContent = text || '';
  els.message.classList.toggle('error', !!text && isError);
  els.message.classList.toggle('success', !!text && !isError);
}

function groupPoolsByMarket(pools) {
  const map = {};
  (pools || []).forEach((pool) => {
    const markets = Array.isArray(pool.markets) ? pool.markets : (pool.market ? [pool.market] : ['Other']);
    const market = markets[0] || 'Other';
    if (!map[market]) map[market] = [];
    map[market].push(pool);
  });
  return Object.keys(map).sort().map((market) => ({
    market,
    pools: map[market].sort((a, b) => getPoolName(a).localeCompare(getPoolName(b))),
  }));
}

function populateFacilitySelect(pools) {
  poolsCache = Array.isArray(pools) ? pools : [];
  if (!els.facility) return;
  const current = els.facility.value;
  els.facility.innerHTML = '<option value="">Select</option>';
  groupPoolsByMarket(poolsCache).forEach(({ market, pools: marketPools }) => {
    const group = document.createElement('optgroup');
    group.label = market;
    marketPools.forEach((pool) => {
      const option = document.createElement('option');
      option.value = pool.id || getPoolName(pool);
      option.textContent = getPoolName(pool);
      group.appendChild(option);
    });
    els.facility.appendChild(group);
  });
  if (current) els.facility.value = current;
}

function getAllSupplyItems() {
  return SUPPLY_SECTIONS.flatMap((section) =>
    section.items.map((item) => ({ ...item, sectionId: section.id, sectionLabel: section.label }))
  );
}

function renderWeeklyFields() {
  const pool = getSelectedPool();
  if (!els.weekly) return;
  els.weekly.innerHTML = '';
  weeklyCustomRowCounter = 0;
  SUPPLY_SECTIONS.forEach((section) => {
    const enabledItems = section.items.filter((item) => !pool || getSupplySetting(pool, item.id).enabled);
    if (!enabledItems.length) return;
    const card = document.createElement('section');
    card.className = 'inventory-section-card';
    card.innerHTML = `<h3>${escapeHtml(section.label)}</h3>`;
    enabledItems.forEach((item) => {
      const setting = pool ? getSupplySetting(pool, item.id) : { enabled: true, type: '' };
      const row = document.createElement('div');
      row.className = 'inventory-supply-row';
      row.dataset.itemId = item.id;
      row.dataset.sectionId = section.id;
      row.innerHTML = `
        <div>
          <div class="inventory-supply-name">${escapeHtml(item.label)}</div>
          ${setting.type ? `<div class="inventory-supply-type">Type: ${escapeHtml(setting.type)}</div>` : ''}
        </div>
        <select class="training-filter-select inventory-status-select" required>
          <option value="">Select level</option>
          ${INVENTORY_STATUSES.map((status) => `<option value="${status}">${status}</option>`).join('')}
        </select>
      `;
      card.appendChild(row);
    });
    els.weekly.appendChild(card);
  });
  const customCard = document.createElement('section');
  customCard.className = 'inventory-section-card inventory-custom-section';
  customCard.innerHTML = '<h3>Additional Items</h3><div class="inventory-custom-list" id="weeklyCustomItems"></div>';
  els.weekly.appendChild(customCard);
}

function createSupplyOptions(pool = getSelectedPool()) {
  return SUPPLY_SECTIONS.map((section) => `
    <optgroup label="${escapeHtml(section.label)}">
      ${section.items
        .filter((item) => !pool || getSupplySetting(pool, item.id).enabled)
        .map((item) => `<option value="${item.id}">${escapeHtml(item.label)}</option>`).join('')}
    </optgroup>
  `).join('');
}

function addUrgentRow(value = '') {
  if (!els.urgent) return;
  urgentRowCounter += 1;
  const row = document.createElement('div');
  row.className = 'inventory-urgent-row';
  row.dataset.urgentRow = String(urgentRowCounter);
  row.innerHTML = `
    <select class="training-filter-select inventory-urgent-select" required>
      <option value="">Select item</option>
      ${createSupplyOptions()}
    </select>
    <button type="button" class="editAndSave inventory-remove-item">Remove</button>
  `;
  const select = row.querySelector('select');
  if (value) select.value = value;
  row.querySelector('.inventory-remove-item')?.addEventListener('click', () => {
    row.remove();
  });
  els.urgent.appendChild(row);
}

function renderUrgentFields() {
  if (!els.urgent) return;
  els.urgent.innerHTML = '';
  urgentRowCounter = 0;
}

function addWeeklyCustomRow() {
  const list = document.getElementById('weeklyCustomItems');
  if (!list) return;
  weeklyCustomRowCounter += 1;
  const row = document.createElement('div');
  row.className = 'inventory-supply-row inventory-custom-row';
  row.dataset.customRow = String(weeklyCustomRowCounter);
  row.innerHTML = `
    <input type="text" class="inventory-custom-name" placeholder="Item name" aria-label="Additional item name" required>
    <select class="training-filter-select inventory-status-select" required>
      <option value="">Select level</option>
      ${INVENTORY_STATUSES.map((status) => `<option value="${status}">${status}</option>`).join('')}
    </select>
    <button type="button" class="editAndSave inventory-remove-item">Remove</button>
  `;
  row.querySelector('.inventory-remove-item')?.addEventListener('click', () => row.remove());
  list.appendChild(row);
  row.querySelector('.inventory-custom-name')?.focus();
}

function handleAddItem() {
  const type = els.formType?.value || '';
  if (type === 'weekly') addWeeklyCustomRow();
  if (type === 'urgent') addUrgentRow();
}

function syncFormType() {
  const type = els.formType?.value || '';
  els.form?.classList.toggle('hidden', !type);
  els.weekly?.classList.toggle('hidden', type !== 'weekly');
  els.urgent?.classList.toggle('hidden', type !== 'urgent');
  els.addItem?.classList.toggle('hidden', type !== 'weekly' && type !== 'urgent');
  if (els.directions) {
    els.directions.textContent = type === 'urgent'
      ? 'Use this form to indicate any items that are critically low in stock and will run out before the next inventory form is completed (Thursdays).'
      : type === 'weekly'
        ? 'Fill out this form to indicate the supply level of each item needed to run your pool.'
        : '';
  }
  if (type === 'weekly') renderWeeklyFields();
  if (type === 'urgent') renderUrgentFields();
  setMessage('');
}

function getRespondentInfo() {
  const helperRecord = typeof window.getCurrentEmployeeRecord === 'function'
    ? window.getCurrentEmployeeRecord()
    : null;
  const firstName = helperRecord?.firstName || sessionStorage.getItem('chemlogEmployeeFirstName') || '';
  const lastName = helperRecord?.lastName || sessionStorage.getItem('chemlogEmployeeLastName') || '';
  const email = helperRecord?.email || sessionStorage.getItem('chemlogEmployeeEmail') || '';
  const username = helperRecord?.username || sessionStorage.getItem('chemlogEmployeeUsername') || '';
  const name = [firstName, lastName].filter(Boolean).join(' ').trim();
  return {
    firstName,
    lastName,
    respondentName: name || 'Unknown',
    submitterName: name || 'Unknown',
    respondentEmail: email,
    submitterEmail: email,
    employeeId: helperRecord?.employeeId || helperRecord?.id || email || '',
    respondentUsername: username,
    submitterUsername: username,
    username,
  };
}

function findSupplyItem(itemId) {
  return getAllSupplyItems().find((item) => item.id === itemId) || null;
}

function collectWeeklyItems(pool) {
  const standardItems = Array.from(document.querySelectorAll('.inventory-supply-row:not(.inventory-custom-row)')).map((row) => {
    const item = findSupplyItem(row.dataset.itemId);
    const status = row.querySelector('.inventory-status-select')?.value || '';
    const setting = pool ? getSupplySetting(pool, item?.id) : {};
    return {
      id: item?.id || row.dataset.itemId,
      item: item?.label || row.dataset.itemId,
      sectionId: item?.sectionId || row.dataset.sectionId || '',
      section: item?.sectionLabel || '',
      type: setting?.type || '',
      status,
    };
  });
  const customItems = Array.from(document.querySelectorAll('.inventory-custom-row')).map((row, index) => {
    const name = row.querySelector('.inventory-custom-name')?.value?.trim() || '';
    const status = row.querySelector('.inventory-status-select')?.value || '';
    return name ? {
      id: `custom_${index + 1}_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
      item: name,
      sectionId: 'custom',
      section: 'Additional Items',
      type: '',
      status,
      custom: true,
    } : null;
  }).filter(Boolean);
  return standardItems.concat(customItems);
}

function collectUrgentItems(pool) {
  return Array.from(document.querySelectorAll('.inventory-urgent-select')).map((select) => {
    const item = findSupplyItem(select.value);
    const setting = pool ? getSupplySetting(pool, item?.id) : {};
    return item ? {
      id: item.id,
      item: item.label,
      sectionId: item.sectionId,
      section: item.sectionLabel,
      type: setting?.type || '',
      status: 'Critically Low',
    } : null;
  }).filter(Boolean);
}

async function handleInventorySubmit(event) {
  event.preventDefault();
  const type = els.formType?.value || '';
  const pool = getSelectedPool();
  if (!type) return setMessage('Choose a form first.', true);
  if (!pool) return setMessage('Select a facility.', true);

  const items = type === 'urgent' ? collectUrgentItems(pool) : collectWeeklyItems(pool);
  if (!items.length) return setMessage('Add at least one item.', true);
  const missingStatus = items.find((item) => !item.status);
  if (missingStatus) return setMessage(`Select a level for ${missingStatus.item}.`, true);

  const submissionRef = doc(collection(db, 'inventorySubmissions'));
  const respondent = getRespondentInfo();
  const markets = Array.isArray(pool.markets) ? pool.markets : (pool.market ? [pool.market] : []);

  try {
    els.submit.disabled = true;
    els.submit.textContent = 'Submitting...';
    setMessage('');
    await setDoc(submissionRef, {
      timestamp: serverTimestamp(),
      submittedAtIso: new Date().toISOString(),
      formType: type,
      facilityId: pool.id || getPoolName(pool),
      facilityName: getPoolName(pool),
      market: markets[0] || 'Other',
      items,
      ...respondent,
      version: 1,
    });
    event.target.reset();
    syncFormType();
    setMessage('Inventory submitted.', false);
  } catch (err) {
    console.error('[Inventory] Unable to submit inventory:', err);
    setMessage('Unable to submit inventory. Please try again.', true);
  } finally {
    els.submit.disabled = false;
    els.submit.textContent = 'Submit';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (Array.isArray(window._poolsForDuties)) populateFacilitySelect(window._poolsForDuties);
  window.addEventListener('poolpro:pools-ready', (event) => populateFacilitySelect(event.detail?.pools || []));
  els.formType?.addEventListener('change', syncFormType);
  els.facility?.addEventListener('change', () => {
    if (els.formType?.value === 'weekly') renderWeeklyFields();
    if (els.formType?.value === 'urgent') renderUrgentFields();
  });
  els.addItem?.addEventListener('click', handleAddItem);
  els.form?.addEventListener('submit', handleInventorySubmit);
  syncFormType();
});
