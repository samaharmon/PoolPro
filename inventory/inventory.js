import {
  app,
  db,
  collection,
  doc,
  setDoc,
  serverTimestamp,
} from '../firebase.js';
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js';

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

const SIGNAGE_PHOTO_GROUPS = [
  {
    id: 'sigPoolRules',
    category: 'poolRulesSign',
    title: 'Pool Rules Sign',
    description: 'Take a picture of the pool rules sign and ensure that ALL blanks are entirely filled out and clearly visible (not faded). The Pool Operator should be Capital City Aquatics, and the ID # should be 100548.',
    min: 1,
    max: 5,
  },
  {
    id: 'sigShallowWater',
    category: 'shallowWaterNoDiving',
    title: 'Shallow Water, No Diving Signs',
    description: 'Ensure that there are TWO shallow water signs and that they are bound to the fence (and unbroken).',
    min: 2,
    max: 5,
  },
  {
    id: 'sigNoLifeguard',
    category: 'noLifeguardOnDuty',
    title: 'No Lifeguard On Duty, Swim At Your Own Risk Signs',
    description: 'Ensure that there are TWO no lifeguard on duty signs and that they are bound to the fence (and unbroken).',
    min: 2,
    max: 5,
  },
];

let poolsCache = [];
let urgentRowCounter = 0;
let weeklyCustomRowCounter = 0;
const inventoryPhotoSlotCounters = {};

const els = {
  formType: document.getElementById('inventoryFormType'),
  form: document.getElementById('inventoryForm'),
  facility: document.getElementById('inventoryFacilitySelect'),
  directions: document.getElementById('inventoryDirections'),
  weekly: document.getElementById('weeklyInventoryFields'),
  urgent: document.getElementById('urgentInventoryFields'),
  chemical: document.getElementById('chemicalInventoryFields'),
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

// ---- Signage photo slots ----

function getInventorySlotCount(group) {
  return group.querySelectorAll('.inventory-photo-slot').length;
}

function updateSignageAddBtn(groupId) {
  const group = document.getElementById(groupId);
  const btn = document.querySelector(`[data-add-for="${groupId}"]`);
  if (!group || !btn) return;
  const max = parseInt(group.dataset.max || '5', 10);
  btn.disabled = getInventorySlotCount(group) >= max;
}

function addInventoryPhotoSlot(groupId) {
  const group = document.getElementById(groupId);
  if (!group) return;
  const max = parseInt(group.dataset.max || '5', 10);
  if (getInventorySlotCount(group) >= max) return;

  inventoryPhotoSlotCounters[groupId] = (inventoryPhotoSlotCounters[groupId] || 0) + 1;
  const idx = inventoryPhotoSlotCounters[groupId];
  const inputId = `${groupId}_input${idx}`;

  const slot = document.createElement('div');
  slot.className = 'inventory-photo-slot';

  const uploadArea = document.createElement('div');
  uploadArea.className = 'inventory-upload-area';
  uploadArea.addEventListener('click', () => fileInput.click());

  const placeholder = document.createElement('div');
  placeholder.className = 'inventory-upload-placeholder';
  placeholder.innerHTML = '<span class="inventory-upload-icon">&#128247;</span><span>Tap to add</span>';

  const preview = document.createElement('img');
  preview.className = 'inventory-photo-preview';
  preview.alt = 'Signage photo preview';
  preview.style.display = 'none';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.id = inputId;
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileInput._selectedFile = file;
    const reader = new FileReader();
    reader.onload = (ev) => {
      preview.src = ev.target.result;
      preview.style.display = 'block';
      placeholder.style.display = 'none';
      removeBtn.style.display = 'block';
    };
    reader.readAsDataURL(file);
    updateSignageAddBtn(groupId);
  });

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'inventory-photo-remove-btn';
  removeBtn.textContent = 'Remove';
  removeBtn.style.display = 'none';
  removeBtn.addEventListener('click', () => {
    const min = parseInt(group.dataset.min || '0', 10);
    if (getInventorySlotCount(group) > Math.max(min, 1)) {
      slot.remove();
    } else {
      fileInput.value = '';
      fileInput._selectedFile = null;
      preview.src = '';
      preview.style.display = 'none';
      placeholder.style.display = 'flex';
      removeBtn.style.display = 'none';
    }
    updateSignageAddBtn(groupId);
  });

  uploadArea.appendChild(placeholder);
  uploadArea.appendChild(preview);
  uploadArea.appendChild(fileInput);
  slot.appendChild(uploadArea);
  slot.appendChild(removeBtn);
  group.appendChild(slot);
  updateSignageAddBtn(groupId);
}

function initSignagePhotoGroups() {
  SIGNAGE_PHOTO_GROUPS.forEach(({ id, min }) => {
    inventoryPhotoSlotCounters[id] = 0;
    const group = document.getElementById(id);
    if (!group) return;
    for (let i = 0; i < min; i++) addInventoryPhotoSlot(id);
  });
  document.querySelectorAll('[data-add-for]').forEach((btn) => {
    btn.addEventListener('click', () => addInventoryPhotoSlot(btn.dataset.addFor));
  });
}

