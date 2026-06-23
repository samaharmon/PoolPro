import {
  db,
  auth,
  collection,
  doc,
  setDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  limit,
  serverTimestamp,
  deleteDoc,
  listenPools,
} from '../firebase.js';

const TASKS_COLLECTION = 'facilityTasks';
const TASK_MEDIA_COLLECTION = 'taskProofMedia';
const SELECTED_POOL_KEY_BASE = 'poolproTodoSelectedPool';
const ACCESS_MODE_STORAGE_KEY = 'poolproAccessMode';
const LIFEGUARD_SESSION_KEY = 'poolproLifeguardSession';
const PROOF_CHUNK_SIZE = 350000;
const URGENCY_RANK = { high: 0, medium: 1, low: 2 };

const FORM_PROOF_CONFIG = {
  poolChemistry: {
    label: 'Pool Chemistry Log',
    collection: 'poolSubmissions',
    facilityFields: ['poolLocation', 'facilityName', 'pool', 'poolName'],
    timeFields: ['timestamp', 'submittedAtIso', 'createdAt'],
  },
  inventory: {
    label: 'Inventory Form',
    collection: 'inventorySubmissions',
    facilityFields: ['facilityName', 'pool', 'poolLocation', 'poolName'],
    timeFields: ['timestamp', 'submittedAtIso', 'createdAt'],
    predicate: (data) => String(data.formType || '').toLowerCase() !== 'chemical',
  },
  chemicalInventory: {
    label: 'Chemical Inventory Form',
    collection: 'managerialReports',
    facilityFields: ['pool', 'facilityName', 'poolLocation', 'poolName'],
    timeFields: ['timestamp', 'submittedAtIso', 'createdAt'],
    predicate: (data) => {
      const type = String(data.formType || data.reportType || data.type || '').toLowerCase();
      return type === 'chemicalinventory' || type.includes('chemical inventory');
    },
  },
  cleanlinessOpening: {
    label: 'Opening Cleanliness Report',
    collection: 'dutySubmissions',
    facilityFields: ['pool', 'facilityName', 'poolLocation', 'poolName'],
    timeFields: ['timestamp', 'submittedAtIso', 'createdAt'],
    predicate: (data) => String(data.shift || data.reportShift || '').toLowerCase().includes('opening'),
  },
  cleanlinessClosing: {
    label: 'Closing Cleanliness Report',
    collection: 'dutySubmissions',
    facilityFields: ['pool', 'facilityName', 'poolLocation', 'poolName'],
    timeFields: ['timestamp', 'submittedAtIso', 'createdAt'],
    predicate: (data) => String(data.shift || data.reportShift || '').toLowerCase().includes('closing'),
  },
  desLogbooks: {
    label: 'DES Logbook Form',
    collection: 'desLogbookSubmissions',
    facilityFields: ['pool', 'facilityName', 'poolLocation', 'poolName'],
    timeFields: ['timestamp', 'submittedAtIso', 'createdAt'],
  },
  desPreInspection: {
    label: 'DES Pre-Inspection',
    collection: 'desPreInspections',
    facilityFields: ['pool', 'facilityName', 'poolLocation', 'poolName'],
    timeFields: ['timestamp', 'submittedAtIso', 'createdAt'],
  },
  operationalStatus: {
    label: 'Operational Status Log',
    collection: 'operationalStatusLogs',
    facilityFields: ['facilityName', 'poolLocation', 'pool', 'poolName'],
    timeFields: ['timestamp', 'updatedAt', 'createdAt'],
  },
};

const state = {
  pools: [],
  selectedPool: '',
  tasks: [],
  unsubscribeTasks: null,
  pendingProofTask: null,
  formCompletionCache: new Map(),
  autoCompleting: new Set(),
};

const els = {};

document.addEventListener('DOMContentLoaded', () => {
  cacheElements();
  bindEvents();
  loadPools();
  subscribeTasks();
});

