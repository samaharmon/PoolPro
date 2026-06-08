// des-logbooks.js - Daily DES logbook photo submission
import { db, collection, serverTimestamp, doc, setDoc, writeBatch } from '../firebase.js';

const STORAGE_SOURCE = 'firestoreDesLogbookPhoto';
const FIRESTORE_CHUNK_SIZE = 350000;
const IMAGE_MAX_SIDE = 1024;
const IMAGE_QUALITY = 0.66;
const COMPRESS_THRESHOLD_BYTES = 750 * 1024;
const UPLOAD_CONCURRENCY = 3;
const ACCESS_MODE_STORAGE_KEY = 'poolproAccessMode';

const slotCounters = {};

document.addEventListener('DOMContentLoaded', () => {
  if (!enforceGateAttendantPage()) return;
  initSubmitterInfo();
  initPhotoGroups();
  window.addEventListener('poolpro:pools-ready', () => {
    updateDESLogbooksFields(document.getElementById('dutiesPool')?.value || '');
  });
  const poolSelect = document.getElementById('dutiesPool');
  poolSelect?.addEventListener('change', () => updateDESLogbooksFields(poolSelect.value));
  updateDESLogbooksFields(poolSelect?.value || '');
  document.getElementById('desLogbooksForm')?.addEventListener('submit', submitDesLogbooksForm);
});

function getRequestedAccessMode() {
  try {
    return (
      sessionStorage.getItem(ACCESS_MODE_STORAGE_KEY) ||
      localStorage.getItem(ACCESS_MODE_STORAGE_KEY) ||
      ''
    ).toLowerCase();
  } catch (_) {
    return '';
  }
}

function enforceGateAttendantPage() {
  if (getRequestedAccessMode() === 'attendant') return true;
  const container = document.querySelector('.container') || document.body;
  container.innerHTML = `
    <h2 class="page-content-title">DES Logbooks</h2>
    <div class="form-container">
      <div class="section">
        <h2>Access Required</h2>
        <p>This page is available only from the Gate Attendants home screen option.</p>
      </div>
    </div>
  `;
  return false;
}

function getSubmitterEmail() {
  return sessionStorage.getItem('chemlogEmployeeEmail') ||
    sessionStorage.getItem('chemlogEmployeeId') ||
    '';
}

function getSubmitterName() {
  const first = sessionStorage.getItem('chemlogEmployeeFirstName') || '';
  const last = sessionStorage.getItem('chemlogEmployeeLastName') || '';
  return [first, last].filter(Boolean).join(' ').trim() ||
    sessionStorage.getItem('chemlogEmployeeUsername') ||
    getSubmitterEmail() ||
    'Unknown';
}

function initSubmitterInfo() {
  const infoEl = document.getElementById('dutiesSubmitterInfo');
  const submitter = getSubmitterName();
  if (infoEl && submitter) infoEl.textContent = `Submitting as: ${submitter}`;
}

function normalizeFacilityName(name) {
  return String(name || '').trim().toLowerCase();
}

function getSelectedPoolDoc(poolValue) {
  const pools = window._poolsForDuties || [];
  return pools.find((pool) =>
    pool.id === poolValue ||
    pool.name === poolValue ||
    (pool.name || pool.id) === poolValue
  ) || null;
}

function getSlotCount(group) {
  return group?.querySelectorAll('.duties-photo-slot').length || 0;
}

function initPhotoGroups() {
  document.querySelectorAll('.duties-multi-upload').forEach((group) => {
    const min = parseInt(group.dataset.min || '1', 10);
    slotCounters[group.id] = 0;
    for (let i = 0; i < Math.max(min, 1); i += 1) addPhotoSlotToGroup(group);
    updateAddBtn(group.id);
  });
}

