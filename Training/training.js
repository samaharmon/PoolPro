// training.js

// ChemLog Training Page logic
// - Supervisor login gating
// - Training session CRUD (date, time, pool, address, capacity, notes)
// - Lifeguard signup with capacity enforcement

const STORAGE_KEY = 'chemlogTrainingSessions_v1';
const LOGIN_KEY = 'chemlogTrainingSupervisorLoggedIn';

// Local cache of training sessions (localStorage)
let trainingSessions = [];

// Active filters for admin and public Scheduled Sessions tables
let activeAdminTypeFilter = 'all';
let activeAdminCityFilter = 'all';
let activePublicTypeFilter = 'all';
let activePublicCityFilter = 'all';
const adminScheduleOpenState = {};
const publicScheduleOpenState = {};
const adminScheduleEditState = {};
let selectedAdminSessionId = '';
let selectedAdminSessionMonth = '';
let trainingUndoState = null;

// Market derived from lifeguard's selected home pool (filters signup session dropdown)
let activeSignupMarket = '';

// ---------- Menu handlers for Lifeguard / Supervisor views ----------

const menuLifeguard = document.getElementById('menuLifeguardSignup');
if (menuLifeguard) {
  menuLifeguard.addEventListener('click', (e) => {
    e.preventDefault();
    showLifeguardView();
    document
      .querySelectorAll('.dropdown-menu.show')
      .forEach((m) => m.classList.remove('show'));
  });
}

const menuSupervisor = document.getElementById('menuSupervisorLogin');
if (menuSupervisor) {
  menuSupervisor.addEventListener('click', (e) => {
    e.preventDefault();

    const modal = document.getElementById('trainingLoginModal');
    if (modal) {
      modal.style.display = 'flex';
      requestAnimationFrame(() => modal.classList.add('visible'));
    } else {
      // Fallback: if no modal, just show the supervisor section
      showSupervisorView();
    }

    document
      .querySelectorAll('.dropdown-menu.show')
      .forEach((m) => m.classList.remove('show'));
  });
}

// ---------- Storage helpers ----------

function generateId() {
  return (
    'sess_' +
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36)
  );
}

function normalizeSession(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      id: generateId(),
      market: '',
      date: '',
      startTime: '',
      endTime: '',
      pool: '',
      address: '',
      capacity: 0,
      notes: '',
      attendees: []
    };
  }

  const capacity = parseInt(raw.capacity, 10);

  return {
    id: raw.id || generateId(),
    trainingType: raw.trainingType || '',
    market: raw.market || '',
    date: raw.date || '',
    startTime: raw.startTime || raw.time || '',  // backwards compat with old `time` field
    endTime: raw.endTime || '',
    multiDay: !!raw.multiDay,
    startDate: raw.startDate || raw.date || '',
    endDate: raw.endDate || '',
    dayTimes: (raw.dayTimes && typeof raw.dayTimes === 'object') ? raw.dayTimes : {},
    pool: raw.pool || '',
    address: raw.address || '',
    capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : 0,
    notes: raw.notes || '',
    attendees: Array.isArray(raw.attendees) ? raw.attendees : []
  };
}

/**
 * This is the function the console is complaining about.
 * It loads any locally saved sessions and returns them as an array.
 */
function loadSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeSession);
  } catch (err) {
    console.error('Error loading training sessions from storage:', err);
    return [];
  }
}

function saveSessions() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trainingSessions));
  } catch (err) {
    console.error('Error saving training sessions to storage:', err);
  }
  // Sync to Firestore so the lifeguard view (loadPublicTrainingSessions) stays current
  if (window.syncTrainingSessionsToFirestore) {
    window.syncTrainingSessionsToFirestore(trainingSessions);
  }
}

// ---------- Date / time helpers ----------

