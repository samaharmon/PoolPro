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
 * ✅ This is the function the console is complaining about.
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

function getMonthKeyFromDateString(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T12:00:00'); // noon to avoid timezone edge cases
  if (Number.isNaN(d.getTime())) return null;
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
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const month = d.toLocaleString(undefined, { month: 'short' });
  const day = d.getDate();
  const year = d.getFullYear();
  return `${month} ${day}, ${year}`;
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
      `${taken} sign‑ups so far. Add a capacity to track remaining spots.`;
    return;
  }

  const remaining = Math.max(capacity - taken, 0);
  el.capacityInfo.textContent =
    `${taken} of ${capacity} spots used • ${remaining} remaining`;
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
      let label = pieces.join(' – ');

      const taken = Array.isArray(session.attendees) ? session.attendees.length : 0;
      const capacity = session.capacity || 0;
      const remaining = capacity ? Math.max(capacity - taken, 0) : null;

      if (capacity) {
        label += ` (${taken}/${capacity} spots filled${remaining === 0 ? ' – FULL' : ''})`;
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

function handleSaveSession(el) {
  const trainingType = el.trainingTypeInput?.value || '';
  const market = el.marketSelect?.value || '';
  const isMultiDay = el.multiDayCheckbox?.checked || false;
  const pool = el.poolSelect?.value?.trim() || '';
  const address = el.addressInput?.value?.trim() || '';
  const capacityRaw = el.capacityInput?.value?.trim() || '';
  const notes = el.notesInput?.value?.trim() || '';
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
        `Capacity (${capacity}) cannot be less than current sign‑ups (${taken}).`;
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
  renderAdminTables(el);
  if (el.trainingMonthSelect && el.trainingMonthSelect.value) {
    updateSessionSelectForType(el.trainingMonthSelect.value, el);
  }

  updateCapacityInfo(targetSession, el);

  messageEl.textContent = 'Training session saved.';
  messageEl.classList.add('success');

  // Clear the form after saving
  if (el.marketSelect) el.marketSelect.value = '';
  if (el.trainingTypeInput) el.trainingTypeInput.value = '';
  if (el.dateInput) el.dateInput.value = '';
  if (el.startTimeSelect) el.startTimeSelect.value = '';
  if (el.endTimeSelect) el.endTimeSelect.value = '';
  if (el.poolSelect) el.poolSelect.value = '';
  if (el.addressInput) el.addressInput.value = '';
  if (el.capacityInput) el.capacityInput.value = '';
  if (el.notesInput) el.notesInput.value = '';
  if (el.sessionIdInput) el.sessionIdInput.value = '';
  // Reset multi-day fields
  if (el.multiDayCheckbox) el.multiDayCheckbox.checked = false;
  if (el.startDateInput) el.startDateInput.value = '';
  if (el.endDateInput) el.endDateInput.value = '';
  if (el.startDaySelect) el.startDaySelect.value = '';
  if (el.endDaySelect) el.endDaySelect.value = '';
  window._currentDayTimes = {};
  setMultiDayUI(el, false);
  updateCapacityInfo(null, el);
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
  if (el.notesInput) el.notesInput.value = session.notes || '';

  updateCapacityInfo(session, el);
  if (el.dateInput && !isMultiDay) el.dateInput.focus();
}

function handleDeleteSessionClick(sessionId, el) {
  const idx = trainingSessions.findIndex((s) => s.id === sessionId);
  if (idx === -1) return;

  const session = trainingSessions[idx];
  const taken = Array.isArray(session.attendees) ?
    session.attendees.length
    : 0;

  const confirmMsg = `Delete ${formatDateNice(session.date)} ${
    session.time || ''
  } at ${session.pool || 'this location'}?\n\nThis will also remove ${taken} existing sign‑up(s).`;
  if (!window.confirm(confirmMsg)) {
    return;
  }

  trainingSessions.splice(idx, 1);
  saveSessions();
  renderAdminTables(el);

  if (el.sessionIdInput && el.sessionIdInput.value === sessionId) {
    el.sessionIdInput.value = '';
    if (el.marketSelect) el.marketSelect.value = '';
    if (el.dateInput) el.dateInput.value = '';
    if (el.startTimeSelect) el.startTimeSelect.value = '';
    if (el.endTimeSelect) el.endTimeSelect.value = '';
    if (el.poolSelect) el.poolSelect.value = '';
    if (el.addressInput) el.addressInput.value = '';
    if (el.capacityInput) el.capacityInput.value = '';
    if (el.notesInput) el.notesInput.value = '';
    if (el.multiDayCheckbox) el.multiDayCheckbox.checked = false;
    if (el.startDateInput) el.startDateInput.value = '';
    if (el.endDateInput) el.endDateInput.value = '';
    window._currentDayTimes = {};
    setMultiDayUI(el, false);
    updateCapacityInfo(null, el);
  }

  if (el.trainingMonthSelect && el.trainingMonthSelect.value) {
    updateSessionSelectForType(el.trainingMonthSelect.value, el);
  }
}

function getDayDate(startDate, dayNum) {
  if (!startDate) return '';
  const d = new Date(startDate + 'T12:00:00');
  d.setDate(d.getDate() + dayNum - 1);
  return d.toISOString().split('T')[0];
}

function buildScheduleTableSection(sessions, isAdmin) {
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
    toggle.innerHTML = `<span class="emp-metrics-arrow">▸</span><span>${MONTH_LABELS[mIdx]}</span>`;
    section.appendChild(toggle);

    const contentWrap = document.createElement('div');
    contentWrap.className = 'emp-metrics-body hidden';
    const stateMap = isAdmin ? adminScheduleOpenState : publicScheduleOpenState;
    if (stateMap[mKey]) {
      contentWrap.classList.remove('hidden');
      toggle.querySelector('.emp-metrics-arrow').textContent = '▾';
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

      // Col 1: Training Type
      const typeCell = document.createElement('td');
      typeCell.textContent = session.trainingType || '';
      row.appendChild(typeCell);

      // Col 2: Date & Time
      const dateTimeCell = document.createElement('td');
      if (session.multiDay && session.dayTimes && Object.keys(session.dayTimes).length > 0) {
        const dayNums = Object.keys(session.dayTimes).sort((a, b) => Number(a) - Number(b));
        const parts = dayNums.map((dayNum, idx) => {
          const dt = session.dayTimes[dayNum];
          const dayDate = getDayDate(session.startDate || session.date, Number(dayNum));
          const timeRange = formatTimeRange(dt.startTime, dt.endTime);
          const sep = idx > 0 ? ' class="multi-day-day-sep"' : '';
          return `<div${sep} class="multi-day-row"><strong>Day ${dayNum}:</strong> ${formatDateNice(dayDate)}${timeRange ? ` / ${timeRange}` : ''}</div>`;
        });
        dateTimeCell.innerHTML = parts.join('');
      } else {
        const timeRange = formatTimeRange(session.startTime, session.endTime);
        dateTimeCell.innerHTML = formatDateNice(session.date) + (timeRange ? `<br>${timeRange}` : '');
      }
      row.appendChild(dateTimeCell);

      // Col 3: Location (14px, no smaller sub-text)
      const locCell = document.createElement('td');
      const locParts = [session.pool, session.address].filter(Boolean);
      locCell.innerHTML = locParts.join('<br>');
      row.appendChild(locCell);

      // Col 4: Notes
      const notesCell = document.createElement('td');
      notesCell.textContent = session.notes || '';
      row.appendChild(notesCell);

      // Col 5: Spots Filled
      const capCell = document.createElement('td');
      const taken = Array.isArray(session.attendees) ? session.attendees.length : 0;
      const capacity = session.capacity || 0;
      capCell.textContent = capacity ? `${taken} / ${capacity}` : `${taken} / —`;
      row.appendChild(capCell);

      if (capacity && taken >= capacity) row.classList.add('session-row-full');

      if (isAdmin) {
        const actionsCell = document.createElement('td');
        actionsCell.classList.add('actions-cell');

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.textContent = 'Edit';
        editBtn.className = 'editAndSave edit-training-btn';
        editBtn.dataset.sessionId = session.id;
        actionsCell.appendChild(editBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.textContent = 'Delete';
        deleteBtn.className = 'editAndSave danger-button delete-training-btn';
        deleteBtn.dataset.sessionId = session.id;
        deleteBtn.style.marginTop = '6px';
        actionsCell.appendChild(deleteBtn);

        const rosterBtn = document.createElement('button');
        rosterBtn.type = 'button';
        rosterBtn.textContent = 'Roster';
        rosterBtn.className = 'editAndSave roster-training-btn';
        rosterBtn.dataset.sessionId = session.id;
        rosterBtn.style.marginTop = '6px';
        actionsCell.appendChild(rosterBtn);

        row.appendChild(actionsCell);
      }

      tbody.appendChild(row);
    }

    table.appendChild(tbody);
    contentWrap.appendChild(table);
    toggle.addEventListener('click', () => {
      contentWrap.classList.toggle('hidden');
      const open = !contentWrap.classList.contains('hidden');
      stateMap[mKey] = open;
      toggle.querySelector('.emp-metrics-arrow').textContent = open ? '▾' : '▸';
    });
    section.appendChild(contentWrap);
    fragment.appendChild(section);
  });

  return fragment;
}

