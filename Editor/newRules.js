import { getPools, listenPools, savePoolDoc, deletePoolDoc } from '../firebase.js';
 
let poolsCache = [];
let currentPoolId = '';
let poolsListenerStarted = false;
let activePoolLoadToken = 0;
let editorSaveInProgress = false;

let currentEditorMode = window.currentEditorMode ?? null;
window.currentEditorMode = currentEditorMode;

// Safety alias in case any older inline handler references the typo:
window.CurrentEditorMide = window.currentEditorMode;

// ---- Per-sanitation rule state ----
const SANITATION_METHODS = ['bleach', 'granular', 'tablet', 'off'];
const PH_RULE_METHODS = ['muriaticAcid', 'noChanges'];
const DEFAULT_PH_RULE_METHOD = 'muriaticAcid';

// ruleStateByPool[poolIndex] = { bleach: { ph:{}, cl:{} }, granular: { ph:{}, cl:{} }, tablet: { ph:{}, cl:{} }, off: { ph:{}, cl:{} } }
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

function showMessage(message, type = 'info') {
  const content = document.getElementById('ruleEditorContent') || document.body;
  let messageEl = document.getElementById('editorMessage');

  if (!messageEl) {
    messageEl = document.createElement('div');
    messageEl.id = 'editorMessage';
    messageEl.className = 'editor-message';
    const anchor = document.getElementById('editorModeRow') || content.firstElementChild;
    if (anchor?.parentNode) anchor.parentNode.insertBefore(messageEl, anchor.nextSibling);
    else content.prepend(messageEl);
  }

  const normalizedType = type === true ? 'error' : (type || 'info');
  messageEl.textContent = String(message || '');
  messageEl.dataset.type = normalizedType;
  messageEl.classList.add('visible');

  clearTimeout(showMessage.hideTimer);
  showMessage.hideTimer = window.setTimeout(() => {
    messageEl.classList.remove('visible');
  }, 5000);
}

function getResponseFields(block, poolIndex) {
  return block.querySelectorAll(`${RULE_RESPONSE_SELECTOR}[id^="pool${poolIndex}_"]`);
}

function getRuleContent(field) {
  if (!field) return '';
  if (field.getAttribute('contenteditable') !== null) return field.innerHTML.trim();
  return (field.value || '').trim();
}

function setRuleContent(field, html) {
  const safeHtml = sanitizeRuleMarkup(html);
  if (field.getAttribute('contenteditable') !== null) {
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
    const autoControllerCheckbox = block.querySelector('.pool-auto-controller-checkbox');

    getResponseFields(block, poolIndex).forEach((area) => {
      const typeKey = area.id.includes('_ph_') ? 'ph' : 'cl';
      const key = area.id.replace(`pool${poolIndex}_${typeKey}_`, '');
      const levelSelect = document.getElementById(`${area.id}_level`);

      poolRules[typeKey][key] = {
        response: sanitizeRuleMarkup(getRuleContent(area)),
        concernLevel: levelSelect ? levelSelect.value : 'none',
      };
    });

    poolRules.autoController = !!autoControllerCheckbox?.checked;

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
    const autoControllerCheckbox = document.querySelector(`.pool-rule-block[data-pool-index="${poolIndex}"] .pool-auto-controller-checkbox`);
    if (autoControllerCheckbox) autoControllerCheckbox.checked = !!rules.autoController;
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

function createEmptyPhMethodRules() {
  return { ph: {} };
}

function createEmptyPhMethods() {
  return Object.fromEntries(
    PH_RULE_METHODS.map(method => [method, createEmptyPhMethodRules()])
  );
}

function getActivePhMethod(block) {
  const activeTab = block?.querySelector('.ph-rule-tabs .ph-rule-tab.active[data-ph-method]');
  const method = activeTab?.dataset.phMethod || block?.dataset.activePhMethod || DEFAULT_PH_RULE_METHOD;
  return PH_RULE_METHODS.includes(method) ? method : DEFAULT_PH_RULE_METHOD;
}

function getSanitationMethodTabs(block) {
  const clWrapper = block?.querySelector('.rules-table.cl-table')?.closest('.table-wrapper');
  const tabsRoot = clWrapper?.querySelector('.sanitation-tabs') || block?.querySelector('.sanitation-tabs');
  return Array.from(tabsRoot?.querySelectorAll('.sanitation-tab[data-method]') || []);
}

function getActiveSanitationMethod(block) {
  const activeTab = getSanitationMethodTabs(block).find((tab) => tab.classList.contains('active'));
  const method = activeTab?.dataset.method || block?.dataset.activeMethod || 'bleach';
  return SANITATION_METHODS.includes(method) ? method : 'bleach';
}

function updateSanitationTabVisuals(block, activeMethod) {
  const normalizedMethod = SANITATION_METHODS.includes(activeMethod) ? activeMethod : 'bleach';
  getSanitationMethodTabs(block).forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.method === normalizedMethod);
  });
}

function cloneRuleMap(ruleMap = {}) {
  return JSON.parse(JSON.stringify(ruleMap || {}));
}