const MONTH_KEYS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const MONTH_LABELS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function parseTrainingDateOnly(dateStr) {
  if (!dateStr) return null;
  const value = String(dateStr).trim();
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  }
  const d = new Date(value.includes('T') ? value : `${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateInputValue(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '';
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMonthKeyFromDateString(dateStr) {
  if (!dateStr) return null;
  const d = parseTrainingDateOnly(dateStr);
  if (!d) return null;
  return MONTH_KEYS[d.getMonth()];
}

function formatTimeRange(startTime, endTime) {
  if (startTime && endTime) return `${startTime} - ${endTime}`;
  if (startTime) return startTime;
  if (endTime) return endTime;
  return '';
}

function formatDateNice(dateStr) {
  if (!dateStr) return '';
  const d = parseTrainingDateOnly(dateStr);
  if (!d) return dateStr;
  const weekday = d.toLocaleString(undefined, { weekday: 'long' });
  const month = d.toLocaleString(undefined, { month: 'short' });
  const day = d.getDate();
  const year = d.getFullYear();
  return `${weekday}, ${month} ${day}, ${year}`;
}

function escapeTrainingHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeTrainingNotesHtml(value) {
  if (!value) return '';
  const template = document.createElement('template');
  template.innerHTML = String(value);
  const allowedTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'DIV', 'P']);

  function cleanNode(parent) {
    Array.from(parent.childNodes).forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node;
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED'].includes(element.tagName)) {
          element.remove();
          return;
        }
        cleanNode(element);
        Array.from(element.attributes).forEach((attr) => element.removeAttribute(attr.name));
        if (!allowedTags.has(element.tagName)) {
          element.replaceWith(...Array.from(element.childNodes));
        }
      }
    });
  }

  cleanNode(template.content);
  return template.innerHTML.trim();
}

function trainingNotesToHtml(value) {
  const raw = String(value || '');
  if (!raw.trim()) return '';
  if (/<\/?[a-z][\s\S]*>/i.test(raw)) {
    return sanitizeTrainingNotesHtml(raw);
  }
  return escapeTrainingHtml(raw).replace(/\n/g, '<br>');
}

function getTrainingNotesHtml(editor) {
  if (!editor) return '';
  if (editor.getAttribute('contenteditable') !== null) {
    return sanitizeTrainingNotesHtml(editor.innerHTML || '');
  }
  return trainingNotesToHtml(editor.value || '');
}

function setTrainingNotesHtml(editor, value) {
  if (!editor) return;
  const html = trainingNotesToHtml(value);
  if (editor.getAttribute('contenteditable') !== null) {
    editor.innerHTML = html;
  } else {
    editor.value = html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  }
}

function inferMarketFromSelectedPool(selectEl) {
  const selected = selectEl?.selectedOptions?.[0] || null;
  const group = selected?.parentElement;
  if (group?.tagName === 'OPTGROUP' && group.label) return group.label;
  return inferMarketFromPoolName(selectEl?.value || '');
}

function inferMarketFromPoolName(poolName) {
  const normalizedPool = String(poolName || '').trim().toLowerCase();
  if (!normalizedPool) return '';
  const pools = window._poolsForDuties || [];
  const pool = pools.find((candidate) => {
    const name = String(candidate.name || candidate.id || '').trim().toLowerCase();
    return name === normalizedPool;
  });
  const markets = Array.isArray(pool?.markets) ? pool.markets : [];
  return markets[0] || pool?.market || '';
}

function getSessionMarket(session) {
  return session?.market || inferMarketFromPoolName(session?.pool || '');
}

let activeTrainingNotesEditor = null;
let savedTrainingNotesSelection = null;

function trainingNotesSelectionInside(editor) {
  const selection = window.getSelection();
  if (!editor || !selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  return editor.contains(range.startContainer) && editor.contains(range.endContainer);
}

function saveTrainingNotesSelection(editor) {
  const selection = window.getSelection();
  if (!editor || !selection || selection.rangeCount === 0) return;
  if (!trainingNotesSelectionInside(editor)) return;
  savedTrainingNotesSelection = selection.getRangeAt(0).cloneRange();
  activeTrainingNotesEditor = editor;
}

function restoreTrainingNotesSelection(editor) {
  if (!editor || !savedTrainingNotesSelection) return;
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(savedTrainingNotesSelection);
  activeTrainingNotesEditor = editor;
}

function updateTrainingNotesToolbarState(editor) {
  const toolbar = editor?.previousElementSibling;
  if (!toolbar?.classList?.contains('training-notes-toolbar')) return;
  toolbar.querySelectorAll('[data-training-format]').forEach((btn) => {
    const cmd = btn.dataset.trainingFormat;
    try {
      btn.classList.toggle('active', !!cmd && document.queryCommandState(cmd));
    } catch (_) {
      btn.classList.remove('active');
    }
  });
}

function initTrainingNotesEditor(editor) {
  if (!editor || editor.dataset.trainingNotesReady === 'true') return;
  editor.dataset.trainingNotesReady = 'true';
  const toolbar = editor.previousElementSibling;
  toolbar?.querySelectorAll('[data-training-format]').forEach((btn) => {
    btn.addEventListener('mousedown', (event) => event.preventDefault());
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.trainingFormat;
      if (!cmd) return;
      editor.focus();
      restoreTrainingNotesSelection(editor);
      document.execCommand(cmd, false);
      saveTrainingNotesSelection(editor);
      updateTrainingNotesToolbarState(editor);
    });
  });

  ['focus', 'mouseup', 'keyup', 'input'].forEach((eventName) => {
    editor.addEventListener(eventName, () => {
      activeTrainingNotesEditor = editor;
      saveTrainingNotesSelection(editor);
      updateTrainingNotesToolbarState(editor);
    });
  });

  document.addEventListener('selectionchange', () => {
    if (!activeTrainingNotesEditor || !trainingNotesSelectionInside(activeTrainingNotesEditor)) return;
    saveTrainingNotesSelection(activeTrainingNotesEditor);
    updateTrainingNotesToolbarState(activeTrainingNotesEditor);
  });
}

const TIME_OPTIONS = [
  '8:00 AM',
  '9:00 AM',
  '10:00 AM',
  '11:00 AM',
  '12:00 PM',
  '1:00 PM',
  '2:00 PM',
  '3:00 PM',
  '4:00 PM',
  '5:00 PM',
  '6:00 PM',
  '7:00 PM',
  '8:00 PM'
];

function buildTimeOptions(selectEl, placeholderText) {
  if (!selectEl) return;
  if (selectEl.tagName === 'INPUT') {
    const text = String(placeholderText || 'Enter time')
      .replace(/^Select\s+/i, 'Enter ');
    selectEl.placeholder = text === placeholderText ? 'e.g. 3:00 PM' : text;
    return;
  }
  const current = selectEl.value;
  selectEl.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = placeholderText || 'Select time';
  selectEl.appendChild(placeholder);

  TIME_OPTIONS.forEach((timeStr) => {
    const opt = document.createElement('option');
    opt.value = timeStr;
    opt.textContent = timeStr;
    selectEl.appendChild(opt);
  });

  if (current) {
    selectEl.value = current;
    if (selectEl.value !== current) {
      const customOpt = document.createElement('option');
      customOpt.value = current;
      customOpt.textContent = current;
      customOpt.selected = true;
      selectEl.appendChild(customOpt);
    }
  }
}

// ---------- UI helpers ----------

function normalizeTrainingHeaderCopy() {
  const subtitle = document.querySelector('.header-title-block p, #CCA');
  if (subtitle && subtitle.dataset.headerCopyReady !== 'true') {
    subtitle.textContent = '';
    subtitle.dataset.headerCopyReady = 'true';
  }
}

function getResponsiveTableMinWidth(table) {
  if (table.matches('.training-schedule-table')) return '760px';
  if (table.matches('.attendance-table')) return '900px';
  if (table.matches('.employee-table')) return '980px';
  if (table.matches('.resource-table')) return '980px';
  if (table.matches('.sanitation-table')) return '700px';
  return '720px';
}

function wrapResponsiveTables(root = document) {
  const tables = root.querySelectorAll('table');
  tables.forEach((table) => {
    table.style.setProperty('--table-min-width', getResponsiveTableMinWidth(table));
    const existingWrapper = table.closest('.table-scroll-wrap');
    if (existingWrapper) {
      ensureTableScrollShell(existingWrapper);
      bindTableScrollShadow(existingWrapper);
      updateTableScrollShadow(existingWrapper);
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'table-scroll-wrap';
    const shell = document.createElement('div');
    shell.className = 'table-scroll-shell';
    table.parentNode.insertBefore(shell, table);
    shell.appendChild(wrapper);
    wrapper.appendChild(table);
    bindTableScrollShadow(wrapper);
  });
}

function ensureTableScrollShell(wrapper) {
  if (!wrapper || wrapper.parentElement?.classList.contains('table-scroll-shell')) return wrapper?.parentElement || null;
  const shell = document.createElement('div');
  shell.className = 'table-scroll-shell';
  wrapper.parentNode.insertBefore(shell, wrapper);
  shell.appendChild(wrapper);
  return shell;
}

function updateTableScrollShadow(wrapper) {
  if (!wrapper) return;
  const shell = ensureTableScrollShell(wrapper) || wrapper;
  const hasOverflow = wrapper.scrollWidth > wrapper.clientWidth + 2;
  const hasRight = hasOverflow && (wrapper.scrollLeft + wrapper.clientWidth) < (wrapper.scrollWidth - 2);
  const hasLeft = hasOverflow && wrapper.scrollLeft > 2;
  wrapper.classList.toggle('has-overflow-right', hasRight);
  wrapper.classList.toggle('has-overflow-left', hasLeft);
  wrapper.classList.toggle('has-overflow', hasOverflow);
  shell.classList.toggle('has-overflow-right', hasRight);
  shell.classList.toggle('has-overflow-left', hasLeft);
  shell.classList.toggle('has-overflow', hasOverflow);
  shell.style.setProperty('--table-scroll-shadow-height', `${Math.max(0, wrapper.clientHeight - 8)}px`);
}

function bindTableScrollShadow(wrapper) {
  if (!wrapper || wrapper.dataset.shadowBound === 'true') return;
  wrapper.dataset.shadowBound = 'true';
  const refresh = () => updateTableScrollShadow(wrapper);
  wrapper.addEventListener('scroll', refresh, { passive: true });
  window.addEventListener('resize', refresh, { passive: true });
  requestAnimationFrame(refresh);
}

function observeResponsiveTables() {
  if (!document.body || document.body.dataset.trainingTableObserverReady === 'true') return;
  document.body.dataset.trainingTableObserverReady = 'true';

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches?.('table')) {
          wrapResponsiveTables(node.parentElement || document);
          return;
        }
        if (node.querySelector?.('table')) {
          wrapResponsiveTables(node);
        }
      });
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function hasFreshSupervisorSession() {
  try {
    const token = JSON.parse(localStorage.getItem('loginToken') || 'null');
    if (token?.expires && Date.now() < Number(token.expires)) return true;
    if (token?.expires && Date.now() >= Number(token.expires)) {
      localStorage.setItem(LOGIN_KEY, 'false');
      localStorage.removeItem('loginToken');
      localStorage.removeItem('ChemLogSupervisor');
      localStorage.removeItem('trainingSupervisorLoggedIn');
      localStorage.removeItem('training_supervisor_logged_in_v1');
      localStorage.removeItem('chemlogTrainingSupervisorLoggedIn');
      if (localStorage.getItem('chemlogRole') === 'supervisor') localStorage.removeItem('chemlogRole');
    }
  } catch (_) { /* ignore */ }
  return false;
}

function updateCapacityInfo(session, el) {
  if (!el.capacityInfo) return;

  if (!session) {
    el.capacityInfo.textContent =
      'Spots used / remaining will appear after you save this session.';
    return;
  }

  const capacity = session.capacity || 0;
  const taken = Array.isArray(session.attendees) ?
    session.attendees.length
    : 0;

  if (!capacity) {
    el.capacityInfo.textContent =
      `${taken} sign-ups so far. Add a capacity to track remaining spots.`;
    return;
  }

  const remaining = Math.max(capacity - taken, 0);
  el.capacityInfo.textContent =
    `${taken} of ${capacity} spots used - ${remaining} remaining`;
}

function updateSessionSelectForType(typeKey, el) {
  const select = el.trainingSessionSelect;
  if (!select) return;

  select.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';

  if (!typeKey) {
    placeholder.textContent = 'Select a training type first';
    select.appendChild(placeholder);
    return;
  }

  let sessionsForType = trainingSessions.filter(
    (s) => s.trainingType === typeKey
  );

  // Further filter to the lifeguard's market (derived from their home pool selection)
  if (activeSignupMarket) {
    sessionsForType = sessionsForType.filter(s => s.market === activeSignupMarket);
  }

  if (!sessionsForType.length) {
    placeholder.textContent = activeSignupMarket
      ? `No sessions available in ${activeSignupMarket} for this type`
      : 'No sessions available for this type';
    select.appendChild(placeholder);
    return;
  }

  placeholder.textContent = 'Select a session';
  select.appendChild(placeholder);

  // Group by month with optgroup headers
  const monthOrder = ['may', 'june', 'july'];
  const monthLabels = { may: 'May', june: 'June', july: 'July' };
  const byMonth = {};

  sessionsForType.forEach((session) => {
    const mKey = getMonthKeyFromDateString(session.date);
    if (!mKey) return;
    if (!byMonth[mKey]) byMonth[mKey] = [];
    byMonth[mKey].push(session);
  });

  monthOrder.forEach((mKey) => {
    if (!byMonth[mKey] || !byMonth[mKey].length) return;

    const group = document.createElement('optgroup');
    group.label = monthLabels[mKey];

    byMonth[mKey].forEach((session) => {
      const opt = document.createElement('option');
      opt.value = session.id;

      const datePart = formatDateNice(session.date);
      const timeRange = formatTimeRange(session.startTime, session.endTime);
      const pieces = [datePart, timeRange, session.pool].filter(Boolean);
      let label = pieces.join(' - ');

      const taken = Array.isArray(session.attendees) ? session.attendees.length : 0;
      const capacity = session.capacity || 0;
      const remaining = capacity ? Math.max(capacity - taken, 0) : null;

      if (capacity) {
        label += ` (${taken}/${capacity} spots filled${remaining === 0 ? ' - FULL' : ''})`;
      } else if (taken) {
        label += ` (${taken} signed up)`;
      }

      opt.textContent = label;
      if (remaining === 0) opt.disabled = true;

      group.appendChild(opt);
    });

    select.appendChild(group);
  });
}

// ---------- Admin (supervisor) handlers ----------

function isAnyAdminScheduleEditable() {
  return Object.values(adminScheduleEditState).some(Boolean);
}

function clearTrainingSessionForm(el) {
  if (el.marketSelect) el.marketSelect.value = '';
  if (el.trainingTypeInput) el.trainingTypeInput.value = '';
  if (el.dateInput) el.dateInput.value = '';
  if (el.startTimeSelect) el.startTimeSelect.value = '';
  if (el.endTimeSelect) el.endTimeSelect.value = '';
  if (el.poolSelect) el.poolSelect.value = '';
  if (el.addressInput) el.addressInput.value = '';
  if (el.capacityInput) el.capacityInput.value = '';
  setTrainingNotesHtml(el.notesInput, '');
  if (el.sessionIdInput) el.sessionIdInput.value = '';
  if (el.multiDayCheckbox) el.multiDayCheckbox.checked = false;
  if (el.startDateInput) el.startDateInput.value = '';
  if (el.endDateInput) el.endDateInput.value = '';
  if (el.startDaySelect) el.startDaySelect.value = '';
  if (el.endDaySelect) el.endDaySelect.value = '';
  window._currentDayTimes = {};
  setMultiDayUI(el, false);
  updateCapacityInfo(null, el);
}

function ensureTrainingSessionActionButtons(el) {
  const saveBtn = el.saveSessionBtn;
  if (!saveBtn) return;

  if (!saveBtn.parentElement?.classList.contains('training-session-action-row')) {
    const row = document.createElement('div');
    row.className = 'training-session-action-row employee-action-row';
    saveBtn.parentElement.insertBefore(row, saveBtn);
    row.appendChild(saveBtn);
  }

  const row = saveBtn.parentElement;
  if (!document.getElementById('deleteTrainingSessionBtn')) {
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.id = 'deleteTrainingSessionBtn';
    deleteBtn.className = 'submit-btn button-shadow employee-action-btn hidden';
    deleteBtn.textContent = 'Delete';
    row.appendChild(deleteBtn);
  }

  if (!document.getElementById('undoTrainingSessionBtn')) {
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.id = 'undoTrainingSessionBtn';
    undoBtn.className = 'submit-btn button-shadow employee-action-btn hidden';
    undoBtn.textContent = 'Undo';
    row.appendChild(undoBtn);
  }
}

function syncTrainingSessionActionButtons(el) {
  ensureTrainingSessionActionButtons(el);
  const deleteBtn = document.getElementById('deleteTrainingSessionBtn');
  const undoBtn = document.getElementById('undoTrainingSessionBtn');
  const selectedEditable = selectedAdminSessionId
    && selectedAdminSessionMonth
    && adminScheduleEditState[selectedAdminSessionMonth];
  const anyEditable = isAnyAdminScheduleEditable();

  if (deleteBtn) deleteBtn.classList.toggle('hidden', !selectedEditable);
  if (undoBtn) undoBtn.classList.toggle('hidden', !(anyEditable && trainingUndoState));
}

function setTrainingUndoAction(action, el) {
  trainingUndoState = action || null;
  syncTrainingSessionActionButtons(el);
}

function selectAdminTrainingRow(sessionId, monthKey, el) {
  if (!adminScheduleEditState[monthKey]) return;
  const session = trainingSessions.find((s) => s.id === sessionId);
  if (!session) return;
  selectedAdminSessionId = sessionId;
  selectedAdminSessionMonth = monthKey;
  handleEditSessionClick(sessionId, el);
  syncTrainingSessionActionButtons(el);
  renderAdminTables(el);
}

function setAdminScheduleEditable(monthKey, editable, el) {
  adminScheduleEditState[monthKey] = !!editable;
  if (!editable && selectedAdminSessionMonth === monthKey) {
    selectedAdminSessionId = '';
    selectedAdminSessionMonth = '';
    clearTrainingSessionForm(el);
  }
  syncTrainingSessionActionButtons(el);
  renderAdminTables(el);
}

async function undoLastTrainingAction(el) {
  if (!trainingUndoState) return;
  const { type, session, index } = trainingUndoState;
  if (type === 'delete' && session) {
    const restoreIndex = Math.max(0, Math.min(index ?? trainingSessions.length, trainingSessions.length));
    trainingSessions.splice(restoreIndex, 0, normalizeSession(session));
    selectedAdminSessionId = session.id || '';
    selectedAdminSessionMonth = getMonthKeyFromDateString(session.date) || '';
    if (selectedAdminSessionMonth) adminScheduleEditState[selectedAdminSessionMonth] = true;
    saveSessions();
    handleEditSessionClick(selectedAdminSessionId, el);
    renderAdminTables(el);
  }
  setTrainingUndoAction(null, el);
  if (el.trainingMonthSelect && el.trainingMonthSelect.value) {
    updateSessionSelectForType(el.trainingMonthSelect.value, el);
  }
}

function handleSaveSession(el) {
  const trainingType = el.trainingTypeInput?.value || '';
  const isMultiDay = el.multiDayCheckbox?.checked || false;
  const pool = el.poolSelect?.value?.trim() || '';
  const market = inferMarketFromSelectedPool(el.poolSelect) || inferMarketFromPoolName(pool);
  const address = el.addressInput?.value?.trim() || '';
  const capacityRaw = el.capacityInput?.value?.trim() || '';
  const notes = getTrainingNotesHtml(el.notesInput);
  const messageEl = el.adminMessage;

  if (!messageEl) return;
  messageEl.textContent = '';
  messageEl.classList.remove('success', 'error');

  let date, startTime, endTime, startDate, endDate, dayTimes;

  if (isMultiDay) {
    startDate = el.startDateInput?.value?.trim() || '';
    endDate = el.endDateInput?.value?.trim() || '';
    date = startDate;
    startTime = '';
    endTime = '';
    // Save the current day's times before reading final state
    const curDay = el.startDaySelect?.value;
    if (curDay) {
      window._currentDayTimes = window._currentDayTimes || {};
      window._currentDayTimes[curDay] = {
        startTime: el.startTimeSelect?.value || '',
        endTime: el.endTimeSelect?.value || ''
      };
    }
    dayTimes = { ...(window._currentDayTimes || {}) };
    if (!startDate || !endDate) {
      messageEl.textContent = 'Please enter a start and end date for the multi-day session.';
      messageEl.classList.add('error');
      return;
    }
    // Require at least 2 days with both start AND end times
    const completeDays = Object.values(dayTimes).filter(d => d.startTime && d.endTime).length;
    if (completeDays < 2) {
      messageEl.textContent = 'Please enter start and end times for at least 2 days.';
      messageEl.classList.add('error');
      return;
    }
  } else {
    date = el.dateInput?.value?.trim() || '';
    startDate = date;
    endDate = '';
    startTime = el.startTimeSelect?.value || '';
    endTime = el.endTimeSelect?.value || '';
    dayTimes = {};
    if (!date || !startTime || !pool || !capacityRaw) {
      messageEl.textContent =
        'Please enter a date, start time, location, and capacity for the training session.';
      messageEl.classList.add('error');
      return;
    }
  }

  if (!pool || !capacityRaw) {
    messageEl.textContent = 'Please enter a pool location and capacity.';
    messageEl.classList.add('error');
    return;
  }

  const capacity = parseInt(capacityRaw, 10);
  if (!Number.isFinite(capacity) || capacity <= 0) {
    messageEl.textContent = 'Capacity must be a positive number.';
    messageEl.classList.add('error');
    return;
  }

  const id = el.sessionIdInput?.value;
  let targetSession = null;

  if (id) {
    targetSession = trainingSessions.find((s) => s.id === id);
    if (!targetSession) {
      messageEl.textContent =
        'Could not find that session to update (it may have been deleted). Saving as a new session.';
    }
  }

  if (targetSession) {
    const taken = Array.isArray(targetSession.attendees) ? targetSession.attendees.length : 0;
    if (capacity < taken) {
      messageEl.textContent =
        `Capacity (${capacity}) cannot be less than current sign-ups (${taken}).`;
      messageEl.classList.add('error');
      return;
    }

    targetSession.trainingType = trainingType;
    targetSession.market = market;
    targetSession.date = date;
    targetSession.startTime = startTime;
    targetSession.endTime = endTime;
    targetSession.multiDay = isMultiDay;
    targetSession.startDate = startDate;
    targetSession.endDate = endDate;
    targetSession.dayTimes = dayTimes;
    targetSession.pool = pool;
    targetSession.address = address;
    targetSession.capacity = capacity;
    targetSession.notes = notes;
  } else {
    targetSession = {
      id: generateId(),
      trainingType,
      market,
      date,
      startTime,
      endTime,
      multiDay: isMultiDay,
      startDate,
      endDate,
      dayTimes,
      pool,
      address,
      capacity,
      notes,
      attendees: []
    };
    trainingSessions.push(targetSession);
    if (el.sessionIdInput) {
      el.sessionIdInput.value = targetSession.id;
    }
  }

  saveSessions();
  selectedAdminSessionId = '';
  selectedAdminSessionMonth = '';
  renderAdminTables(el);
  if (el.trainingMonthSelect && el.trainingMonthSelect.value) {
    updateSessionSelectForType(el.trainingMonthSelect.value, el);
  }

  updateCapacityInfo(targetSession, el);

  messageEl.textContent = 'Training session saved.';
  messageEl.classList.add('success');

  clearTrainingSessionForm(el);
  syncTrainingSessionActionButtons(el);
}

function handleEditSessionClick(sessionId, el) {
  const session = trainingSessions.find((s) => s.id === sessionId);
  if (!session) return;

  if (el.sessionIdInput) el.sessionIdInput.value = session.id;
  if (el.marketSelect) el.marketSelect.value = session.market || '';
  if (el.trainingTypeInput) el.trainingTypeInput.value = session.trainingType || '';

  const isMultiDay = !!session.multiDay;
  if (el.multiDayCheckbox) el.multiDayCheckbox.checked = isMultiDay;
  setMultiDayUI(el, isMultiDay);

  if (isMultiDay) {
    if (el.startDateInput) el.startDateInput.value = session.startDate || session.date || '';
    if (el.endDateInput) el.endDateInput.value = session.endDate || '';
    window._currentDayTimes = session.dayTimes ? { ...session.dayTimes } : {};
    updateDaySelects(el);
    // Load Day 1 times into the time selects
    const day1Times = window._currentDayTimes['1'] || {};
    if (el.startDaySelect) el.startDaySelect.value = '1';
    if (el.endDaySelect) el.endDaySelect.value = '1';
    buildTimeOptions(el.startTimeSelect, 'Select start time');
    if (day1Times.startTime) el.startTimeSelect.value = day1Times.startTime;
    buildTimeOptions(el.endTimeSelect, 'Select end time');
    if (day1Times.endTime) el.endTimeSelect.value = day1Times.endTime;
  } else {
    if (el.dateInput) el.dateInput.value = session.date || '';
    if (el.startTimeSelect) {
      buildTimeOptions(el.startTimeSelect, 'Select start time');
      el.startTimeSelect.value = session.startTime || '';
      if (session.startTime && el.startTimeSelect.value !== session.startTime) {
        const opt = document.createElement('option');
        opt.value = session.startTime; opt.textContent = session.startTime;
        el.startTimeSelect.appendChild(opt); el.startTimeSelect.value = session.startTime;
      }
    }
    if (el.endTimeSelect) {
      buildTimeOptions(el.endTimeSelect, 'Select end time');
      el.endTimeSelect.value = session.endTime || '';
      if (session.endTime && el.endTimeSelect.value !== session.endTime) {
        const opt = document.createElement('option');
        opt.value = session.endTime; opt.textContent = session.endTime;
        el.endTimeSelect.appendChild(opt); el.endTimeSelect.value = session.endTime;
      }
    }
  }

  if (el.poolSelect) {
    el.poolSelect.value = session.pool || '';
    if (session.pool && el.poolSelect.value !== session.pool) {
      const opt = document.createElement('option');
      opt.value = session.pool; opt.textContent = session.pool;
      el.poolSelect.appendChild(opt); el.poolSelect.value = session.pool;
    }
  }

  if (el.addressInput) el.addressInput.value = session.address || '';
  if (el.capacityInput) el.capacityInput.value = session.capacity != null ? String(session.capacity) : '';
  setTrainingNotesHtml(el.notesInput, session.notes || '');

  updateCapacityInfo(session, el);
  if (el.dateInput && !isMultiDay) el.dateInput.focus();
}

function handleDeleteSessionClick(sessionId, el) {
  const idx = trainingSessions.findIndex((s) => s.id === sessionId);
  if (idx === -1) return;

  const session = normalizeSession(trainingSessions[idx]);
  const taken = Array.isArray(session.attendees) ?
    session.attendees.length
    : 0;

  const confirmMsg = `Delete ${formatDateNice(session.date)} ${
    session.time || ''
  } at ${session.pool || 'this location'}?\n\nThis will also remove ${taken} existing sign-up(s).`;
  if (!window.confirm(confirmMsg)) {
    return;
  }

  trainingSessions.splice(idx, 1);
  selectedAdminSessionId = '';
  selectedAdminSessionMonth = '';
  setTrainingUndoAction({ type: 'delete', session, index: idx }, el);
  saveSessions();
  renderAdminTables(el);

  if (el.sessionIdInput && el.sessionIdInput.value === sessionId) {
    clearTrainingSessionForm(el);
  }

  if (el.trainingMonthSelect && el.trainingMonthSelect.value) {
    updateSessionSelectForType(el.trainingMonthSelect.value, el);
  }
  syncTrainingSessionActionButtons(el);
}

function getDayDate(startDate, dayNum) {
  if (!startDate) return '';
  const d = parseTrainingDateOnly(startDate);
  if (!d) return '';
  d.setDate(d.getDate() + dayNum - 1);
  return formatDateInputValue(d);
}

function getTrainingSessionDateTimeMarkup(session) {
  if (!session) return '';
  if (session.multiDay && session.dayTimes && Object.keys(session.dayTimes).length > 0) {
    const dayNums = Object.keys(session.dayTimes).sort((a, b) => Number(a) - Number(b));
    return dayNums.map((dayNum, idx) => {
      const dt = session.dayTimes[dayNum];
      const dayDate = getDayDate(session.startDate || session.date, Number(dayNum));
      const timeRange = formatTimeRange(dt.startTime, dt.endTime);
      const sep = idx > 0 ? ' class="multi-day-day-sep"' : '';
      return `<div${sep} class="multi-day-row"><strong>Day ${dayNum}:</strong> ${formatDateNice(dayDate)}${timeRange ? ` / ${timeRange}` : ''}</div>`;
    }).join('');
  }

  const timeRange = formatTimeRange(session.startTime, session.endTime);
  return formatDateNice(session.date) + (timeRange ? `<br>${timeRange}` : '');
}

function getTrainingSessionDateTimeText(session) {
  if (!session) return '';
  if (session.multiDay && session.dayTimes && Object.keys(session.dayTimes).length > 0) {
    const dayNums = Object.keys(session.dayTimes).sort((a, b) => Number(a) - Number(b));
    return dayNums.map((dayNum) => {
      const dt = session.dayTimes[dayNum];
      const dayDate = getDayDate(session.startDate || session.date, Number(dayNum));
      const timeRange = formatTimeRange(dt.startTime, dt.endTime);
      return `Day ${dayNum}: ${formatDateNice(dayDate)}${timeRange ? ` / ${timeRange}` : ''}`;
    }).join('\n');
  }

  const timeRange = formatTimeRange(session.startTime, session.endTime);
  return [formatDateNice(session.date), timeRange].filter(Boolean).join(' / ');
}

function getTrainingSessionLocationText(session) {
  return [session?.pool, session?.address].filter(Boolean).join('\n');
}

function isTrainingSessionFull(session) {
  const taken = Array.isArray(session?.attendees) ? session.attendees.length : 0;
  const capacity = session?.capacity || 0;
  return !!(capacity && taken >= capacity);
}

function buildScheduleTableSection(sessions, isAdmin, el = null) {
  // Group into month buckets
  const byMonth = {};
  for (const session of sessions) {
    const mKey = getMonthKeyFromDateString(session.date);
    if (!mKey) continue;
    if (!byMonth[mKey]) byMonth[mKey] = [];
    byMonth[mKey].push(session);
  }

  const fragment = document.createDocumentFragment();

  MONTH_KEYS.forEach((mKey, mIdx) => {
    const monthSessions = byMonth[mKey];
    if (!monthSessions || !monthSessions.length) return;

    const section = document.createElement('div');
    section.className = 'scheduled-section';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'emp-metrics-toggle';
    toggle.innerHTML = `<span class="emp-metrics-arrow">&gt;</span><span>${MONTH_LABELS[mIdx]}</span>`;
    section.appendChild(toggle);

    const contentWrap = document.createElement('div');
    contentWrap.className = 'emp-metrics-body hidden';
    const stateMap = isAdmin ? adminScheduleOpenState : publicScheduleOpenState;
    if (stateMap[mKey]) {
      contentWrap.classList.remove('hidden');
      toggle.querySelector('.emp-metrics-arrow').textContent = 'v';
    }

    const monthEditable = !!adminScheduleEditState[mKey];

    if (isAdmin) {
      const controlsRow = document.createElement('div');
      controlsRow.className = 'toggle-btn training-month-edit-row';
      controlsRow.innerHTML = `
        <div class="sanitation-controls training-month-controls" data-training-month="${mKey}">
          <div class="sanitation-controls-thumb"></div>
          <button type="button" class="editAndSave ${monthEditable ? 'active' : ''}" data-training-edit-month="${mKey}" ${monthEditable ? 'disabled' : ''}>Edit</button>
          <button type="button" class="editAndSave ${monthEditable ? '' : 'active'}" data-training-save-month="${mKey}" ${monthEditable ? '' : 'disabled'}>Save</button>
        </div>
      `;
      const thumb = controlsRow.querySelector('.sanitation-controls-thumb');
      if (thumb) thumb.style.transform = monthEditable ? 'translateX(0%)' : 'translateX(100%)';
      controlsRow.querySelector('[data-training-edit-month]')?.addEventListener('click', () => setAdminScheduleEditable(mKey, true, el));
      controlsRow.querySelector('[data-training-save-month]')?.addEventListener('click', () => setAdminScheduleEditable(mKey, false, el));
      contentWrap.appendChild(controlsRow);
    }

    const table = document.createElement('table');
    table.className = isAdmin
      ? 'schedule-table training-schedule-table training-schedule-table--admin'
      : 'sanitation-table training-schedule-table training-schedule-table--public';

    const thead = document.createElement('thead');
    thead.innerHTML = isAdmin
      ? `<tr><th>Training Type</th><th>Date &amp; Time</th><th>Location</th><th>Notes</th><th>Spots Filled</th><th>Actions</th></tr>`
      : `<tr><th>Training Type</th><th>Date &amp; Time</th><th>Location</th><th>Notes</th><th>Spots Filled</th></tr>`;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    for (const session of monthSessions) {
      const row = document.createElement('tr');
      row.dataset.sessionId = session.id;
      if (isAdmin && monthEditable) {
        row.classList.add('training-row-clickable');
        row.addEventListener('click', () => selectAdminTrainingRow(session.id, mKey, el));
      }
      if (!isAdmin) {
        row.classList.add('training-row-clickable', 'training-signup-row');
        row.addEventListener('click', () => openTrainingSignupModal(session.id, el));
      }
      if (isAdmin && monthEditable && session.id === selectedAdminSessionId) {
        row.classList.add('training-row-selected');
      }

      // Col 1: Training Type
      const typeCell = document.createElement('td');
      typeCell.textContent = session.trainingType || '';
      row.appendChild(typeCell);

      // Col 2: Date & Time
      const dateTimeCell = document.createElement('td');
      dateTimeCell.innerHTML = getTrainingSessionDateTimeMarkup(session);
      row.appendChild(dateTimeCell);

      // Col 3: Location (14px, no smaller sub-text)
      const locCell = document.createElement('td');
      const locParts = [session.pool, session.address].filter(Boolean);
      locCell.innerHTML = locParts.join('<br>');
      row.appendChild(locCell);

      // Col 4: Notes
      const notesCell = document.createElement('td');
      notesCell.className = 'notes-cell';
      notesCell.innerHTML = trainingNotesToHtml(session.notes || '');
      row.appendChild(notesCell);

      // Col 5: Spots Filled
      const capCell = document.createElement('td');
      const taken = Array.isArray(session.attendees) ? session.attendees.length : 0;
      const capacity = session.capacity || 0;
      capCell.textContent = capacity ? `${taken} / ${capacity}` : `${taken} / -`;
      row.appendChild(capCell);

      if (capacity && taken >= capacity) row.classList.add('session-row-full');

      if (isAdmin) {
        const actionsCell = document.createElement('td');
        actionsCell.className = 'training-actions-cell actions-cell';
        const rosterBtn = document.createElement('button');
        rosterBtn.type = 'button';
        rosterBtn.className = 'editAndSave training-roster-btn';
        rosterBtn.textContent = 'Roster';
        rosterBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          openRosterModal(session.id);
        });
        actionsCell.appendChild(rosterBtn);
        row.appendChild(actionsCell);
      }

      tbody.appendChild(row);
    }

    table.appendChild(tbody);
    const tableShell = document.createElement('div');
    tableShell.className = `training-edit-table-shell${isAdmin && monthEditable ? ' is-editable' : ' is-locked'}`;
    tableShell.appendChild(table);
    if (isAdmin) {
      const overlay = document.createElement('div');
      overlay.className = 'training-table-body-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      tableShell.appendChild(overlay);
      requestAnimationFrame(() => {
        tableShell.style.setProperty('--training-header-height', `${thead.offsetHeight || 44}px`);
      });
    }
    contentWrap.appendChild(tableShell);
    toggle.addEventListener('click', () => {
      contentWrap.classList.toggle('hidden');
      const open = !contentWrap.classList.contains('hidden');
      stateMap[mKey] = open;
      toggle.querySelector('.emp-metrics-arrow').textContent = open ? 'v' : '>';
    });
    section.appendChild(contentWrap);
    fragment.appendChild(section);
  });

  return fragment;
}

function applyFiltersAndSort(typeFilter, cityFilter) {
  let filtered = trainingSessions;
  if (typeFilter !== 'all') filtered = filtered.filter(s => s.trainingType === typeFilter);
  if (cityFilter !== 'all') filtered = filtered.filter(s => getSessionMarket(s) === cityFilter);
  return [...filtered].sort((a, b) => {
    if (a.date !== b.date) return (a.date || '').localeCompare(b.date || '');
    return (a.startTime || '').localeCompare(b.startTime || '');
  });
}

function renderAdminTables(el) {
  const container = el.adminTablesContainer;
  if (!container) return;

  const sorted = applyFiltersAndSort(activeAdminTypeFilter, activeAdminCityFilter);
  if (selectedAdminSessionId && !sorted.some((session) => session.id === selectedAdminSessionId)) {
    selectedAdminSessionId = '';
    selectedAdminSessionMonth = '';
    clearTrainingSessionForm(el);
  }

  container.innerHTML = '';
  if (!sorted.length) {
    container.innerHTML = '<p style="text-align:center;color:#888;font-style:italic;margin:20px 0;">No trainings fit these filters.</p>';
    syncTrainingSessionActionButtons(el);
    return;
  }

  container.appendChild(buildScheduleTableSection(sorted, true, el));
  syncTrainingSessionActionButtons(el);
}

function renderPublicTables(el) {
  const container = el.publicTablesContainer;
  if (!container) return;

  const sorted = applyFiltersAndSort(activePublicTypeFilter, activePublicCityFilter);

  container.innerHTML = '';
  if (!sorted.length) {
    container.innerHTML = '<p style="text-align:center;color:#888;font-style:italic;margin:20px 0;">No trainings fit these filters.</p>';
    return;
  }

  container.appendChild(buildScheduleTableSection(sorted, false, el));
}

// Multi-day UI helpers
function setMultiDayUI(el, isMultiDay) {
  const singleDate = el.dateInput;
  const rangeGroup = el.dateRangeGroup;
  const startDay = el.startDaySelect;
  const endDay = el.endDaySelect;
  if (singleDate) singleDate.style.display = isMultiDay ? 'none' : '';
  if (rangeGroup) rangeGroup.style.display = isMultiDay ? 'flex' : 'none';
  if (startDay) startDay.style.display = isMultiDay ? '' : 'none';
  if (endDay) endDay.style.display = isMultiDay ? '' : 'none';
}

function updateDaySelects(el) {
  const startDay = el.startDaySelect;
  const endDay = el.endDaySelect;
  if (!startDay || !endDay) return;

  [startDay, endDay].forEach(sel => {
    const prev = sel.value;
    sel.innerHTML = '<option value="">Day</option>';
    for (let i = 1; i <= 5; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = String(i);
      sel.appendChild(opt);
    }
    if (prev && Number(prev) <= 5) sel.value = prev;
  });
}

function loadDayTimes(el, dayNum) {
  const times = (window._currentDayTimes || {})[dayNum] || {};
  buildTimeOptions(el.startTimeSelect, 'Select start time');
  buildTimeOptions(el.endTimeSelect, 'Select end time');
  if (times.startTime) el.startTimeSelect.value = times.startTime;
  if (times.endTime) el.endTimeSelect.value = times.endTime;
}

function saveDayTimes(el, dayNum) {
  if (!dayNum) return;
  window._currentDayTimes = window._currentDayTimes || {};
  window._currentDayTimes[dayNum] = {
    startTime: el.startTimeSelect?.value || '',
    endTime: el.endTimeSelect?.value || ''
  };
}

function setupAdmin(el) {
  if (!el.scheduleSection || !el.saveSessionBtn) return;
  ensureTrainingSessionActionButtons(el);
  syncTrainingSessionActionButtons(el);

  // Wire dual filter dropdowns for admin tables
  const typeFilter = document.getElementById('adminTrainingTypeFilter');
  if (typeFilter) {
    typeFilter.addEventListener('change', () => {
      activeAdminTypeFilter = typeFilter.value || 'all';
      renderAdminTables(el);
    });
  }
  const cityFilter = document.getElementById('adminTrainingCityFilter');
  if (cityFilter) {
    cityFilter.addEventListener('change', () => {
      activeAdminCityFilter = cityFilter.value || 'all';
      renderAdminTables(el);
    });
  }

  buildTimeOptions(el.startTimeSelect, 'Select start time');
  buildTimeOptions(el.endTimeSelect, 'Select end time');
  window._currentDayTimes = {};

  // Multi-day checkbox toggle
  if (el.multiDayCheckbox) {
    // Ensure unchecked on page load
    el.multiDayCheckbox.checked = false;
    setMultiDayUI(el, false);

    el.multiDayCheckbox.addEventListener('change', () => {
      const isMultiDay = el.multiDayCheckbox.checked;
      setMultiDayUI(el, isMultiDay);
      window._currentDayTimes = {};
      if (isMultiDay) {
        updateDaySelects(el);
      } else {
        if (el.startTimeSelect) el.startTimeSelect.value = '';
        if (el.endTimeSelect) el.endTimeSelect.value = '';
        if (el.startDaySelect) el.startDaySelect.value = '';
        if (el.endDaySelect) el.endDaySelect.value = '';
      }
    });
  }

  // Day selector sync: when either changes, sync both and load that day's times
  function onDayChange(changedSel, otherSel) {
    const prev = otherSel._prevDay;
    if (prev) saveDayTimes(el, prev);
    const day = changedSel.value;
    otherSel.value = day;
    changedSel._prevDay = day;
    otherSel._prevDay = day;
    if (day) {
      loadDayTimes(el, day);
    } else {
      if (el.startTimeSelect) el.startTimeSelect.value = '';
      if (el.endTimeSelect) el.endTimeSelect.value = '';
    }
  }

  if (el.startDaySelect) {
    el.startDaySelect.addEventListener('change', () => onDayChange(el.startDaySelect, el.endDaySelect));
  }
  if (el.endDaySelect) {
    el.endDaySelect.addEventListener('change', () => onDayChange(el.endDaySelect, el.startDaySelect));
  }

  el.saveSessionBtn.addEventListener('click', () => {
    handleSaveSession(el);
  });

  document.getElementById('deleteTrainingSessionBtn')?.addEventListener('click', () => {
    if (selectedAdminSessionId) handleDeleteSessionClick(selectedAdminSessionId, el);
  });

  document.getElementById('undoTrainingSessionBtn')?.addEventListener('click', async () => {
    await undoLastTrainingAction(el);
  });
}

let rosterEmployeeSuggestionsCache = [];

function normalizeRosterEmployeeOption(employee) {
  const normalized = mergeTrainingEmployeeSources(employee);
  return {
    id: normalized.id || normalized.employeeId || normalized.email || '',
    employeeId: normalized.employeeId || normalized.id || normalized.email || '',
    email: normalized.email || '',
    username: normalized.username || '',
    firstName: normalized.firstName || normalized.name || '',
    lastName: normalized.lastName || '',
    homePool: normalized.homePool || normalized.pool || '',
    phone: normalized.phone || '',
  };
}

function setRosterEmployeeSuggestionsCache(employees) {
  if (!Array.isArray(employees)) return;
  rosterEmployeeSuggestionsCache = employees
    .map(normalizeRosterEmployeeOption)
    .filter((employee) => employee.firstName || employee.lastName || employee.email);
}

function getRosterEmployeeSuggestions() {
  const sharedEmployees = Array.isArray(window.poolProEmployeesData)
    ? window.poolProEmployeesData
    : (Array.isArray(window.poolProEmployees) ? window.poolProEmployees : null);
  if (sharedEmployees) {
    setRosterEmployeeSuggestionsCache(sharedEmployees);
  }
  return rosterEmployeeSuggestionsCache;
}

window.addEventListener('poolpro:employees-loaded', (event) => {
  setRosterEmployeeSuggestionsCache(event.detail?.employees || []);
});

function findRosterEmployee(firstName, lastName, email) {
  const cleanFirst = normalizeTrainingIdentityKey(firstName);
  const cleanLast = normalizeTrainingIdentityKey(lastName);
  const cleanEmail = normalizeTrainingIdentityKey(email);
  const employees = getRosterEmployeeSuggestions();
  if (cleanEmail) {
    const byEmail = employees.find((employee) => [
      employee.email,
      employee.employeeId,
      employee.id,
      employee.username,
    ].map(normalizeTrainingIdentityKey).some((key) => key && key === cleanEmail));
    if (byEmail) return byEmail;
  }
  if (cleanLast) {
    return employees.find((employee) => {
      const employeeLast = normalizeTrainingIdentityKey(employee.lastName);
      const employeeFirst = normalizeTrainingIdentityKey(employee.firstName);
      return employeeLast === cleanLast && (!cleanFirst || employeeFirst.startsWith(cleanFirst) || cleanFirst.startsWith(employeeFirst));
    }) || null;
  }
  return null;
}

function resolveRosterAttendee(attendee) {
  const employee = findRosterEmployee(
    attendee?.firstName || attendee?.name || '',
    attendee?.lastName || '',
    attendee?.email || attendee?.employeeId || attendee?.id || attendee?.username || ''
  );
  return mergeTrainingEmployeeSources(attendee, employee);
}

function backfillRosterAttendee(attendee, resolved) {
  let changed = false;
  ['firstName', 'lastName', 'homePool', 'phone', 'email', 'employeeId', 'username'].forEach((key) => {
    if (attendee[key] || !resolved[key]) return;
    attendee[key] = resolved[key];
    changed = true;
  });
  if (!attendee.name && resolved.firstName) {
    attendee.name = resolved.firstName;
    changed = true;
  }
  return changed;
}

function openRosterModal(sessionId) {
  const session = trainingSessions.find(s => s.id === sessionId);
  if (!session) return;

  const modal = document.getElementById('attendanceModal');
  const tbody = document.getElementById('attendanceTableBody');
  if (!modal || !tbody) return;

  let selectedRosterEmployee = null;

  function renderRosterRows() {
    tbody.innerHTML = '';
    if (!Array.isArray(session.attendees)) session.attendees = [];
    const attendees = session.attendees;

    if (!attendees.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="6" style="text-align:center;color:#999;">No attendees yet.</td>';
      tbody.appendChild(tr);
      return;
    }

    let rosterChanged = false;
    attendees.forEach((a, idx) => {
      const resolvedAttendee = resolveRosterAttendee(a);
      rosterChanged = backfillRosterAttendee(a, resolvedAttendee) || rosterChanged;
      const tr = document.createElement('tr');

      const deleteTd = document.createElement('td');
      deleteTd.className = 'attendance-delete-cell';
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'attendance-row-delete-btn';
      deleteBtn.setAttribute('aria-label', `Remove ${a.firstName || a.name || 'participant'} from roster`);
      deleteBtn.textContent = 'X';
      deleteBtn.addEventListener('click', () => {
        attendees.splice(idx, 1);
        saveSessions();
        renderRosterRows();
      });
      deleteTd.appendChild(deleteBtn);
      tr.appendChild(deleteTd);

      // Text cells: Preferred First Name, Last Name, Home Pool, Phone Number
      const cellValues = [
        resolvedAttendee.firstName || resolvedAttendee.name || '',  // Preferred First Name
        resolvedAttendee.lastName || '',                            // Last Name
        resolvedAttendee.homePool || resolvedAttendee.pool || '',   // Home Pool
        resolvedAttendee.phone || ''                                // Phone Number
      ];
      cellValues.forEach(val => {
        const td = document.createElement('td');
        td.textContent = val;
        tr.appendChild(td);
      });

      // Attendance checkbox
      const cbTd = document.createElement('td');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'market-filter-checkbox';
      cb.checked = !!a.attended;
      cb.addEventListener('change', () => {
        a.attended = cb.checked;
        saveSessions();
      });
      cbTd.appendChild(cb);
      tr.appendChild(cbTd);
      tbody.appendChild(tr);
    });
    if (rosterChanged) saveSessions();
  }

  renderRosterRows();

  const firstNameInput = document.getElementById('attendanceAddFirstName');
  const emailInput = document.getElementById('attendanceAddEmployeeId');
  const lastNameInputOriginal = document.getElementById('attendanceAddLastName');
  let lastNameInput = lastNameInputOriginal;
  const suggestionsEl = document.getElementById('attendanceLastNameSuggestions');

  if (lastNameInputOriginal?.parentNode) {
    const clonedLastNameInput = lastNameInputOriginal.cloneNode(true);
    lastNameInputOriginal.parentNode.replaceChild(clonedLastNameInput, lastNameInputOriginal);
    lastNameInput = clonedLastNameInput;
  }

  function hideRosterSuggestions() {
    if (!suggestionsEl) return;
    suggestionsEl.classList.remove('show');
    suggestionsEl.innerHTML = '';
  }

  function chooseRosterEmployee(employee) {
    selectedRosterEmployee = employee;
    if (firstNameInput) firstNameInput.value = employee.firstName || '';
    if (lastNameInput) lastNameInput.value = employee.lastName || '';
    if (emailInput) emailInput.value = employee.email || employee.employeeId || '';
    hideRosterSuggestions();
  }

  function renderRosterSuggestions() {
    if (!suggestionsEl || !lastNameInput) return;
    const query = lastNameInput.value.trim().toLowerCase();
    selectedRosterEmployee = null;
    suggestionsEl.innerHTML = '';
    if (!query) {
      suggestionsEl.classList.remove('show');
      return;
    }

    const matches = getRosterEmployeeSuggestions()
      .filter((employee) => {
        const last = (employee.lastName || '').toLowerCase();
        const first = (employee.firstName || '').toLowerCase();
        return last.includes(query) || first.includes(query);
      })
      .slice(0, 8);

    if (!matches.length) {
      suggestionsEl.classList.remove('show');
      return;
    }

    matches.forEach((employee) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'attendance-suggestion-option';
      const name = [employee.firstName, employee.lastName].filter(Boolean).join(' ');
      const detail = [employee.homePool, employee.email].filter(Boolean).join(' - ');
      option.innerHTML = `<span>${name || employee.email}</span>${detail ? `<small>${detail}</small>` : ''}`;
      option.addEventListener('mousedown', (event) => {
        event.preventDefault();
        chooseRosterEmployee(employee);
      });
      suggestionsEl.appendChild(option);
    });
    suggestionsEl.classList.add('show');
  }

  lastNameInput?.addEventListener('input', renderRosterSuggestions);
  lastNameInput?.addEventListener('focus', renderRosterSuggestions);
  lastNameInput?.addEventListener('blur', () => window.setTimeout(hideRosterSuggestions, 150));

  // Wire Add/Save button - replace node to clear previous listeners
  const oldAddBtn = document.getElementById('attendanceAddBtn');
  if (oldAddBtn) {
    const newAddBtn = oldAddBtn.cloneNode(true);
    oldAddBtn.parentNode.replaceChild(newAddBtn, oldAddBtn);
    newAddBtn.addEventListener('click', () => {
      if (!Array.isArray(session.attendees)) session.attendees = [];
      const firstName = document.getElementById('attendanceAddFirstName')?.value.trim() || '';
      const typedLastName = document.getElementById('attendanceAddLastName')?.value.trim() || '';
      const emailVal = (document.getElementById('attendanceAddEmployeeId')?.value.trim() || '').toLowerCase();
      if (!firstName && !typedLastName && !emailVal) return;

      const empRec = selectedRosterEmployee
        || (emailVal && window.getEmployeeByEmail ? window.getEmployeeByEmail(emailVal) : null)
        || findRosterEmployee(firstName, typedLastName, emailVal);
      const lastName = empRec?.lastName || typedLastName || '';
      const homePool = empRec?.homePool || '';
      const phone = empRec?.phone || '';

      const entry = {
        id: 'att_' + Math.random().toString(36).slice(2, 9),
        firstName: empRec?.firstName || firstName,
        lastName,
        homePool,
        phone,
        email: emailVal || empRec?.email || '',
        employeeId: emailVal || empRec?.employeeId || empRec?.email || '',
        attended: false,
        signupTimestamp: new Date().toISOString()
      };

      session.attendees.push(entry);
      saveSessions();
      renderRosterRows();
      selectedRosterEmployee = null;
      hideRosterSuggestions();
      ['attendanceAddFirstName', 'attendanceAddLastName', 'attendanceAddEmployeeId']
        .forEach(fid => { const fEl = document.getElementById(fid); if (fEl) fEl.value = ''; });
    });
  }

  modal.style.display = 'flex';

  // Close button - replace node to clear previous listeners
  const oldClose = document.getElementById('attendanceModalClose');
  if (oldClose) {
    const newClose = oldClose.cloneNode(true);
    oldClose.parentNode.replaceChild(newClose, oldClose);
    newClose.addEventListener('click', () => { modal.style.display = 'none'; });
  }

  // Close on overlay click (click outside modal content)
  const onOverlayClick = (evt) => {
    if (evt.target === modal) {
      modal.style.display = 'none';
      modal.removeEventListener('click', onOverlayClick);
    }
  };
  modal.removeEventListener('click', onOverlayClick);
  modal.addEventListener('click', onOverlayClick);
}

// ---------- Lifeguard signup handlers ----------

function normalizeTrainingIdentityKey(value) {
  return (value || '').toString().trim().toLowerCase();
}

function mergeTrainingEmployeeSources(...sources) {
  return sources.filter(Boolean).reduce((merged, source) => {
    const normalized = {
      id: source.id || source.employeeId || '',
      employeeId: source.employeeId || source.id || source.email || '',
      email: source.email || source.employeeEmail || source.authEmail || '',
      username: source.username || '',
      firstName: source.firstName || source.name || '',
      lastName: source.lastName || '',
      homePool: source.homePool || source.pool || '',
      phone: source.phone || '',
    };
    Object.entries(normalized).forEach(([key, value]) => {
      const cleanValue = (value || '').toString().trim();
      if (cleanValue) merged[key] = cleanValue;
    });
    return merged;
  }, {});
}

function getStoredTrainingEmployeeRecord() {
  let storedSession = {};
  try {
    storedSession = JSON.parse(localStorage.getItem('poolproLifeguardSession') || '{}') || {};
  } catch (_) {
    storedSession = {};
  }

  return mergeTrainingEmployeeSources(storedSession, {
    email: sessionStorage.getItem('chemlogEmployeeEmail') || '',
    employeeId: sessionStorage.getItem('chemlogEmployeeId') || '',
    username: sessionStorage.getItem('chemlogEmployeeUsername') || '',
    firstName: sessionStorage.getItem('chemlogEmployeeFirstName') || '',
    lastName: sessionStorage.getItem('chemlogEmployeeLastName') || '',
    homePool: sessionStorage.getItem('chemlogEmployeeHomePool') || '',
    phone: sessionStorage.getItem('chemlogEmployeePhone') || '',
  });
}

function getCurrentTrainingEmployeeRecord() {
  const stored = getStoredTrainingEmployeeRecord();
  const helperRecord = typeof window.getCurrentEmployeeRecord === 'function'
    ? window.getCurrentEmployeeRecord()
    : null;
  const lookupKey = helperRecord?.email || helperRecord?.employeeId || stored.email || stored.employeeId || stored.username;
  const tableRecord = lookupKey && typeof window.getEmployeeByID === 'function'
    ? window.getEmployeeByID(lookupKey)
    : null;
  return mergeTrainingEmployeeSources(stored, helperRecord, tableRecord);
}

function getTrainingEmployeePrimaryKey(employee) {
  return normalizeTrainingIdentityKey(employee.email || employee.employeeId || employee.id || employee.username);
}

function getTrainingEmployeeMarket(employee) {
  const homePool = (employee.homePool || '').trim();
  if (!homePool) return '';
  if (typeof window.getPoolMarketByName === 'function') {
    return window.getPoolMarketByName(homePool) || '';
  }
  return '';
}

function refreshSignupMarketFromEmployee(el) {
  const employee = getCurrentTrainingEmployeeRecord();
  activeSignupMarket = getTrainingEmployeeMarket(employee);
  if (el?.trainingMonthSelect?.value) {
    updateSessionSelectForType(el.trainingMonthSelect.value, el);
  }
}

function waitForCurrentTrainingEmployeeRecord(timeoutMs = 4000) {
  const initial = getCurrentTrainingEmployeeRecord();
  if (getTrainingEmployeePrimaryKey(initial) && (initial.homePool || window.poolProEmployeesLoaded)) {
    return Promise.resolve(initial);
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      window.removeEventListener('poolpro:employees-loaded', finish);
      resolve(getCurrentTrainingEmployeeRecord());
    };
    window.addEventListener('poolpro:employees-loaded', finish, { once: true });
    timeoutId = window.setTimeout(finish, timeoutMs);
    if (window.poolProEmployeesReady && typeof window.poolProEmployeesReady.then === 'function') {
      window.poolProEmployeesReady.then(finish).catch(finish);
    }
  });
}

let pendingTrainingSignupSessionId = '';

function getTrainingSignupModalEls() {
  return {
    modal: document.getElementById('trainingSignupConfirmModal'),
    body: document.getElementById('trainingSignupConfirmBody'),
    actions: document.getElementById('trainingSignupConfirmActions'),
    confirmBtn: document.getElementById('trainingSignupConfirmBtn'),
    closeBtn: document.getElementById('trainingSignupModalClose'),
  };
}

function closeTrainingSignupModal() {
  const { modal, confirmBtn } = getTrainingSignupModalEls();
  pendingTrainingSignupSessionId = '';
  if (confirmBtn) confirmBtn.disabled = false;
  if (modal) modal.style.display = 'none';
}

function showTrainingSignupModalError(message) {
  const { body } = getTrainingSignupModalEls();
  if (!body) return;
  const existing = body.querySelector('.training-signup-modal-error');
  if (existing) existing.remove();
  const banner = document.createElement('div');
  banner.className = 'training-signup-modal-error';
  banner.textContent = message;
  body.prepend(banner);
}

function showTrainingSignupSuccess(session) {
  const { body, actions } = getTrainingSignupModalEls();
  if (!body) return;
  body.innerHTML = `
    <div class="training-signup-success-banner">You are signed up for this training.</div>
    <div class="training-signup-reminder-box">
      <strong>REMINDER!</strong>
      <p>Add this event to your calendar immediately and arrive 5 minutes early. You will not receive email reminders for the event.</p>
    </div>
    <dl class="training-signup-summary-list" aria-label="Signed up training details">
      <div><dt>Training Type</dt><dd>${session.trainingType || ''}</dd></div>
      <div><dt>Date &amp; Time</dt><dd>${getTrainingSessionDateTimeText(session).replace(/\n/g, '<br>')}</dd></div>
      <div><dt>Location</dt><dd>${getTrainingSessionLocationText(session).replace(/\n/g, '<br>')}</dd></div>
    </dl>
  `;
  if (actions) actions.style.display = 'none';
}

function renderTrainingSignupConfirmation(session) {
  const { body, actions, confirmBtn } = getTrainingSignupModalEls();
  if (!body) return;
  const full = isTrainingSessionFull(session);
  body.innerHTML = `
    <p class="training-signup-modal-copy">Confirm that you want to sign up for this training.</p>
    <dl class="training-signup-summary-list">
      <div><dt>Training Type</dt><dd>${session.trainingType || ''}</dd></div>
      <div><dt>Date &amp; Time</dt><dd>${getTrainingSessionDateTimeText(session).replace(/\n/g, '<br>')}</dd></div>
      <div><dt>Location</dt><dd>${getTrainingSessionLocationText(session).replace(/\n/g, '<br>')}</dd></div>
    </dl>
    ${full ? '<div class="training-signup-modal-error">This training is full. Please choose another session.</div>' : ''}
  `;
  if (actions) actions.style.display = '';
  if (confirmBtn) confirmBtn.disabled = full;
}

async function submitTrainingSignupForSession(sessionId, el) {
  const session = trainingSessions.find((s) => s.id === sessionId);
  if (!session) {
    showTrainingSignupModalError('Could not find the selected session. Please try again.');
    return false;
  }

  if (isTrainingSessionFull(session)) {
    showTrainingSignupModalError('Sorry, that session is already full. Please pick another option.');
    renderPublicTables(el);
    return false;
  }

  const { confirmBtn } = getTrainingSignupModalEls();
  if (confirmBtn) confirmBtn.disabled = true;

  try {
    const employeeRecord = await waitForCurrentTrainingEmployeeRecord();
    const resolvedEmployee = mergeTrainingEmployeeSources(
      employeeRecord,
      findRosterEmployee(employeeRecord.firstName, employeeRecord.lastName, employeeRecord.email || employeeRecord.employeeId || employeeRecord.username)
    );
    const employeeId = getTrainingEmployeePrimaryKey(resolvedEmployee);
    const firstName = resolvedEmployee.firstName || '';
    const lastName = resolvedEmployee.lastName || '';
    const homePool = resolvedEmployee.homePool || '';
    const phone = resolvedEmployee.phone || '';
    const email = normalizeTrainingIdentityKey(resolvedEmployee.email || (employeeId.includes('@') ? employeeId : ''));

    if (!employeeId) {
      showTrainingSignupModalError('PoolPro could not identify your employee profile. Please log out and sign in again.');
      return false;
    }

    const alreadySignedUp =
      Array.isArray(session.attendees) &&
      session.attendees.some((att) => {
        const attendeeKey = normalizeTrainingIdentityKey(att.employeeId || att.email || att.username || att.id);
        return attendeeKey && attendeeKey === employeeId;
      });

    if (alreadySignedUp) {
      showTrainingSignupModalError('You are already signed up for this session.');
      return false;
    }

    const attendee = {
      id: 'att_' + Math.random().toString(36).slice(2, 9),
      employeeId,
      email,
      username: resolvedEmployee.username || '',
      name: firstName,
      firstName,
      lastName,
      homePool,
      phone,
      signupTimestamp: new Date().toISOString()
    };

    if (!Array.isArray(session.attendees)) {
      session.attendees = [];
    }
    session.attendees.push(attendee);

    saveSessions();

    if (window.addTrainingSignupToSchedule) {
      window.addTrainingSignupToSchedule({
        sessionId,
        firstName,
        lastName,
        homePool,
        email,
        employeeId,
        username: resolvedEmployee.username || '',
        phone
      });
    }

    renderPublicTables(el);
    showTrainingSignupSuccess(session);
    return true;
  } finally {
    if (confirmBtn) confirmBtn.disabled = false;
  }
}

function openTrainingSignupModal(sessionId, el) {
  const session = trainingSessions.find((s) => s.id === sessionId);
  const { modal } = getTrainingSignupModalEls();
  if (!session || !modal) return;
  pendingTrainingSignupSessionId = sessionId;
  renderTrainingSignupConfirmation(session);
  modal.style.display = 'flex';
}

function setupSignup(el) {
  refreshSignupMarketFromEmployee(el);
  window.addEventListener('poolpro:employees-loaded', () => refreshSignupMarketFromEmployee(el));
  window.addEventListener('poolpro:pools-ready', () => refreshSignupMarketFromEmployee(el));
  [el.guardEmployeeIdInput, el.guardNameInput, el.guardPoolInput, el.trainingMonthSelect, el.trainingSessionSelect]
    .filter(Boolean)
    .forEach((field) => {
      field.required = false;
      field.removeAttribute('required');
    });

  const { modal, confirmBtn, closeBtn } = getTrainingSignupModalEls();
  confirmBtn?.addEventListener('click', async () => {
    if (!pendingTrainingSignupSessionId) return;
    await submitTrainingSignupForSession(pendingTrainingSignupSessionId, el);
  });
  closeBtn?.addEventListener('click', closeTrainingSignupModal);
  modal?.addEventListener('click', (event) => {
    if (event.target === modal) closeTrainingSignupModal();
  });
}

// ---------- Lifeguard / Supervisor view switching ----------

function updateTrainingMenuForView(view) {
  const menuL = document.getElementById('menuLifeguardSignup');
  const menuS = document.getElementById('menuSupervisorLogin');

  if (!menuL || !menuS) return;

  if (view === 'lifeguard') {
    menuL.classList.add('hidden');
    menuS.classList.remove('hidden');
  } else if (view === 'supervisor') {
    menuL.classList.remove('hidden');
    menuS.classList.add('hidden');
  }
}

function showLifeguardView() {
  const guardCard = document.querySelector('.training-card:not(#trainingAdminPanel .training-card)');
  const adminPanel = document.getElementById('trainingAdminPanel');
  const title = document.getElementById('mainPageTitle');

  if (guardCard) {
    guardCard.classList.remove('hidden');
    guardCard.style.display = 'block';
  }

  if (adminPanel) {
    adminPanel.classList.add('hidden');
    adminPanel.style.display = 'none';
  }

  if (title) title.textContent = 'Training Signup';

  updateTrainingMenuForView('lifeguard');
}

function showSupervisorView() {
  const guardCard = document.querySelector('.training-card:not(#trainingAdminPanel .training-card)');
  const adminPanel = document.getElementById('trainingAdminPanel');
  const title = document.getElementById('mainPageTitle');

  if (guardCard) {
    guardCard.classList.add('hidden');
    guardCard.style.display = 'none';
  }

  if (adminPanel) {
    adminPanel.classList.remove('hidden');
    adminPanel.style.display = 'block';
    adminPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (title) title.textContent = 'Training Setup';

  updateTrainingMenuForView('supervisor');
}

window.showLifeguardView = showLifeguardView;
window.showSupervisorView = showSupervisorView;

// ---------- Supervisor login handlers ----------

function setupLogin(el) {
  const modal = el.loginModal;
  const openBtn = el.openLoginBtn; // optional
  const closeBtn = el.closeLoginBtn;
  const form = el.loginForm;
  const messageEl = el.loginMessage;
  const panel = el.trainingAdminPanel;

  if (!modal || !form || !panel) return;

  function setLoggedIn(loggedIn) {
    try {
      localStorage.setItem(LOGIN_KEY, loggedIn ? 'true' : 'false');
    } catch (err) {
      console.error('Unable to persist supervisor login flag:', err);
    }

    panel.style.display = loggedIn ? 'block' : 'none';

    if (loggedIn) {
      if (typeof showSupervisorView === 'function') showSupervisorView();
    } else {
      if (typeof showLifeguardView === 'function') showLifeguardView();
    }

    // Refresh dropdown visibility now that login state changed
    if (typeof window.setupDropdownVisibility === 'function') {
      window.setupDropdownVisibility();
    }

    if (openBtn) {
      openBtn.textContent = loggedIn ? 'Supervisor Panel' : 'Supervisor Login';
    }

    if (messageEl) {
      messageEl.textContent = '';
      messageEl.classList.remove('success', 'error');
    }
  }

  function openModal() {
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('visible'));
    if (messageEl) {
      messageEl.textContent = '';
      messageEl.classList.remove('success', 'error');
    }
  }

  function closeModal() {
    modal.classList.remove('visible');
    setTimeout(() => {
      modal.style.display = 'none';
    }, 200);
  }

  setLoggedIn(hasFreshSupervisorSession());

  if (openBtn) {
    openBtn.addEventListener('click', () => {
      if (hasFreshSupervisorSession()) {
        if (typeof showSupervisorView === 'function') {
          showSupervisorView();
        } else {
          panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } else {
        openModal();
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      closeModal();
    });
  }

  modal.addEventListener('click', (evt) => {
    if (evt.target === modal) {
      closeModal();
    }
  });

  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape' && modal.style.display === 'flex') {
      closeModal();
    }
  });

  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const email =
      document.getElementById('trainingUsername')?.value.trim() || '';
    const password =
      document.getElementById('trainingPassword')?.value.trim() || '';

    if (!messageEl) return;
    messageEl.textContent = '';
    messageEl.classList.remove('success', 'error');

    if (!email || !password) {
      messageEl.textContent = 'Please enter your email and password.';
      messageEl.classList.add('error');
      return;
    }

    try {
      if (window.supervisorSignIn) {
        await window.supervisorSignIn(email, password);
      } else {
        throw new Error('Auth service not ready. Please refresh and try again.');
      }
      setLoggedIn(true);
      closeModal();
    } catch (err) {
      const msg = err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found'
        ? 'Invalid email or password.'
        : (err.message || 'Login failed.');
      messageEl.textContent = msg;
      messageEl.classList.add('error');
    }
  });
}

function setupPublicFilters(el) {
  const typeFilter = document.getElementById('publicTrainingTypeFilter');
  if (typeFilter) {
    typeFilter.addEventListener('change', () => {
      activePublicTypeFilter = typeFilter.value || 'all';
      renderPublicTables(el);
    });
  }
  const cityFilter = document.getElementById('publicTrainingCityFilter');
  if (cityFilter) {
    cityFilter.addEventListener('change', () => {
      activePublicCityFilter = cityFilter.value || 'all';
      renderPublicTables(el);
    });
  }
}

// ---------- Bootstrapping ----------

document.addEventListener('DOMContentLoaded', async () => {
  normalizeTrainingHeaderCopy();
  wrapResponsiveTables();
  observeResponsiveTables();
  // Set up login + basic UI wiring
  const el = {
    trainingAdminPanel: document.getElementById('trainingAdminPanel'),
    openLoginBtn: document.getElementById('openTrainingLoginBtn'),
    loginModal: document.getElementById('trainingLoginModal'),
    loginForm: document.getElementById('trainingLoginForm'),
    loginMessage: document.getElementById('trainingLoginMessage'),
    closeLoginBtn: document.getElementById('closeTrainingLoginModal'),

    signupForm: document.getElementById('trainingSignupForm'),
    signupMessage: document.getElementById('signupMessage'),
    trainingMonthSelect: document.getElementById('trainingMonth'),
    trainingSessionSelect: document.getElementById('trainingSession'),
    guardEmployeeIdInput: document.getElementById('guardEmployeeId'),
    guardNameInput: document.getElementById('guardName'),
    guardPoolInput: document.getElementById('guardPool'),

    marketSelect: document.getElementById('trainingMarketSelect'),
    trainingTypeInput: document.getElementById('trainingTypeInput'),
    dateInput: document.getElementById('trainingDateInput'),
    multiDayCheckbox: document.getElementById('multiDayCheckbox'),
    dateRangeGroup: document.getElementById('trainingDateRangeGroup'),
    startDateInput: document.getElementById('trainingStartDateInput'),
    endDateInput: document.getElementById('trainingEndDateInput'),
    startDaySelect: document.getElementById('trainingStartDaySelect'),
    endDaySelect: document.getElementById('trainingEndDaySelect'),
    startTimeSelect: document.getElementById('trainingStartTimeSelect'),
    endTimeSelect: document.getElementById('trainingEndTimeSelect'),
    poolSelect: document.getElementById('trainingPoolSelect'),
    addressInput: document.getElementById('trainingAddressInput'),
    capacityInput: document.getElementById('trainingCapacityInput'),
    capacityInfo: document.getElementById('trainingCapacityInfo'),
    notesInput: document.getElementById('trainingNotesInput'),
    sessionIdInput: document.getElementById('trainingSessionId'),
    saveSessionBtn: document.getElementById('saveTrainingSessionBtn'),
    scheduleSection: document.getElementById('scheduleTrainingsSection'),
    adminMessage: document.getElementById('adminMessage'),

    adminTablesContainer: document.getElementById('adminScheduledTablesContainer'),
    publicTablesContainer: document.getElementById('publicScheduledTablesContainer')
  };

  // Numeric-only Capacity
  const capacityInput = el.capacityInput;
  if (capacityInput) {
    capacityInput.addEventListener('input', () => {
      capacityInput.value = capacityInput.value.replace(/\D/g, '');
    });
  }
  initTrainingNotesEditor(el.notesInput);

  // Load sessions - prefer Firestore (shared/persistent), fall back to localStorage
  if (window.loadTrainingSessionsFromFirestore) {
    const firestoreSessions = await window.loadTrainingSessionsFromFirestore();
    if (firestoreSessions && firestoreSessions.length > 0) {
      trainingSessions = firestoreSessions.map(normalizeSession);
      // Keep localStorage in sync
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(trainingSessions)); } catch (_) {}
    } else {
      trainingSessions = loadSessions();
      // If localStorage has sessions but Firestore doesn't, push them up
      if (trainingSessions.length > 0 && window.syncTrainingSessionsToFirestore) {
        window.syncTrainingSessionsToFirestore(trainingSessions);
      }
    }
  } else {
    trainingSessions = loadSessions();
  }

  setupLogin(el);
  renderAdminTables(el);
  renderPublicTables(el);
  updateCapacityInfo(null, el);
  setupAdmin(el);
  setupPublicFilters(el);
  setupSignup(el);

  // Initialize the session dropdown based on any pre-selected month
  if (el.trainingMonthSelect && el.trainingMonthSelect.value) {
    updateSessionSelectForType(el.trainingMonthSelect.value, el);
  } else {
    updateSessionSelectForType('', el);
  }

  // Check if we arrived via "Training Setup" from another page
  const adminIntent = sessionStorage.getItem('trainingIntentAdmin');
  if (adminIntent === '1') {
    sessionStorage.removeItem('trainingIntentAdmin');
    // Check all auth sources before showing login modal
    const alreadyAuth = hasFreshSupervisorSession();
    if (alreadyAuth) {
      localStorage.setItem(LOGIN_KEY, 'true');
      showSupervisorView();
    } else {
      const loginModal = document.getElementById('trainingLoginModal');
      if (loginModal) {
        loginModal.style.display = 'flex';
        requestAnimationFrame(() => loginModal.classList.add('visible'));
      }
    }
  } else {
    showLifeguardView();
  }
});

window.addEventListener('load', () => {
  document.body.classList.add('page-loaded');
});
