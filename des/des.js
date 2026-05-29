import {
  db,
  collection,
  doc,
  setDoc,
  serverTimestamp,
  writeBatch,
} from '../firebase.js';

const DES_PHOTO_STORAGE = 'firestoreDesPreInspectionPhoto';
const DES_PHOTO_CHUNK_SIZE = 350000;
const DES_IMAGE_MAX_SIDE = 1280;
const DES_IMAGE_QUALITY = 0.72;
const DES_IMAGE_COMPRESS_THRESHOLD_BYTES = 1.5 * 1024 * 1024;

const DES_ITEMS = [
  { id: 'first_aid_kit', label: 'First aid kit: Is the first aid kit adequately stocked?' },
  { id: 'life_ring', label: 'Life ring and life ring rope: Is the white rope attached to the ring buoy?' },
  { id: 'depth_markers', label: 'Depth marker tiles: There are no missing or broken depth marker tiles.' },
  { id: 'ladders_handrails', label: 'Ladders/handrails: All ladders are stable with no missing steps or loose step bolts.' },
  { id: 'pool_clean', label: 'Pool clean/algae: Is the pool generally clean? There must be ZERO algae.' },
  { id: 'deck_hazards', label: 'Deck clear of hazards: There are no games near the pool, trip hazards, loose equipment, or other deck hazards.' },
  { id: 'skimmers', label: 'Skimmers: Skimmer baskets are clean, and pipe entries are not obstructed except by chlorine tablets.' },
  { id: 'diving_board', label: 'Diving board: Board bolts are stable, board surface is not slippery, and steps are present and not rusted or broken.' },
  { id: 'bathrooms', label: 'Bathrooms: Bathrooms are generally clean, toilets and sinks function, and all fixtures work.' },
  { id: 'water_fountain', label: 'Water fountain/hose: The fountain is functioning properly, and water is not empty or cloudy.' },
  { id: 'perimeter_fence', label: 'Perimeter fencing/gate: Fencing is in good shape, and gates self-close and self-latch.' },
  { id: 'paperwork', label: 'Previous year paperwork: Check current year paperwork and the most recent DHEC sign listed.' },
  { id: 'chemistry', label: 'Chlorine and pH: Testing is accurate, pH and chlorine are within required ranges, and readings are recorded.' },
  { id: 'main_drain', label: 'Main drain: Main drain grates are attached and visible from the pool deck.' },
  { id: 'shepherds_crook', label: 'Shepherds crook: It is present and in good condition, and pole hardware is present.' },
  { id: 'auto_controller', label: 'Automatic controller: If the pool has an automatic controller, it is functioning properly and calibrated.' },
  { id: 'lifeguards', label: 'Lifeguards: Lifeguards are present in sufficient amount and actively scanning the pool.' },
  { id: 'rescue_tubes', label: 'Rescue tubes: Tubes are in good condition, and straps are connected.' },
  { id: 'backboard', label: 'Backboard: The backboard is present, accessible, and has a head pad plus required straps.' },
  { id: 'telephone', label: 'Telephone: The pool phone is present and capable of dialing emergency and posted contacts.' },
  { id: 'signage', label: 'Signage: Pool rules, no-diving signs, pool open/closed sign, and other required signs are posted and visible.' },
  { id: 'bound_log_book', label: 'Bound log book: The DHEC log book is present, open for use, and required readings are listed.' },
  { id: 'disinfection_equipment', label: 'Disinfection equipment: Feeders are working properly, and pools have sufficient chlorine equipment.' },
  { id: 'recirculation', label: 'Recirculation system: The pump is operating properly, skimmers are pulling water, and baskets are clean.' },
  { id: 'other_issues', label: 'List any other issues you notice.', type: 'notes' },
];

const selectedPhotos = new Map();

function setMessage(text, isError = false) {
  const msg = document.getElementById('desFormMessage');
  if (!msg) return;
  msg.textContent = text || '';
  msg.classList.toggle('error', !!text && isError);
  msg.classList.toggle('success', !!text && !isError);
}

