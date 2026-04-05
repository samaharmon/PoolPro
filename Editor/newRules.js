import { getPools, listenPools, savePoolDoc, deletePoolDoc } from '../firebase.js';
 
let poolsCache = [];
let currentPoolId = '';
let poolsListenerStarted = false;

let currentEditorMode = window.currentEditorMode ?? null;
window.currentEditorMode = currentEditorMode;

// Safety alias in case any older inline handler references the typo:
window.CurrentEditorMide = window.currentEditorMode;

// ---- Per‑sanitation rule state ----
const SANITATION_METHODS = ['bleach', 'granular'];

// ruleStateByPool[poolIndex] = { bleach: { ph:{}, cl:{} }, granular: { ph:{}, cl:{} } }
const ruleStateByPool = {};

// ---------- Rockbridge preset handling ----------

const ROCKBRIDGE_PRESET_STORAGE_KEY = 'chemlog_rockbridge_preset_v1';
const RULE_RESPONSE_SELECTOR = '.ruleResponse';
const ALLOWED_RULE_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR']);

function escapeHtmlUnsafe(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getResponseFields(block, poolIndex) {
  return block.querySelectorAll(`${RULE_RESPONSE_SELECTOR}[id^="pool${poolIndex}_"]`);
}

function getRuleContent(field) {
  if (!field) return '';
  if (field.isContentEditable) return field.innerHTML.trim();
  return (field.value || '').trim();
}

function setRuleContent(field, html) {
  const safeHtml = sanitizeRuleMarkup(html);
  if (field.isContentEditable) {
    field.innerHTML = safeHtml;
  } else {
    field.value = safeHtml;
  }
}

function sanitizeRuleMarkup(inputHtml) {
  if (!inputHtml) return '';
  const root = document.createElement('div');
  root.innerHTML = String(inputHtml);

  const cleanNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtmlUnsafe(node.textContent || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toUpperCase();
    if (!ALLOWED_RULE_TAGS.has(tag)) {
      const inner = Array.from(node.childNodes).map(cleanNode).join('');
      if (tag === 'DIV' || tag === 'P' || tag === 'LI') return `${inner}<br>`;
      return inner;
    }

    if (tag === 'BR') return '<br>';
    const inner = Array.from(node.childNodes).map(cleanNode).join('');
    const normalized = tag === 'B' ? 'strong' : tag === 'I' ? 'em' : tag.toLowerCase();
    return `<${normalized}>${inner}</${normalized}>`;
  };

  return Array.from(root.childNodes).map(cleanNode).join('');
}

/**
 * Read the current metadata + rule tables from the editor and, if the
 * pool name is "Rockbridge", store them in localStorage so they can be
 * used as defaults for any *new* pools that get created later.
 */
function captureRockbridgePresetIfNeeded() {
  const nameInput = document.getElementById('editorPoolName');
  if (!nameInput) return;

  const poolName = (nameInput.value || '').trim();
  if (poolName !== 'Rockbridge') return;

  const numPoolsSelect = document.getElementById('editorNumPools');
  const marketCheckboxes = document.querySelectorAll('input[name="editorMarket"]');

  const preset = {
    metadata: {
      numPools: numPoolsSelect ? Number(numPoolsSelect.value || 2) : 2,
      markets: Array.from(marketCheckboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.value),
    },
    rulesByPoolIndex: {},
  };

  // Capture all rules from each pool rule block
  document.querySelectorAll('.pool-rule-block').forEach(block => {
    const poolIndex = block.dataset.poolIndex;
    if (!poolIndex) return;

    const poolRules = { ph: {}, cl: {} };

    getResponseFields(block, poolIndex).forEach((area) => {
      const typeKey = area.id.includes('_ph_') ? 'ph' : 'cl';
      const key = area.id.replace(`pool${poolIndex}_${typeKey}_`, '');
      const levelSelect = document.getElementById(`${area.id}_level`);

      poolRules[typeKey][key] = {
        response: sanitizeRuleMarkup(getRuleContent(area)),
        concernLevel: levelSelect ? levelSelect.value : 'none',
      };
    });

    preset.rulesByPoolIndex[poolIndex] = poolRules;
  });

  try {
    localStorage.setItem(
      ROCKBRIDGE_PRESET_STORAGE_KEY,
      JSON.stringify(preset)
    );
    // console.log('Rockbridge preset updated', preset);
  } catch (err) {
    console.error('Unable to save Rockbridge preset', err);
  }
}

/**
 * Apply the last-saved Rockbridge preset to the editor while in
 * "Add new pool" mode.  Pool name is intentionally reset to "New Pool"
 * so you don't accidentally create another Rockbridge.
 */
function applyRockbridgePresetToNewPool() {
  let raw = null;
  try {
    raw = localStorage.getItem(ROCKBRIDGE_PRESET_STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (!raw) return;

  let preset;
  try {
    preset = JSON.parse(raw);
  } catch {
    return;
  }

  const nameInput = document.getElementById('editorPoolName');
  const numPoolsSelect = document.getElementById('editorNumPools');
  const marketCheckboxes = document.querySelectorAll('input[name="editorMarket"]');

  // Always reset the name to something generic for a new pool
  if (nameInput) {
    nameInput.value = 'New Pool';
  }
  if (numPoolsSelect && preset.metadata && preset.metadata.numPools) {
    numPoolsSelect.value = String(preset.metadata.numPools);
  }

  // Markets
  if (preset.metadata && Array.isArray(preset.metadata.markets)) {
    const set = new Set(preset.metadata.markets);
    marketCheckboxes.forEach(cb => {
      cb.checked = set.has(cb.value);
    });
  }

  // Rules for each pool index (1, 2, etc.)
  if (!preset.rulesByPoolIndex) return;

  Object.entries(preset.rulesByPoolIndex).forEach(([poolIndex, rules]) => {
    ['ph', 'cl'].forEach(typeKey => {
      const group = rules[typeKey] || {};
      Object.entries(group).forEach(([key, rule]) => {
        const responseField = document.getElementById(
          `pool${poolIndex}_${typeKey}_${key}`
        );
        const levelSelect = document.getElementById(
          `pool${poolIndex}_${typeKey}_${key}_level`
        );

        if (responseField && typeof rule.response === 'string') {
          setRuleContent(responseField, rule.response);
        }
        if (levelSelect && rule.concernLevel) {
          levelSelect.value = rule.concernLevel;
        }
      });
    });
  });
}


function createEmptyMethodRules() {
  return { ph: {}, cl: {} };
}

function getOrCreatePoolRuleState(poolIndex) {
  if (!ruleStateByPool[poolIndex]) {
    ruleStateByPool[poolIndex] = {
      bleach: createEmptyMethodRules(),
      granular: createEmptyMethodRules(),
    };
  }
  return ruleStateByPool[poolIndex];
}

/**
 * Read the currently visible textareas + Concern dropdowns for a block
 * into ruleStateByPool[poolIndex][method].
 */
function captureRulesFromBlock(block, method) {
  const poolIndex = block.dataset.poolIndex;
  const state = getOrCreatePoolRuleState(poolIndex);

  const methodRules = { ph: {}, cl: {} };

  getResponseFields(block, poolIndex).forEach((area) => {
    const typeKey = area.id.includes('_ph_') ? 'ph' : 'cl';
    const key = area.id.replace(`pool${poolIndex}_${typeKey}_`, '');
    const levelSelect = document.getElementById(`${area.id}_level`);
    methodRules[typeKey][key] = {
      response: sanitizeRuleMarkup(getRuleContent(area)),
      concernLevel: levelSelect ? levelSelect.value : 'none',
    };
  });

  // 🔁 pH is shared across ALL sanitation methods (Bleach + Granular).
  // Whatever is on screen right now becomes the single source of truth
  // for pH for this pool, regardless of which tab is active.
  SANITATION_METHODS.forEach((m) => {
    if (!state[m]) state[m] = createEmptyMethodRules();
    state[m].ph = JSON.parse(JSON.stringify(methodRules.ph));
  });

  // 💧 Chlorine rules remain method‑specific.
  if (!state[method]) state[method] = createEmptyMethodRules();
  state[method].cl = JSON.parse(JSON.stringify(methodRules.cl));
}

/**
 * Push one method’s rules from ruleStateByPool back into the DOM
 * for a single pool block.
 */
function showRulesForMethod(block, method) {
  const poolIndex = block.dataset.poolIndex;
  const state = getOrCreatePoolRuleState(poolIndex);

  // If we switch to Granular and its Cl rules are empty
  // but Bleach has Cl rules, clone them so the user
  // never sees a blank granular Cl section by default.
  if (method === 'granular') {
    const bleach   = state.bleach   || createEmptyMethodRules();
    const granular = state.granular || createEmptyMethodRules();

    const granularCl = granular.cl || {};
    const hasAnyGranularCl = Object.values(granularCl).some(
      (rule) =>
        rule &&
        typeof rule.response === 'string' &&
        rule.response.trim() !== ''
    );

    if (!hasAnyGranularCl && bleach.cl) {
      granular.cl = JSON.parse(JSON.stringify(bleach.cl));
      state.granular = granular;
    }
  }

  const methodState = state[method] || createEmptyMethodRules();
  applyRuleToInputs(block, methodState);
  block.dataset.activeMethod = method;
}

const poolRuleContainerSelector = '#poolRuleBlocks .pool-rule-block';

function setModeButtonsActive(mode) {
  const addBtn = document.getElementById('editorModeAdd');
  const editBtn = document.getElementById('editorModeEdit');
  if (!addBtn || !editBtn) return;

  addBtn.classList.toggle('active', mode === 'add');
  editBtn.classList.toggle('active', mode === 'edit');
}

function showEditorDetails() {
  const poolMetadataSection = document.getElementById('poolMetadataSection');
  const ruleEditorSection = document.getElementById('ruleEditorSection');
  if (poolMetadataSection) poolMetadataSection.style.display = '';
  if (ruleEditorSection) ruleEditorSection.style.display = '';
}

function removeDuplicateRuleHeaderControls() {
  document.querySelectorAll('.pool-rule-header').forEach((header) => {
    const duplicateTitle = Array.from(header.querySelectorAll('h4')).find((h4) => !h4.classList.contains('pool-rule-title'));
    if (duplicateTitle) duplicateTitle.remove();

    const duplicateTabs = header.querySelector('.sanitation-tabs');
    if (duplicateTabs) duplicateTabs.remove();
  });
}

 
function removePoolShapeGallonage() {
  const stale = document.getElementById('poolShapeGallonage');
  if (stale?.parentElement) {
    stale.parentElement.removeChild(stale);
  }
}

function getPoolName(pool) {
  return pool?.name || pool?.poolName || pool?.id || '';
}
 
function renderSelectOptions(selectEl, pools) {
  if (!selectEl) return;
  const previous = selectEl.value;
  selectEl.innerHTML = '<option value="">Select an existing pool...</option>';

  // Group pools by market (matching chem.html Pool Location style)
  const marketMap = {};
  pools.forEach(pool => {
    const markets = Array.isArray(pool.markets) ? pool.markets
      : (pool.market ? [pool.market] : ['Other']);
    const primary = markets[0] || 'Other';
    if (!marketMap[primary]) marketMap[primary] = [];
    marketMap[primary].push(pool);
  });

  Object.keys(marketMap).sort().forEach(market => {
    const group = document.createElement('optgroup');
    group.label = market;
    marketMap[market].sort((a, b) => getPoolName(a).localeCompare(getPoolName(b))).forEach(pool => {
      const option = document.createElement('option');
      option.value = pool.id;
      option.textContent = getPoolName(pool);
      group.appendChild(option);
    });
    selectEl.appendChild(group);
  });

  if (previous && selectEl.querySelector(`option[value="${previous}"]`)) {
    selectEl.value = previous;
  }
}
 
function updateGlobalPoolOptions(pools) {
  const poolLocationSelect = document.getElementById('poolLocation'); // ChemLog form
  const poolFilterSelect   = document.getElementById('poolFilter');   // dashboard filter
  const guardPoolSelect    = document.getElementById('guardPool');    // lifeguard signup

  const applyOptions = (selectEl, placeholderText) => {
    if (!selectEl) return;

    const prev = selectEl.value;
    const placeholder = placeholderText || 'Select a pool.';

    selectEl.innerHTML = `<option value="">${placeholder}</option>`;

    pools.forEach((pool) => {
      const name = getPoolName(pool);
      if (!name) return;

      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      selectEl.appendChild(option);
    });

    if (prev && selectEl.querySelector(`option[value="${prev}"]`)) {
      selectEl.value = prev;
    }
  };

  applyOptions(poolLocationSelect, 'Select a pool.');
  applyOptions(poolFilterSelect, 'All pools');
  applyOptions(guardPoolSelect, 'Select your home pool');
}
 
function startPoolListener() {
  if (poolsListenerStarted) return;
  poolsListenerStarted = true;
  listenPools((pools) => {
    poolsCache = pools;
    renderSelectOptions(document.getElementById('editorPoolSelect'), pools);
    updateGlobalPoolOptions(pools);
   });
 }
 

function setBlockEnabled(block, enabled) {
  const ruleInputs = block.querySelectorAll(`.rules-table ${RULE_RESPONSE_SELECTOR}, .rules-table select`);
  ruleInputs.forEach((el) => {
    if (el.matches('select')) {
      el.disabled = !enabled;
      return;
    }
    if (el.isContentEditable || el.getAttribute('contenteditable') !== null) {
      el.setAttribute('contenteditable', enabled ? 'true' : 'false');
      el.classList.toggle('readonly-editor', !enabled);
    } else {
      el.disabled = !enabled;
    }
  });

  // Also enable/disable the pool name input in the header
  const nameInput = block.querySelector('.pool-name-input');
  if (nameInput) nameInput.disabled = !enabled;

  // add overlay class only to the rules-table region
  block.querySelectorAll('.rules-table').forEach(tbl => {
    tbl.classList.toggle('overlay-disabled', !enabled);
  });

  block.classList.toggle('is-saved-mode', !enabled);
  block.dataset.isEditing = enabled ? 'true' : 'false';
  block.querySelectorAll('.formatting-toolbar .format-btn').forEach((btn) => {
    btn.disabled = !enabled;
  });
}
 
function setMetadataEnabled(enabled) {
  const metadataSection = document.getElementById('poolMetadataSection');
  if (!metadataSection) return;

  const fields = [
    document.getElementById('editorPoolName'),
    document.getElementById('editorNumPools'),
    ...document.querySelectorAll('input[name="editorMarket"]'),
  ];

  fields.forEach((el) => {
    if (el) el.disabled = !enabled;
  });

  metadataSection.classList.toggle('overlay-disabled', !enabled);
}

 
function updatePoolBlockVisibility(count) {
  const blocks = document.querySelectorAll('#poolRuleBlocks .pool-rule-block');
  blocks.forEach((block, index) => {
    block.style.display = index < count ? '' : 'none';
  });
}

function applyRuleToInputs(block, rules = {}) {
  const poolIndex = block.dataset.poolIndex;

  getResponseFields(block, poolIndex).forEach((area) => {
    const typeKey = area.id.includes('_ph_') ? 'ph' : 'cl';
    const key = area.id.replace(`pool${poolIndex}_${typeKey}_`, '');
    const levelSelect = document.getElementById(`${area.id}_level`);

    const ruleEntry = rules[typeKey]?.[key] || {};
    setRuleContent(area, ruleEntry.response || '');
    autoResizeRuleTextarea(area);

    if (levelSelect) {
      levelSelect.value = ruleEntry.concernLevel || 'none';
      applyConcernToRow(levelSelect);
    }
  });
}
 
function extractLegacyRulesFromDoc(rawDoc, poolIndex) {
  // Attempt to reconstruct rules from old flat fields like:
  // pool1_ph_lt_7_0, pool1_ph_7_0, pool1_cl_0_1, etc.
  if (!rawDoc) return { ph: {}, cl: {} };

  const ph = {};
  const cl = {};

  const prefixPh = `pool${poolIndex}_ph_`;
  const prefixCl = `pool${poolIndex}_cl_`;

  Object.keys(rawDoc).forEach((key) => {
    if (key.startsWith(prefixPh) && !key.endsWith('_level')) {
      const valueKey = key.slice(prefixPh.length);  // e.g. "lt_7_0"
      const response = rawDoc[key];
      const concernLevel = rawDoc[`${key}_level`] || 'none';
      ph[valueKey] = { response, concernLevel };
    }

    if (key.startsWith(prefixCl) && !key.endsWith('_level')) {
      const valueKey = key.slice(prefixCl.length);
      const response = rawDoc[key];
      const concernLevel = rawDoc[`${key}_level`] || 'none';
      cl[valueKey] = { response, concernLevel };
    }
  });

  return { ph, cl };
}

async function maybeMigrateLegacyRules(poolDoc) {
  const raw = poolDoc.rawData || {};
  const existing = poolDoc.rules?.pools || [];

  // If we already have rules in the new shape, nothing to do
  if (Array.isArray(existing) && existing.some(p => p && (p.bleach || p.granular))) {
    return poolDoc;
  }

  // Try to build new rules array from legacy fields
  const migratedPools = [];
  for (let poolIndex = 1; poolIndex <= 5; poolIndex++) {
    const legacy = extractLegacyRulesFromDoc(raw, poolIndex);

    const hasAny =
      (legacy.ph && Object.keys(legacy.ph).length) ||
      (legacy.cl && Object.keys(legacy.cl).length);

    if (!hasAny) {
      migratedPools.push({ bleach: { ph: {}, cl: {} }, granular: { ph: {}, cl: {} } });
      continue;
    }

    migratedPools.push({
      bleach: {
        ph: legacy.ph || {},
        cl: legacy.cl || {},
      },
      granular: {
        ph: legacy.ph || {},
        cl: legacy.cl || {},
      },
    });
  }

  const newRules = { pools: migratedPools };
  const updatedDoc = {
    ...poolDoc,
    rules: newRules,
  };

  // Persist the migrated rules back to Firestore so we don't have to do this again
  if (typeof savePoolDoc === 'function' && poolDoc.id) {
    try {
      await savePoolDoc(poolDoc.id, { rules: newRules });
      console.log('✅ Migrated legacy rules for pool', poolDoc.id);
    } catch (err) {
      console.error('Error migrating legacy rules for pool', poolDoc.id, err);
    }
  }

  return updatedDoc;
}

async function loadPoolIntoEditor(poolDoc) {
  if (!poolDoc) return;

  // poolDoc.rawData should be the original Firestore data; if you're currently
  // passing plain .data(), adjust getPools/listenPools to include it.
  const normalizedDoc =
    poolDoc.rules && poolDoc.rules.pools ?
      poolDoc
      : await maybeMigrateLegacyRules(poolDoc);

  currentPoolId = normalizedDoc.id || '';

  // Reveal the metadata + rule sections when editing
  const metadataSection = document.getElementById('poolMetadataSection');
  const ruleSection = document.getElementById('ruleEditorSection');
  metadataSection?.classList.remove('hidden');
  ruleSection?.classList.remove('hidden');

  const poolNameInput   = document.getElementById('editorPoolName');
  const numPoolsInput   = document.getElementById('editorNumPools');
  const marketCheckboxes = document.querySelectorAll('input[name="editorMarket"]');

  // Basic metadata
  if (poolNameInput) {
    poolNameInput.value = getPoolName(normalizedDoc);
  }

  if (numPoolsInput) {
    const savedCount = normalizedDoc.numPools || normalizedDoc.poolCount || 1;
    numPoolsInput.value = String(savedCount);

    const count = Math.max(1, Math.min(5, Number(savedCount) || 1));
    updatePoolBlockVisibility(count);
  }

  if (marketCheckboxes?.length) {
    const markets = normalizedDoc.markets || normalizedDoc.market || [];
    marketCheckboxes.forEach((cb) => {
      cb.checked = markets.includes(cb.value);
    });
  }

  // Load rules for each pool (bleach + granular) into editor state
  const rulesForPools = normalizedDoc.rules?.pools || [];
  const blocks = document.querySelectorAll(poolRuleContainerSelector);

  blocks.forEach((block, idx) => {
    const poolIndex = block.dataset.poolIndex;
    const state = getOrCreatePoolRuleState(poolIndex);
    const fromDoc = rulesForPools[idx] || {};

    if (fromDoc.bleach || fromDoc.granular) {
      const sharedPh = {
        ...(fromDoc.bleach?.ph || {}),
        ...(fromDoc.granular?.ph || {}),
      };

      state.bleach = {
        ph: sharedPh,
        cl: fromDoc.bleach?.cl || {},
      };
      state.granular = {
        ph: sharedPh,
        cl: fromDoc.granular?.cl || {},
      };
    }

    applyRuleToInputs(block, state.bleach); // default view: bleach

    // Load pool sub-name if stored
    const nameInput = block.querySelector('.pool-name-input');
    if (nameInput) nameInput.value = fromDoc.poolName || '';
  });

  // Make sure the right sanitize tab is active & buttons are wired
  setupSanitationTabs();
  wireBlockButtons();

  // Start in read-only state; user must click Edit to modify metadata
  setMetadataEnabled(false);
  const editBtn = document.getElementById('editMetadataBtn');
  const saveBtn = document.getElementById('saveMetadataBtn');
  if (editBtn) editBtn.disabled = false;
  if (saveBtn) saveBtn.disabled = true;
}
 
const EDITOR_FADE_MS = 250;

function fadeShow(el) {
  if (!el) return;

  // If the element has an inline "display:none" (rockbridge wrapper does),
  // clear it so the element can appear.
  if (el.style && el.style.display === "none") el.style.display = "";

  el.classList.remove("hidden");
  el.style.opacity = "0";
  el.style.transition = `opacity ${EDITOR_FADE_MS}ms ease`;

  requestAnimationFrame(() => {
    el.style.opacity = "1";
  });
}

function fadeHide(el) {
  if (!el) return;
  if (el.classList.contains("hidden")) return;

  el.style.transition = `opacity ${EDITOR_FADE_MS}ms ease`;
  el.style.opacity = "0";

  window.setTimeout(() => {
    el.classList.add("hidden");
    el.style.removeProperty("opacity");
    el.style.removeProperty("transition");
  }, EDITOR_FADE_MS);
}

function readEditorToObject() {
  const poolNameInput   = document.getElementById('editorPoolName');
  const numPoolsInput   = document.getElementById('editorNumPools');
  const marketCheckboxes = document.querySelectorAll('input[name="editorMarket"]');

  const name = poolNameInput?.value.trim() || '';
  const numPools = numPoolsInput ? parseInt(numPoolsInput.value || '1', 10) : 1;

  const markets = [];
  marketCheckboxes.forEach((cb) => {
    if (cb.checked) markets.push(cb.value);
  });

  const blocks = document.querySelectorAll(poolRuleContainerSelector);
  const pools = [];

  blocks.forEach((block, idx) => {
    if (idx >= numPools) return; // respect "Number of pools"

    const poolIndex = block.dataset.poolIndex;
    const currentMethod = block.dataset.activeMethod || 'bleach';

    // Make sure the currently visible method is captured from DOM
    captureRulesFromBlock(block, currentMethod);

    const state = getOrCreatePoolRuleState(poolIndex);
    const nameInput = block.querySelector('.pool-name-input');
    const poolName = nameInput ? nameInput.value.trim() : '';

    pools.push({
      bleach: state.bleach || createEmptyMethodRules(),
      granular: state.granular || createEmptyMethodRules(),
      poolName,
    });
  });

  return {
    name,
    markets,
    numPools,
    rules: { pools },
  };
}

async function handleSavePoolClick() {
  if (!currentPoolId && !getPoolNameFromEditor()) {
    showMessage('Please give the pool a name before saving.', 'error');
    return;
  }

  const poolDoc = readEditorToObject();

  // Safety: don’t allow saving a pool with zero rules
  const poolsArray = (poolDoc.rules && poolDoc.rules.pools) || [];
  if (!Array.isArray(poolsArray) || poolsArray.length === 0) {
    showMessage('No rule rows found. Add at least one PH / Cl rule block before saving.', 'error');
    return;
  }

  const updatedId = await savePoolDoc(currentPoolId, poolDoc);
  if (updatedId) {
    currentPoolId = updatedId;
    showMessage('Pool rules saved.', 'success');
  } else {
    showMessage('There was an error saving this pool.', 'error');
  }
}
 
async function attemptSave() {
  const poolData = readEditorToObject();
  if (!poolData) return false;

  try {
    const poolId = currentPoolId || poolData.name;
    const savedId = await savePoolDoc(poolId, poolData);
    currentPoolId = savedId || poolId;
    onSaveSuccess(currentPoolId);
    disableAllEditors();
    return true;
  } catch (error) {
    console.error('Failed to save pool', error);
    showMessage('Could not save the pool. Please try again.', 'error');
    return false;
  }
}
 
function disableAllEditors() {
  const blocks = document.querySelectorAll(poolRuleContainerSelector);
  blocks.forEach((block) => {
    setBlockEnabled(block, false);
  });

  // Match the IDs in NewRules.html
  const metadataEditBtn = document.getElementById('editMetadataBtn');
  const metadataSaveBtn = document.getElementById('saveMetadataBtn');
  if (metadataEditBtn && metadataSaveBtn) {
    metadataEditBtn.disabled = false;
    metadataSaveBtn.disabled = true;
  }

  setMetadataEnabled(false);
  captureRockbridgePresetIfNeeded();
}

 
// Turn each block's Edit / Save pair into a theme-switch style toggle
function wireBlockButtons(singleBlock) {
  const blocks = singleBlock ?
    [singleBlock]
    : Array.from(document.querySelectorAll(poolRuleContainerSelector));

  blocks.forEach((block) => {
    const ruleButtons = block.querySelector('.rule-buttons');
    if (!ruleButtons) return;

    const editBtn = ruleButtons.querySelector('.pool-edit-btn');
    const saveBtn = ruleButtons.querySelector('.pool-save-btn');
    if (!editBtn || !saveBtn) return;

    // Skip if already converted
    if (ruleButtons.querySelector('.theme-switch')) return;

    // Hide original buttons (keep in DOM for reference but use checkbox for UX)
    editBtn.style.display = 'none';
    saveBtn.style.display = 'none';

    // Build theme-switch style toggle: unchecked = Edit mode, checked = Saved mode
    const label = document.createElement('label');
    label.className = 'theme-toggle rule-edit-save-toggle';

    const switchDiv = document.createElement('div');
    switchDiv.className = 'theme-switch';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'edit-save-toggle-input';
    cb.checked = true; // initial: saved/read-only

    const track = document.createElement('div');
    track.className = 'theme-switch-track';

    const editSpan = document.createElement('span');
    editSpan.className = 'theme-switch-text theme-light-text';
    editSpan.textContent = 'Edit';

    const saveSpan = document.createElement('span');
    saveSpan.className = 'theme-switch-text theme-dark-text';
    saveSpan.textContent = 'Save';

    const thumb = document.createElement('div');
    thumb.className = 'theme-switch-thumb';

    track.append(editSpan, saveSpan, thumb);
    switchDiv.append(cb, track);
    label.append(switchDiv);
    ruleButtons.appendChild(label);

    cb.addEventListener('change', async () => {
      if (!cb.checked) {
        // Unchecked → Edit mode
        setBlockEnabled(block, true);
        block.dataset.isEditing = 'true';
      } else {
        // Checked → Save mode — apply overlay immediately, revert on failure
        setBlockEnabled(block, false);
        block.dataset.isEditing = 'false';
        const success = await attemptSave();
        if (success) {
          captureRockbridgePresetIfNeeded();
        } else {
          // Revert: put block back into Edit mode
          cb.checked = false;
          setBlockEnabled(block, true);
          block.dataset.isEditing = 'true';
        }
      }
    });

    // Initial state: read-only (checked = saved)
    setBlockEnabled(block, false);
  });
}

 // ===============================
// Rule block editing helpers
// ===============================

function setBlockEditing(block, isEditing) {
  const fields = block.querySelectorAll(`${RULE_RESPONSE_SELECTOR}, select`);
  fields.forEach((field) => {
    if (field.matches('select')) {
      field.disabled = !isEditing;
      field.classList.toggle('editable', isEditing);
      return;
    }
    if (field.isContentEditable || field.getAttribute('contenteditable') !== null) {
      field.setAttribute('contenteditable', isEditing ? 'true' : 'false');
      field.classList.toggle('editable', isEditing);
      field.classList.toggle('readonly-editor', !isEditing);
    } else {
      if (isEditing) {
        field.removeAttribute('disabled');
        field.classList.add('editable');
      } else {
        field.setAttribute('disabled', 'disabled');
        field.classList.remove('editable');
      }
    }
  });

  // Sync formatting toolbar button states
  block.querySelectorAll('.formatting-toolbar button').forEach(btn => {
    btn.disabled = !isEditing;
  });

  const editBtn = block.querySelector('.pool-edit-btn');
  const saveBtn = block.querySelector('.pool-save-btn');

  if (editBtn && saveBtn) {
    if (isEditing) {
      editBtn.classList.add('hidden');
      saveBtn.classList.remove('hidden');
    } else {
      editBtn.classList.remove('hidden');
      saveBtn.classList.add('hidden');
    }
  }
}

// Sync the contents of one pool block back into the in‑memory rule state
function syncBlockIntoState(block) {
  const poolIndex = block.dataset.poolIndex;
  if (!poolIndex) return;

  const state = getOrCreatePoolRuleState(poolIndex);
  const activeMethod = block.dataset.activeMethod || 'bleach';

  const methodState = { ph: {}, cl: {} };

  block.querySelectorAll(`${RULE_RESPONSE_SELECTOR}[id]`).forEach((area) => {
    const id = area.id || '';
    const isPh = id.includes('_ph_');
    const typeKey = isPh ? 'ph' : 'cl';
    const key = id.split('_').slice(-1)[0]; // last piece after final underscore

    const levelSelect = document.getElementById(`${id}_level`);
    methodState[typeKey][key] = {
      response: sanitizeRuleMarkup(getRuleContent(area)),
      concern: levelSelect ? levelSelect.value || 'None' : 'None',
    };
  });

  // Write back into the correct method (bleach / granular)
  state[activeMethod] = methodState;
}
 
function wireMetadataButtons() {
  // Match button IDs from NewRules.html
  const editBtn = document.getElementById('editMetadataBtn');
  const saveBtn = document.getElementById('saveMetadataBtn');

  if (!editBtn || !saveBtn) return;

  editBtn.addEventListener('click', () => {
    setMetadataEnabled(true);
    editBtn.disabled = true;
    saveBtn.disabled = false;
  });

  saveBtn.addEventListener('click', async () => {
    const success = await attemptSave();
    if (success) {
      setMetadataEnabled(false);
      editBtn.disabled = false;
      saveBtn.disabled = true;
    }
  });
}

// Rename concern level options (values stay the same)
function relabelConcernOptions() {
  document
    .querySelectorAll('#poolRuleBlocks .concernLevel')
    .forEach((select) => {
      select.querySelectorAll('option').forEach((opt) => {
        if (opt.value === 'none') opt.textContent = 'None';
        if (opt.value === 'yellow') opt.textContent = 'Minor';
        if (opt.value === 'red') opt.textContent = 'Major';
      });
    });
}

async function refreshPools() {
  poolsCache = await getPools();
  renderSelectOptions(document.getElementById('editorPoolSelect'), poolsCache);
  populateCopyRulesLocationSelects();
}
 
function findPoolById(poolId) {
  return poolsCache.find((pool) => pool.id === poolId);
 }
 
function applyRockbridgeMetadataFromCache() {
  const poolNameInput    = document.getElementById('editorPoolName');
  const numPoolsInput    = document.getElementById('editorNumPools');
  const marketCheckboxes = document.querySelectorAll('input[name="editorMarket"]');

  const rockbridge = poolsCache.find((pool) => getPoolName(pool) === 'Rockbridge');

  // If we can't find Rockbridge, fall back to a simple default
  if (!rockbridge) {
    if (poolNameInput) poolNameInput.value = 'New Pool';
    if (numPoolsInput) {
      numPoolsInput.value = '2';
      updatePoolBlockVisibility(2);
    }
    if (marketCheckboxes?.length) {
      marketCheckboxes.forEach((cb) => {
        cb.checked = cb.value === 'Columbia';
      });
    }
    return;
  }

  // Use a generic name so you don't accidentally create a second “Rockbridge”
  if (poolNameInput) {
    poolNameInput.value = 'New Pool';
  }

  // Copy numPools
  if (numPoolsInput) {
    const count = typeof rockbridge.numPools === 'number' ? rockbridge.numPools : 2;
    numPoolsInput.value = String(count);
    updatePoolBlockVisibility(count);
  }

  // Copy markets
  if (marketCheckboxes?.length) {
    const set = new Set(rockbridge.markets || []);
    marketCheckboxes.forEach((cb) => {
      cb.checked = set.size ? set.has(cb.value) : cb.value === 'Columbia';
    });
  }
}


// === Switch between "Add new pool" and "Edit existing pool" ===

// --- Simple fade helpers for showing/hiding editor sections ---
const EDITOR_SECTION_FADE_MS = 250;

function fadeShowSection(el) {
  if (!el) return;
  if (!el.classList.contains('hidden')) return;

  el.classList.remove('hidden');
  el.style.opacity = '0';
  el.style.transition = `opacity ${EDITOR_SECTION_FADE_MS}ms ease`;
  el.style.pointerEvents = 'none';

  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.pointerEvents = 'auto';
  });
}

function fadeHideSection(el) {
  if (!el) return;
  if (el.classList.contains('hidden')) return;

  el.style.opacity = '0';
  el.style.transition = `opacity ${EDITOR_SECTION_FADE_MS}ms ease`;
  el.style.pointerEvents = 'none';

  window.setTimeout(() => {
    el.classList.add('hidden');
  }, EDITOR_SECTION_FADE_MS);
}

// === Switch between "Add new pool" and "Edit existing pool" ===
function toggleMode(mode) {
  const poolSelectWrapper   = document.getElementById('editorPoolSelectWrapper');
  const rockbridgeWrapper   = document.getElementById('rockbridgePresetWrapper');
  const poolMetadataSection = document.getElementById('poolMetadataSection');
  const ruleEditorSection   = document.getElementById('ruleEditorSection');

  const addBtn  = document.getElementById('editorModeAdd');
  const editBtn = document.getElementById('editorModeEdit');

  if (addBtn && editBtn) {
    addBtn.classList.toggle('active', mode === 'add');
    editBtn.classList.toggle('active', mode === 'edit');
  }

  if (mode === 'add') {
    // "Add new pool" mode
    poolSelectWrapper?.classList.add('hidden');
    rockbridgeWrapper?.classList.remove('hidden');
    poolMetadataSection?.classList.remove('hidden');
    ruleEditorSection?.classList.remove('hidden');
  } else {
    // "Edit existing pool" mode
    poolSelectWrapper?.classList.remove('hidden');
    rockbridgeWrapper?.classList.add('hidden');

    const poolSelect = document.getElementById('editorPoolSelect');

    if (poolSelect && poolSelect.value) {
      // If a pool is already selected, immediately show + load it
      poolMetadataSection?.classList.remove('hidden');
      ruleEditorSection?.classList.remove('hidden');

      if (typeof loadPoolIntoEditor === 'function') {
        const poolDoc = findPoolById(poolSelect.value);
        if (poolDoc) {
          loadPoolIntoEditor(poolDoc);
        } else {
          console.warn('Selected pool not found in cache:', poolSelect.value);
        }
      }
    } else {
      // Force selection before exposing the editor
      poolMetadataSection?.classList.add('hidden');
      ruleEditorSection?.classList.add('hidden');
    }
  }
}

async function cloneRockbridgePresets() {
  // Make sure we have the latest list of pools
  if (!poolsCache.length) {
    await refreshPools();
  }

  const rockbridge = poolsCache.find((pool) => getPoolName(pool) === 'Rockbridge');
  if (!rockbridge || !rockbridge.rules || !Array.isArray(rockbridge.rules.pools)) {
    console.warn('Rockbridge rules not found or malformed', rockbridge);
    showMessage('Rockbridge rules could not be loaded for presets.', 'error');
    return;
  }

  const rulesArray = rockbridge.rules.pools || [];
  const blocks = document.querySelectorAll(poolRuleContainerSelector);

  blocks.forEach((block, idx) => {
    const poolIndex = block.dataset.poolIndex;
    if (!poolIndex) return;

    // Pick the Rockbridge pool rules to clone into this block
    const fromDoc = rulesArray[idx] || rulesArray[0] || {};

    // Support both the new {bleach, granular} shape and the older {ph, cl} shape
    const bleachDoc   = fromDoc.bleach || fromDoc || {};
    const granularDoc = fromDoc.granular || {};

    const bleachPh   = bleachDoc.ph   || {};
    const bleachCl   = bleachDoc.cl   || {};
    const granularPh = granularDoc.ph || {};
    const granularCl = granularDoc.cl || {};

    // pH is shared across methods – merge any separate ph rules
    const sharedPh = {
      ...bleachPh,
      ...granularPh,
    };

    // If granular has no Cl defined, fall back to bleach Cl
    const granularClSource =
      Object.keys(granularCl).length > 0 ?
        granularCl
        : bleachCl;

    const state = getOrCreatePoolRuleState(poolIndex);

    state.bleach = {
      ph: JSON.parse(JSON.stringify(sharedPh)),
      cl: JSON.parse(JSON.stringify(bleachCl)),
    };

    state.granular = {
      ph: JSON.parse(JSON.stringify(sharedPh)),
      cl: JSON.parse(JSON.stringify(granularClSource)),
    };

    // Default view is Bleach
    showRulesForMethod(block, 'bleach');
    block.dataset.activeMethod = 'bleach';
  });

  showMessage('Rockbridge presets applied.', 'success');
}

function resetPoolEditorState() {
  // Clear in-memory rule state
  Object.keys(ruleStateByPool).forEach((k) => delete ruleStateByPool[k]);

  // Clear rule textareas + concern dropdowns
  document.querySelectorAll(`#poolRuleBlocks ${RULE_RESPONSE_SELECTOR}`).forEach((t) => {
    setRuleContent(t, '');
  });

  document.querySelectorAll('#poolRuleBlocks select.concernLevel').forEach((sel) => {
    if ([...sel.options].some((o) => o.value === 'none')) sel.value = 'none';
    else sel.selectedIndex = 0;

    try {
      if (typeof applyConcernToRow === 'function') applyConcernToRow(sel);
    } catch {
      // ignore
    }
  });

  // Reset method tabs to bleach and refresh UI
  document.querySelectorAll('.pool-rule-block').forEach((block) => {
    block.dataset.activeMethod = 'bleach';

    block.querySelectorAll('.sanitation-tab').forEach((btn) => {
      const method = btn.dataset.method || 'bleach';
      btn.classList.toggle('active', method === 'bleach');
    });

    try {
      showRulesForMethod(block, 'bleach');
    } catch {
      // ignore
    }
  });

  // Clear metadata fields (they will be re-filled by presets or selected pool)
  const nameInput = document.getElementById('editorPoolName');
  if (nameInput) nameInput.value = '';

  const numPoolsInput = document.getElementById('editorNumPools');
  if (numPoolsInput) numPoolsInput.value = '2';

  document.querySelectorAll('input[name=\"editorMarket\"]').forEach((cb) => {
    cb.checked = false;
  });

  currentPoolId = '';
}

// ------------------------------------------------------------------
// Legacy alias: some older code still calls applyRockbridgePresets.
// Keep it as a thin wrapper around the new cloneRockbridgePresets.
// ------------------------------------------------------------------
async function applyRockbridgePresets() {
  console.warn(
    '[Pool Editor] applyRockbridgePresets is deprecated – using cloneRockbridgePresets instead.'
  );
  return cloneRockbridgePresets();
}

// Expose for any inline / global callers that still reference it
window.applyRockbridgePresets = applyRockbridgePresets;
 
function setActiveModeButton(mode) {
  const addBtn = document.getElementById('editorModeAdd');
  const editBtn = document.getElementById('editorModeEdit');

  if (!addBtn || !editBtn) return;

  addBtn.classList.toggle('active', mode === 'add');
  editBtn.classList.toggle('active', mode === 'edit');
}

function attachEditorEvents() {
  const addModeBtn = document.getElementById('editorModeAdd');
  const editModeBtn = document.getElementById('editorModeEdit');
  const poolSelect = document.getElementById('editorPoolSelect');
  const numPoolsSelect = document.getElementById('editorNumPools');

  if (addModeBtn) {
    addModeBtn.addEventListener('click', async () => {
      toggleMode('add');

      currentPoolId = '';
      if (poolSelect) poolSelect.value = '';

      resetPoolEditorState();

      // Auto-apply Rockbridge defaults for new pools
      applyRockbridgeMetadataFromCache();

      const count = Math.max(1, Math.min(5, Number(numPoolsSelect?.value || 2)));
      updatePoolBlockVisibility(count);

      await cloneRockbridgePresets();

      // Start read-only; user must click Edit before making changes
      disableAllEditors();
    });
  }

  if (editModeBtn) {
    editModeBtn.addEventListener('click', () => {
      toggleMode('edit');

      currentPoolId = '';
      if (poolSelect) poolSelect.value = '';

      resetPoolEditorState();
      updatePoolBlockVisibility(0);
      disableAllEditors();
    });
  }

  if (poolSelect) {
    poolSelect.addEventListener('change', async () => {
      const selectedId = poolSelect.value;

      if (!selectedId) {
        toggleMode('edit');
        resetPoolEditorState();
        updatePoolBlockVisibility(0);
        disableAllEditors();
        return;
      }

      const poolDoc = findPoolById(selectedId);
      if (!poolDoc) {
        showMessage('Selected pool not found in cache. Try refreshing.', true);
        return;
      }

      resetPoolEditorState();

      await loadPoolIntoEditor(poolDoc);

      // Ensure sections are visible in edit mode once selected
      toggleMode('edit');

      // Lock everything until Edit is clicked
      disableAllEditors();
    });
  }

  if (numPoolsSelect) {
    numPoolsSelect.addEventListener('change', () => {
      const count = Math.max(1, Math.min(5, Number(numPoolsSelect.value || 1)));
      updatePoolBlockVisibility(count);
    });
  }
}

const activeSanitationByPool = {};

function setupSanitationTabs() {
  const blocks = document.querySelectorAll(poolRuleContainerSelector);

  blocks.forEach((block) => {
    const tabs = block.querySelector('.sanitation-tabs');
    if (!tabs) return;

    const buttons = Array.from(tabs.querySelectorAll('.sanitation-tab'));
    if (!buttons.length) return;

    const updateVisual = (activeMethod) => {
      buttons.forEach((btn) => {
        const method = btn.dataset.method || 'bleach';
        btn.classList.toggle('active', method === activeMethod);
      });
    };

    buttons.forEach((tab) => {
      tab.addEventListener('click', () => {
        const newMethod = tab.dataset.method || 'bleach';
        const currentMethod = block.dataset.activeMethod || 'bleach';
        if (newMethod === currentMethod) return;

        // Save the currently visible rules under the old method
        captureRulesFromBlock(block, currentMethod);

        // Switch method in state + DOM
        showRulesForMethod(block, newMethod);
        block.dataset.activeMethod = newMethod;
        activeSanitationByPool[block.dataset.poolIndex] = newMethod;

        updateVisual(newMethod);
      });
    });

    const initialMethod =
      activeSanitationByPool[block.dataset.poolIndex] ||
      block.dataset.activeMethod ||
      'bleach';

    block.dataset.activeMethod = initialMethod;
    updateVisual(initialMethod);
  });
}

function applyConcernToRow(select) {
  const row = select.closest('.table-row');
  if (!row) return;

  const responseArea = row.querySelector(RULE_RESPONSE_SELECTOR);

  // remove previous concern classes
  ['concern-none', 'concern-minor', 'concern-major'].forEach((cls) => {
    row.classList.remove(cls);
    select.classList.remove(cls);
    if (responseArea) responseArea.classList.remove(cls);
  });

  const level = select.value || 'none';
  const cls =
    (level === 'major' || level === 'red') ? 'concern-major' :
    (level === 'minor' || level === 'yellow') ? 'concern-minor' :
    'concern-none';

  row.classList.add(cls);
  select.classList.add(cls);
  if (responseArea) responseArea.classList.add(cls);

  if (level === 'major' || level === 'red') {
    select.style.backgroundColor = '#8b0000';
    select.style.color = '#fff';
  } else if (level === 'minor' || level === 'yellow') {
    select.style.backgroundColor = '#c89a00';
    select.style.color = '#fff';
  } else {
    select.style.backgroundColor = '';
    select.style.color = '';
  }
}

function wireConcernDropdowns() {
  document.querySelectorAll('.concernLevel').forEach((sel) => {
    sel.addEventListener('change', () => applyConcernToRow(sel));
    // apply initial state from saved value
    applyConcernToRow(sel);
  });
}

function setupDeletePool() {
  const deleteBtn = document.getElementById('deletePoolBtn');
  const modal = document.getElementById('deletePoolModal');
  const confirmBtn = document.getElementById('confirmDeletePoolBtn');
  const cancelBtn = document.getElementById('cancelDeletePoolBtn');

  if (!deleteBtn || !modal || !confirmBtn || !cancelBtn) {
    console.warn('Delete pool UI not fully present.');
    return;
  }

  const closeModal = () => {
    modal.style.display = 'none';
    removeOverlay?.();
  };

  const onDocClick = (evt) => {
    if (modal.style.display !== 'none' && !modal.contains(evt.target)) {
      closeModal();
    }
  };

  deleteBtn.addEventListener('click', () => {
    if (!currentPoolId) {
      showMessage('You can only delete an existing saved pool.', 'warning');
      return;
    }
    createOrShowOverlay?.();
    modal.style.display = 'block';
    setTimeout(() => document.addEventListener('click', onDocClick, { once: true }), 0);
  });

  cancelBtn.addEventListener('click', closeModal);

confirmBtn.addEventListener('click', async () => {
  if (!currentPoolId) return;

  // disable button to prevent double-clicks while working
  confirmBtn.disabled = true;

  try {
    // Attempt deletion (deletePoolDoc may return true/false or throw)
    const result = await deletePoolDoc(currentPoolId);

    // If the helper returns falsey (explicit false or null/undefined),
    // treat it as a failure and surface a helpful message.
    if (!result) {
      console.error('deletePoolDoc indicated failure for id:', currentPoolId, 'result:', result);
      showMessage('Could not delete pool. Check console for details.', 'error');
      return;
    }

    // Success path
    showMessage('Pool deleted.', 'success');

    // Close modal & remove overlay if those functions exist
    try {
      if (typeof closeModal === 'function') closeModal();
      if (typeof removeOverlay === 'function') removeOverlay();
    } catch (e) {
      // non-fatal: log and continue
      console.warn('Error closing modal / removing overlay after delete:', e);
    }

    // Refresh pools list and UI
    await refreshPools();

    // Clear selection and current id
    const poolSelect = document.getElementById('editorPoolSelect');
    if (poolSelect) poolSelect.value = '';
    currentPoolId = '';

    // Hide metadata + rules sections (back to pre-edit state)
    const metadataSection = document.getElementById('poolMetadataSection');
    const ruleSection = document.getElementById('ruleEditorSection');
    metadataSection?.classList.add('hidden');
    ruleSection?.classList.add('hidden');

  } catch (err) {
    // Unexpected exception (network / Firestore permission / etc.)
    console.error('Error deleting pool:', err);
    showMessage(`Could not delete pool: ${err?.message || String(err)}`, 'error');
  } finally {
    // always re-enable confirm button
    confirmBtn.disabled = false;
  }
});
}

// Utility: make sure rule textareas/selects inside #poolRuleBlocks
// don't share the same id attribute. This prevents
// "Duplicate form field id in the same form" warnings at runtime.
function dedupeRuleFieldIds() {
  const seen = Object.create(null);

  const fields = document.querySelectorAll(
    `#poolRuleBlocks ${RULE_RESPONSE_SELECTOR}[id], #poolRuleBlocks select[id]`
  );

  fields.forEach((el) => {
    const originalId = el.id;
    if (!originalId) return;

    if (!seen[originalId]) {
      // first time we've seen this id – keep it as‑is
      seen[originalId] = 1;
      return;
    }

    // Subsequent duplicates: give them a unique suffix
    let counter = ++seen[originalId];
    let newId = `${originalId}__${counter}`;

    // Just in case something else already has that id
    while (document.getElementById(newId)) {
      counter += 1;
      newId = `${originalId}__${counter}`;
    }

    el.id = newId;
  });
}

// ---- Copy Existing Rules ----

function populateCopyRulesLocationSelects() {
  const locationSelects = document.querySelectorAll('.copy-rules-location');
  if (!locationSelects.length) return;

  const marketMap = {};
  poolsCache.forEach(pool => {
    const markets = Array.isArray(pool.markets) ? pool.markets
      : (pool.market ? [pool.market] : ['Other']);
    const primary = markets[0] || 'Other';
    if (!marketMap[primary]) marketMap[primary] = [];
    marketMap[primary].push(pool);
  });

  locationSelects.forEach(select => {
    const currentVal = select.value;
    select.innerHTML = '<option value="">— Pool location —</option>';
    Object.keys(marketMap).sort().forEach(market => {
      const group = document.createElement('optgroup');
      group.label = market;
      marketMap[market].sort((a, b) => getPoolName(a).localeCompare(getPoolName(b))).forEach(pool => {
        const opt = document.createElement('option');
        opt.value = pool.id;
        opt.textContent = getPoolName(pool);
        group.appendChild(opt);
      });
      select.appendChild(group);
    });
    if (currentVal) select.value = currentVal;
  });
}

function wireCopyRulesDropdowns() {
  document.querySelectorAll('.copy-rules-location').forEach(locationSelect => {
    const poolIndex = locationSelect.dataset.poolIndex;
    const blockSelect = document.querySelector(`.copy-rules-block[data-pool-index="${poolIndex}"]`);
    const copyBtn = document.querySelector(`.copy-rules-btn[data-pool-index="${poolIndex}"]`);
    if (!blockSelect || !copyBtn) return;

    locationSelect.addEventListener('change', () => {
      const poolId = locationSelect.value;
      blockSelect.innerHTML = '<option value="">— Rule block —</option>';
      blockSelect.disabled = true;
      copyBtn.disabled = true;
      if (!poolId) return;

      const pool = poolsCache.find(p => p.id === poolId);
      if (!pool) return;

      const rulesForPools = pool.rules?.pools || [];
      if (rulesForPools.length) {
        rulesForPools.forEach((poolRule, idx) => {
          const opt = document.createElement('option');
          opt.value = String(idx);
          opt.textContent = poolRule.poolName || `Pool ${idx + 1}`;
          blockSelect.appendChild(opt);
        });
      } else {
        const opt = document.createElement('option');
        opt.value = '0';
        opt.textContent = getPoolName(pool) || 'Pool 1';
        blockSelect.appendChild(opt);
      }

      blockSelect.disabled = false;
      copyBtn.disabled = false;
    });

    copyBtn.addEventListener('click', () => {
      const poolId = locationSelect.value;
      if (!poolId || blockSelect.value === '') return;

      const blockIdx = Number(blockSelect.value);
      const pool = poolsCache.find(p => p.id === poolId);
      if (!pool) return;

      const rulesForPools = pool.rules?.pools || [];
      const sourcePoolRules = rulesForPools[blockIdx];
      if (!sourcePoolRules) return;

      const targetBlock = document.querySelector(`.pool-rule-block[data-pool-index="${poolIndex}"]`);
      if (!targetBlock) return;

      const state = getOrCreatePoolRuleState(poolIndex);
      const sharedPh = {
        ...(sourcePoolRules.bleach?.ph || {}),
        ...(sourcePoolRules.granular?.ph || {}),
      };

      state.bleach = {
        ph: JSON.parse(JSON.stringify(sharedPh)),
        cl: JSON.parse(JSON.stringify(sourcePoolRules.bleach?.cl || {})),
      };
      state.granular = {
        ph: JSON.parse(JSON.stringify(sharedPh)),
        cl: JSON.parse(JSON.stringify(sourcePoolRules.granular?.cl || {})),
      };

      const activeMethod = targetBlock.dataset.activeMethod || 'bleach';
      showRulesForMethod(targetBlock, activeMethod);

      locationSelect.value = '';
      blockSelect.innerHTML = '<option value="">— Rule block —</option>';
      blockSelect.disabled = true;
      copyBtn.disabled = true;
    });
  });
}

async function initEditor() {
  removePoolShapeGallonage();
  startPoolListener();
  await refreshPools();
  convertRuleTextareasToRichEditors();
  removeDuplicateRuleHeaderControls();

  // Deduplicate any repeated ids in the rule blocks BEFORE wiring events
  if (typeof dedupeRuleFieldIds === 'function') {
    dedupeRuleFieldIds();
  }

  wireMetadataButtons();
  wireBlockButtons();
  injectFormattingToolbars();
  wireAutoResizeRuleTextareas();
  setupSanitationTabs();
  wireConcernDropdowns();
  setupDeletePool();
  wireCopyRulesDropdowns();
  populateCopyRulesLocationSelects();

  relabelConcernOptions();
  attachEditorEvents();

  const editorSection = document.getElementById('poolRuleEditorSection');
  if (editorSection) editorSection.classList.remove('hidden');

  // Start with only the two mode buttons visible
  disableAllEditors();
}

function onSaveSuccess(poolId) {
  showMessage('Saved', 'success');
  refreshPools();
  currentPoolId = poolId;
}

window.initEditor = initEditor;
window.cloneRockbridgePresets = cloneRockbridgePresets;
window.loadPoolIntoEditor = loadPoolIntoEditor;
window.readEditorToObject = readEditorToObject;
window.onSaveSuccess = onSaveSuccess;

// ============================================================
// FORMATTING TOOLBAR — B / I / U buttons for rule textareas
// ============================================================

function injectFormattingToolbars() {
  const selectionByEditor = new WeakMap();
  let activeEditor = null;

  const selectionInside = (editor) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    return editor.contains(range.startContainer) && editor.contains(range.endContainer);
  };

  const saveSelection = (editor) => {
    const sel = window.getSelection();
    if (!editor || !sel || sel.rangeCount === 0) return;
    if (!selectionInside(editor)) return;
    selectionByEditor.set(editor, sel.getRangeAt(0).cloneRange());
    activeEditor = editor;
  };

  const restoreSelection = (editor) => {
    if (!editor) return;
    const range = selectionByEditor.get(editor);
    if (!range) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    activeEditor = editor;
  };

  const updateToolbarState = (editor) => {
    if (!editor) return;
    const toolbar = editor.previousElementSibling;
    if (!toolbar || !toolbar.classList.contains('formatting-toolbar')) return;
    toolbar.querySelectorAll('.format-btn').forEach((btn) => {
      const cmd = btn.dataset.cmd;
      if (!cmd || editor.getAttribute('contenteditable') !== 'true') {
        btn.classList.remove('active');
        return;
      }
      try {
        btn.classList.toggle('active', document.queryCommandState(cmd));
      } catch (_) {
        btn.classList.remove('active');
      }
    });
  };

  document.querySelectorAll(RULE_RESPONSE_SELECTOR).forEach((field) => {
    // Avoid double-injection
    if (field.previousElementSibling && field.previousElementSibling.classList.contains('formatting-toolbar')) return;

    const toolbar = document.createElement('div');
    toolbar.className = 'formatting-toolbar';

    const formats = [
      { label: 'B', cmd: 'bold', title: 'Bold' },
      { label: 'I', cmd: 'italic', title: 'Italic' },
      { label: 'U', cmd: 'underline', title: 'Underline' },
    ];

    formats.forEach(({ label, cmd, title }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.title = title;
      btn.className = 'format-btn';
      btn.dataset.cmd = cmd;
      btn.disabled = true; // disabled until block is in edit mode
      btn.addEventListener('mousedown', (event) => {
        event.preventDefault();
      });
      btn.addEventListener('click', () => {
        field.focus();
        restoreSelection(field);
        document.execCommand(cmd, false);
        autoResizeRuleTextarea(field);
        saveSelection(field);
        updateToolbarState(field);
      });
      toolbar.appendChild(btn);
    });

    field.parentNode.insertBefore(toolbar, field);

    field.addEventListener('focus', () => {
      activeEditor = field;
      saveSelection(field);
      updateToolbarState(field);
    });
    field.addEventListener('mouseup', () => {
      saveSelection(field);
      updateToolbarState(field);
    });
    field.addEventListener('keyup', () => {
      saveSelection(field);
      updateToolbarState(field);
    });
    field.addEventListener('input', () => {
      saveSelection(field);
      updateToolbarState(field);
    });
  });

  document.addEventListener('selectionchange', () => {
    if (!activeEditor || !selectionInside(activeEditor)) return;
    saveSelection(activeEditor);
    updateToolbarState(activeEditor);
  });
}

