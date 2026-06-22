// duties.js — Daily Pool Cleanliness Report
import { db, auth, collection, serverTimestamp, doc, getDoc, setDoc, writeBatch } from '../firebase.js';

const SITE_DEVELOPER_EMAIL = 'samaharmon@icloud.com';
const ROLE_PERMISSIONS_DOC_ID = 'rolesPermissions';
const DUTY_FIRESTORE_STORAGE = 'firestoreDutyPhoto';
const DUTY_FIRESTORE_CHUNK_SIZE = 350000;
const DUTY_UPLOAD_IMAGE_MAX_SIDE = 1024;
const DUTY_UPLOAD_IMAGE_QUALITY = 0.66;
const DUTY_UPLOAD_COMPRESS_THRESHOLD_BYTES = 750 * 1024;
const DUTY_UPLOAD_CONCURRENCY = 3;
const CLEANLINESS_REPORT_QUESTION_TYPES = [
  { id: 'deck', label: 'Deck photos', instructions: 'Submit clear photos showing the full deck area.', minPhotos: 2 },
  { id: 'pool', label: 'Pool photos', instructions: 'Submit clear photos showing the pool water and surrounding edge.', minPhotos: 2 },
  { id: 'skimmers', label: 'Skimmer photos', instructions: 'Submit photos of the skimmer baskets and skimmer areas.', minPhotos: 2 },
  { id: 'damaged', label: 'Damaged equipment photos and notes', instructions: 'Document any damaged, unsafe, or missing equipment.', minPhotos: 0 },
  { id: 'bleachFeeders', label: 'Bleach feeder photos', instructions: 'Submit photos of each bleach feeder.', minPhotos: 1 },
  { id: 'desLogbooks', label: 'DES logbook photos', instructions: 'Submit photos where the whole DES logbook page is clearly visible.', minPhotos: 0 },
  { id: 'fillLines', label: 'Fill line photos', instructions: 'Submit photos showing pool fill line conditions.', minPhotos: 0 },
  { id: 'otherNotes', label: 'Other notes', instructions: 'Add any other notes that should be included with this report.', minPhotos: 0 },
];
const CLEANLINESS_REPORT_SETTINGS_DOC_ID = 'cleanlinessReport';
const CLEANLINESS_REPORT_SHIFTS = [
  { key: 'opening', label: 'Opening Shift' },
  { key: 'closing', label: 'Closing Shift' },
];
const CLEANLINESS_BUILT_IN_IDS = new Set(CLEANLINESS_REPORT_QUESTION_TYPES.map((item) => item.id));
const CLEANLINESS_REPORT_PHOTO_GROUPS = {
  deck: { wrapperId: 'deckPhotosGroup', uploadId: 'deckUpload', min: 2, max: 10, initialSlots: 2 },
  pool: { wrapperId: 'poolPhotosGroup', uploadId: 'poolUpload', min: 2, max: 10, initialSlots: 2 },
  skimmers: { wrapperId: 'skimmersPhotosGroup', uploadId: 'skimmersUpload', min: 2, max: 10, initialSlots: 2 },
  damaged: { wrapperId: 'damagedEquipmentGroup', uploadId: 'damagedUpload', min: 0, max: 10, noteIds: ['damagedNotes'] },
  bleachFeeders: { wrapperId: 'bleachFeedersGroup', uploadId: 'bleachFeederUpload', min: 1, max: 10, initialSlots: 1 },
  otherNotes: { wrapperId: 'otherNotesGroup', noteIds: ['dutiesOtherNotes'] },
};
let cleanlinessQuestionBank = [];
let selectedCleanlinessShift = null;

function escapeHtmlUnsafe(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  initSubmitterInfo();
  initPhotoGroups();
  initCleanlinessShiftSelector();
  initManagerSectionToggle();
  loadCleanlinessQuestionBank().finally(() => {
    const poolSel = document.getElementById('dutiesPool');
    updateCleanlinessReportFields(poolSel?.value || '');
  });
  window.addEventListener('poolpro:pools-ready', populatePools);
  populatePools();
  // Wire main pool selector to update CYA fields
  const poolSel = document.getElementById('dutiesPool');
  if (poolSel) {
    poolSel.addEventListener('change', () => {
      populateCYAFields(poolSel.value);
      updateCleanlinessReportFields(poolSel.value);
    });
    updateCleanlinessReportFields(poolSel.value);
  }
});

function isManagerialReportPage() {
  return document.body?.dataset.reportType === 'managerial';
}

// ============================================================
// SUBMITTER INFO (from session — no email input field)
// ============================================================

function initSubmitterInfo() {
  const infoEl = document.getElementById('dutiesSubmitterInfo');
  const submitter = getSubmitterInfo();
  if (infoEl && submitter.displayName) {
    infoEl.textContent = `Submitting as: ${submitter.displayName}`;
  }
}

function getSubmitterEmail() {
  return sessionStorage.getItem('chemlogEmployeeEmail') || sessionStorage.getItem('chemlogEmployeeId') || '';
}

function getSubmitterInfo() {
  const helperRecord = typeof window.getCurrentEmployeeRecord === 'function'
    ? window.getCurrentEmployeeRecord()
    : null;
  const firstName = (helperRecord?.firstName || sessionStorage.getItem('chemlogEmployeeFirstName') || '').trim();
  const lastName = (helperRecord?.lastName || sessionStorage.getItem('chemlogEmployeeLastName') || '').trim();
  const email = (helperRecord?.email || getSubmitterEmail() || '').trim();
  const username = (helperRecord?.username || sessionStorage.getItem('chemlogEmployeeUsername') || '').trim();
  const employeeId = (helperRecord?.employeeId || helperRecord?.id || email || sessionStorage.getItem('chemlogEmployeeId') || '').trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return {
    firstName,
    lastName,
    submitterName: fullName || 'Unknown',
    respondentName: fullName || 'Unknown',
    displayName: fullName || '',
    submitterEmail: email,
    employeeId,
    username,
  };
}

// ============================================================
// POOL DROPDOWN
// ============================================================

let poolPopulateRetryId = null;

function schedulePoolPopulateRetry() {
  if (poolPopulateRetryId) return;
  poolPopulateRetryId = window.setTimeout(() => {
    poolPopulateRetryId = null;
    populatePools();
  }, 500);
}

function populatePools() {
  const sel = document.getElementById('dutiesPool');
  if (!sel) return;
  const current = sel.value;
  while (sel.options.length > 1) sel.remove(1);
  Array.from(sel.querySelectorAll('optgroup')).forEach((group) => group.remove());
  const pools = window._poolsForDuties || [];
  if (!pools.length) {
    schedulePoolPopulateRetry();
    populateCYAFields('');
    updateCleanlinessReportFields('');
    return;
  }
  if (poolPopulateRetryId) {
    window.clearTimeout(poolPopulateRetryId);
    poolPopulateRetryId = null;
  }
  const map = {};
  pools.forEach(p => {
    const market = (p.markets && p.markets[0]) || 'Other';
    if (!map[market]) map[market] = [];
    map[market].push(p);
  });
  Object.keys(map).sort().forEach(market => {
    const group = document.createElement('optgroup');
    group.label = market;
    map[market].sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name || p.id;
      opt.textContent = p.name || p.id;
      group.appendChild(opt);
    });
    sel.appendChild(group);
  });
  if (current) sel.value = current;
  populateCYAFields(sel.value || '');
  updateCleanlinessReportFields(sel.value || '');
}

