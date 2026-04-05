// duties.js — Job Form Submission
import { db, collection, addDoc, serverTimestamp } from '../firebase.js';
import { getApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js';

// Populate pool dropdown via script.js's poolsCache (exposed via DOMContentLoaded)
document.addEventListener('DOMContentLoaded', () => {
  // script.js loads pools and populates selects globally; we hook into that
  // by checking after a short delay or observing window.poolsCache
  setTimeout(populatePools, 800);
});

function populatePools() {
  const sel = document.getElementById('dutiesPool');
  if (!sel) return;
  // script.js may expose poolsCache on window after module load
  const pools = window._poolsForDuties || [];
  if (!pools.length) {
    // Try again if not yet ready
    setTimeout(populatePools, 600);
    return;
  }
  pools.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.name || p.id;
    opt.textContent = p.name || p.id;
    sel.appendChild(opt);
  });
}

// Attach photo preview handlers
[1, 2, 3].forEach(n => {
  document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById(`photoInput${n}`);
    if (!input) return;
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const preview = document.getElementById(`preview${n}`);
        const placeholder = document.getElementById(`placeholder${n}`);
        const clearBtn = document.getElementById(`clearBtn${n}`);
        if (preview) { preview.src = ev.target.result; preview.style.display = 'block'; }
        if (placeholder) placeholder.style.display = 'none';
        if (clearBtn) clearBtn.style.display = 'inline-block';
      };
      reader.readAsDataURL(file);
    });
  });
});

window.clearPhoto = function(n) {
  const input = document.getElementById(`photoInput${n}`);
  const preview = document.getElementById(`preview${n}`);
  const placeholder = document.getElementById(`placeholder${n}`);
  const clearBtn = document.getElementById(`clearBtn${n}`);
  if (input) input.value = '';
  if (preview) { preview.src = ''; preview.style.display = 'none'; }
  if (placeholder) { placeholder.style.display = 'flex'; }
  if (clearBtn) clearBtn.style.display = 'none';
};

window.submitDutiesForm = async function() {
  const pool = document.getElementById('dutiesPool')?.value;
  const guardId = document.getElementById('dutiesGuardId')?.value?.trim();
  const notes = document.getElementById('dutiesNotes')?.value?.trim();
  const msgEl = document.getElementById('dutiesMessage');

  if (!pool) { if (msgEl) msgEl.textContent = 'Please select a pool.'; return; }
  if (!guardId) { if (msgEl) msgEl.textContent = 'Please enter your Employee ID.'; return; }

  const photoFiles = [1, 2, 3].map(n => document.getElementById(`photoInput${n}`)?.files[0]).filter(Boolean);
  if (!photoFiles.length) { if (msgEl) msgEl.textContent = 'Please upload at least one photo.'; return; }

  const submitBtn = document.getElementById('dutiesSubmitBtn');
  if (submitBtn) submitBtn.disabled = true;
  if (msgEl) msgEl.textContent = 'Submitting…';

  try {
    const storage = getStorage(getApp());
    const photoURLs = [];

    for (let i = 0; i < [1, 2, 3].length; i++) {
      const n = i + 1;
      const file = document.getElementById(`photoInput${n}`)?.files[0];
      if (!file) continue;
      const storageRef = ref(storage, `dutyPhotos/${pool}/${Date.now()}_${n}_${file.name}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      photoURLs.push({ slot: n, url, name: file.name });
    }

    await addDoc(collection(db, 'dutySubmissions'), {
      pool,
      guardId,
      notes: notes || '',
      photos: photoURLs,
      timestamp: serverTimestamp(),
    });

    if (msgEl) { msgEl.style.color = '#1a8a1a'; msgEl.textContent = 'Form submitted successfully!'; }
    [1, 2, 3].forEach(n => window.clearPhoto(n));
    if (document.getElementById('dutiesNotes')) document.getElementById('dutiesNotes').value = '';
    if (document.getElementById('dutiesGuardId')) document.getElementById('dutiesGuardId').value = '';
    if (document.getElementById('dutiesPool')) document.getElementById('dutiesPool').value = '';
  } catch (err) {
    console.error('[Duties] Submit error:', err);
    if (msgEl) { msgEl.style.color = '#c0392b'; msgEl.textContent = 'Error submitting form. Please try again.'; }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
};