function cacheElements() {
  els.poolSelect = document.getElementById('todoPoolSelect');
  els.taskCount = document.getElementById('todoTaskCount');
  els.list = document.getElementById('todoList');
  els.form = document.getElementById('todoTaskForm');
  els.editingTaskId = document.getElementById('todoEditingTaskId');
  els.title = document.getElementById('todoTaskTitle');
  els.urgency = document.getElementById('todoTaskUrgency');
  els.due = document.getElementById('todoTaskDue');
  els.expires = document.getElementById('todoTaskExpires');
  els.description = document.getElementById('todoTaskDescription');
  els.repeatMode = document.getElementById('todoTaskRepeatMode');
  els.repeatCount = document.getElementById('todoTaskRepeatCount');
  els.customDates = document.getElementById('todoTaskCustomDates');
  els.proofType = document.getElementById('todoTaskProofType');
  els.proofForm = document.getElementById('todoTaskProofForm');
  els.saveBtn = document.getElementById('todoSaveTaskBtn');
  els.clearBtn = document.getElementById('todoClearTaskBtn');
  els.formMessage = document.getElementById('todoFormMessage');
  els.favoritesTable = document.getElementById('todoFavoritesTable');
  els.historyTable = document.getElementById('todoHistoryTable');
  els.proofModal = document.getElementById('todoProofModal');
  els.proofClose = document.getElementById('todoProofClose');
  els.proofTitle = document.getElementById('todoProofTitle');
  els.proofSummary = document.getElementById('todoProofSummary');
  els.proofExplanation = document.getElementById('todoProofExplanation');
  els.proofImages = document.getElementById('todoProofImages');
  els.proofSubmit = document.getElementById('todoProofSubmit');
  els.proofMessage = document.getElementById('todoProofMessage');
}

function bindEvents() {
  els.poolSelect?.addEventListener('change', () => {
    state.selectedPool = els.poolSelect.value || '';
    rememberSelectedPool(state.selectedPool);
    render();
    runAutoCompletionChecks();
  });

  els.form?.addEventListener('submit', handleTaskFormSubmit);
  els.clearBtn?.addEventListener('click', clearTaskForm);
  els.proofClose?.addEventListener('click', closeProofModal);
  els.proofModal?.addEventListener('click', (event) => {
    if (event.target === els.proofModal) closeProofModal();
  });
  els.proofSubmit?.addEventListener('click', submitProofAndCompleteTask);
}

function loadPools() {
  listenPools((pools) => {
    state.pools = Array.isArray(pools) ? pools : [];
    populatePoolSelect();
    render();
    runAutoCompletionChecks();
  });
}

function subscribeTasks() {
  const taskQuery = query(collection(db, TASKS_COLLECTION), orderBy('createdAt', 'desc'), limit(800));
  state.unsubscribeTasks = onSnapshot(
    taskQuery,
    (snap) => {
      state.tasks = snap.docs.map((docSnap) => normalizeTask({ id: docSnap.id, ...docSnap.data() }));
      render();
      runAutoCompletionChecks();
    },
    (error) => {
      console.error('[PoolPro] Error loading facility tasks:', error);
      if (els.list) {
        els.list.innerHTML = '<p class="todo-empty todo-error">Unable to load tasks. Check Firestore rules and console errors.</p>';
      }
    }
  );
}

function populatePoolSelect() {
  if (!els.poolSelect) return;
  const current = state.selectedPool || getRememberedSelectedPool();
  const homePool = getCurrentUserInfo().homePool;
  const poolNames = state.pools.map(getPoolName).filter(Boolean);
  const preferred = [current, homePool].find((name) => poolNames.includes(name)) || poolNames[0] || '';

  els.poolSelect.innerHTML = '';
  if (!poolNames.length) {
    els.poolSelect.innerHTML = '<option value="">No pools found</option>';
    state.selectedPool = '';
    return;
  }

  groupPoolsByMarket(state.pools).forEach(({ market, pools }) => {
    const group = document.createElement('optgroup');
    group.label = market;
    pools.forEach((pool) => {
      const name = getPoolName(pool);
      if (!name) return;
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      group.appendChild(option);
    });
    els.poolSelect.appendChild(group);
  });

  els.poolSelect.value = preferred;
  state.selectedPool = els.poolSelect.value || '';
  if (state.selectedPool) rememberSelectedPool(state.selectedPool);
}

function render() {
  renderTaskList();
  renderTaskTables();
  updateFormPermissions();
}