function resetPhotoGroup(groupId, options = {}) {
  const group = document.getElementById(groupId);
  if (!group) return;
  if (options.min !== undefined) group.dataset.min = String(options.min);
  if (options.max !== undefined) group.dataset.max = String(options.max);
  group.innerHTML = '';
  slotCounters[groupId] = 0;
  const min = parseInt(group.dataset.min || '1', 10);
  const initialSlots = Number.isFinite(Number(options.initialSlots))
    ? Number(options.initialSlots)
    : min;
  for (let i = 0; i < Math.max(initialSlots, min, 1); i += 1) addPhotoSlotToGroup(group);
  updateAddBtn(groupId);
}

function updateDESLogbooksFields(poolValue) {
  const groupWrap = document.getElementById('desLogbooksGroup');
  const badge = document.getElementById('desLogbooksBadge');
  const desc = document.getElementById('desLogbooksDesc');
  if (!groupWrap || !badge || !desc) return;

  desc.textContent = 'Submit image(s) of the current page of all DES logbooks for your facility. Make sure that the entire page is clearly visible in the photos.';
  const poolDoc = getSelectedPoolDoc(poolValue);
  const poolName = normalizeFacilityName(poolDoc?.name || poolValue);
  let config = { min: 1, max: 2, badge: '1 required, 2 max', initialSlots: 1 };

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

  groupWrap.classList.remove('hidden');
  badge.textContent = config.badge;
  resetPhotoGroup('desLogbooksUpload', config);
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

window.addPhotoSlot = function addPhotoSlot(groupId) {
  const group = document.getElementById(groupId);
  if (!group) return;
  const max = parseInt(group.dataset.max || '10', 10);
  if (getSlotCount(group) >= max) return;
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
  uploadArea.addEventListener('click', () => document.getElementById(inputId)?.click());

  const placeholder = document.createElement('div');
  placeholder.className = 'duties-upload-placeholder';
  placeholder.innerHTML = '<span class="duties-upload-icon">&#128247;</span><span>Tap to add</span>';

  const preview = document.createElement('img');
  preview.className = 'duties-preview';
  preview.alt = 'Preview';
  preview.style.display = 'none';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  fileInput.id = inputId;
  fileInput.addEventListener('change', (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setPhotoSlotFile({ fileInput, preview, placeholder, removeBtn }, files[0]);
    files.slice(1).forEach((file) => {
      if (getSlotCount(group) >= max) return;
      const nextSlot = addPhotoSlotToGroup(group);
      if (nextSlot) setPhotoSlotFile(nextSlot, file);
    });
    updateAddBtn(groupId);
  });

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'duties-clear-btn';
  removeBtn.textContent = 'Remove';
  removeBtn.style.display = 'none';
  removeBtn.addEventListener('click', () => {
    const min = parseInt(group.dataset.min || '1', 10);
    if (getSlotCount(group) > Math.max(min, 1)) {
      slot.remove();
      updateAddBtn(groupId);
      return;
    }
    fileInput.value = '';
    fileInput._selectedFile = null;
    preview.src = '';
    preview.style.display = 'none';
    placeholder.style.display = 'flex';
    removeBtn.style.display = 'none';
  });

  uploadArea.appendChild(placeholder);
  uploadArea.appendChild(preview);
  uploadArea.appendChild(fileInput);
  slot.appendChild(uploadArea);
  slot.appendChild(removeBtn);
  group.appendChild(slot);
  return { fileInput, preview, placeholder, removeBtn };
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
  reader.onload = (event) => {
    preview.src = event.target.result;
    preview.style.display = 'block';
    placeholder.style.display = 'none';
    removeBtn.style.display = 'inline-block';
  };
  reader.readAsDataURL(file);
}

function collectPhotosFromGroup(groupId) {
  const group = document.getElementById(groupId);
  if (!group) return [];
  const files = [];
  group.querySelectorAll('input[type="file"]').forEach((input) => {
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

async function preparePhotoForUpload(file) {
  if (!file || !(file.type || '').startsWith('image/')) {
    return { body: file, contentType: file?.type || 'application/octet-stream' };
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
    if (file.size <= COMPRESS_THRESHOLD_BYTES && largestSide <= IMAGE_MAX_SIDE) {
      return { body: file, contentType: file.type || 'image/jpeg' };
    }
    const scale = Math.min(1, IMAGE_MAX_SIDE / largestSide);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is unavailable for image compression.');
    ctx.drawImage(image, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, 'image/jpeg', IMAGE_QUALITY);
    return { body: blob, contentType: 'image/jpeg' };
  } catch (err) {
    console.warn('[DES Logbooks] Image compression failed; using original file.', err);
    return { body: file, contentType: file.type || 'application/octet-stream' };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function ensureUploadModal() {
  let modal = document.getElementById('dutiesUploadProgressModal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'dutiesUploadProgressModal';
  modal.className = 'duties-upload-progress-modal';
  modal.innerHTML = `
    <div class="duties-upload-progress-card">
      <h2>Uploading DES Logbooks</h2>
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

function updateUploadProgress({ completed = 0, total = 0, message = '', error = false } = {}) {
  const modal = ensureUploadModal();
  modal.classList.toggle('duties-upload-progress-error', !!error);
  const bar = modal.querySelector('#dutiesUploadProgressBar');
  const count = modal.querySelector('#dutiesUploadProgressCount');
  const detail = modal.querySelector('#dutiesUploadProgressDetail');
  const percent = total ? Math.min(100, Math.round((completed / total) * 100)) : (error ? 100 : 15);
  if (bar) bar.style.width = `${percent}%`;
  if (count) count.textContent = total ? `${completed} of ${total} photos uploaded` : 'Saving report';
  if (detail) detail.textContent = message;
}

function showUploadProgress(totalPhotos) {
  const modal = ensureUploadModal();
  modal.style.display = 'flex';
  modal.classList.remove('duties-upload-progress-error');
  requestAnimationFrame(() => modal.classList.add('visible'));
  updateUploadProgress({
    completed: 0,
    total: totalPhotos,
    message: totalPhotos ? 'Preparing photos for upload...' : 'Saving report...',
  });
}

function hideUploadProgress(delay = 0) {
  const modal = document.getElementById('dutiesUploadProgressModal');
  if (!modal) return;
  window.setTimeout(() => {
    modal.classList.remove('visible');
    window.setTimeout(() => {
      if (!modal.classList.contains('visible')) modal.style.display = 'none';
    }, 220);
  }, delay);
}

async function uploadPhoto({ submissionId, pool, file, index }) {
  const safeName = String(file.name || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
  const uploadPayload = await preparePhotoForUpload(file);
  const uniqueId = window.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const photoId = `${Date.now()}_desLogbooks_${index}_${uniqueId}_${safeName}`;
  const photoDoc = doc(db, 'desLogbookSubmissionMedia', submissionId, 'photos', photoId);
  const dataUrl = await readFileAsDataURL(uploadPayload.body);
  const [prefix, encoded = ''] = String(dataUrl || '').split(',');
  if (!encoded) throw new Error(`Unable to encode ${file.name || 'photo'} for upload.`);

  const chunks = [];
  for (let i = 0; i < encoded.length; i += FIRESTORE_CHUNK_SIZE) {
    chunks.push(encoded.slice(i, i + FIRESTORE_CHUNK_SIZE));
  }

  await setDoc(photoDoc, {
    submissionId,
    pool,
    category: 'desLogbooks',
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
      batch.set(doc(db, 'desLogbookSubmissionMedia', submissionId, 'photos', photoId, 'chunks', chunkId), {
        index: chunkIndex,
        data: chunk,
      });
    });
    await batch.commit();
  }

  return {
    index,
    url: `${STORAGE_SOURCE}:${submissionId}:${photoId}`,
    name: file.name || safeName,
    storagePath: '',
    source: STORAGE_SOURCE,
    contentType: uploadPayload.contentType,
    dataUrlPrefix: prefix,
    chunkCount: chunks.length,
    photoId,
    submissionId,
  };
}

async function uploadPhotos({ submissionId, pool, files, onProgress }) {
  const results = [];
  let uploadedCount = 0;
  let nextIndex = 0;

  async function runNextUpload() {
    while (nextIndex < files.length) {
      const index = nextIndex;
      const file = files[index];
      nextIndex += 1;
      onProgress?.({ completed: uploadedCount, total: files.length, fileName: file.name || `Photo ${index + 1}` });
      const uploaded = await uploadPhoto({ submissionId, pool, file, index });
      results.push(uploaded);
      uploadedCount += 1;
      onProgress?.({ completed: uploadedCount, total: files.length, fileName: file.name || `Photo ${index + 1}` });
    }
  }

  const workerCount = Math.min(UPLOAD_CONCURRENCY, files.length);
  if (workerCount > 0) await Promise.all(Array.from({ length: workerCount }, runNextUpload));
  results.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
  return results;
}

async function submitDesLogbooksForm(event) {
  event.preventDefault();
  const pool = document.getElementById('dutiesPool')?.value || '';
  const msgEl = document.getElementById('desLogbooksMessage');
  const submitBtn = document.getElementById('desLogbooksSubmitBtn');
  const uploadGroup = document.getElementById('desLogbooksUpload');
  const min = parseInt(uploadGroup?.dataset.min || '1', 10);
  const files = collectPhotosFromGroup('desLogbooksUpload');

  if (!pool) {
    if (msgEl) {
      msgEl.style.color = '#ff7b7b';
      msgEl.textContent = 'Please select a pool facility.';
    }
    return;
  }
  if (files.length < min) {
    if (msgEl) {
      msgEl.style.color = '#ff7b7b';
      msgEl.textContent = `Please upload at least ${min} DES logbook photo${min === 1 ? '' : 's'}.`;
    }
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  if (msgEl) {
    msgEl.style.color = '#fff';
    msgEl.textContent = `Preparing ${files.length} photo${files.length === 1 ? '' : 's'} for upload...`;
  }

  try {
    const submissionRef = doc(collection(db, 'desLogbookSubmissions'));
    showUploadProgress(files.length);
    const photos = await uploadPhotos({
      submissionId: submissionRef.id,
      pool,
      files,
      onProgress: ({ completed, total, fileName }) => {
        const message = completed >= total
          ? 'Uploads complete. Saving report...'
          : `Uploading ${fileName}.`;
        updateUploadProgress({ completed, total, message });
        if (msgEl) msgEl.textContent = message;
      },
    });

    await setDoc(submissionRef, {
      reportType: 'desLogbooks',
      pool,
      facilityName: pool,
      submitterEmail: getSubmitterEmail() || 'unknown',
      submitterName: getSubmitterName(),
      photos: { desLogbooks: photos },
      timestamp: serverTimestamp(),
    });

    if (msgEl) {
      msgEl.style.color = '#91d36f';
      msgEl.textContent = 'DES logbook report submitted successfully!';
    }
    updateUploadProgress({
      completed: files.length,
      total: files.length,
      message: 'Report saved. You may leave this page now.',
    });
    hideUploadProgress(1000);
    resetPhotoGroup('desLogbooksUpload', {
      min,
      max: parseInt(uploadGroup?.dataset.max || '2', 10),
      initialSlots: min,
    });
  } catch (err) {
    console.error('[DES Logbooks] Submit error:', err);
    updateUploadProgress({
      completed: 0,
      total: 0,
      message: 'Upload failed. Check your connection and try submitting again.',
      error: true,
    });
    hideUploadProgress(2500);
    if (msgEl) {
      msgEl.style.color = '#ff7b7b';
      msgEl.textContent = 'Unable to submit DES logbooks. Please try again.';
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}