function getSelectedPoolDoc(poolValue) {
  const pools = window._poolsForDuties || [];
  return pools.find(p => p.id === poolValue || p.name === poolValue || (p.name || p.id) === poolValue) || null;
}

function normalizeFacilityName(name) {
  return String(name || '').trim().toLowerCase();
}

function resetPhotoGroup(groupId, options = {}) {
  const group = document.getElementById(groupId);
  if (!group) return;

  if (options.min !== undefined) group.dataset.min = String(options.min);
  if (options.max !== undefined) group.dataset.max = String(options.max);

  group.innerHTML = '';
  slotCounters[groupId] = 0;

  const min = parseInt(group.dataset.min || '0', 10);
  const configuredInitialSlots = Number.isFinite(Number(options.initialSlots))
    ? Number(options.initialSlots)
    : min;
  const initialSlots = options.empty ? 0 : Math.max(configuredInitialSlots, min, 1);
  for (let i = 0; i < initialSlots; i++) {
    addPhotoSlotToGroup(group);
  }
  updateAddBtn(groupId);
}

function getDefaultCleanlinessQuestionBank() {
  return CLEANLINESS_REPORT_QUESTION_TYPES.map((item) => ({
    ...item,
    builtIn: true,
  }));
}

function normalizeCleanlinessQuestionId(value) {
  const base = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return base || `requirement_${Date.now()}`;
}

function normalizeCleanlinessQuestionBank(items = []) {
  const byId = new Map();
  getDefaultCleanlinessQuestionBank().forEach((item) => byId.set(item.id, item));
  (Array.isArray(items) ? items : []).forEach((item) => {
    const label = String(item?.label || '').trim();
    if (!label) return;
    const id = normalizeCleanlinessQuestionId(item.id || label);
    const builtIn = CLEANLINESS_BUILT_IN_IDS.has(id);
    const existing = byId.get(id) || {};
    const minPhotos = Number.isFinite(Number(item?.minPhotos)) ? Math.max(0, Number(item.minPhotos)) : Number(existing.minPhotos || 0);
    byId.set(id, {
      ...existing,
      id,
      label,
      instructions: String(item?.instructions ?? existing.instructions ?? '').trim(),
      minPhotos,
      builtIn,
      custom: !builtIn,
    });
  });
  return Array.from(byId.values());
}

function getCleanlinessQuestionBank() {
  if (!cleanlinessQuestionBank.length) {
    cleanlinessQuestionBank = normalizeCleanlinessQuestionBank();
  }
  return cleanlinessQuestionBank;
}

async function loadCleanlinessQuestionBank() {
  try {
    const snap = await getDoc(doc(db, 'settings', CLEANLINESS_REPORT_SETTINGS_DOC_ID));
    cleanlinessQuestionBank = normalizeCleanlinessQuestionBank(snap.exists() ? snap.data()?.questionBank : []);
  } catch (err) {
    console.error('[Duties] Error loading cleanliness question bank:', err);
    cleanlinessQuestionBank = normalizeCleanlinessQuestionBank();
  }
}

function getDefaultCleanlinessShiftSettings() {
  const enabledQuestionTypes = {};
  getCleanlinessQuestionBank().forEach((item) => {
    enabledQuestionTypes[item.id] = CLEANLINESS_BUILT_IN_IDS.has(item.id);
  });
  return {
    enabledQuestionTypes,
    questionLabels: {},
    questionInstructions: {},
    questionMinPhotos: {},
    requireBathroomPhotos: false,
  };
}

function normalizeCleanlinessShiftSettings(source = {}, legacySource = null) {
  const defaults = getDefaultCleanlinessShiftSettings();
  const fallback = legacySource && typeof legacySource === 'object' ? legacySource : null;
  const enabledSource = source.enabledQuestionTypes || source.questionTypes || fallback?.enabledQuestionTypes || fallback?.questionTypes || {};
  const labelSource = source.questionLabels || source.labels || {};
  const instructionSource = source.questionInstructions || source.instructions || {};
  const photoSource = source.questionMinPhotos || source.minPhotos || {};

  getCleanlinessQuestionBank().forEach(({ id, minPhotos }) => {
    if (Object.prototype.hasOwnProperty.call(enabledSource, id)) {
      defaults.enabledQuestionTypes[id] = enabledSource[id] !== false;
    } else if (Object.prototype.hasOwnProperty.call(source, id)) {
      defaults.enabledQuestionTypes[id] = source[id] !== false;
    } else if (fallback && Object.prototype.hasOwnProperty.call(fallback, id)) {
      defaults.enabledQuestionTypes[id] = fallback[id] !== false;
    }
    const label = String(labelSource[id] || '').trim();
    if (label) defaults.questionLabels[id] = label;
    const instructions = String(instructionSource[id] ?? '').trim();
    if (instructions) defaults.questionInstructions[id] = instructions;
    if (Object.prototype.hasOwnProperty.call(photoSource, id)) {
      const parsedMin = Number(photoSource[id]);
      if (Number.isFinite(parsedMin) && parsedMin >= 0 && parsedMin !== Number(minPhotos || 0)) {
        defaults.questionMinPhotos[id] = parsedMin;
      }
    }
  });

  defaults.requireBathroomPhotos =
    source.requireBathroomPhotos === true ||
    source.bathroomPhotosRequired === true ||
    source.requireBathrooms === true ||
    fallback?.requireBathroomPhotos === true ||
    fallback?.bathroomPhotosRequired === true ||
    fallback?.requireBathrooms === true;

  return defaults;
}

function normalizeCleanlinessReportSettings(source = {}) {
  const hasShiftSettings = CLEANLINESS_REPORT_SHIFTS.some(({ key }) => source && typeof source[key] === 'object');
  const legacySource = hasShiftSettings ? null : source;
  const settings = {};
  CLEANLINESS_REPORT_SHIFTS.forEach(({ key }) => {
    settings[key] = normalizeCleanlinessShiftSettings(source?.[key] || {}, legacySource);
  });
  return settings;
}

function getDefaultCleanlinessShift() {
  const now = new Date();
  const hour = now.getHours();
  if (hour >= 14 && hour <= 23) return 'closing';
  return 'opening';
}