function renderTaskList() {
  if (!els.list) return;
  const tasks = getVisibleTasksForSelectedPool();
  if (els.taskCount) {
    const activeCount = tasks.filter((task) => !task.completed).length;
    els.taskCount.textContent = `${activeCount} active • ${tasks.length} shown`;
  }
  if (!state.selectedPool) {
    els.list.innerHTML = '<p class="todo-empty">Select a pool to view tasks.</p>';
    return;
  }
  if (!tasks.length) {
    els.list.innerHTML = '<p class="todo-empty">No active tasks for this pool.</p>';
    return;
  }

  els.list.innerHTML = '';
  tasks.forEach((task) => {
    const card = document.createElement('article');
    card.className = `todo-card${task.completed ? ' is-complete' : ''}`;
    const proofLabel = getProofLabel(task);
    const due = toDate(task.requiredCompletionAtIso);
    const isFormProof = task.proofType === 'form';
    const canEdit = canManageTasks();
    card.innerHTML = `
      <div class="todo-card-header">
        <div>
          <h3 class="todo-card-title">${escapeHtml(task.title || 'Untitled Task')}</h3>
          <div class="todo-card-meta">
            <span class="todo-chip urgency-${escapeHtml(task.urgency)}">${escapeHtml(task.urgency || 'medium')}</span>
            <span class="todo-chip">${escapeHtml(formatDueDate(due))}</span>
            <span class="todo-chip">${escapeHtml(getTimeRemainingLabel(due, task.completed))}</span>
            <span class="todo-chip">${escapeHtml(proofLabel)}</span>
          </div>
        </div>
        <div class="todo-card-actions">
          <label class="todo-status-toggle${task.completed ? ' is-complete' : ''}${isFormProof && !task.completed ? ' is-disabled' : ''}" title="${isFormProof && !task.completed ? 'This task completes automatically after the required form is submitted.' : ''}">
            <input type="checkbox" data-todo-complete="${escapeHtml(task.id)}" ${task.completed ? 'checked' : ''} ${isFormProof && !task.completed ? 'disabled' : ''}>
            <span>Incomplete</span>
            <span>Complete</span>
          </label>
          <button type="button" class="todo-action-btn" data-todo-edit="${escapeHtml(task.id)}" ${canEdit ? '' : 'disabled'}>Edit</button>
          <button type="button" class="todo-action-btn" data-todo-delete="${escapeHtml(task.id)}" ${canEdit ? '' : 'disabled'}>Delete</button>
        </div>
      </div>
      ${task.description ? `<p class="todo-card-desc">${escapeHtml(task.description)}</p>` : ''}
    `;
    els.list.appendChild(card);
  });

  els.list.querySelectorAll('[data-todo-complete]').forEach((input) => {
    input.addEventListener('change', () => handleCompletionToggle(input.dataset.todoComplete, input.checked));
  });
  els.list.querySelectorAll('[data-todo-edit]').forEach((button) => {
    button.addEventListener('click', () => editTask(button.dataset.todoEdit));
  });
  els.list.querySelectorAll('[data-todo-delete]').forEach((button) => {
    button.addEventListener('click', () => deleteTask(button.dataset.todoDelete));
  });
}

function renderTaskTables() {
  renderTaskTable(els.favoritesTable, getTasksForSelectedPool().filter((task) => task.favorite), true);
  renderTaskTable(els.historyTable, getTasksForSelectedPool(), false);
}