function applyFiltersAndSort(typeFilter, cityFilter) {
  let filtered = trainingSessions;
  if (typeFilter !== 'all') filtered = filtered.filter(s => s.trainingType === typeFilter);
  if (cityFilter !== 'all') filtered = filtered.filter(s => s.market === cityFilter);
  return [...filtered].sort((a, b) => {
    if (a.date !== b.date) return (a.date || '').localeCompare(b.date || '');
    return (a.startTime || '').localeCompare(b.startTime || '');
  });
}

function renderAdminTables(el) {
  const container = el.adminTablesContainer;
  if (!container) return;

  const sorted = applyFiltersAndSort(activeAdminTypeFilter, activeAdminCityFilter);

  container.innerHTML = '';
  if (!sorted.length) {
    container.innerHTML = '<p style="text-align:center;color:#888;font-style:italic;margin:20px 0;">No trainings fit these filters.</p>';
    return;
  }

  container.appendChild(buildScheduleTableSection(sorted, true));
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

  container.appendChild(buildScheduleTableSection(sorted, false));
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

  el.scheduleSection.addEventListener('click', (evt) => {
    const editBtn = evt.target.closest('.edit-training-btn');
    if (editBtn) {
      const id = editBtn.dataset.sessionId;
      if (id) handleEditSessionClick(id, el);
      return;
    }

    const deleteBtn = evt.target.closest('.delete-training-btn');
    if (deleteBtn) {
      const id = deleteBtn.dataset.sessionId;
      if (id) handleDeleteSessionClick(id, el);
      return;
    }

    const rosterBtn = evt.target.closest('.roster-training-btn');
    if (rosterBtn) {
      const id = rosterBtn.dataset.sessionId;
      if (id) openRosterModal(id);
    }
  });
}

