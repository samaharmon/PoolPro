// duties.js — Daily Pool Cleanliness Report
import { db, collection, addDoc, serverTimestamp } from '../firebase.js';
import { getApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js';

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  initSubmitterInfo();
  initPhotoGroups();
  setTimeout(populatePools, 800);
  setTimeout(populateCYAFields, 1200);
});

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

// ============================================================
// CYA FIELDS — per pool based on pool metadata
// ============================================================

function populateCYAFields() {
  const container = document.getElementById('cyaPoolFields');
  if (!container) return;
  const selectedPool = document.getElementById('dutiesPool')?.value;
  const pools = window._poolsForDuties || [];

  // Filter pools to match selected facility (if selected)
  // For CYA, we show inputs for sub-pools of the selected facility
  // or just one generic input if no sub-pool info available
  let poolsToShow = pools;
  if (selectedPool) {
    // Find pools matching the selected facility name
    const exact = pools.filter(p => (p.name || p.id) === selectedPool);
    if (exact.length) poolsToShow = exact;
  }

  container.innerHTML = '';
  if (!poolsToShow.length) {
    container.innerHTML = '<p style="color:#aaa;font-size:13px;">Select a pool above to see CYA fields.</p>';
    return;
  }

  poolsToShow.forEach(pool => {
    const wrapper = document.createElement('div');
    wrapper.className = 'duties-cya-row';
    const label = document.createElement('label');
    label.textContent = pool.name || pool.id;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '100';
    input.placeholder = '0–100';
    input.dataset.poolId = pool.id || pool.name;
    input.className = 'cya-input';
    wrapper.appendChild(label);
    wrapper.appendChild(input);
    container.appendChild(wrapper);
  });
}

// Update CYA fields when pool selection changes
document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('dutiesPool');
  if (sel) {
    sel.addEventListener('change', () => {
      setTimeout(populateCYAFields, 100);
    });
  }
});

// ============================================================
// MULTI-PHOTO UPLOAD
// ============================================================

// photo slot counter per group
const slotCounters = {};

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
  if (slotCounters[groupId] >= max) return;

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
  fileInput.capture = 'environment';
  fileInput.style.display = 'none';
  fileInput.id = inputId;
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      preview.src = ev.target.result;
      preview.style.display = 'block';
      placeholder.style.display = 'none';
      removeBtn.style.display = 'inline-block';
    };
    reader.readAsDataURL(file);
  });

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'duties-clear-btn';
  removeBtn.textContent = 'Remove';
  removeBtn.style.display = 'none';
  removeBtn.onclick = () => {
    const min = parseInt(group.dataset.min || '0', 10);
    // Always remove slot if above minimum, or just clear if at minimum
    if (slotCounters[groupId] > Math.max(min, 1)) {
      slot.remove();
      slotCounters[groupId]--;
      updateAddBtn(groupId);
    } else {
      // Just clear the photo
      fileInput.value = '';
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
}

function updateAddBtn(groupId) {
  const group = document.getElementById(groupId);
  if (!group) return;
  const max = parseInt(group.dataset.max || '10', 10);
  const btn = group.nextElementSibling;
  if (btn && btn.classList.contains('duties-add-photo-btn')) {
    btn.style.display = slotCounters[groupId] >= max ? 'none' : 'inline-block';
    btn.textContent = `+ Add Photo (${slotCounters[groupId]}/${max})`;
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
    if (input.files[0]) files.push(input.files[0]);
  });
  return files;
}

// ============================================================
// SUBMIT
// ============================================================

window.submitDutiesForm = async function () {
  const pool = document.getElementById('dutiesPool')?.value;
  const submitterEmail = getSubmitterEmail();
  const msgEl = document.getElementById('dutiesMessage');

  if (!pool) {
    if (msgEl) { msgEl.style.color = '#c0392b'; msgEl.textContent = 'Please select a pool facility.'; }
    return;
  }

  // Validate required photo groups
  const requiredGroups = [
    { id: 'deckUpload', label: 'Deck', min: 2 },
    { id: 'poolUpload', label: 'Pool', min: 2 },
    { id: 'skimmersUpload', label: 'Skimmers', min: 2 },
  ];

  for (const g of requiredGroups) {
    const photos = collectPhotosFromGroup(g.id);
    if (photos.length < g.min) {
      if (msgEl) { msgEl.style.color = '#c0392b'; msgEl.textContent = `Please upload at least ${g.min} photos for ${g.label}.`; }
      return;
    }
  }

  const submitBtn = document.getElementById('dutiesSubmitBtn');
  if (submitBtn) submitBtn.disabled = true;
  if (msgEl) { msgEl.style.color = '#333'; msgEl.textContent = 'Submitting…'; }

  try {
    const storage = getStorage(getApp());

    async function uploadGroup(groupId, category) {
      const files = collectPhotosFromGroup(groupId);
      const urls = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const storageRef = ref(storage, `dutyPhotos/${pool}/${category}/${Date.now()}_${i}_${file.name}`);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        urls.push({ index: i, url, name: file.name });
      }
      return urls;
    }

    const [deckPhotos, poolPhotos, skimmersPhotos, damagedPhotos, bleachPhotos] = await Promise.all([
      uploadGroup('deckUpload', 'deck'),
      uploadGroup('poolUpload', 'pool'),
      uploadGroup('skimmersUpload', 'skimmers'),
      uploadGroup('damagedUpload', 'damaged'),
      uploadGroup('bleachUpload', 'bleach'),
    ]);

    // Collect CYA readings
    const cyaReadings = {};
    document.querySelectorAll('.cya-input').forEach(input => {
      if (input.value !== '') {
        cyaReadings[input.dataset.poolId] = parseFloat(input.value);
      }
    });

    await addDoc(collection(db, 'dutySubmissions'), {
      pool,
      submitterEmail: submitterEmail || 'unknown',
      photos: {
        deck: deckPhotos,
        pool: poolPhotos,
        skimmers: skimmersPhotos,
        damaged: damagedPhotos,
        bleach: bleachPhotos,
      },
      damagedNotes: document.getElementById('damagedNotes')?.value?.trim() || '',
      otherNotes: document.getElementById('dutiesOtherNotes')?.value?.trim() || '',
      bleachVolume: document.getElementById('bleachVolume')?.value || null,
      muriaticAcid: document.getElementById('muriaticAcid')?.value || null,
      shockGranular: document.getElementById('shockGranular')?.value || null,
      cyaReadings,
      timestamp: serverTimestamp(),
    });

    if (msgEl) { msgEl.style.color = '#1a8a1a'; msgEl.textContent = 'Form submitted successfully!'; }
    resetForm();
  } catch (err) {
    console.error('[Duties] Submit error:', err);
    if (msgEl) { msgEl.style.color = '#c0392b'; msgEl.textContent = 'Error submitting form. Please try again.'; }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
};

function resetForm() {
  document.getElementById('dutiesPool').value = '';
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
  ['deckUpload', 'poolUpload', 'skimmersUpload', 'damagedUpload', 'bleachUpload'].forEach(groupId => {
    const group = document.getElementById(groupId);
    if (!group) return;
    group.innerHTML = '';
    slotCounters[groupId] = 0;
    const min = parseInt(group.dataset.min || '0', 10);
    const initialSlots = Math.max(min, 1);
    for (let i = 0; i < initialSlots; i++) addPhotoSlotToGroup(group);
    updateAddBtn(groupId);
  });
}