function renderTaskTable(host, tasks, favoritesOnly) {
  if (!host) return;
  if (!state.selectedPool) {
    host.innerHTML = '<p class="todo-table-empty">Select a pool.</p>';
    return;
  }
  if (!tasks.length) {
    host.innerHTML = `<p class="todo-table-empty">${favoritesOnly ? 'No favorite tasks yet.' : 'No task history yet.'}</p>`;
    return;
  }
  const sorted = [...tasks].sort((a, b) => {
    const favoriteDiff = Number(!!b.favorite) - Number(!!a.favorite);
    if (favoritesOnly && favoriteDiff) return favoriteDiff;
    return (toDate(b.createdAtIso)?.getTime() || 0) - (toDate(a.createdAtIso)?.getTime() || 0);
  });
  host.innerHTML = `
    <table class="todo-table">
      <thead>
        <tr>
          <th>Favorite</th>
          <th>Title</th>
          <th>Urgency</th>
          <th>Due</th>
          <th>Status</th>
          <th>Proof</th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map((task) => `
          <tr>
            <td>
              <button type="button" class="todo-heart-btn${task.favorite ? ' is-favorite' : ''}" data-todo-favorite="${escapeHtml(task.id)}" ${canManageTasks() ? '' : 'disabled'} aria-label="Favorite task">${task.favorite ? '♥' : '♡'}</button>
            </td>
            <td>${escapeHtml(task.title || 'Untitled Task')}</td>
            <td>${escapeHtml(task.urgency || 'medium')}</td>
            <td>${escapeHtml(formatDueDate(toDate(task.requiredCompletionAtIso)))}</td>
            <td>${task.completed ? 'Complete' : 'Incomplete'}</td>
            <td>${escapeHtml(getProofLabel(task))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  host.querySelectorAll('[data-todo-favorite]').forEach((button) => {
    button.addEventListener('click', () => toggleFavorite(button.dataset.todoFavorite));
  });
  wrapTodoTables(host);
}

function updateFormPermissions() {
  const canManage = canManageTasks();
  document.querySelectorAll('[data-todo-edit], [data-todo-delete], [data-todo-favorite]').forEach((button) => {
    button.disabled = !canManage;
  });
}

async function handleTaskFormSubmit(event) {
  event.preventDefault();
  setFormMessage('');
  if (!state.selectedPool) {
    setFormMessage('Select a pool before saving a task.', true);
    return;
  }
  const title = els.title.value.trim();
  const dueDate = parseDateTimeLocal(els.due.value);
  const proofType = els.proofType.value || 'none';
  const proofForm = els.proofForm.value || '';
  if (!title || !dueDate) {
    setFormMessage('Title and required completion time are required.', true);
    return;
  }
  if (proofType === 'form' && !proofForm) {
    setFormMessage('Select the required form for form-submission proof.', true);
    return;
  }

  const editingId = els.editingTaskId.value.trim();
  const nowIso = new Date().toISOString();
  const baseTask = {
    facilityName: state.selectedPool,
    facilityKey: normalizeFacilityName(state.selectedPool),
    title,
    description: els.description.value.trim(),
    urgency: els.urgency.value || 'medium',
    requiredCompletionAtIso: dueDate.toISOString(),
    expiresAfterDue: !!els.expires.checked,
    proofType,
    proofForm: proofType === 'form' ? proofForm : '',
    repetition: {
      mode: els.repeatMode.value || 'none',
      count: Math.max(0, Number.parseInt(els.repeatCount.value, 10) || 0),
      customDates: parseCustomRepeatDates(els.customDates.value).map((date) => date.toISOString()),
    },
    updatedAt: serverTimestamp(),
    updatedAtIso: nowIso,
  };

  try {
    els.saveBtn.disabled = true;
    if (editingId) {
      await setDoc(doc(db, TASKS_COLLECTION, editingId), baseTask, { merge: true });
      setFormMessage('Task updated.');
    } else {
      const createdBy = getCurrentUserInfo();
      const taskRef = doc(collection(db, TASKS_COLLECTION));
      const createdTask = {
        ...baseTask,
        id: taskRef.id,
        completed: false,
        favorite: false,
        createdBy,
        createdAt: serverTimestamp(),
        createdAtIso: nowIso,
      };
      await setDoc(taskRef, createdTask, { merge: true });
      await createRepeatedTasks(createdTask, taskRef.id);
      setFormMessage('Task saved.');
    }
    clearTaskForm({ keepMessage: true });
  } catch (error) {
    console.error('[PoolPro] Error saving task:', error);
    setFormMessage('Unable to save the task. Check the console.', true);
  } finally {
    els.saveBtn.disabled = false;
  }
}

async function createRepeatedTasks(baseTask, baseTaskId) {
  const repetition = baseTask.repetition || {};
  const due = toDate(baseTask.requiredCompletionAtIso);
  if (!due) return;

  const repeats = [];
  if (repetition.mode === 'custom') {
    repeats.push(...(repetition.customDates || []).map(toDate).filter(Boolean));
  } else if (['daily', 'weekly', 'monthly'].includes(repetition.mode)) {
    const count = Math.max(0, Number.parseInt(repetition.count, 10) || 0);
    for (let i = 1; i <= count; i++) {
      repeats.push(addRepeatInterval(due, repetition.mode, i));
    }
  }

  await Promise.all(repeats.map(async (repeatDate) => {
    const repeatRef = doc(collection(db, TASKS_COLLECTION));
    await setDoc(repeatRef, {
      ...baseTask,
      id: repeatRef.id,
      baseTaskId,
      requiredCompletionAtIso: repeatDate.toISOString(),
      completed: false,
      favorite: false,
      createdAt: serverTimestamp(),
      createdAtIso: new Date().toISOString(),
      updatedAt: serverTimestamp(),
      updatedAtIso: new Date().toISOString(),
    }, { merge: true });
  }));
}

async function handleCompletionToggle(taskId, complete) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  if (task.proofType === 'form' && complete) {
    render();
    return;
  }
  if (complete && ['images', 'explanation'].includes(task.proofType)) {
    openProofModal(task);
    render();
    return;
  }
  await updateTaskCompletion(task, complete);
}