function renderInspectionItems() {
  const container = document.getElementById('desInspectionItems');
  if (!container) return;
  container.innerHTML = '';

  DES_ITEMS.forEach((item, index) => {
    const row = document.createElement('section');
    row.className = 'des-item';
    row.dataset.itemId = item.id;
    const answerHtml = item.type === 'notes'
      ? ''
      : `<div class="des-answer-group" role="radiogroup" aria-label="${item.label}">
          <label><input type="radio" name="${item.id}_answer" value="Yes" required> Yes</label>
          <label><input type="radio" name="${item.id}_answer" value="No" required> No</label>
        </div>`;
    row.innerHTML = `
      <div class="des-item-header">
        <div class="des-item-title">${index + 1}. ${item.label}</div>
        ${answerHtml}
      </div>
      <div class="des-item-body">
        <label for="${item.id}_notes">${item.type === 'notes' ? 'Notes' : 'Explain if you select no.'}</label>
        <textarea id="${item.id}_notes" placeholder="Notes"></textarea>
        <label class="des-photo-picker">
          <span>Take a photo if helpful</span>
          <input type="file" accept="image/*" multiple data-photo-input="${item.id}">
        </label>
        <div class="des-photo-preview-grid" data-photo-preview="${item.id}"></div>
      </div>
    `;
    container.appendChild(row);
  });
}

function renderPhotoPreview(itemId) {
  const preview = document.querySelector(`[data-photo-preview="${itemId}"]`);
  if (!preview) return;
  preview.innerHTML = '';
  const files = selectedPhotos.get(itemId) || [];
  files.forEach((file, index) => {
    const thumb = document.createElement('div');
    thumb.className = 'des-photo-thumb';
    const img = document.createElement('img');
    img.alt = file.name || `Photo ${index + 1}`;
    img.src = URL.createObjectURL(file);
    img.onload = () => URL.revokeObjectURL(img.src);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      const nextFiles = (selectedPhotos.get(itemId) || []).filter((_, i) => i !== index);
      selectedPhotos.set(itemId, nextFiles);
      renderPhotoPreview(itemId);
    });
    thumb.appendChild(img);
    thumb.appendChild(remove);
    preview.appendChild(thumb);
  });
}

function bindPhotoInputs() {
  document.addEventListener('change', (event) => {
    const input = event.target.closest('[data-photo-input]');
    if (!input) return;
    const itemId = input.dataset.photoInput;
    const existing = selectedPhotos.get(itemId) || [];
    const incoming = Array.from(input.files || []);
    selectedPhotos.set(itemId, existing.concat(incoming));
    input.value = '';
    renderPhotoPreview(itemId);
  });
}