function collectSignagePhotos() {
  const photos = {};
  SIGNAGE_PHOTO_GROUPS.forEach(({ id, category }) => {
    const group = document.getElementById(id);
    photos[category] = group
      ? Array.from(group.querySelectorAll('input[type="file"]'))
          .map((inp) => inp._selectedFile || inp.files?.[0] || null)
          .filter(Boolean)
      : [];
  });
  return photos;
}

function validateSignagePhotos(photos) {
  for (const { category, title, min } of SIGNAGE_PHOTO_GROUPS) {
    const count = (photos[category] || []).length;
    if (count < min) {
      const needed = min === 1 ? '1 photo' : `${min} photos`;
      return `"${title}" requires ${needed} (${count} attached).`;
    }
  }
  return '';
}

async function resizeSignageImage(file) {
  return new Promise((resolve) => {
    const MAX_SIDE = 1280;
    const QUALITY = 0.72;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width: w, height: h } = img;
      if (w > MAX_SIDE || h > MAX_SIDE) {
        if (w > h) { h = Math.round((h * MAX_SIDE) / w); w = MAX_SIDE; }
        else { w = Math.round((w * MAX_SIDE) / h); h = MAX_SIDE; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => { URL.revokeObjectURL(url); resolve(blob || file); }, 'image/jpeg', QUALITY);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

async function uploadSignagePhoto({ submissionId, pool, category, file, index }) {
  const blob = await resizeSignageImage(file);
  const safeName = String(file.name || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
  const photoId = `${Date.now()}_${index}_${safeName}`;
  const path = `inventorySubmissionMedia/${submissionId}/signage/${category}/${photoId}`;
  const ref = storageRef(getStorage(app), path);
  await uploadBytes(ref, blob, { contentType: 'image/jpeg' });
  const url = await getDownloadURL(ref);
  return { url, name: file.name || safeName, storagePath: path, category, index };
}

function renderSignageSection() {
  const section = document.createElement('section');
  section.className = 'inventory-section-card inventory-chemical-card inventory-signage-card';
  const header = document.createElement('h3');
  header.textContent = 'Pool Area Signage';
  const subtitle = document.createElement('p');
  subtitle.className = 'inventory-directions inventory-signage-subtitle';
  subtitle.textContent = 'Take images of all required signage.';
  section.appendChild(header);
  section.appendChild(subtitle);

  SIGNAGE_PHOTO_GROUPS.forEach(({ id, category, title, description, min, max }) => {
    const group = document.createElement('div');
    group.className = 'inventory-photo-group';
    group.innerHTML = `
      <h4 class="inventory-photo-group-title">${escapeHtml(title)}
        <span class="inventory-photo-required">${min === 1 ? '1 photo required' : `${min} photos required`}</span>
      </h4>
      <p class="inventory-photo-group-desc">${escapeHtml(description)}</p>
      <div class="inventory-photo-slots" id="${id}" data-category="${category}" data-min="${min}" data-max="${max}"></div>
      <button type="button" class="inventory-add-photo-btn" data-add-for="${id}">+ Add Photo</button>
    `;
    section.appendChild(group);
  });
  return section;
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

function renderChemicalInventoryFields() {
  if (!els.chemical) return;
  const pool = getSelectedPool();
  els.chemical.innerHTML = `
    <section class="inventory-section-card inventory-chemical-card">
      <h3>Chemical Inventory Log</h3>
      <div class="inventory-chemical-grid">
        <label>
          <span>Bleach Volume (%)</span>
          <input type="number" id="chemicalBleachVolume" min="0" max="100" placeholder="0-100">
        </label>
        <label>
          <span>Muriatic Acid (gal)</span>
          <input type="number" id="chemicalMuriaticAcid" min="0" step="0.5" placeholder="Gallons">
        </label>
        <label>
          <span>Shock / Granular (%)</span>
          <input type="number" id="chemicalShockGranular" min="0" max="100" placeholder="0-100">
        </label>
      </div>
    </section>
    <section class="inventory-section-card inventory-chemical-card">
      <h3>CYA Levels</h3>
      <p class="inventory-directions">Enter a CYA level for each pool at this facility.</p>
      <div class="inventory-chemical-cya-list" id="chemicalCyaFields"></div>
    </section>
  `;
  const cyaFields = els.chemical.querySelector('#chemicalCyaFields');
  if (cyaFields) {
    if (!pool) {
      cyaFields.innerHTML = '<p class="inventory-directions">Select a facility above to see CYA fields.</p>';
    } else {
      const numPools = Math.max(1, parseInt(pool.numPools || pool.poolCount || pool.rules?.pools?.length || 1, 10));
      const poolDefs = Array.isArray(pool.rules?.pools) ? pool.rules.pools : [];
      for (let i = 1; i <= numPools; i += 1) {
        const def = poolDefs[i - 1] || {};
        const label = def.poolName ? `Pool ${i}: ${def.poolName}` : (numPools === 1 ? getPoolName(pool) : `Pool ${i}`);
        const row = document.createElement('label');
        row.className = 'inventory-chemical-cya-row';
        row.innerHTML = `
          <span>${escapeHtml(label)}</span>
          <input type="number" min="0" max="100" class="inventory-chemical-cya-input" data-pool-index="${i}" placeholder="0-100">
        `;
        cyaFields.appendChild(row);
      }
    }
  }

  els.chemical.appendChild(renderSignageSection());
  initSignagePhotoGroups();
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
  els.chemical?.classList.toggle('hidden', type !== 'chemical');
  els.addItem?.classList.toggle('hidden', type !== 'weekly' && type !== 'urgent');
  if (els.directions) {
    els.directions.textContent = type === 'urgent'
      ? 'Use this form to indicate any items that are critically low in stock and will run out before the next inventory form is completed (Thursdays).'
      : type === 'weekly'
        ? 'Fill out this form to indicate the supply level of each item needed to run your pool.'
      : type === 'chemical'
        ? 'Record chemical inventory log values for the selected facility.'
        : '';
  }
  if (type === 'weekly') renderWeeklyFields();
  if (type === 'urgent') renderUrgentFields();
  if (type === 'chemical') renderChemicalInventoryFields();
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

function collectChemicalInventoryValues() {
  const cyaReadings = {};
  document.querySelectorAll('.inventory-chemical-cya-input').forEach((input) => {
    if (input.value !== '') {
      cyaReadings[`pool${input.dataset.poolIndex}`] = parseFloat(input.value);
    }
  });
  return {
    bleachVolume: document.getElementById('chemicalBleachVolume')?.value || null,
    muriaticAcid: document.getElementById('chemicalMuriaticAcid')?.value || null,
    shockGranular: document.getElementById('chemicalShockGranular')?.value || null,
    cyaReadings,
  };
}

async function handleInventorySubmit(event) {
  event.preventDefault();
  const type = els.formType?.value || '';
  const pool = getSelectedPool();
  if (!type) return setMessage('Choose a form first.', true);
  if (!pool) return setMessage('Select a facility.', true);

  const respondent = getRespondentInfo();
  const markets = Array.isArray(pool.markets) ? pool.markets : (pool.market ? [pool.market] : []);

  try {
    els.submit.disabled = true;
    els.submit.textContent = 'Submitting...';
    setMessage('');

    if (type === 'chemical') {
      const chemicalValues = collectChemicalInventoryValues();
      const hasChemicalValue = ['bleachVolume', 'muriaticAcid', 'shockGranular'].some((key) => chemicalValues[key] !== null && chemicalValues[key] !== '') ||
        Object.keys(chemicalValues.cyaReadings || {}).length > 0;
      if (!hasChemicalValue) return setMessage('Enter at least one chemical inventory value.', true);

      const signagePhotos = collectSignagePhotos();
      const signageError = validateSignagePhotos(signagePhotos);
      if (signageError) return setMessage(signageError, true);

      const submissionRef = doc(collection(db, 'managerialReports'));
      const submissionId = submissionRef.id;
      const poolName = getPoolName(pool);

      setMessage('Uploading signage photos…');
      const uploadedSignage = {};
      for (const { category } of SIGNAGE_PHOTO_GROUPS) {
        uploadedSignage[category] = [];
        const files = signagePhotos[category] || [];
        for (let i = 0; i < files.length; i++) {
          uploadedSignage[category].push(
            await uploadSignagePhoto({ submissionId, pool: poolName, category, file: files[i], index: i })
          );
        }
      }
      setMessage('Saving…');

      await setDoc(submissionRef, {
        reportType: 'managerial',
        formType: 'chemicalInventory',
        timestamp: serverTimestamp(),
        submittedAtIso: new Date().toISOString(),
        pool: poolName,
        facilityId: pool.id || poolName,
        facilityName: poolName,
        market: markets[0] || 'Other',
        photos: { bleach: [], signage: uploadedSignage },
        signagePhotos: uploadedSignage,
        ...chemicalValues,
        ...respondent,
        version: 2,
      });
    } else {
      const items = type === 'urgent' ? collectUrgentItems(pool) : collectWeeklyItems(pool);
      if (!items.length) return setMessage('Add at least one item.', true);
      const missingStatus = items.find((item) => !item.status);
      if (missingStatus) return setMessage(`Select a level for ${missingStatus.item}.`, true);
      await setDoc(doc(collection(db, 'inventorySubmissions')), {
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
    }
    event.target.reset();
    syncFormType();
    setMessage(type === 'chemical' ? 'Chemical inventory log submitted.' : 'Inventory submitted.', false);
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
  const requestedForm = new URLSearchParams(window.location.search).get('form');
  if (requestedForm && els.formType?.querySelector(`option[value="${requestedForm}"]`)) {
    els.formType.value = requestedForm;
  }
  els.formType?.addEventListener('change', syncFormType);
  els.facility?.addEventListener('change', () => {
    if (els.formType?.value === 'weekly') renderWeeklyFields();
    if (els.formType?.value === 'urgent') renderUrgentFields();
    if (els.formType?.value === 'chemical') renderChemicalInventoryFields();
  });
  els.addItem?.addEventListener('click', handleAddItem);
  els.form?.addEventListener('submit', handleInventorySubmit);
  syncFormType();
});