async function updateTaskCompletion(task, complete, extra = {}) {
  const user = getCurrentUserInfo();
  await setDoc(doc(db, TASKS_COLLECTION, task.id), {
    completed: !!complete,
    completedAtIso: complete ? new Date().toISOString() : '',
    completedBy: complete ? user : null,
    updatedAt: serverTimestamp(),
    updatedAtIso: new Date().toISOString(),
    ...extra,
  }, { merge: true });
}

function openProofModal(task) {
  state.pendingProofTask = task;
  if (!els.proofModal) return;
  els.proofTitle.textContent = `Complete ${task.title || 'Task'}`;
  els.proofSummary.textContent = task.proofType === 'images'
    ? 'Upload at least one image to complete this task.'
    : 'Enter an explanation to complete this task.';
  els.proofExplanation.value = '';
  els.proofImages.value = '';
  els.proofMessage.textContent = '';
  document.querySelector('.todo-proof-images').style.display = task.proofType === 'images' ? '' : 'none';
  document.querySelector('.todo-proof-explanation').style.display = task.proofType === 'explanation' ? '' : 'none';
  els.proofModal.classList.remove('hidden');
  requestAnimationFrame(() => els.proofModal.classList.add('visible'));
}

function closeProofModal() {
  if (!els.proofModal) return;
  els.proofModal.classList.remove('visible');
  setTimeout(() => {
    if (!els.proofModal.classList.contains('visible')) els.proofModal.classList.add('hidden');
  }, 190);
  state.pendingProofTask = null;
}

async function submitProofAndCompleteTask() {
  const task = state.pendingProofTask;
  if (!task) return;
  const explanation = els.proofExplanation.value.trim();
  const files = Array.from(els.proofImages.files || []);
  if (task.proofType === 'explanation' && !explanation) {
    setProofMessage('Enter an explanation before completing this task.', true);
    return;
  }
  if (task.proofType === 'images' && !files.length) {
    setProofMessage('Upload at least one image before completing this task.', true);
    return;
  }

  try {
    els.proofSubmit.disabled = true;
    setProofMessage('Saving proof...');
    const photoRefs = task.proofType === 'images' ? await uploadProofImages(task.id, files) : [];
    await updateTaskCompletion(task, true, {
      proof: {
        type: task.proofType,
        explanation,
        photoRefs,
        submittedAtIso: new Date().toISOString(),
        submittedBy: getCurrentUserInfo(),
      },
    });
    setProofMessage('Task completed.');
    setTimeout(closeProofModal, 350);
  } catch (error) {
    console.error('[PoolPro] Error saving task proof:', error);
    setProofMessage('Unable to save proof. Check the console.', true);
  } finally {
    els.proofSubmit.disabled = false;
  }
}

async function uploadProofImages(taskId, files) {
  const refs = [];
  for (const file of files) {
    const dataUrl = await readFileAsDataUrl(file);
    const [prefix, base64 = ''] = dataUrl.split(',');
    const photoRef = doc(collection(db, TASK_MEDIA_COLLECTION, taskId, 'photos'));
    const chunkCount = Math.ceil(base64.length / PROOF_CHUNK_SIZE);
    await setDoc(photoRef, {
      fileName: file.name || 'proof-image',
      contentType: file.type || 'image/jpeg',
      size: file.size || 0,
      dataUrlPrefix: prefix,
      chunkCount,
      uploadedAt: serverTimestamp(),
      uploadedAtIso: new Date().toISOString(),
    }, { merge: true });
    const chunks = [];
    for (let i = 0; i < chunkCount; i++) {
      const chunk = base64.slice(i * PROOF_CHUNK_SIZE, (i + 1) * PROOF_CHUNK_SIZE);
      chunks.push(setDoc(doc(db, TASK_MEDIA_COLLECTION, taskId, 'photos', photoRef.id, 'chunks', String(i).padStart(4, '0')), {
        index: i,
        data: chunk,
      }, { merge: true }));
    }
    await Promise.all(chunks);
    refs.push({
      taskId,
      photoId: photoRef.id,
      fileName: file.name || 'proof-image',
      contentType: file.type || 'image/jpeg',
    });
  }
  return refs;
}