function autoResizeRuleTextarea(textarea) {
  if (!textarea) return;
  if (textarea.isContentEditable) {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(48, textarea.scrollHeight)}px`;
    return;
  }
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.max(48, textarea.scrollHeight)}px`;
}

function wireAutoResizeRuleTextareas() {
  document.querySelectorAll(RULE_RESPONSE_SELECTOR).forEach((textarea) => {
    autoResizeRuleTextarea(textarea);
    textarea.addEventListener('input', () => autoResizeRuleTextarea(textarea));
  });
}

function convertRuleTextareasToRichEditors() {
  document.querySelectorAll('textarea.ruleResponse').forEach((textarea) => {
    const editor = document.createElement('div');
    editor.id = textarea.id;
    editor.className = textarea.className;
    editor.dataset.fromTextarea = 'true';
    editor.setAttribute('contenteditable', 'false');
    editor.innerHTML = sanitizeRuleMarkup(textarea.value || '');
    textarea.replaceWith(editor);
  });
}

window.addEventListener('beforeunload', (e) => {
  const editingBlocks = document.querySelectorAll('.pool-rule-block[data-is-editing="true"]');
  if (editingBlocks.length > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initEditor();
  } catch (err) {
    console.error('Failed to initialize pool editor:', err);
  }
});

// Global fade‑in helper for this page
window.addEventListener('load', () => {
  document.body.classList.add('page-loaded');
});

// NOTE: We deliberately do NOT override window.logout here.
// The shared logout implementation in script.js handles navigation
// correctly for index.html, newRules.html, and training.html.