function setCleanlinessShift(shiftKey) {
  const shift = CLEANLINESS_REPORT_SHIFTS.find((item) => item.key === shiftKey) || CLEANLINESS_REPORT_SHIFTS[0];
  selectedCleanlinessShift = shift.key;
  document.querySelectorAll('.duties-shift-option').forEach((button) => {
    const active = button.dataset.shift === shift.key;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  const fields = document.getElementById('dutiesFormFields');
  if (fields) fields.classList.remove('hidden-by-shift');
  const poolSel = document.getElementById('dutiesPool');
  updateCleanlinessReportFields(poolSel?.value || '');
}

function initCleanlinessShiftSelector() {
  document.querySelectorAll('.duties-shift-option').forEach((button) => {
    button.addEventListener('click', () => setCleanlinessShift(button.dataset.shift));
  });
  setCleanlinessShift(getDefaultCleanlinessShift());
}

function getCleanlinessShiftLabel(shiftKey = selectedCleanlinessShift) {
  return CLEANLINESS_REPORT_SHIFTS.find((item) => item.key === shiftKey)?.label || '';
}

function getCleanlinessReportSettings(poolValue, shiftKey = selectedCleanlinessShift || getDefaultCleanlinessShift()) {
  const poolDoc = getSelectedPoolDoc(poolValue);
  const settings = normalizeCleanlinessReportSettings(poolDoc?.cleanlinessReport || {});
  return settings[shiftKey] || getDefaultCleanlinessShiftSettings();
}

function getCleanlinessQuestionLabel(questionId, settings) {
  const override = String(settings?.questionLabels?.[questionId] || '').trim();
  if (override) return override;
  return getCleanlinessQuestionBank().find((item) => item.id === questionId)?.label || questionId;
}

function getCleanlinessQuestionInstructions(questionId, settings) {
  const override = String(settings?.questionInstructions?.[questionId] || '').trim();
  if (override) return override;
  return getCleanlinessQuestionBank().find((item) => item.id === questionId)?.instructions || '';
}

function getCleanlinessQuestionMinPhotos(questionId, settings) {
  if (Object.prototype.hasOwnProperty.call(settings?.questionMinPhotos || {}, questionId)) {
    const parsed = Number(settings.questionMinPhotos[questionId]);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return Number(getCleanlinessQuestionBank().find((item) => item.id === questionId)?.minPhotos || 0);
}

function toCleanlinessGroupTitle(label) {
  return String(label || '')
    .replace(/\s+photos?(?:\s+and\s+notes)?$/i, '')
    .replace(/\s+notes$/i, ' Notes')
    .trim();
}

function updateCleanlinessGroupTitle(config, label) {
  const wrapper = document.getElementById(config.wrapperId);
  const title = wrapper?.querySelector('.duties-photo-group-title');
  if (!title) return;
  const badge = title.querySelector('span');
  title.textContent = `${toCleanlinessGroupTitle(label)} `;
  if (badge) title.appendChild(badge);
}

function updateCleanlinessGroupInstructions(config, instructions) {
  const wrapper = document.getElementById(config.wrapperId);
  const desc = wrapper?.querySelector('.duties-group-desc');
  if (desc && instructions) desc.textContent = instructions;
}

function updateCleanlinessGroupBadge(config, minPhotos, maxPhotos) {
  const wrapper = document.getElementById(config.wrapperId);
  const badge = wrapper?.querySelector('.duties-opt-badge');
  if (!badge) return;
  const min = Number(minPhotos || 0);
  const max = Number(maxPhotos || 0);
  badge.textContent = min > 0
    ? `${min} required${max > min ? `, ${max} max` : ''}`
    : 'optional';
}

function setCleanlinessPhotoGroup(config, visible, options = {}) {
  const wrapper = document.getElementById(config.wrapperId);
  if (!wrapper) return;
  wrapper.classList.toggle('hidden', !visible);

  const minPhotos = Number.isFinite(Number(options.minPhotos)) ? Math.max(0, Number(options.minPhotos)) : Number(config.min || 0);
  const maxPhotos = Math.max(Number(config.max || minPhotos || 1), minPhotos || 0);
  updateCleanlinessGroupBadge(config, minPhotos, maxPhotos);

  if (config.uploadId) {
    resetPhotoGroup(config.uploadId, visible
      ? { min: minPhotos, max: maxPhotos, initialSlots: Math.max(Number(config.initialSlots || 0), minPhotos || 1) }
      : { min: 0, max: maxPhotos, empty: true });
  }

  if (!visible && Array.isArray(config.noteIds)) {
    config.noteIds.forEach((id) => {
      const field = document.getElementById(id);
      if (field) field.value = '';
    });
  }
}

function setSpecialPhotoGroupHidden(groupId, uploadId, max = 2) {
  const wrapper = document.getElementById(groupId);
  if (wrapper) wrapper.classList.add('hidden');
  resetPhotoGroup(uploadId, { min: 0, max, empty: true });
}

function applySpecialCleanlinessOverrides(questionId, settings, groupId, uploadId, descId, badgeId) {
  const wrapper = document.getElementById(groupId);
  const upload = document.getElementById(uploadId);
  if (!wrapper || !upload || wrapper.classList.contains('hidden')) return;
  if (Object.prototype.hasOwnProperty.call(settings?.questionInstructions || {}, questionId)) {
    const desc = document.getElementById(descId);
    if (desc) desc.textContent = getCleanlinessQuestionInstructions(questionId, settings);
  }
  if (Object.prototype.hasOwnProperty.call(settings?.questionMinPhotos || {}, questionId)) {
    const min = getCleanlinessQuestionMinPhotos(questionId, settings);
    const max = Math.max(min, parseInt(upload.dataset.max || String(min || 1), 10));
    const badge = document.getElementById(badgeId);
    if (badge) badge.textContent = min > 0 ? `${min} required${max > min ? `, ${max} max` : ''}` : 'optional';
    resetPhotoGroup(uploadId, min > 0 ? { min, max, initialSlots: min } : { min: 0, max, empty: true });
  }
}

function updateBathroomPhotoRequirement(required) {
  const wrapper = document.getElementById('bathroomsGroup');
  if (!wrapper) return;
  wrapper.classList.toggle('hidden', !required);
  resetPhotoGroup('bathroomsUpload', required
    ? { min: 4, max: 12, initialSlots: 4 }
    : { min: 0, max: 12, empty: true });
}

function updateCleanlinessReportFields(poolValue) {
  const settings = getCleanlinessReportSettings(poolValue);
  Object.entries(CLEANLINESS_REPORT_PHOTO_GROUPS).forEach(([key, config]) => {
    updateCleanlinessGroupTitle(config, getCleanlinessQuestionLabel(key, settings));
    updateCleanlinessGroupInstructions(config, getCleanlinessQuestionInstructions(key, settings));
    setCleanlinessPhotoGroup(config, settings.enabledQuestionTypes[key] !== false, {
      minPhotos: getCleanlinessQuestionMinPhotos(key, settings),
    });
  });

  updateFillLinesFields(poolValue);
  updateDESLogbooksFields(poolValue);
  applySpecialCleanlinessOverrides('fillLines', settings, 'fillLinesGroup', 'fillLinesUpload', 'fillLinesDesc', 'fillLinesBadge');
  applySpecialCleanlinessOverrides('desLogbooks', settings, 'desLogbooksGroup', 'desLogbooksUpload', 'desLogbooksDesc', 'desLogbooksBadge');

  if (settings.enabledQuestionTypes.fillLines === false) {
    setSpecialPhotoGroupHidden('fillLinesGroup', 'fillLinesUpload', 2);
  }
  if (settings.enabledQuestionTypes.desLogbooks === false) {
    setSpecialPhotoGroupHidden('desLogbooksGroup', 'desLogbooksUpload', 2);
  }

  updateBathroomPhotoRequirement(!!settings.requireBathroomPhotos);
  updateCustomCleanlinessRequirements(settings);
}

function updateCustomCleanlinessRequirements(settings) {
  const wrapper = document.getElementById('customCleanlinessRequirementsGroup');
  const rows = document.getElementById('customCleanlinessRequirementsRows');
  if (!wrapper || !rows) return;
  rows.innerHTML = '';
  const customItems = getCleanlinessQuestionBank().filter((item) =>
    !CLEANLINESS_BUILT_IN_IDS.has(item.id) && settings.enabledQuestionTypes[item.id] === true
  );
  wrapper.classList.toggle('hidden', customItems.length === 0);
  customItems.forEach((item) => {
    const label = getCleanlinessQuestionLabel(item.id, settings);
    const instructions = getCleanlinessQuestionInstructions(item.id, settings);
    const minPhotos = getCleanlinessQuestionMinPhotos(item.id, settings);
    const uploadId = `customUpload_${item.id.replace(/[^a-z0-9_-]/gi, '_')}`;
    const row = document.createElement('div');
    row.className = 'duties-custom-requirement-row';
    row.dataset.requirementId = item.id;
    row.dataset.uploadId = uploadId;
    row.innerHTML = `
      <label class="duties-custom-requirement-checkline">
        <input type="checkbox" class="duties-custom-requirement-check" data-requirement-id="${escapeHtmlUnsafe(item.id)}">
        <span>${escapeHtmlUnsafe(label)}</span>
      </label>
      ${instructions ? `<p class="duties-custom-requirement-instructions">${escapeHtmlUnsafe(instructions)}</p>` : ''}
      ${minPhotos > 0 ? `
        <div class="duties-custom-upload-wrap">
          <div class="duties-multi-upload duties-custom-upload" id="${escapeHtmlUnsafe(uploadId)}" data-category="customRequirements" data-min="${escapeHtmlUnsafe(minPhotos)}" data-max="${escapeHtmlUnsafe(Math.max(minPhotos, 10))}"></div>
          <button type="button" class="duties-add-photo-btn duties-custom-add-photo" data-upload-id="${escapeHtmlUnsafe(uploadId)}">+ Add Photo</button>
        </div>
      ` : ''}
    `;
    rows.appendChild(row);
    if (minPhotos > 0) {
      resetPhotoGroup(uploadId, { min: minPhotos, max: Math.max(minPhotos, 10), initialSlots: minPhotos });
      row.querySelector('.duties-custom-add-photo')?.addEventListener('click', () => addPhotoSlot(uploadId));
    }
  });
}

function updateFillLinesFields(poolValue) {
  const groupWrap = document.getElementById('fillLinesGroup');
  const group = document.getElementById('fillLinesUpload');
  const desc = document.getElementById('fillLinesDesc');
  const badge = document.getElementById('fillLinesBadge');
  if (!groupWrap || !group || !desc || !badge) return;

  const poolDoc = getSelectedPoolDoc(poolValue);
  const poolName = normalizeFacilityName(poolDoc?.name || poolValue);
  const isWildewood = poolName.includes('wildewood');
  const needsValvePhotos =
    poolName.includes('rockbridge') ||
    poolName.includes('forest lake') ||
    poolName.includes('camden cc') ||
    poolName.includes('camden country club') ||
    poolName.includes('camden');

  if (!isWildewood && !needsValvePhotos) {
    groupWrap.classList.add('hidden');
    desc.textContent = '';
    badge.textContent = '1 required';
    resetPhotoGroup('fillLinesUpload', { min: 0, max: 2, empty: true });
    return;
  }

  groupWrap.classList.remove('hidden');
  if (isWildewood) {
    desc.textContent = 'ENSURE THAT THE FILL LINE IS COMPLETELY OFF. Then, submit a photo of the spout by the diving board.';
    badge.textContent = '1 required';
    resetPhotoGroup('fillLinesUpload', { min: 1, max: 1 });
  } else {
    desc.textContent = 'ENSURE THAT THE FILL LINE IS COMPLETELY OFF! Then, submit a photo of the valve for each fill line.';
    badge.textContent = '1 required, 2 max';
    resetPhotoGroup('fillLinesUpload', { min: 1, max: 2 });
  }
}

function updateDESLogbooksFields(poolValue) {
  const groupWrap = document.getElementById('desLogbooksGroup');
  const group = document.getElementById('desLogbooksUpload');
  const badge = document.getElementById('desLogbooksBadge');
  const desc = document.getElementById('desLogbooksDesc');
  if (!groupWrap || !group || !badge || !desc) return;

  desc.textContent = 'Submit image(s) of the current page of all DES logbooks for your facility. Make sure that the entire page is clearly visible in the photos.';
  const poolDoc = getSelectedPoolDoc(poolValue);
  const poolName = normalizeFacilityName(poolDoc?.name || poolValue);

  let config = null;
  if (poolName.includes('columbia country club') || poolName.includes('columbia cc')) {
    config = { min: 1, max: 2, badge: '1 required, 2 max', initialSlots: 2 };
  } else if (poolName.includes('camden country club') || poolName.includes('camden cc')) {
    config = { min: 1, max: 1, badge: '1 required', initialSlots: 1 };
  } else if (
    poolName.includes('forest lake') ||
    poolName.includes('rockbridge') ||
    poolName.includes('wildewood') ||
    poolName.includes('winchester')
  ) {
    config = { min: 2, max: 2, badge: '2 required', initialSlots: 2 };
  }

  if (!config) {
    groupWrap.classList.add('hidden');
    badge.textContent = '1 required';
    resetPhotoGroup('desLogbooksUpload', { min: 0, max: 2, empty: true });
    return;
  }

  groupWrap.classList.remove('hidden');
  badge.textContent = config.badge;
  resetPhotoGroup('desLogbooksUpload', config);
}

// ============================================================
// CYA SECTION — auto-populated from main pool selection
// ============================================================

function populateCYAFields(poolId) {
  const container = document.getElementById('cyaPoolFields');
  if (!container) return;
  container.innerHTML = '';

  if (!poolId) {
    container.innerHTML = '<p style="color:#aaa;font-size:13px;">Select a pool location above to see CYA fields.</p>';
    return;
  }

  const pools = window._poolsForDuties || [];
  // Match by id or by name (value from optgroup option)
  const pool = pools.find(p => p.id === poolId || p.name === poolId || (p.name || p.id) === poolId);
  if (!pool) return;

  const numPools = Math.max(1, parseInt(pool.numPools || pool.poolCount || 1, 10));
  const poolDefs = pool.rules?.pools || [];

  for (let i = 1; i <= numPools; i++) {
    const def = poolDefs[i - 1];
    const subName = def?.poolName ? `Pool ${i}: ${def.poolName}` : (numPools === 1 ? (pool.name || pool.id) : `Pool ${i}`);

    const wrapper = document.createElement('div');
    wrapper.className = 'duties-cya-row';
    const label = document.createElement('label');
    label.textContent = subName;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '100';
    input.placeholder = '0–100';
    input.dataset.poolIndex = i;
    input.className = 'cya-input';
    wrapper.appendChild(label);
    wrapper.appendChild(input);
    container.appendChild(wrapper);
  }
}

// ============================================================
// MULTI-PHOTO UPLOAD
// ============================================================

// photo slot counter per group
const slotCounters = {};

function getSlotCount(group) {
  return group?.querySelectorAll('.duties-photo-slot').length || 0;
}

function initPhotoGroups() {
  document.querySelectorAll('.duties-multi-upload').forEach(group => {
    const min = parseInt(group.dataset.min || '0', 10);
    slotCounters[group.id] = 0;
    // Pre-fill minimum required slots
    const initialSlots = Math.max(min, 1);
    for (let i = 0; i < initialSlots; i++) {
      addPhotoSlotToGroup(group);
    }
    updateAddBtn(group.id);
  });
}

function initManagerSectionToggle() {
  const toggle = document.getElementById('dutiesManagerToggle');
  const body = document.getElementById('dutiesManagerBody');
  const section = document.getElementById('dutiesManagerSection');
  if (!section || !body) return;
  const accessMessage = document.getElementById('managerialAccessMessage');
  const managerialPage = isManagerialReportPage();
  section.classList.add('hidden');

  const setExpanded = (expanded) => {
    if (toggle) toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    body.classList.toggle('collapsed', !expanded);
  };

  setExpanded(managerialPage);
  if (toggle) {
    toggle.addEventListener('click', () => {
      setExpanded(toggle.getAttribute('aria-expanded') !== 'true');
    });
  }

  canAccessManagerialReport().then((allowed) => {
    section.classList.toggle('hidden', !allowed);
    if (accessMessage) {
      accessMessage.textContent = allowed ? '' : 'You do not have permission to view the Managerial Report.';
    }
    const submitBtn = document.getElementById('dutiesSubmitBtn');
    if (managerialPage && submitBtn) submitBtn.disabled = !allowed;
    if (!allowed) {
      if (managerialPage && submitBtn) submitBtn.title = 'Managerial Report permission is required.';
      return;
    }
    if (toggle) toggle.style.display = 'none';
    setExpanded(true);
    section.classList.add('duties-manager-section-open');
  });
}

function normalizeIdentityKey(value) {
  return (value || '').toString().trim().toLowerCase();
}

function getStoredSupervisorEmail() {
  try {
    const token = JSON.parse(localStorage.getItem('loginToken') || 'null');
    return normalizeIdentityKey(token?.username || '');
  } catch (_) {
    return '';
  }
}

function getCurrentIdentityKeys() {
  const keys = [
    auth.currentUser?.email,
    getStoredSupervisorEmail(),
    sessionStorage.getItem('chemlogEmployeeEmail'),
    sessionStorage.getItem('chemlogEmployeeId'),
    sessionStorage.getItem('chemlogEmployeeUsername'),
  ].map(normalizeIdentityKey).filter(Boolean);
  return [...new Set(keys)];
}

function normalizeRolesPermissionsData(data = {}) {
  const roles = data.roles || {};
  const permissions = data.permissions || {};
  const individual = data.individualPermissions || {};
  const normalizedIndividual = Object.fromEntries(Object.entries(individual).map(([key, value]) => {
    const permissionOverrides = {};
    if (Object.prototype.hasOwnProperty.call(value || {}, 'managerialReport')) {
      permissionOverrides.managerialReport = !!value.managerialReport;
    }
    return [normalizeIdentityKey(key), permissionOverrides];
  }));
  return {
    roles: {
      poolManager: Array.isArray(roles.poolManager) ? roles.poolManager.map(normalizeIdentityKey).filter(Boolean) : [],
      supervisor: Array.isArray(roles.supervisor) ? roles.supervisor.map(normalizeIdentityKey).filter(Boolean) : [],
    },
    permissions: {
      poolManager: { managerialReport: !!permissions.poolManager?.managerialReport },
      supervisor: { managerialReport: !!permissions.supervisor?.managerialReport },
    },
    individualPermissions: normalizedIndividual,
  };
}

async function canAccessManagerialReport() {
  if (typeof window.poolProCanAccessManagerialReport === 'function') {
    return !!window.poolProCanAccessManagerialReport();
  }
  const keys = getCurrentIdentityKeys();
  if (keys.includes(SITE_DEVELOPER_EMAIL)) return true;
  try {
    const snap = await getDoc(doc(db, 'settings', ROLE_PERMISSIONS_DOC_ID));
    const roleData = normalizeRolesPermissionsData(snap.exists() ? snap.data() : {});
    const keySet = new Set(keys);
    const hasDeniedOverride = keys.some((key) =>
      Object.prototype.hasOwnProperty.call(roleData.individualPermissions[key] || {}, 'managerialReport') &&
      roleData.individualPermissions[key].managerialReport === false
    );
    if (hasDeniedOverride) return false;
    const individualAllowed = keys.some((key) => roleData.individualPermissions[key]?.managerialReport === true);
    if (individualAllowed) return true;
    const roleAllowed = ['poolManager', 'supervisor'].some((roleKey) =>
      (roleData.roles[roleKey] || []).some((memberKey) => keySet.has(memberKey)) &&
      roleData.permissions[roleKey]?.managerialReport
    );
    return roleAllowed;
  } catch (err) {
    console.error('[Duties] Error loading managerial permissions:', err);
    return false;
  }
}

window.addPhotoSlot = function (groupId) {
  const group = document.getElementById(groupId);
  if (!group) return;
  const max = parseInt(group.dataset.max || '10', 10);
  if (slotCounters[groupId] >= max) return;
  addPhotoSlotToGroup(group);
  updateAddBtn(groupId);
};

function addPhotoSlotToGroup(group) {
  const groupId = group.id;
  const max = parseInt(group.dataset.max || '10', 10);
  if (getSlotCount(group) >= max) return null;

  const idx = ++slotCounters[groupId];
  const slotId = `${groupId}_slot${idx}`;
  const inputId = `${groupId}_input${idx}`;

  const slot = document.createElement('div');
  slot.className = 'duties-photo-slot';
  slot.id = slotId;

  const uploadArea = document.createElement('div');
  uploadArea.className = 'duties-upload-area';
  uploadArea.onclick = () => document.getElementById(inputId)?.click();

  const placeholder = document.createElement('div');
  placeholder.className = 'duties-upload-placeholder';
  placeholder.id = `${slotId}_placeholder`;
  placeholder.innerHTML = `<span class="duties-upload-icon">&#128247;</span><span>Tap to add</span>`;

  const preview = document.createElement('img');
  preview.className = 'duties-preview';
  preview.id = `${slotId}_preview`;
  preview.alt = 'Preview';
  preview.style.display = 'none';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  fileInput.id = inputId;
  fileInput.name = inputId;
  fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setPhotoSlotFile({ slot, fileInput, preview, placeholder, removeBtn }, files[0]);

    files.slice(1).forEach((file) => {
      if (getSlotCount(group) >= max) return;
      // Fill an existing empty slot before creating a new one
      let filled = false;
      for (const s of group.querySelectorAll('.duties-photo-slot')) {
        const inp = s.querySelector('input[type="file"]');
        if (!inp || inp.files?.[0] || inp._selectedFile) continue;
        const prev = s.querySelector('.duties-preview');
        const ph = s.querySelector('.duties-upload-placeholder');
        const rb = s.querySelector('.duties-clear-btn');
        if (prev && ph && rb) {
          setPhotoSlotFile({ fileInput: inp, preview: prev, placeholder: ph, removeBtn: rb }, file);
          filled = true;
          break;
        }
      }
      if (!filled) {
        const nextSlot = addPhotoSlotToGroup(group);
        if (nextSlot) setPhotoSlotFile(nextSlot, file);
      }
    });
    updateAddBtn(groupId);
  });

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'duties-clear-btn';
  removeBtn.textContent = 'Remove';
  removeBtn.style.display = 'none';
  removeBtn.onclick = () => {
    const min = parseInt(group.dataset.min || '0', 10);
    // Always remove slot if above minimum, or just clear if at minimum
    if (getSlotCount(group) > Math.max(min, 1)) {
      slot.remove();
      updateAddBtn(groupId);
    } else {
      // Just clear the photo
      fileInput.value = '';
      fileInput._selectedFile = null;
      preview.src = '';
      preview.style.display = 'none';
      placeholder.style.display = 'flex';
      removeBtn.style.display = 'none';
    }
  };

  uploadArea.appendChild(placeholder);
  uploadArea.appendChild(preview);
  uploadArea.appendChild(fileInput);
  slot.appendChild(uploadArea);
  slot.appendChild(removeBtn);
  group.appendChild(slot);
  return { slot, fileInput, preview, placeholder, removeBtn };
}

function setPhotoSlotFile(slotParts, file) {
  const { fileInput, preview, placeholder, removeBtn } = slotParts;
  if (!fileInput || !file) return;
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
  } catch (_) {
    fileInput._selectedFile = file;
  }

  const reader = new FileReader();
  reader.onload = (ev) => {
    preview.src = ev.target.result;
    preview.style.display = 'block';
    placeholder.style.display = 'none';
    removeBtn.style.display = 'inline-block';
  };
  reader.readAsDataURL(file);
}