function editTask(taskId) {
  if (!canManageTasks()) return;
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  els.editingTaskId.value = task.id;
  els.title.value = task.title || '';
  els.urgency.value = task.urgency || 'medium';
  els.due.value = toDateTimeLocalInputValue(toDate(task.requiredCompletionAtIso));
  els.expires.checked = !!task.expiresAfterDue;
  els.description.value = task.description || '';
  els.repeatMode.value = task.repetition?.mode || 'none';
  els.repeatCount.value = String(task.repetition?.count || 0);
  els.customDates.value = (task.repetition?.customDates || []).map((value) => toDateTimeLocalInputValue(toDate(value))).filter(Boolean).join('\n');
  els.proofType.value = task.proofType || 'none';
  els.proofForm.value = task.proofForm || '';
  els.saveBtn.textContent = 'Save Changes';
  els.title.focus();
  setFormMessage('Editing task.');
}

async function deleteTask(taskId) {
  if (!canManageTasks()) return;
  const task = state.tasks.find((item) => item.id === taskId);
  const label = task?.title || 'this task';
  if (!window.confirm(`Delete "${label}"?`)) return;
  await deleteDoc(doc(db, TASKS_COLLECTION, taskId));
}

async function toggleFavorite(taskId) {
  if (!canManageTasks()) return;
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  await setDoc(doc(db, TASKS_COLLECTION, taskId), {
    favorite: !task.favorite,
    updatedAt: serverTimestamp(),
    updatedAtIso: new Date().toISOString(),
  }, { merge: true });
}

function clearTaskForm({ keepMessage = false } = {}) {
  els.form?.reset();
  if (els.editingTaskId) els.editingTaskId.value = '';
  if (els.urgency) els.urgency.value = 'medium';
  if (els.repeatMode) els.repeatMode.value = 'none';
  if (els.repeatCount) els.repeatCount.value = '0';
  if (els.proofType) els.proofType.value = 'none';
  if (els.proofForm) els.proofForm.value = '';
  if (els.saveBtn) els.saveBtn.textContent = 'Save Task';
  if (!keepMessage) setFormMessage('');
}

async function runAutoCompletionChecks() {
  const tasks = getTasksForSelectedPool().filter((task) =>
    !task.completed &&
    task.proofType === 'form' &&
    task.proofForm &&
    !state.autoCompleting.has(task.id)
  );
  await Promise.all(tasks.map(async (task) => {
    state.autoCompleting.add(task.id);
    try {
      if (await hasMatchingFormSubmission(task)) {
        await updateTaskCompletion(task, true, {
          completedBy: { name: 'Required form submission', id: 'form-submission:auto' },
          proof: {
            type: 'form',
            form: task.proofForm,
            autoCompletedAtIso: new Date().toISOString(),
          },
        });
      }
    } catch (error) {
      console.warn('[PoolPro] Could not check form completion for task:', task.title, error);
    } finally {
      state.autoCompleting.delete(task.id);
    }
  }));
}

async function hasMatchingFormSubmission(task) {
  const config = FORM_PROOF_CONFIG[task.proofForm];
  if (!config) return false;
  const period = getTaskCompletionPeriod(task);
  if (!period) return false;
  const cacheKey = `${task.proofForm}::${task.facilityKey}::${period.start.toISOString()}::${period.end.toISOString()}`;
  if (state.formCompletionCache.has(cacheKey)) return state.formCompletionCache.get(cacheKey);

  const snap = await getDocs(query(collection(db, config.collection), orderBy(config.timeFields[0], 'desc'), limit(600)));
  const facilityKey = normalizeFacilityName(task.facilityName);
  const matched = snap.docs.some((docSnap) => {
    const data = docSnap.data() || {};
    if (config.predicate && !config.predicate(data)) return false;
    const submissionFacility = getSubmissionFacilityKey(data, config.facilityFields);
    if (submissionFacility !== facilityKey) return false;
    const submittedAt = getFirstDateValue(data, config.timeFields);
    return submittedAt && submittedAt >= period.start && submittedAt <= period.end;
  });
  state.formCompletionCache.set(cacheKey, matched);
  return matched;
}

function getTaskCompletionPeriod(task) {
  const due = toDate(task.requiredCompletionAtIso) || toDate(task.createdAtIso);
  if (!due) return null;
  const start = new Date(due);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setMilliseconds(end.getMilliseconds() - 1);
  return { start, end };
}