function getPhMethodsFromDoc(source = {}) {
  const sharedPh = {
    ...SANITATION_METHODS.reduce((acc, method) => ({
      ...acc,
      ...(source[method]?.ph || {}),
    }), {}),
    ...(source.ph || {}),
  };

  return Object.fromEntries(
    PH_RULE_METHODS.map((method) => {
      const hasPhMethod = !!source.phMethods?.[method];
      const directPh = source.phMethods?.[method]?.ph || {};
      return [
        method,
        { ph: cloneRuleMap(hasPhMethod ? directPh : sharedPh) },
      ];
    })
  );
}

function getOrCreatePoolRuleState(poolIndex) {
  if (!ruleStateByPool[poolIndex]) {
    ruleStateByPool[poolIndex] = {
      phMethods: createEmptyPhMethods(),
      bleach: createEmptyMethodRules(),
      granular: createEmptyMethodRules(),
      tablet: createEmptyMethodRules(),
      off: createEmptyMethodRules(),
    };
  } else if (!ruleStateByPool[poolIndex].phMethods) {
    ruleStateByPool[poolIndex].phMethods = getPhMethodsFromDoc(ruleStateByPool[poolIndex]);
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
  const activePhMethod = getActivePhMethod(block);
  const activeClMethod = method || getActiveSanitationMethod(block);

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

  if (!state.phMethods) state.phMethods = createEmptyPhMethods();
  if (!state.phMethods[activePhMethod]) state.phMethods[activePhMethod] = createEmptyPhMethodRules();
  state.phMethods[activePhMethod].ph = cloneRuleMap(methodRules.ph);

  // Chlorine rules remain method-specific.
  if (!state[activeClMethod]) state[activeClMethod] = createEmptyMethodRules();
  state[activeClMethod].cl = cloneRuleMap(methodRules.cl);

  const defaultPh = state.phMethods[DEFAULT_PH_RULE_METHOD]?.ph || {};
  SANITATION_METHODS.forEach((m) => {
    if (!state[m]) state[m] = createEmptyMethodRules();
    state[m].ph = cloneRuleMap(defaultPh);
  });
}

/**
 * Push one method’s rules from ruleStateByPool back into the DOM
 * for a single pool block.
 */
function showRulesForMethod(block, method) {
  const poolIndex = block.dataset.poolIndex;
  const state = getOrCreatePoolRuleState(poolIndex);
  const activeMethod = SANITATION_METHODS.includes(method) ? method : 'bleach';

  // If switching to granular or tablet and their Cl rules are empty,
  // clone bleach Cl rules so the user never sees a blank Cl section by default.
  if (activeMethod === 'granular' || activeMethod === 'tablet') {
    const bleach     = state.bleach   || createEmptyMethodRules();
    const methodData = state[activeMethod]  || createEmptyMethodRules();

    const methodCl = methodData.cl || {};
    const hasAnyCl = Object.values(methodCl).some(
      (rule) =>
        rule &&
        typeof rule.response === 'string' &&
        rule.response.trim() !== ''
    );

    if (!hasAnyCl && bleach.cl) {
      methodData.cl = JSON.parse(JSON.stringify(bleach.cl));
      state[activeMethod] = methodData;
    }
  }

  const methodState = state[activeMethod] || createEmptyMethodRules();
  const activePhMethod = getActivePhMethod(block);
  const phRules = state.phMethods?.[activePhMethod]?.ph || methodState.ph || {};
  applyRuleToInputs(block, { ph: phRules, cl: methodState.cl || {} });
  block.dataset.activeMethod = activeMethod;
  updateSanitationTabVisuals(block, activeMethod);
}

function showRulesForPhMethod(block, phMethod) {
  const poolIndex = block.dataset.poolIndex;
  const state = getOrCreatePoolRuleState(poolIndex);
  if (!state.phMethods?.[phMethod]) {
    state.phMethods[phMethod] = createEmptyPhMethodRules();
  }

  const activeClMethod = getActiveSanitationMethod(block);
  const clRules = state[activeClMethod]?.cl || {};
  const phRules = state.phMethods[phMethod]?.ph || {};
  applyRuleToInputs(block, { ph: phRules, cl: clRules });
  block.dataset.activePhMethod = phMethod;
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
  if (Array.isArray(existing) && existing.some(p => p && (p.phMethods || SANITATION_METHODS.some(method => p[method])))) {
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
      migratedPools.push({
        phMethods: createEmptyPhMethods(),
        ...Object.fromEntries(
        SANITATION_METHODS.map(method => [method, { ph: {}, cl: {} }])
        ),
      });
      continue;
    }

    migratedPools.push({
      phMethods: {
        muriaticAcid: { ph: legacy.ph || {} },
        noChanges: { ph: legacy.ph || {} },
      },
      ...Object.fromEntries(
        SANITATION_METHODS.map(method => [
          method,
          {
            ph: legacy.ph || {},
            cl: legacy.cl || {},
          },
        ])
      ),
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

async function loadPoolIntoEditor(poolDoc, loadToken = null) {
  if (!poolDoc) return;

  // poolDoc.rawData should be the original Firestore data; if you're currently
  // passing plain .data(), adjust getPools/listenPools to include it.
  const normalizedDoc =
    poolDoc.rules && poolDoc.rules.pools ?
      poolDoc
      : await maybeMigrateLegacyRules(poolDoc);

  if (loadToken !== null && loadToken !== activePoolLoadToken) return;

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

  // Load rules for each pool into editor state.
  const rulesForPools = normalizedDoc.rules?.pools || [];
  const blocks = document.querySelectorAll(poolRuleContainerSelector);

  blocks.forEach((block, idx) => {
    const poolIndex = block.dataset.poolIndex;
    const state = getOrCreatePoolRuleState(poolIndex);
    const fromDoc = rulesForPools[idx] || {};

    if (fromDoc.phMethods || SANITATION_METHODS.some(method => fromDoc[method])) {
      state.phMethods = getPhMethodsFromDoc(fromDoc);
      const sharedPh = SANITATION_METHODS.reduce((acc, method) => ({
        ...acc,
        ...(fromDoc[method]?.ph || {}),
      }), { ...(state.phMethods[DEFAULT_PH_RULE_METHOD]?.ph || {}) });
      const fallbackCl = SANITATION_METHODS
        .map(method => fromDoc[method]?.cl || {})
        .find(cl => Object.keys(cl).length > 0) || {};

      SANITATION_METHODS.forEach((method) => {
        const hasMethodDoc = !!fromDoc[method];
        const methodCl = fromDoc[method]?.cl || {};
        state[method] = {
          ph: JSON.parse(JSON.stringify(sharedPh)),
          cl: JSON.parse(JSON.stringify(hasMethodDoc ? methodCl : fallbackCl)),
        };
      });
    }

    block.dataset.activePhMethod = DEFAULT_PH_RULE_METHOD;
    block.dataset.activeMethod = 'bleach';
    activeSanitationByPool[poolIndex] = 'bleach';
    showRulesForMethod(block, 'bleach');

    // Load pool sub-name if stored
    const nameInput = block.querySelector('.pool-name-input');
    if (nameInput) nameInput.value = fromDoc.poolName || '';
    const autoControllerCheckbox = block.querySelector('.pool-auto-controller-checkbox');
    if (autoControllerCheckbox) autoControllerCheckbox.checked = !!fromDoc.autoController;
  });

  // Make sure the right sanitize tab is active & buttons are wired
  setupPhRuleTabs();
  setupSanitationTabs();
  wireBlockButtons();

  // Start in read-only state; user must click Edit to modify metadata
  setMetadataEnabled(false);
  const editBtn = document.getElementById('editMetadataBtn');
  const saveBtn = document.getElementById('saveMetadataBtn');
  if (editBtn) editBtn.disabled = false;
  if (saveBtn) saveBtn.disabled = true;
  syncMetadataToggleFromButtons();
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
    const currentMethod = getActiveSanitationMethod(block);

    // Make sure the currently visible method is captured from DOM
    captureRulesFromBlock(block, currentMethod);

    const state = getOrCreatePoolRuleState(poolIndex);
    const nameInput = block.querySelector('.pool-name-input');
    const autoControllerCheckbox = block.querySelector('.pool-auto-controller-checkbox');
    const poolName = nameInput ? nameInput.value.trim() : '';
    const phMethods = state.phMethods || createEmptyPhMethods();
    const defaultPh = phMethods[DEFAULT_PH_RULE_METHOD]?.ph || {};

    pools.push({
      phMethods,
      bleach: { ...(state.bleach || createEmptyMethodRules()), ph: cloneRuleMap(defaultPh) },
      granular: { ...(state.granular || createEmptyMethodRules()), ph: cloneRuleMap(defaultPh) },
      tablet: { ...(state.tablet || createEmptyMethodRules()), ph: cloneRuleMap(defaultPh) },
      off: { ...(state.off || createEmptyMethodRules()), ph: cloneRuleMap(defaultPh) },
      poolName,
      autoController: !!autoControllerCheckbox?.checked,
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
  if (editorSaveInProgress) return false;
  const poolData = readEditorToObject();
  if (!poolData) return false;

  editorSaveInProgress = true;
  try {
    const poolId = currentPoolId || poolData.name;
    const savedId = await savePoolDoc(poolId, poolData);
    if (!savedId) throw new Error('Pool save did not complete.');
    currentPoolId = savedId;
    updatePoolsCacheAfterSave(savedId, poolData);
    onSaveSuccess(currentPoolId);
    disableAllEditors();
    return true;
  } catch (error) {
    console.error('Failed to save pool', error);
    showMessage('Could not save the pool. Please try again.', 'error');
    return false;
  } finally {
    editorSaveInProgress = false;
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
  syncMetadataToggleFromButtons();

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

// Sync the contents of one pool block back into the in-memory rule state.
function syncBlockIntoState(block) {
  if (!block?.dataset.poolIndex) return;
  captureRulesFromBlock(block, getActiveSanitationMethod(block));
}

function syncMetadataToggleFromButtons() {
  const saveBtn = document.getElementById('saveMetadataBtn');
  const toggle = document.querySelector('.metadata-rule-buttons .edit-save-toggle-input');
  if (saveBtn && toggle) toggle.checked = saveBtn.disabled;
}
 
function wireMetadataButtons() {
  const editBtn = document.getElementById('editMetadataBtn');
  const saveBtn = document.getElementById('saveMetadataBtn');
  const ruleButtons = document.querySelector('.metadata-rule-buttons');

  if (!editBtn || !saveBtn || !ruleButtons) return;

  const syncToggle = syncMetadataToggleFromButtons;

  const setMetadataEditing = (isEditing) => {
    setMetadataEnabled(isEditing);
    editBtn.disabled = isEditing;
    saveBtn.disabled = !isEditing;
    syncToggle();
  };

  const saveMetadata = async () => {
    setMetadataEnabled(false);
    editBtn.disabled = true;
    saveBtn.disabled = true;
    syncToggle();

    const success = await attemptSave();
    if (success) {
      setMetadataEditing(false);
    } else {
      setMetadataEditing(true);
    }
    return success;
  };

  if (editBtn.dataset.metadataBound !== 'true') {
    editBtn.dataset.metadataBound = 'true';
    editBtn.addEventListener('click', () => setMetadataEditing(true));
  }

  if (saveBtn.dataset.metadataBound !== 'true') {
    saveBtn.dataset.metadataBound = 'true';
    saveBtn.addEventListener('click', saveMetadata);
  }

  // Skip if already converted to toggle
  if (ruleButtons.querySelector('.theme-switch')) {
    syncToggle();
    return;
  }

  // Build theme-switch style toggle matching rule block headers
  const label = document.createElement('label');
  label.className = 'theme-toggle rule-edit-save-toggle';
  label.setAttribute('aria-label', 'Pool metadata edit and save mode');

  const switchDiv = document.createElement('div');
  switchDiv.className = 'theme-switch';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'edit-save-toggle-input';
  cb.setAttribute('aria-label', 'Toggle pool metadata edit and save mode');
  cb.checked = !!saveBtn.disabled; // checked = saved/read-only, unchecked = editing

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
      // Switch to Edit mode
      setMetadataEditing(true);
    } else {
      // Switch to Save mode
      cb.disabled = true;
      const success = await saveMetadata();
      cb.disabled = false;
      if (!success) cb.checked = false;
    }
  });

  // Keep toggle in sync with external button state changes
  const observer = new MutationObserver(() => {
    syncToggle();
  });
  observer.observe(saveBtn, { attributes: true, attributeFilter: ['disabled'] });
  syncToggle();
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

function updatePoolsCacheAfterSave(poolId, poolData) {
  if (!poolId || !poolData) return;
  const savedPool = { id: poolId, ...poolData };
  const existingIndex = poolsCache.findIndex((pool) => pool.id === poolId);
  if (existingIndex >= 0) poolsCache[existingIndex] = savedPool;
  else poolsCache.push(savedPool);
  renderSelectOptions(document.getElementById('editorPoolSelect'), poolsCache);
  populateCopyRulesLocationSelects();
}

function hasUnsavedEditorChanges() {
  const metadataSaveBtn = document.getElementById('saveMetadataBtn');
  const metadataEditing = !!metadataSaveBtn && !metadataSaveBtn.disabled;
  const blockEditing = !!document.querySelector('.pool-rule-block[data-is-editing="true"]');
  return metadataEditing || blockEditing;
}

async function saveCurrentPoolBeforeSwitch(nextPoolId) {
  if (!currentPoolId || nextPoolId === currentPoolId || !hasUnsavedEditorChanges()) return true;
  showMessage('Saving current pool before switching...', 'info');
  return attemptSave();
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
      poolMetadataSection?.classList.remove('hidden');
      ruleEditorSection?.classList.remove('hidden');
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

    // Support both the new per-method shape and the older {ph, cl} shape.
    const methodDocs = Object.fromEntries(
      SANITATION_METHODS.map(method => [method, fromDoc[method] || (method === 'bleach' ? fromDoc : {})])
    );
    const phMethods = getPhMethodsFromDoc(fromDoc);

    // pH is shared across methods. Merge any separate ph rules.
    const sharedPh = SANITATION_METHODS.reduce((acc, method) => ({
      ...acc,
      ...(methodDocs[method]?.ph || {}),
    }), { ...(phMethods[DEFAULT_PH_RULE_METHOD]?.ph || {}) });
    const fallbackCl = SANITATION_METHODS
      .map(method => methodDocs[method]?.cl || {})
      .find(cl => Object.keys(cl).length > 0) || {};

    const state = getOrCreatePoolRuleState(poolIndex);
    state.phMethods = phMethods;

    SANITATION_METHODS.forEach((method) => {
      const hasMethodDoc = !!fromDoc[method] || (method === 'bleach' && (!!fromDoc.ph || !!fromDoc.cl));
      const methodCl = methodDocs[method]?.cl || {};
      state[method] = {
        ph: JSON.parse(JSON.stringify(sharedPh)),
        cl: JSON.parse(JSON.stringify(hasMethodDoc ? methodCl : fallbackCl)),
      };
    });

    // Default view is Bleach
    block.dataset.activePhMethod = DEFAULT_PH_RULE_METHOD;
    showRulesForMethod(block, 'bleach');
    block.dataset.activeMethod = 'bleach';
  });

  showMessage('Rockbridge presets applied.', 'success');
}

function resetPoolEditorState() {
  // Clear in-memory rule state
  Object.keys(ruleStateByPool).forEach((k) => delete ruleStateByPool[k]);
  Object.keys(activeSanitationByPool).forEach((k) => delete activeSanitationByPool[k]);

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
    block.dataset.activePhMethod = DEFAULT_PH_RULE_METHOD;

    block.querySelectorAll('.sanitation-tabs .sanitation-tab').forEach((btn) => {
      const method = btn.dataset.method || 'bleach';
      btn.classList.toggle('active', method === 'bleach');
    });
    block.querySelectorAll('.ph-rule-tab').forEach((btn) => {
      const method = btn.dataset.phMethod || DEFAULT_PH_RULE_METHOD;
      btn.classList.toggle('active', method === DEFAULT_PH_RULE_METHOD);
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

  if (addModeBtn && addModeBtn.dataset.editorModeBound !== 'true') {
    addModeBtn.dataset.editorModeBound = 'true';
    addModeBtn.addEventListener('click', async () => {
      activePoolLoadToken += 1;
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

  if (editModeBtn && editModeBtn.dataset.editorModeBound !== 'true') {
    editModeBtn.dataset.editorModeBound = 'true';
    editModeBtn.addEventListener('click', () => {
      activePoolLoadToken += 1;
      currentPoolId = '';
      if (poolSelect) poolSelect.value = '';

      resetPoolEditorState();
      updatePoolBlockVisibility(0);
      disableAllEditors();
      toggleMode('edit');
    });
  }

  if (poolSelect && poolSelect.dataset.editorPoolSelectBound !== 'true') {
    poolSelect.dataset.editorPoolSelectBound = 'true';
    poolSelect.addEventListener('change', async () => {
      const selectedId = poolSelect.value;
      const previousPoolId = currentPoolId;

      const savedBeforeSwitch = await saveCurrentPoolBeforeSwitch(selectedId);
      if (!savedBeforeSwitch) {
        if (previousPoolId) poolSelect.value = previousPoolId;
        return;
      }

      if (!selectedId) {
        activePoolLoadToken += 1;
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

      const loadToken = ++activePoolLoadToken;
      resetPoolEditorState();

      await loadPoolIntoEditor(poolDoc, loadToken);
      if (loadToken !== activePoolLoadToken) return;

      // Ensure sections are visible in edit mode once selected
      toggleMode('edit');

      // Lock everything until Edit is clicked
      disableAllEditors();
    });
  }

  if (numPoolsSelect && numPoolsSelect.dataset.editorPoolCountBound !== 'true') {
    numPoolsSelect.dataset.editorPoolCountBound = 'true';
    numPoolsSelect.addEventListener('change', () => {
      const count = Math.max(1, Math.min(5, Number(numPoolsSelect.value || 1)));
      updatePoolBlockVisibility(count);
    });
  }
}

const activeSanitationByPool = {};

function setupPhRuleTabs() {
  const blocks = document.querySelectorAll(poolRuleContainerSelector);

  blocks.forEach((block) => {
    const tabs = block.querySelector('.ph-rule-tabs');
    if (!tabs) return;

    const buttons = Array.from(tabs.querySelectorAll('.ph-rule-tab'));
    if (!buttons.length) return;

    const updateVisual = (activeMethod) => {
      buttons.forEach((btn) => {
        const method = btn.dataset.phMethod || DEFAULT_PH_RULE_METHOD;
        btn.classList.toggle('active', method === activeMethod);
      });
    };

    if (tabs.dataset.phTabsBound !== 'true') {
      tabs.dataset.phTabsBound = 'true';
      buttons.forEach((tab) => {
        tab.addEventListener('click', () => {
          const newMethod = tab.dataset.phMethod || DEFAULT_PH_RULE_METHOD;
          const currentMethod = getActivePhMethod(block);
          if (newMethod === currentMethod) return;

          captureRulesFromBlock(block, getActiveSanitationMethod(block));
          showRulesForPhMethod(block, newMethod);
          updateVisual(newMethod);
        });
      });
    }

    const initialMethod = getActivePhMethod(block);
    block.dataset.activePhMethod = initialMethod;
    updateVisual(initialMethod);
  });
}

function setupSanitationTabs() {
  const blocks = document.querySelectorAll(poolRuleContainerSelector);

  blocks.forEach((block) => {
    const buttons = getSanitationMethodTabs(block);
    if (!buttons.length) return;
    const tabs = buttons[0].closest('.sanitation-tabs');
    if (!tabs) return;

    const updateVisual = (activeMethod) => {
      updateSanitationTabVisuals(block, activeMethod);
    };

    if (tabs.dataset.sanitationTabsBound !== 'true') {
      tabs.dataset.sanitationTabsBound = 'true';
      buttons.forEach((tab) => {
        tab.addEventListener('click', () => {
          const newMethod = tab.dataset.method || 'bleach';
          const currentMethod = getActiveSanitationMethod(block);
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
    }

    const initialMethod =
      activeSanitationByPool[block.dataset.poolIndex] ||
      getActiveSanitationMethod(block) ||
      'bleach';

    block.dataset.activeMethod = initialMethod;
    updateVisual(initialMethod);
  });
}

function applyConcernToRow(select) {
  const row = select.closest('.table-row');
  if (!row) return;

  const responseArea = row.querySelector(RULE_RESPONSE_SELECTOR);

  // remove previous concern classes (row keeps class for CSS parent selectors; response area is not colored)
  ['concern-none', 'concern-minor', 'concern-major'].forEach((cls) => {
    row.classList.remove(cls);
    select.classList.remove(cls);
  });

  const level = select.value || 'none';
  const cls =
    (level === 'major' || level === 'red') ? 'concern-major' :
    (level === 'minor' || level === 'yellow') ? 'concern-minor' :
    'concern-none';

  row.classList.add(cls);
  select.classList.add(cls);

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

function showEditorModalOverlay() {
  const overlay = document.getElementById('settingsOverlay');
  if (!overlay) return null;
  overlay.style.display = 'block';
  requestAnimationFrame(() => overlay.classList.add('visible'));
  return overlay;
}

function hideEditorModalOverlay() {
  const overlay = document.getElementById('settingsOverlay');
  const settingsModal = document.getElementById('settingsModal');
  const deleteModal = document.getElementById('deletePoolModal');
  const deleteOpen = deleteModal && deleteModal.style.display !== 'none' && deleteModal.classList.contains('visible');
  const settingsOpen = settingsModal && settingsModal.classList.contains('visible');
  if (!overlay || deleteOpen || settingsOpen) return;
  overlay.classList.remove('visible');
  setTimeout(() => {
    if (!overlay.classList.contains('visible')) overlay.style.display = 'none';
  }, 250);
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

  if (deleteBtn.dataset.deletePoolBound === 'true') return;
  deleteBtn.dataset.deletePoolBound = 'true';

  const closeModal = () => {
    modal.classList.remove('visible');
    setTimeout(() => {
      if (!modal.classList.contains('visible')) modal.style.display = 'none';
      hideEditorModalOverlay();
    }, 250);
  };

  const onDocClick = (evt) => {
    if (modal.style.display !== 'none' && !modal.contains(evt.target)) {
      closeModal();
    }
  };

  modal.addEventListener('click', (evt) => evt.stopPropagation());

  deleteBtn.addEventListener('click', () => {
    if (!currentPoolId) {
      showMessage('You can only delete an existing saved pool.', 'warning');
      return;
    }
    const overlay = showEditorModalOverlay();
    modal.style.display = 'block';
    requestAnimationFrame(() => modal.classList.add('visible'));
    overlay?.addEventListener('click', closeModal, { once: true });
    setTimeout(() => document.addEventListener('click', onDocClick, { once: true }), 0);
  });

  cancelBtn.addEventListener('click', closeModal);

  confirmBtn.addEventListener('click', async () => {
    if (!currentPoolId) return;

    const deletedPoolName = getPoolName(findPoolById(currentPoolId)) || currentPoolId;
    const originalText = confirmBtn.textContent;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting...';

    try {
      const result = await deletePoolDoc(currentPoolId);

      if (!result) {
        console.error('deletePoolDoc indicated failure for id:', currentPoolId, 'result:', result);
        showMessage('Could not delete pool. Check console for details.', 'error');
        return;
      }

      closeModal();
      await refreshPools();

      const poolSelect = document.getElementById('editorPoolSelect');
      if (poolSelect) poolSelect.value = '';
      currentPoolId = '';

      const metadataSection = document.getElementById('poolMetadataSection');
      const ruleSection = document.getElementById('ruleEditorSection');
      metadataSection?.classList.add('hidden');
      ruleSection?.classList.add('hidden');

      showMessage(`${deletedPoolName} deleted.`, 'success');
    } catch (err) {
      console.error('Error deleting pool:', err);
      showMessage(`Could not delete pool: ${err?.message || String(err)}`, 'error');
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = originalText;
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

function formatRuleValueLabel(valueKey) {
  return String(valueKey || '')
    .replace(/^lt_/, 'less than ')
    .replace(/^gt_/, 'greater than ')
    .replace(/_/g, '.');
}

function labelRuleControl(el) {
  const id = el.id || '';
  const match = id.match(/^pool(\d+)_(ph|cl)_(.+?)(?:_level)?(?:__\d+)?$/);
  if (!match) return;

  const [, poolIndex, metricKey, valueKey] = match;
  const metricLabel = metricKey === 'ph' ? 'pH' : 'chlorine';
  const valueLabel = formatRuleValueLabel(valueKey);
  const fieldType = el.matches('select') ? 'concern level' : 'response';
  el.setAttribute('aria-label', `Pool ${poolIndex} ${metricLabel} ${valueLabel} ${fieldType}`);
}

function ensureEditorAccessibility() {
  document.querySelectorAll('.pool-rule-block').forEach((block) => {
    const poolIndex = block.dataset.poolIndex || '';
    if (!poolIndex) return;

    const poolNameInput = block.querySelector('.pool-name-input');
    if (poolNameInput) {
      if (!poolNameInput.id) poolNameInput.id = `pool${poolIndex}_name`;
      poolNameInput.setAttribute('aria-label', `Pool ${poolIndex} name`);
    }

    const autoControllerCheckbox = block.querySelector('.pool-auto-controller-checkbox');
    if (autoControllerCheckbox) {
      if (!autoControllerCheckbox.id) autoControllerCheckbox.id = `pool${poolIndex}_auto_controller`;
      autoControllerCheckbox.setAttribute('aria-label', `Pool ${poolIndex} auto controller`);
    }

    block.querySelectorAll('.copy-rules-location').forEach((copyLocation) => {
      const copyKind = copyLocation.closest('.copy-rules-row')?.dataset.copyKind || 'rules';
      if (!copyLocation.id) copyLocation.id = `pool${poolIndex}_copy_location`;
      copyLocation.setAttribute('aria-label', `Pool ${poolIndex} ${copyKind} copy from facility`);
    });

    block.querySelectorAll('.copy-rules-block').forEach((copyBlock) => {
      const copyKind = copyBlock.closest('.copy-rules-row')?.dataset.copyKind || 'rules';
      if (!copyBlock.id) copyBlock.id = `pool${poolIndex}_copy_block`;
      copyBlock.setAttribute('aria-label', `Pool ${poolIndex} ${copyKind} copy from rule block`);
    });

    block.querySelectorAll('.copy-rules-btn').forEach((copyBtn) => {
      const copyKind = copyBtn.closest('.copy-rules-row')?.dataset.copyKind || 'rules';
      copyBtn.setAttribute('aria-label', `Copy ${copyKind} rules into Pool ${poolIndex}`);
    });

    block.querySelectorAll('.sanitation-tabs .sanitation-tab').forEach((tab) => {
      const method = tab.dataset.method || tab.textContent.trim() || 'sanitation';
      tab.setAttribute('aria-label', `Pool ${poolIndex} ${method} rules`);
    });
    block.querySelectorAll('.ph-rule-tab').forEach((tab) => {
      const method = tab.textContent.trim() || 'pH';
      tab.setAttribute('aria-label', `Pool ${poolIndex} ${method} pH rules`);
    });
  });

  document.querySelectorAll(`#poolRuleBlocks ${RULE_RESPONSE_SELECTOR}[id], #poolRuleBlocks select.concernLevel[id]`).forEach(labelRuleControl);

  const marketOptions = document.querySelector('#poolMetadataSection .market-options');
  if (marketOptions) {
    marketOptions.setAttribute('role', 'group');
    marketOptions.setAttribute('aria-label', 'Markets');
    marketOptions.querySelectorAll('input[name="editorMarket"]').forEach((input) => {
      input.setAttribute('aria-label', `${input.value} market`);
    });
  }

  document.getElementById('employeeFileInput')?.setAttribute('aria-label', 'Employee file');
  document.getElementById('employeeMarketFilter')?.setAttribute('aria-label', 'Filter employees by market');
  document.getElementById('employeePoolFilter')?.setAttribute('aria-label', 'Filter employees by home pool');
  document.getElementById('darkModeToggle')?.setAttribute('aria-label', 'Toggle dark mode');
}

function ensureAutoControllerToggles() {
  document.querySelectorAll('.pool-rule-block').forEach((block) => {
    if (block.querySelector('.pool-auto-controller-toggle')) return;
    const title = block.querySelector('.pool-rule-title');
    if (!title) return;
    const poolIndex = block.dataset.poolIndex || '';

    const toggle = document.createElement('label');
    toggle.className = 'pool-auto-controller-toggle';
    toggle.innerHTML = `
      <input type="checkbox" class="market-filter-checkbox pool-auto-controller-checkbox" data-pool-index="${poolIndex}">
      <span>Auto Controller</span>
    `;
    title.insertAdjacentElement('afterend', toggle);
  });
}

// ---- Copy Existing Rules ----

function getSanitationMethodLabel(method) {
  return {
    bleach: 'Bleach',
    granular: 'Granular',
    tablet: 'Tablet',
    off: 'No Changes',
  }[method] || 'Bleach';
}

async function getLatestPoolForCopy(poolId) {
  let fallbackPool = poolsCache.find(p => p.id === poolId) || null;

  try {
    poolsCache = await getPools();
    fallbackPool = poolsCache.find(p => p.id === poolId) || fallbackPool;
  } catch (err) {
    console.warn('Unable to fetch the latest pool rules for copy; using cached rules.', err);
  }

  return fallbackPool;
}

function getRulesForMethodCopy(sourcePoolRules = {}, method = 'bleach', phMethod = DEFAULT_PH_RULE_METHOD) {
  const sourceHasLegacyShape = sourcePoolRules.ph || sourcePoolRules.cl;
  const hasMethodDoc = !!sourcePoolRules[method];
  const methodDoc = hasMethodDoc ? sourcePoolRules[method] : (sourceHasLegacyShape ? sourcePoolRules : {});
  const phMethods = getPhMethodsFromDoc(sourcePoolRules);
  const directCl = methodDoc.cl || {};
  const clSource = hasMethodDoc || sourceHasLegacyShape ? directCl : {};

  return {
    ph: cloneRuleMap(phMethods[phMethod]?.ph || phMethods[DEFAULT_PH_RULE_METHOD]?.ph || {}),
    cl: cloneRuleMap(clSource),
  };
}

function getRulesForCopyPool(pool, blockIdx) {
  const rulesForPools = pool?.rules?.pools || [];
  if (rulesForPools.length) return rulesForPools[blockIdx] || null;

  const legacyRules = extractLegacyRulesFromDoc(pool?.rawData || pool, blockIdx + 1);
  return Object.fromEntries(
    [
      ['phMethods', {
        muriaticAcid: { ph: cloneRuleMap(legacyRules.ph) },
        noChanges: { ph: cloneRuleMap(legacyRules.ph) },
      }],
      ...SANITATION_METHODS.map(method => [
        method,
        {
          ph: cloneRuleMap(legacyRules.ph),
          cl: cloneRuleMap(legacyRules.cl),
        },
      ]),
    ]
  );
}

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
  document.querySelectorAll('.copy-rules-row').forEach(copyRow => {
    if (copyRow.dataset.copyRulesBound === 'true') return;
    copyRow.dataset.copyRulesBound = 'true';

    const locationSelect = copyRow.querySelector('.copy-rules-location');
    const blockSelect = copyRow.querySelector('.copy-rules-block');
    const copyBtn = copyRow.querySelector('.copy-rules-btn');
    if (!locationSelect || !blockSelect || !copyBtn) return;

    const poolIndex = locationSelect.dataset.poolIndex;
    const copyKind = copyRow.dataset.copyKind || 'cl';

    locationSelect.addEventListener('change', async () => {
      const poolId = locationSelect.value;
      blockSelect.innerHTML = '<option value="">— Rule block —</option>';
      blockSelect.disabled = true;
      copyBtn.disabled = true;
      if (!poolId) return;

      const pool = await getLatestPoolForCopy(poolId);
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

    copyBtn.addEventListener('click', async () => {
      const poolId = locationSelect.value;
      if (!poolId || blockSelect.value === '') return;

      const blockIdx = Number(blockSelect.value);
      const targetBlock = document.querySelector(`.pool-rule-block[data-pool-index="${poolIndex}"]`);
      if (!targetBlock) return;

      const activeMethod = getActiveSanitationMethod(targetBlock);
      const activePhMethod = getActivePhMethod(targetBlock);
      const originalText = copyBtn.textContent;
      copyBtn.disabled = true;
      copyBtn.textContent = 'Copying...';

      try {
        const pool = await getLatestPoolForCopy(poolId);
        if (!pool) {
          showMessage('Could not find the selected pool to copy from.', 'error');
          return;
        }

        const sourcePoolRules = getRulesForCopyPool(pool, blockIdx);
        if (!sourcePoolRules) {
          showMessage('No saved rule block was found for that pool.', 'error');
          return;
        }

        captureRulesFromBlock(targetBlock, activeMethod);
        const state = getOrCreatePoolRuleState(poolIndex);
        const copiedRules = getRulesForMethodCopy(sourcePoolRules, activeMethod, activePhMethod);

        if (copyKind === 'ph') {
          if (!state.phMethods) state.phMethods = createEmptyPhMethods();
          if (!state.phMethods[activePhMethod]) state.phMethods[activePhMethod] = createEmptyPhMethodRules();
          state.phMethods[activePhMethod].ph = cloneRuleMap(copiedRules.ph);
          const defaultPh = state.phMethods[DEFAULT_PH_RULE_METHOD]?.ph || {};
          SANITATION_METHODS.forEach((method) => {
            if (!state[method]) state[method] = createEmptyMethodRules();
            state[method].ph = cloneRuleMap(defaultPh);
          });
          showRulesForPhMethod(targetBlock, activePhMethod);
          showMessage(`${activePhMethod === 'noChanges' ? 'No Changes' : 'Muriatic Acid'} pH rules copied into Pool ${poolIndex}.`, 'success');
        } else {
          if (!state[activeMethod]) state[activeMethod] = createEmptyMethodRules();
          state[activeMethod].cl = cloneRuleMap(copiedRules.cl);
          const phRules = state.phMethods?.[activePhMethod]?.ph || state[activeMethod].ph || {};
          targetBlock.dataset.activeMethod = activeMethod;
          updateSanitationTabVisuals(targetBlock, activeMethod);
          applyRuleToInputs(targetBlock, { ph: phRules, cl: state[activeMethod].cl || {} });
          showMessage(`${getSanitationMethodLabel(activeMethod)} chlorine rules copied into Pool ${poolIndex}.`, 'success');
        }

        locationSelect.value = '';
        blockSelect.innerHTML = '<option value="">— Rule block —</option>';
        blockSelect.disabled = true;
      } catch (err) {
        console.error('Error copying rules:', err);
        showMessage(`Could not copy rules: ${err?.message || String(err)}`, 'error');
      } finally {
        copyBtn.textContent = originalText;
        copyBtn.disabled = !locationSelect.value || blockSelect.value === '';
      }
    });
  });
}

async function initEditor() {
  removePoolShapeGallonage();
  ensureAutoControllerToggles();
  startPoolListener();
  await refreshPools();
  convertRuleTextareasToRichEditors();
  removeDuplicateRuleHeaderControls();

  // Deduplicate any repeated ids in the rule blocks BEFORE wiring events
  if (typeof dedupeRuleFieldIds === 'function') {
    dedupeRuleFieldIds();
  }
  ensureEditorAccessibility();

  wireMetadataButtons();
  wireBlockButtons();
  injectFormattingToolbars();
  wireAutoResizeRuleTextareas();
  setupPhRuleTabs();
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