function bindTextareaAutoResize() {
  document.addEventListener('input', (event) => {
    const textarea = event.target.closest('.des-item-body textarea');
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(72, textarea.scrollHeight)}px`;
  });
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
      img.onerror = () => reject(new Error('Unable to prepare photo.'));
      img.src = objectUrl;
    });
    const width = image.naturalWidth || image.width || 1;
    const height = image.naturalHeight || image.height || 1;
    const largestSide = Math.max(width, height);
    if (file.size <= DES_IMAGE_COMPRESS_THRESHOLD_BYTES && largestSide <= DES_IMAGE_MAX_SIDE) {
      return { body: file, contentType: file.type || 'image/jpeg' };
    }

    const scale = Math.min(1, DES_IMAGE_MAX_SIDE / largestSide);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is unavailable.');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, 'image/jpeg', DES_IMAGE_QUALITY);
    return { body: blob, contentType: 'image/jpeg' };
  } catch (err) {
    console.warn('[DES] Photo compression failed; using original file.', err);
    return { body: file, contentType: file.type || 'application/octet-stream' };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function uploadDesPhoto({ submissionId, itemId, file }) {
  const safeName = String(file.name || 'des-photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
  const uploadPayload = await preparePhotoForUpload(file);
  const photoId = `${Date.now()}_${itemId}_${Math.random().toString(36).slice(2)}_${safeName}`;
  const photoDoc = doc(db, 'desPreInspectionMedia', submissionId, 'photos', photoId);
  const dataUrl = await readFileAsDataURL(uploadPayload.body);
  const [prefix, encoded = ''] = String(dataUrl || '').split(',');
  if (!encoded) throw new Error(`Unable to encode ${file.name || 'photo'} for upload.`);

  const chunks = [];
  for (let i = 0; i < encoded.length; i += DES_PHOTO_CHUNK_SIZE) {
    chunks.push(encoded.slice(i, i + DES_PHOTO_CHUNK_SIZE));
  }

  await setDoc(photoDoc, {
    submissionId,
    itemId,
    fileName: file.name || safeName,
    contentType: uploadPayload.contentType,
    dataUrlPrefix: prefix,
    chunkCount: chunks.length,
    storedAt: serverTimestamp(),
  });

  for (let i = 0; i < chunks.length; i += 400) {
    const batch = writeBatch(db);
    chunks.slice(i, i + 400).forEach((chunk, offset) => {
      const chunkIndex = i + offset;
      batch.set(doc(db, 'desPreInspectionMedia', submissionId, 'photos', photoId, 'chunks', String(chunkIndex).padStart(4, '0')), {
        index: chunkIndex,
        data: chunk,
      });
    });
    await batch.commit();
  }

  return {
    source: DES_PHOTO_STORAGE,
    url: `${DES_PHOTO_STORAGE}:${submissionId}:${photoId}`,
    submissionId,
    photoId,
    itemId,
    name: file.name || safeName,
    contentType: uploadPayload.contentType,
    dataUrlPrefix: prefix,
    chunkCount: chunks.length,
  };
}

function collectFormItems() {
  return DES_ITEMS.map((item) => {
    const answer = document.querySelector(`input[name="${item.id}_answer"]:checked`)?.value || '';
    const notes = document.getElementById(`${item.id}_notes`)?.value.trim() || '';
    return {
      id: item.id,
      label: item.label,
      answer: item.type === 'notes' ? 'Notes' : answer,
      type: item.type || 'inspection',
      notes,
      files: selectedPhotos.get(item.id) || [],
    };
  });
}

async function handleSubmit(event) {
  event.preventDefault();
  const submitBtn = document.getElementById('desSubmitBtn');
  const respondentName = document.getElementById('desRespondentName')?.value.trim() || '';
  const pool = document.getElementById('desPoolSelect')?.value || '';
  const items = collectFormItems();

  if (!respondentName || !pool) {
    alert('Please enter your name and select a pool.');
    return;
  }

  const missingAnswer = items.find((item) => item.type !== 'notes' && !item.answer);
  if (missingAnswer) {
    alert(`Please answer this item: ${missingAnswer.label}`);
    return;
  }

  const missingExplanation = items.find((item) => item.answer === 'No' && !item.notes && !item.files.length);
  if (missingExplanation) {
    alert(`Please add notes or a photo for this item: ${missingExplanation.label}`);
    return;
  }

  const submissionRef = doc(collection(db, 'desPreInspections'));
  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    setMessage('');

    const totalPhotos = items.reduce((sum, item) => sum + item.files.length, 0);
    let uploadedPhotos = 0;
    const inspectionItems = [];
    for (const item of items) {
      const photos = [];
      for (const file of item.files) {
        submitBtn.textContent = totalPhotos
          ? `Uploading photo ${uploadedPhotos + 1}/${totalPhotos}`
          : 'Submitting...';
        photos.push(await uploadDesPhoto({ submissionId: submissionRef.id, itemId: item.id, file }));
        uploadedPhotos += 1;
      }
      inspectionItems.push({
        id: item.id,
        label: item.label,
        type: item.type,
        answer: item.answer,
        notes: item.notes,
        photos,
      });
    }

    await setDoc(submissionRef, {
      timestamp: serverTimestamp(),
      pool,
      respondentName,
      submitterName: respondentName,
      reportType: 'desPreInspection',
      inspectionItems,
      version: 1,
    });

    event.target.reset();
    selectedPhotos.clear();
    DES_ITEMS.forEach((item) => renderPhotoPreview(item.id));
    setMessage('DES Pre-Inspection submitted.', false);
  } catch (err) {
    console.error('[DES] Unable to submit pre-inspection:', err);
    alert('Unable to submit DES Pre-Inspection. Please try again.');
    setMessage('Submission failed.', true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderInspectionItems();
  bindPhotoInputs();
  bindTextareaAutoResize();
  document.getElementById('desInspectionForm')?.addEventListener('submit', handleSubmit);
});