function getVisibleTasksForSelectedPool() {
  const now = Date.now();
  return getTasksForSelectedPool()
    .filter((task) => task.completed || !task.expiresAfterDue || !(toDate(task.requiredCompletionAtIso)?.getTime() < now))
    .sort(compareTasks);
}

function getTasksForSelectedPool() {
  const key = normalizeFacilityName(state.selectedPool);
  return state.tasks.filter((task) => task.facilityKey === key);
}

function compareTasks(a, b) {
  if (!!a.completed !== !!b.completed) return a.completed ? 1 : -1;
  const urgencyDiff = (URGENCY_RANK[a.urgency] ?? 1) - (URGENCY_RANK[b.urgency] ?? 1);
  if (!a.completed && urgencyDiff) return urgencyDiff;
  const aDue = toDate(a.requiredCompletionAtIso)?.getTime() || Number.MAX_SAFE_INTEGER;
  const bDue = toDate(b.requiredCompletionAtIso)?.getTime() || Number.MAX_SAFE_INTEGER;
  if (aDue !== bDue) return aDue - bDue;
  return String(a.title || '').localeCompare(String(b.title || ''));
}

function normalizeTask(task) {
  return {
    ...task,
    id: String(task.id || ''),
    facilityName: String(task.facilityName || ''),
    facilityKey: String(task.facilityKey || normalizeFacilityName(task.facilityName)),
    title: String(task.title || ''),
    description: String(task.description || ''),
    urgency: ['high', 'medium', 'low'].includes(task.urgency) ? task.urgency : 'medium',
    completed: !!task.completed,
    favorite: !!task.favorite,
    proofType: ['none', 'images', 'explanation', 'form'].includes(task.proofType) ? task.proofType : 'none',
    proofForm: String(task.proofForm || ''),
    requiredCompletionAtIso: task.requiredCompletionAtIso || '',
    createdAtIso: task.createdAtIso || getIsoFromTimestamp(task.createdAt) || '',
  };
}

function getProofLabel(task) {
  if (task.proofType === 'images') return 'Images required';
  if (task.proofType === 'explanation') return 'Explanation required';
  if (task.proofType === 'form') return FORM_PROOF_CONFIG[task.proofForm]?.label || 'Form submission required';
  return 'No proof required';
}

function getSubmissionFacilityKey(data, fields) {
  for (const field of fields) {
    const value = data?.[field];
    if (value) return normalizeFacilityName(value);
  }
  return '';
}

function getFirstDateValue(data, fields) {
  for (const field of fields) {
    const date = toDate(data?.[field]);
    if (date) return date;
  }
  return null;
}

function getCurrentUserInfo() {
  const session = getStoredLifeguardSession();
  let token = {};
  try {
    token = JSON.parse(localStorage.getItem('loginToken') || 'null') || {};
  } catch (_) {
    token = {};
  }
  const firstName = sessionStorage.getItem('chemlogEmployeeFirstName') || session?.firstName || token.firstName || '';
  const lastName = sessionStorage.getItem('chemlogEmployeeLastName') || session?.lastName || token.lastName || '';
  const email = sessionStorage.getItem('chemlogEmployeeEmail') || session?.email || token.email || auth.currentUser?.email || '';
  const username = sessionStorage.getItem('chemlogEmployeeUsername') || session?.username || token.username || '';
  const homePool = sessionStorage.getItem('chemlogEmployeeHomePool') || session?.homePool || localStorage.getItem('chemlogEmployeeHomePool') || '';
  return {
    name: [firstName, lastName].filter(Boolean).join(' ') || username || email || 'Unknown user',
    firstName,
    lastName,
    email,
    username,
    id: email || username || '',
    homePool,
    accessMode: getAccessMode(),
  };
}