function openRosterModal(sessionId) {
  const session = trainingSessions.find(s => s.id === sessionId);
  if (!session) return;

  const modal = document.getElementById('attendanceModal');
  const tbody = document.getElementById('attendanceTableBody');
  if (!modal || !tbody) return;

  let editingAttendeeIdx = -1;

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

    attendees.forEach((a, idx) => {
      const tr = document.createElement('tr');

      // Text cells: Preferred First Name, Last Name, Home Pool, Phone Number
      const cellValues = [
        a.firstName || a.name || '',  // Preferred First Name
        a.lastName || '',              // Last Name (looked up)
        a.homePool || a.pool || '',   // Home Pool
        a.phone || ''                  // Phone Number
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

      // Edit + Delete buttons
      const actionsTd = document.createElement('td');
      actionsTd.className = 'actions-cell';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Edit';
      editBtn.className = 'editAndSave edit-training-btn';
      editBtn.addEventListener('click', () => {
        editingAttendeeIdx = idx;
        document.getElementById('attendanceAddFirstName').value = a.firstName || a.name || '';
        document.getElementById('attendanceAddEmployeeId').value = a.email || a.employeeId || '';
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = 'Delete';
      deleteBtn.className = 'editAndSave danger-button delete-training-btn';
      deleteBtn.style.marginLeft = '4px';
      deleteBtn.addEventListener('click', () => {
        attendees.splice(idx, 1);
        saveSessions();
        renderRosterRows();
      });

      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });
  }

  renderRosterRows();

  // Wire Add/Save button — replace node to clear previous listeners
  const oldAddBtn = document.getElementById('attendanceAddBtn');
  if (oldAddBtn) {
    const newAddBtn = oldAddBtn.cloneNode(true);
    oldAddBtn.parentNode.replaceChild(newAddBtn, oldAddBtn);
    newAddBtn.addEventListener('click', () => {
      if (!Array.isArray(session.attendees)) session.attendees = [];
      const firstName = document.getElementById('attendanceAddFirstName')?.value.trim() || '';
      const emailVal = (document.getElementById('attendanceAddEmployeeId')?.value.trim() || '').toLowerCase();
      if (!firstName && !emailVal) return;

      const base = editingAttendeeIdx >= 0 ? session.attendees[editingAttendeeIdx] : {};

      // Look up employee data by email
      const empRec = window.getEmployeeByEmail ? window.getEmployeeByEmail(emailVal) : null;
      const lastName = empRec?.lastName || base.lastName || '';
      const homePool = empRec?.homePool || base.homePool || '';
      const phone = empRec?.phone || base.phone || '';

      const entry = {
        id: base.id || ('att_' + Math.random().toString(36).slice(2, 9)),
        firstName, lastName, homePool, phone,
        email: emailVal || base.email || '',
        employeeId: emailVal || base.employeeId || '',
        attended: base.attended || false,
        signupTimestamp: base.signupTimestamp || new Date().toISOString()
      };

      if (editingAttendeeIdx >= 0) {
        session.attendees[editingAttendeeIdx] = entry;
        editingAttendeeIdx = -1;
      } else {
        session.attendees.push(entry);
      }

      saveSessions();
      renderRosterRows();
      ['attendanceAddFirstName', 'attendanceAddEmployeeId']
        .forEach(fid => { const fEl = document.getElementById(fid); if (fEl) fEl.value = ''; });
    });
  }

  modal.style.display = 'flex';

  // Close button — replace node to clear previous listeners
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

function setupSignup(el) {
  const form = el.signupForm;
  if (!form || !el.trainingMonthSelect || !el.trainingSessionSelect) return;

  // When the lifeguard picks their home pool, derive the market from the optgroup
  // label and re-filter the session dropdown to that market only.
  if (el.guardPoolInput) {
    el.guardPoolInput.addEventListener('change', () => {
      const select = el.guardPoolInput;
      const selectedOpt = select.options[select.selectedIndex];
      const group = selectedOpt?.parentElement;
      activeSignupMarket = (group && group.tagName === 'OPTGROUP') ? group.label : '';
      updateSessionSelectForType(el.trainingMonthSelect?.value || '', el);
    });
  }

  el.trainingMonthSelect.addEventListener('change', (evt) => {
    const monthKey = evt.target.value || '';
    updateSessionSelectForType(monthKey, el);
  });

  form.addEventListener('submit', (evt) => {
    evt.preventDefault();
    const msgEl = el.signupMessage;
    if (!msgEl) return;

    msgEl.textContent = '';
    msgEl.classList.remove('success', 'error');

    const employeeId = (el.guardEmployeeIdInput?.value.trim() || '').toLowerCase();
    const preferredName = el.guardNameInput?.value.trim();
    const name = preferredName;
    const homePool = el.guardPoolInput?.value.trim();
    const trainingTypeKey = el.trainingMonthSelect.value;
    const sessionId = el.trainingSessionSelect.value;

    if (!employeeId || !employeeId.includes('@') || !name || !homePool || !trainingTypeKey || !sessionId) {
      msgEl.textContent =
        'Please fill out all fields and choose a training session.';
      msgEl.classList.add('error');
      return;
    }

    const session = trainingSessions.find((s) => s.id === sessionId);
    if (!session) {
      msgEl.textContent =
        'Could not find the selected session. Please try again.';
      msgEl.classList.add('error');
      return;
    }

    const taken = Array.isArray(session.attendees) ?
      session.attendees.length
      : 0;
    const capacity = session.capacity || 0;

    if (capacity && taken >= capacity) {
      msgEl.textContent =
        'Sorry, that session is already full. Please pick another option.';
      msgEl.classList.add('error');
      updateSessionSelectForType(trainingTypeKey, el);
      return;
    }

    const alreadySignedUp =
      Array.isArray(session.attendees) &&
      session.attendees.some((att) => att.employeeId === employeeId);

    if (alreadySignedUp) {
      msgEl.textContent = 'You are already signed up for this session.';
      msgEl.classList.add('error');
      return;
    }

    // Look up employee data from employees table via employee ID
    const empRecord = window.getEmployeeByID ? window.getEmployeeByID(employeeId) : null;
    const lastName = empRecord?.lastName || '';
    const phone = empRecord?.phone || '';

    const attendee = {
      id: 'att_' + Math.random().toString(36).slice(2, 9),
      employeeId,
      name,
      firstName: preferredName,
      lastName,
      homePool,
      phone,
      signupTimestamp: new Date().toISOString()
    };

    if (!Array.isArray(session.attendees)) {
      session.attendees = [];
    }
    session.attendees.push(attendee);

    // Persist to localStorage
    saveSessions();

    // Also persist to Firestore if available
    if (window.addTrainingSignupToSchedule) {
      window.addTrainingSignupToSchedule({
        sessionId,
        firstName: name,
        lastName: '',
        homePool,
        email: ''
      });
    }

    msgEl.textContent =
      'You are signed up! Your supervisor will see this on the schedule.';
    msgEl.classList.add('success');

    // Reload after a short delay so the updated Spots Filled counts reflect
    setTimeout(() => location.reload(), 1500);
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
    if (messageEl) {
      messageEl.textContent = '';
      messageEl.classList.remove('success', 'error');
    }
  }

  function closeModal() {
    modal.style.display = 'none';
  }

  // Always start each visit in the lifeguard view; do NOT auto-restore login
  setLoggedIn(false);

  if (openBtn) {
    openBtn.addEventListener('click', () => {
      if (localStorage.getItem(LOGIN_KEY) === 'true') {
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

  // Load sessions — prefer Firestore (shared/persistent), fall back to localStorage
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
    const alreadyAuth = localStorage.getItem(LOGIN_KEY) === 'true'
      || localStorage.getItem('ChemLogSupervisor') === 'true'
      || (() => {
          try {
            const t = JSON.parse(localStorage.getItem('loginToken') || 'null');
            return t && t.expires && Date.now() < t.expires;
          } catch (_) { return false; }
        })();
    if (alreadyAuth) {
      localStorage.setItem(LOGIN_KEY, 'true');
      showSupervisorView();
    } else {
      const loginModal = document.getElementById('trainingLoginModal');
      if (loginModal) loginModal.style.display = 'flex';
    }
  } else {
    showLifeguardView();
  }
});

window.addEventListener('load', () => {
  document.body.classList.add('page-loaded');
});