function updateAddBtn(groupId) {
  const group = document.getElementById(groupId);
  if (!group) return;
  const max = parseInt(group.dataset.max || '10', 10);
  const count = getSlotCount(group);
  const btn = group.nextElementSibling;
  if (btn && btn.classList.contains('duties-add-photo-btn')) {
    btn.style.display = count >= max ? 'none' : 'inline-block';
    btn.textContent = `+ Add Photo (${count}/${max})`;
  }
}

// ============================================================
// COLLECT PHOTOS FROM A GROUP
// ============================================================

function collectPhotosFromGroup(groupId) {
  const group = document.getElementById(groupId);
  if (!group) return [];
  const files = [];
  group.querySelectorAll('input[type="file"]').forEach(input => {
    const file = input.files?.[0] || input._selectedFile;
    if (file) files.push(file);
  });
  return files;
}

function collectCustomCleanlinessRequirements() {
  const rows = Array.from(document.querySelectorAll('#customCleanlinessRequirementsRows .duties-custom-requirement-row'));
  return rows.map((row) => {
    const checkbox = row.querySelector('.duties-custom-requirement-check');
    const label = row.querySelector('.duties-custom-requirement-checkline span')?.textContent?.trim() || '';
    const uploadId = row.dataset.uploadId || '';
    const minPhotos = uploadId ? parseInt(document.getElementById(uploadId)?.dataset.min || '0', 10) : 0;
    return {
      id: checkbox?.dataset.requirementId || '',
      label,
      completed: checkbox?.checked === true,
      minPhotos,
      photoKey: uploadId ? `custom_${checkbox?.dataset.requirementId || ''}` : '',
    };
  }).filter((item) => item.id || item.label);
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Unable to prepare image for upload.'));
    }, type, quality);
  });
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Unable to read file.'));
    reader.readAsDataURL(file);
  });
}