function getStoredLifeguardSession() {
  try {
    const raw = localStorage.getItem(LIFEGUARD_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function getAccessMode() {
  if (hasFreshSupervisorToken() || localStorage.getItem('ChemLogSupervisor') === 'true') return 'supervisor';
  return normalizeAccessMode(
    sessionStorage.getItem(ACCESS_MODE_STORAGE_KEY) ||
    localStorage.getItem(ACCESS_MODE_STORAGE_KEY) ||
    getStoredLifeguardSession()?.accessMode ||
    sessionStorage.getItem('chemlogRole') ||
    localStorage.getItem('chemlogRole') ||
    'lifeguard'
  );
}

function canManageTasks() {
  const mode = getAccessMode();
  return mode === 'supervisor' || mode === 'manager' || mode === 'poolmanager';
}

function hasFreshSupervisorToken() {
  try {
    const token = JSON.parse(localStorage.getItem('loginToken') || 'null');
    return !!(token?.expires && Date.now() < Number(token.expires) && token?.emailVerified === true);
  } catch (_) {
    return false;
  }
}

function normalizeAccessMode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'poolmanager' || raw === 'pool_manager' || raw === 'pool manager') return 'manager';
  if (raw === 'gate' || raw === 'gateattendant' || raw === 'gate attendant') return 'attendant';
  if (raw === 'supervisor') return 'supervisor';
  if (raw === 'manager') return 'manager';
  return raw || 'lifeguard';
}

function rememberSelectedPool(poolName) {
  if (!poolName) return;
  try {
    localStorage.setItem(getSelectedPoolStorageKey(), poolName);
  } catch (_) {
    /* ignore */
  }
}

function getRememberedSelectedPool() {
  try {
    return localStorage.getItem(getSelectedPoolStorageKey()) || localStorage.getItem(SELECTED_POOL_KEY_BASE) || '';
  } catch (_) {
    return '';
  }
}

function getSelectedPoolStorageKey() {
  const user = getCurrentUserInfo();
  const identity = normalizeFacilityName(user.email || user.username || 'shared');
  return `${SELECTED_POOL_KEY_BASE}:${identity}`;
}

function groupPoolsByMarket(pools) {
  const map = {};
  pools.forEach((pool) => {
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

function getPoolName(pool) {
  return String(pool?.name || pool?.id || '').trim();
}

function normalizeFacilityName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseDateTimeLocal(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseCustomRepeatDates(value) {
  return String(value || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => new Date(line))
    .filter((date) => !Number.isNaN(date.getTime()));
}

function addRepeatInterval(date, mode, multiplier) {
  const next = new Date(date);
  if (mode === 'daily') next.setDate(next.getDate() + multiplier);
  if (mode === 'weekly') next.setDate(next.getDate() + (7 * multiplier));
  if (mode === 'monthly') next.setMonth(next.getMonth() + multiplier);
  return next;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getIsoFromTimestamp(value) {
  return toDate(value)?.toISOString() || '';
}

function toDateTimeLocalInputValue(date) {
  if (!date) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDueDate(date) {
  if (!date) return 'No due date';
  return date.toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getTimeRemainingLabel(date, complete) {
  if (complete) return 'Complete';
  if (!date) return 'No deadline';
  const diff = date.getTime() - Date.now();
  const absMinutes = Math.round(Math.abs(diff) / 60000);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  const label = days ? `${days}d ${remainingHours}h` : (hours ? `${hours}h ${minutes}m` : `${minutes}m`);
  return diff < 0 ? `${label} overdue` : `${label} left`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Unable to read file.'));
    reader.readAsDataURL(file);
  });
}

function setFormMessage(message, isError = false) {
  if (!els.formMessage) return;
  els.formMessage.textContent = message || '';
  els.formMessage.classList.toggle('todo-error', !!isError);
  els.formMessage.classList.toggle('todo-success', !!message && !isError);
}

function setProofMessage(message, isError = false) {
  if (!els.proofMessage) return;
  els.proofMessage.textContent = message || '';
  els.proofMessage.classList.toggle('todo-error', !!isError);
  els.proofMessage.classList.toggle('todo-success', !!message && !isError);
}

function wrapTodoTables(root) {
  root.querySelectorAll('table').forEach((table) => {
    if (table.closest('.todo-table-scroll')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'todo-table-scroll';
    table.parentNode.insertBefore(wrapper, table);
    wrapper.appendChild(table);
    const refresh = () => {
      const hasOverflow = wrapper.scrollWidth > wrapper.clientWidth + 2;
      wrapper.classList.toggle('has-overflow-left', hasOverflow && wrapper.scrollLeft > 2);
      wrapper.classList.toggle('has-overflow-right', hasOverflow && (wrapper.scrollLeft + wrapper.clientWidth) < wrapper.scrollWidth - 2);
    };
    wrapper.addEventListener('scroll', refresh, { passive: true });
    window.addEventListener('resize', refresh, { passive: true });
    requestAnimationFrame(refresh);
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

window.addEventListener('beforeunload', () => {
  if (typeof state.unsubscribeTasks === 'function') state.unsubscribeTasks();
});
