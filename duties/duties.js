// duties.js — Daily Pool Cleanliness Report
import { db, auth, collection, serverTimestamp, doc, getDoc, setDoc, writeBatch } from '../firebase.js';

const SITE_DEVELOPER_EMAIL = 'samaharmon@icloud.com';
const ROLE_PERMISSIONS_DOC_ID = 'rolesPermissions';
const DUTY_FIRESTORE_STORAGE = 'firestoreDutyPhoto';
const DUTY_FIRESTORE_CHUNK_SIZE = 350000;
const DUTY_UPLOAD_IMAGE_MAX_SIDE = 1280;
const DUTY_UPLOAD_IMAGE_QUALITY = 0.72;
const DUTY_UPLOAD_COMPRESS_THRESHOLD_BYTES = 1.5 * 1024 * 1024;

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  initSubmitterInfo();
  initPhotoGroups();
  initManagerSectionToggle();
  setTimeout(populatePools, 800);
  // Wire main pool selector to update CYA fields
  const poolSel = document.getElementById('dutiesPool');
  if (poolSel) {
    poolSel.addEventListener('change', () => {
      populateCYAFields(poolSel.value);
      updateFillLinesFields(poolSel.value);
    });
    updateFillLinesFields(poolSel.value);
  }
});

function isManagerialReportPage() {
  return document.body?.dataset.reportType === 'managerial';
}

// ============================================================
// SUBMITTER INFO (from session — no email input field)
// ============================================================

function initSubmitterInfo() {
  const email = sessionStorage.getItem('chemlogEmployeeEmail') || sessionStorage.getItem('chemlogEmployeeId') || '';
  const infoEl = document.getElementById('dutiesSubmitterInfo');
  if (infoEl && email) {
    infoEl.textContent = `Submitting as: ${email}`;
  }
}

function getSubmitterEmail() {
  return sessionStorage.getItem('chemlogEmployeeEmail') || sessionStorage.getItem('chemlogEmployeeId') || '';
}

// ============================================================
// POOL DROPDOWN
// ============================================================

function populatePools() {
  const sel = document.getElementById('dutiesPool');
  if (!sel) return;
  if (sel.querySelectorAll('optgroup').length > 0) return;
  const pools = window._poolsForDuties || [];
  if (!pools.length) {
    setTimeout(populatePools, 600);
    return;
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
  const initialSlots = options.empty ? 0 : Math.max(min, 1);
  for (let i = 0; i < initialSlots; i++) {
    addPhotoSlotToGroup(group);
  }
  updateAddBtn(groupId);
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

async function uploadDutyPhoto({ submissionId, pool, category, file, index }) {
  const safeName = String(file.name || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
  const uploadPayload = await prepareDutyPhotoForUpload(file);
  const photoId = `${Date.now()}_${index}_${safeName}`;
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
  const totalPhotos = uploadGroups.reduce((sum, group) => sum + group.files.length, 0);
  let uploadedCount = 0;
  const results = {};

  for (const group of uploadGroups) {
    const groupResults = [];
    for (let i = 0; i < group.files.length; i += 1) {
      const file = group.files[i];
      if (typeof onProgress === 'function') {
        onProgress({
          completed: uploadedCount,
          total: totalPhotos,
          label: group.label,
          fileName: file.name || `Photo ${i + 1}`,
        });
      }
      const uploadedPhoto = await uploadDutyPhoto({
        submissionId,
        pool,
        category: group.category,
        file,
        index: i,
      });
      groupResults.push(uploadedPhoto);
      uploadedCount += 1;
    }
    results[group.resultKey] = groupResults;
  }

  if (typeof onProgress === 'function' && totalPhotos > 0) {
    onProgress({
      completed: totalPhotos,
      total: totalPhotos,
      done: true,
    });
  }

  return results;
}

// ============================================================
// SUBMIT
// ============================================================

window.submitDutiesForm = async function () {
  const pool = document.getElementById('dutiesPool')?.value;
  const submitterEmail = getSubmitterEmail();
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
      retur