async function prepareDutyPhotoForUpload(file) {
  if (!file || !(file.type || '').startsWith('image/')) {
    return {
      body: file,
      contentType: file?.type || 'application/octet-stream',
    };
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Unable to prepare image preview.'));
      img.src = objectUrl;
    });

    const sourceWidth = image.naturalWidth || image.width || 1;
    const sourceHeight = image.naturalHeight || image.height || 1;
    const largestSide = Math.max(sourceWidth, sourceHeight);
    if (file.size <= DUTY_UPLOAD_COMPRESS_THRESHOLD_BYTES && largestSide <= DUTY_UPLOAD_IMAGE_MAX_SIDE) {
      return {
        body: file,
        contentType: file.type || 'image/jpeg',
      };
    }

    const scale = Math.min(1, DUTY_UPLOAD_IMAGE_MAX_SIDE / largestSide);
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is unavailable for image compression.');
    ctx.drawImage(image, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, 'image/jpeg', DUTY_UPLOAD_IMAGE_QUALITY);
    return {
      body: blob,
      contentType: 'image/jpeg',
    };
  } catch (err) {
    console.warn('[Duties] Image compression failed; using original file upload.', err);
    return {
      body: file,
      contentType: file.type || 'application/octet-stream',
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function ensureDutiesUploadModal() {
  let modal = document.getElementById('dutiesUploadProgressModal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'dutiesUploadProgressModal';
  modal.className = 'duties-upload-progress-modal';
  modal.innerHTML = `
    <div class="duties-upload-progress-card">
      <h2>Uploading Cleanliness Report</h2>
      <p class="duties-upload-progress-warning">Keep this page open until every photo finishes uploading.</p>
      <div class="duties-upload-progress-track" aria-hidden="true">
        <div class="duties-upload-progress-bar" id="dutiesUploadProgressBar"></div>
      </div>
      <p class="duties-upload-progress-count" id="dutiesUploadProgressCount">Starting upload...</p>
      <p class="duties-upload-progress-detail" id="dutiesUploadProgressDetail"></p>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

function showDutiesUploadProgress(totalPhotos) {
  const modal = ensureDutiesUploadModal();
  modal.style.display = 'flex';
  modal.classList.remove('duties-upload-progress-error');
  requestAnimationFrame(() => modal.classList.add('visible'));
  updateDutiesUploadProgress({
    completed: 0,
    total: totalPhotos,
    message: totalPhotos ? 'Preparing photos for upload...' : 'Saving report...',
  });
}

function updateDutiesUploadProgress({ completed = 0, total = 0, message = '', error = false } = {}) {
  const modal = ensureDutiesUploadModal();
  modal.classList.toggle('duties-upload-progress-error', !!error);
  const bar = modal.querySelector('#dutiesUploadProgressBar');
  const count = modal.querySelector('#dutiesUploadProgressCount');
  const detail = modal.querySelector('#dutiesUploadProgressDetail');
  const percent = total ? Math.min(100, Math.round((completed / total) * 100)) : (error ? 100 : 15);
  if (bar) bar.style.width = `${percent}%`;
  if (count) count.textContent = total ? `${completed} of ${total} photos uploaded` : 'Saving report';
  if (detail) detail.textContent = message;
}

function hideDutiesUploadProgress(delay = 0) {
  const modal = document.getElementById('dutiesUploadProgressModal');
  if (!modal) return;
  window.setTimeout(() => {
    modal.classList.remove('visible');
    window.setTimeout(() => {
      if (!modal.classList.contains('visible')) modal.style.display = 'none';
    }, 220);
  }, delay);
}

async function uploadDutyPhoto({ submissionId, pool, category, file, index }) {
  const safeName = String(file.name || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
  const uploadPayload = await prepareDutyPhotoForUpload(file);
  const uniqueId = window.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const photoId = `${Date.now()}_${category}_${index}_${uniqueId}_${safeName}`;
  const photoDoc = doc(db, 'dutySubmissionMedia', submissionId, 'photos', photoId);
  const dataUrl = await readFileAsDataURL(uploadPayload.body);
  const [prefix, encoded = ''] = String(dataUrl || '').split(',');
  if (!encoded) throw new Error(`Unable to encode ${file.name || 'photo'} for upload.`);

  const chunks = [];
  for (let i = 0; i < encoded.length; i += DUTY_FIRESTORE_CHUNK_SIZE) {
    chunks.push(encoded.slice(i, i + DUTY_FIRESTORE_CHUNK_SIZE));
  }

  await setDoc(photoDoc, {
    submissionId,
    pool,
    category,
    index,
    fileName: file.name || safeName,
    contentType: uploadPayload.contentType,
    chunkCount: chunks.length,
    dataUrlPrefix: prefix,
    storedAt: serverTimestamp(),
  });

  for (let i = 0; i < chunks.length; i += 400) {
    const batch = writeBatch(db);
    chunks.slice(i, i + 400).forEach((chunk, offset) => {
      const chunkIndex = i + offset;
      const chunkId = String(chunkIndex).padStart(4, '0');
      batch.set(doc(db, 'dutySubmissionMedia', submissionId, 'photos', photoId, 'chunks', chunkId), {
        index: chunkIndex,
        data: chunk,
      });
    });
    await batch.commit();
  }

  return {
    index,
    url: `${DUTY_FIRESTORE_STORAGE}:${submissionId}:${photoId}`,
    name: file.name,
    storagePath: '',
    source: DUTY_FIRESTORE_STORAGE,
    contentType: uploadPayload.contentType,
    dataUrlPrefix: prefix,
    chunkCount: chunks.length,
    photoId,
    submissionId,
  };
}

async function uploadDutyPhotoGroups({ submissionId, pool, uploadGroups, onProgress }) {
  const uploadTasks = uploadGroups.flatMap((group) =>
    group.files.map((file, index) => ({ group, file, index }))
  );
  const totalPhotos = uploadTasks.length;
  let uploadedCount = 0;
  let nextTaskIndex = 0;
  const results = Object.fromEntries(uploadGroups.map((group) => [group.resultKey, []]));

  async function runNextUpload() {
    while (nextTaskIndex < uploadTasks.length) {
      const task = uploadTasks[nextTaskIndex];
      nextTaskIndex += 1;
      if (typeof onProgress === 'function') {
        onProgress({
          completed: uploadedCount,
          total: totalPhotos,
          label: task.group.label,
          fileName: task.file.name || `Photo ${task.index + 1}`,
        });
      }
      const uploadedPhoto = await uploadDutyPhoto({
        submissionId,
        pool,
        category: task.group.category,
        file: task.file,
        index: task.index,
      });
      results[task.group.resultKey].push(uploadedPhoto);
      uploadedCount += 1;
      if (typeof onProgress === 'function') {
        onProgress({
          completed: uploadedCount,
          total: totalPhotos,
          label: task.group.label,
          fileName: task.file.name || `Photo ${task.index + 1}`,
        });
      }
    }
  }

  const workerCount = Math.min(DUTY_UPLOAD_CONCURRENCY, totalPhotos);
  if (workerCount > 0) {
    await Promise.all(Array.from({ length: workerCount }, runNextUpload));
  }

  if (typeof onProgress === 'function' && totalPhotos > 0) {
    onProgress({
      completed: totalPhotos,
      total: totalPhotos,
      done: true,
    });
  }

  Object.values(results).forEach((items) => items.sort((a, b) => Number(a.index || 0) - Number(b.index || 0)));
  return results;
}

// ============================================================
// SUBMIT
// ============================================================

window.submitDutiesForm = async function () {
  const pool = document.getElementById('dutiesPool')?.value;
  const submitter = getSubmitterInfo();
  const msgEl = document.getElementById('dutiesMessage');
  const managerialPage = isManagerialReportPage();

  if (!pool) {
    if (msgEl) { msgEl.style.color = '#c0392b'; msgEl.textContent = 'Please select a pool facility.'; }
    return;
  }

  if (managerialPage) {
    const allowed = await canAccessManagerialReport();
    if (!allowed) {
      if (msgEl) { msgEl.style.color = '#c0392b'; msgEl.textContent = 'You do not have permission to submit a managerial report.'; }
      return;
    }
  }

  const requiredGroups = [];
  const addRequiredPhotoGroup = (id, label, fallbackMin = 1) => {
    const upload = document.getElementById(id);
    const wrapper = upload?.closest('.duties-photo-group');
    if (!upload || !wrapper || wrapper.classList.contains('hidden')) return;
    const min = parseInt(upload.dataset.min || String(fallbackMin), 10);
    if (min > 0) requiredGroups.push({ id, label, min });
  };

  if (!managerialPage) {
    addRequiredPhotoGroup('deckUpload', 'Deck', 2);
    addRequiredPhotoGroup('poolUpload', 'Pool', 2);
    addRequiredPhotoGroup('skimmersUpload', 'Skimmers', 2);
    addRequiredPhotoGroup('bathroomsUpload', 'Bathrooms', 4);
    addRequiredPhotoGroup('bleachFeederUpload', 'Bleach Feeders', 1);
  }

  const fillLinesGroup = document.getElementById('fillLinesGroup');
  const fillLinesUpload = document.getElementById('fillLinesUpload');
  if (fillLinesGroup && fillLinesUpload && !fillLinesGroup.classList.contains('hidden')) {
    requiredGroups.push({
      id: 'fillLinesUpload',
      label: 'Fill Lines',
      min: parseInt(fillLinesUpload.dataset.min || '1', 10),
    });
  }

  const desLogbooksGroup = document.getElementById('desLogbooksGroup');
  const desLogbooksUpload = document.getElementById('desLogbooksUpload');
  if (desLogbooksGroup && desLogbooksUpload && !desLogbooksGroup.classList.contains('hidden')) {
    requiredGroups.push({
      id: 'desLogbooksUpload',
      label: 'DES Logbooks',
      min: parseInt(desLogbooksUpload.dataset.min || '1', 10),
    });
  }

  document.querySelectorAll('.duties-custom-upload').forEach((upload) => {
    const row = upload.closest('.duties-custom-requirement-row');
    const label = row?.querySelector('.duties-custom-requirement-checkline span')?.textContent?.trim() || 'Additional Requirement';
    const min = parseInt(upload.dataset.min || '0', 10);
    if (min > 0) requiredGroups.push({ id: upload.id, label, min });
  });

  for (const g of requiredGroups) {
    const photos = collectPhotosFromGroup(g.id);
    if (photos.length < g.min) {
      if (msgEl) { msgEl.style.color = '#c0392b'; msgEl.textContent = `Please upload at least ${g.min} photos for ${g.label}.`; }
      return;
    }
  }

  const customRequirements = collectCustomCleanlinessRequirements();
  const incompleteRequirement = customRequirements.find((item) => !item.completed);
  if (!managerialPage && incompleteRequirement) {
    if (msgEl) {
      msgEl.style.color = '#c0392b';
      msgEl.textContent = `Please complete this requirement: ${incompleteRequirement.label}`;
    }
    return;
  }

  const submitBtn = document.getElementById('dutiesSubmitBtn');
  if (submitBtn) submitBtn.disabled = true;
  if (msgEl) { msgEl.style.color = '#333'; msgEl.textContent = 'Submitting…'; }

  try {
    const submissionRef = doc(collection(db, managerialPage ? 'managerialReports' : 'dutySubmissions'));
    const uploadGroups = [
      { groupId: 'deckUpload', category: 'deck', resultKey: 'deck', label: 'Deck' },
      { groupId: 'poolUpload', category: 'pool', resultKey: 'pool', label: 'Pool' },
      { groupId: 'skimmersUpload', category: 'skimmers', resultKey: 'skimmers', label: 'Skimmers' },
      { groupId: 'bathroomsUpload', category: 'bathrooms', resultKey: 'bathrooms', label: 'Bathrooms' },
      { groupId: 'damagedUpload', category: 'damaged', resultKey: 'damaged', label: 'Damaged Equipment' },
      { groupId: 'bleachFeederUpload', category: 'bleachFeeders', resultKey: 'bleachFeeders', label: 'Bleach Feeders' },
      { groupId: 'desLogbooksUpload', category: 'desLogbooks', resultKey: 'desLogbooks', label: 'DES Logbooks' },
      { groupId: 'fillLinesUpload', category: 'fillLines', resultKey: 'fillLines', label: 'Fill Lines' },
      { groupId: 'bleachUpload', category: 'bleach', resultKey: 'bleach', label: 'Managers Only' },
      ...Array.from(document.querySelectorAll('.duties-custom-upload')).map((upload) => {
        const row = upload.closest('.duties-custom-requirement-row');
        const requirementId = row?.dataset.requirementId || upload.id;
        const label = row?.querySelector('.duties-custom-requirement-checkline span')?.textContent?.trim() || 'Additional Requirement';
        return {
          groupId: upload.id,
          category: `customRequirements/${requirementId}`,
          resultKey: `custom_${requirementId}`,
          label,
        };
      }),
    ].map((group) => ({
      ...group,
      files: collectPhotosFromGroup(group.groupId),
    }));

    const totalPhotos = uploadGroups.reduce((sum, group) => sum + group.files.length, 0);
    showDutiesUploadProgress(totalPhotos);
    if (msgEl) {
      msgEl.style.color = '#333';
      msgEl.textContent = totalPhotos
        ? `Preparing ${totalPhotos} photo${totalPhotos === 1 ? '' : 's'} for upload...`
        : 'Submitting...';
    }

    const uploadedPhotos = await uploadDutyPhotoGroups({
      submissionId: submissionRef.id,
      pool,
      uploadGroups,
      onProgress: ({ completed, total, label, fileName, done }) => {
        const message = done || completed >= total
          ? `Uploads complete. Saving report...`
          : completed > 0
            ? `Uploaded ${completed} of ${total} photos. Uploading ${label}: ${fileName}`
            : `Uploading photo 1 of ${total} for ${label}: ${fileName}`;
        updateDutiesUploadProgress({
          completed: done ? total : completed,
          total,
          message,
        });
        if (!msgEl || !total) return;
        msgEl.style.color = '#333';
        msgEl.textContent = message;
      },
    });

    // Collect CYA readings
    const cyaReadings = {};
    document.querySelectorAll('.cya-input').forEach(input => {
      if (input.value !== '') {
        cyaReadings[`pool${input.dataset.poolIndex}`] = parseFloat(input.value);
      }
    });

    await setDoc(submissionRef, {
      reportType: managerialPage ? 'managerial' : 'cleanliness',
      shift: managerialPage ? null : (selectedCleanlinessShift || getDefaultCleanlinessShift()),
      shiftLabel: managerialPage ? null : getCleanlinessShiftLabel(),
      pool,
      firstName: submitter.firstName,
      lastName: submitter.lastName,
      submitterName: submitter.submitterName,
      respondentName: submitter.respondentName,
      submitterEmail: submitter.submitterEmail || 'unknown',
      employeeId: submitter.employeeId || submitter.submitterEmail || '',
      username: submitter.username || '',
      photos: {
        deck: uploadedPhotos.deck || [],
        pool: uploadedPhotos.pool || [],
        skimmers: uploadedPhotos.skimmers || [],
        bathrooms: uploadedPhotos.bathrooms || [],
        damaged: uploadedPhotos.damaged || [],
        bleachFeeders: uploadedPhotos.bleachFeeders || [],
        desLogbooks: uploadedPhotos.desLogbooks || [],
        fillLines: uploadedPhotos.fillLines || [],
        bleach: uploadedPhotos.bleach || [],
      },
      customRequirementPhotos: Object.fromEntries(
        Object.entries(uploadedPhotos)
          .filter(([key]) => key.startsWith('custom_'))
          .map(([key, value]) => [key.replace(/^custom_/, ''), value])
      ),
      damagedNotes: document.getElementById('damagedEquipmentGroup')?.classList.contains('hidden') ? '' : (document.getElementById('damagedNotes')?.value?.trim() || ''),
      otherNotes: document.getElementById('otherNotesGroup')?.classList.contains('hidden') ? '' : (document.getElementById('dutiesOtherNotes')?.value?.trim() || ''),
      customRequirements: managerialPage ? [] : customRequirements,
      bleachVolume: document.getElementById('bleachVolume')?.value || null,
      muriaticAcid: document.getElementById('muriaticAcid')?.value || null,
      shockGranular: document.getElementById('shockGranular')?.value || null,
      cyaReadings,
      timestamp: serverTimestamp(),
    });

    if (msgEl) {
      msgEl.style.color = '#1a8a1a';
      msgEl.textContent = managerialPage ? 'Managerial report submitted successfully!' : 'Form submitted successfully!';
    }
    updateDutiesUploadProgress({
      completed: totalPhotos,
      total: totalPhotos,
      message: 'Report saved. You may leave this page now.',
    });
    hideDutiesUploadProgress(1000);
    resetForm();
  } catch (err) {
    console.error('[Duties] Submit error:', err);
    updateDutiesUploadProgress({
      completed: 0,
      total: 0,
      message: 'Upload failed. Check your connection and try submitting again.',
      error: true,
    });
    hideDutiesUploadProgress(2500);
    if (msgEl) {
      msgEl.style.color = '#c0392b';
      msgEl.textContent = 'Error submitting form. Please try again.';
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
};

function resetForm() {
  const poolSelect = document.getElementById('dutiesPool');
  if (poolSelect) poolSelect.value = '';
  ['damagedNotes', 'dutiesOtherNotes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['bleachVolume', 'muriaticAcid', 'shockGranular'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.querySelectorAll('.cya-input').forEach(el => { el.value = ''; });

  // Reset all photo groups
  ['deckUpload', 'poolUpload', 'skimmersUpload', 'bathroomsUpload', 'damagedUpload', 'bleachFeederUpload', 'desLogbooksUpload', 'fillLinesUpload', 'bleachUpload'].forEach(groupId => {
    const group = document.getElementById(groupId);
    if (!group) return;
    group.innerHTML = '';
    slotCounters[groupId] = 0;
    const min = parseInt(group.dataset.min || '0', 10);
    const initialSlots = Math.max(min, 1);
    for (let i = 0; i < initialSlots; i++) addPhotoSlotToGroup(group);
    updateAddBtn(groupId);
  });
  updateCleanlinessReportFields('');
}
