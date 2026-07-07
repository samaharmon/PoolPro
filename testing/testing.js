// testing.js — SET rubric testing forms for ChemLog
// Loaded as type="module" from testing/testing.html

import {
  db, auth,
  doc, getDoc, setDoc, addDoc, collection,
  signOut, Timestamp
} from '../firebase.js';

// ============================================================
// STATE
// ============================================================

let employeesData = [];
let rescuerOutsideClickBound = false;

const CPR_RAPID_ASSESSMENT_ROWS = [
  { text: 'Rescuer ensured the scene was safe and put on gloves.', points: 2 },
  { text: 'Rescuer checked for verbal and physical responsiveness.', points: 1 },
  { text: 'Rescuer simultaneously checked for pulse and breathing for 5\u201310 s.', points: 3, autoFail: true },
  { text: 'Rescuer pointed and shouted for bystanders to call 911 as well as retrieve an AED and BVM.', points: 5, autoFail: true },
  { text: 'If the victim drowned, rescuer begins CPR by correctly sealing the mask and opening the airway to the appropriate position, providing 2 ventilations.', points: 3, autoFail: true },
];

function cloneRows(rows) {
  return rows.map((row) => ({ ...row }));
}

// ============================================================
// RUBRIC DEFINITIONS
// Point values and pass thresholds sourced from original Word rubrics.
// autoFail: true — missing ANY checkbox in that row = automatic failure.
// ============================================================

const RUBRICS = [
  {
    key: 'dropTest',
    title: 'Drop Test Rubric',
    rescuerLabel: 'Rescuer',
    sections: [
      {
        title: 'EAP and Rapid/Primary Assessment',
        subheading: 'Requirements and Questions',
        checkboxHeader: 'Correctly Demonstrated (X)',
        rows: [
          { text: 'Rescuing lifeguard recognized the submerged silhouette within 30 seconds of the silhouette hitting the pool bottom.', points: 1 },
          { text: 'Rescuing lifeguard blew whistle 3 times (loudly) to activate the EAP.', points: 1 },
          { text: 'Emergency backup lifeguards cleared the pool.', points: 1 },
          { text: 'Rescuing lifeguard retrieved the silhouette and placed it on the pool deck within 1 minute and 30 seconds of the silhouette hitting the pool bottom.', points: 1 },
          { text: 'What is the first step of the rapid/primary assessment?', answer: 'Answer: Verbally check for responsiveness as you put on gloves.', points: 2, autoFail: true },
          { text: 'What is the next step if the victim is not verbally responsive?', answer: "Answer: Physically check for responsiveness by hitting the victim\u2019s shoulders.", points: 1 },
          { text: 'What is the next step if the victim is not physically responsive?', answer: 'Answer: Simultaneously check for breathing and a pulse.', points: 2, autoFail: true },
        ]
      },
      {
        title: 'Basic Life Support Techniques',
        subheading: 'Questions for the Rescuing Lifeguard (Choose 1 Scenario)',
        checkboxHeader: 'Correctly Demonstrated (X)',
        scenarios: [
          {
            label: 'Scenario 1',
            passScore: 12,
            maxScore: 15,
            rows: [
              { text: 'If you determine that the victim has a pulse but is not breathing consistently, what do you need to call for, and what process do you begin?', answer: 'Answer: Call for EMS, an AED, and a BVM, then begin rescue breathing.', points: 4, autoFail: true },
              { text: 'What is rescue breathing?', answer: 'Answer: A resuscitative technique that requires 1 ventilation every 5\u20136 seconds for an adult and 1 ventilation every 2\u20133 seconds for a baby.', points: 2, autoFail: true },
            ]
          },
          {
            label: 'Scenario 2',
            passScore: 15,
            maxScore: 18,
            rows: [
              { text: 'If you determine that the victim has no pulse and is not breathing, what do you need to call for (3), and what process do you begin?', answer: 'Answer: Call for EMS, an AED, and a BVM, then begin CPR.', points: 4, autoFail: true },
              { text: 'Explain the difference in compressions between adult, child and baby CPR.', answer: 'Answer: For adult/child CPR, use the two-hand technique, with the heel of the bottom hand overtop the sternum and compressing 2\u20132.4 inches for an adult or about 2 inches for a child. For baby CPR, use the encircling thumbs technique, with both fingers compressing the chest 1.5 inches per compression.', points: 5, autoFail: true },
            ]
          }
        ]
      }
    ]
  },

  {
    key: 'rapidAssessment',
    title: 'Rapid Assessment',
    rescuerLabel: 'Rescuer',
    passScore: 14,
    sections: [
      {
        title: 'Rapid Assessment',
        subheading: 'Requirements and Questions',
        checkboxHeader: 'Correctly Demonstrated (X)',
        rows: cloneRows(CPR_RAPID_ASSESSMENT_ROWS),
      }
    ]
  },

  {
    key: 'cprTest',
    title: 'CPR Test Rubric',
    rescuerLabel: 'Rescuer',
    sections: [
      {
        title: 'Rapid Assessment',
        subheading: 'Requirements and Questions',
        checkboxHeader: 'Correctly Demonstrated (X)',
        rows: cloneRows(CPR_RAPID_ASSESSMENT_ROWS),
      },
      {
        title: 'Basic Life Support Techniques',
        subheading: 'Requirements and Questions (Choose 1 Scenario)',
        checkboxHeader: 'Correctly Demonstrated (X)',
        scenarios: [
          {
            label: 'Scenario 1: CPR on an Adult',
            passScore: 17, maxScore: 19,
            rows: [
              { text: 'Rescuer compresses the chest 2\u20132.4 inches at a rate of 100\u2013120 compressions per minute.', points: 2, autoFail: true },
              { text: 'Rescuer correctly seals the mask and opens the airway to the past neutral position, providing 2 ventilations after each set of compressions.', points: 2, autoFail: true },
              { text: 'After about 2 minutes of CPR (5\u20136 rounds), what do you need to check on?', answer: 'Answer: Check signs of life (pulse, breathing, responsiveness).', points: 1 },
            ]
          },
          {
            label: 'Scenario 2: CPR on a Child',
            passScore: 17, maxScore: 19,
            rows: [
              { text: 'Rescuer compresses the chest about 2 inches at a rate of 100\u2013120 compressions per minute.', points: 2, autoFail: true },
              { text: 'Rescuer correctly seals the mask and opens the airway to the slightly past neutral position, providing 2 ventilations after each set of compressions.', points: 2, autoFail: true },
              { text: 'After about 2 minutes of CPR (5\u20136 rounds), what do you need to check on?', answer: 'Answer: Check signs of life (pulse, breathing, responsiveness).', points: 1 },
            ]
          },
          {
            label: 'Scenario 3: CPR on an Infant',
            passScore: 17, maxScore: 19,
            rows: [
              { text: 'Rescuer compresses the chest 1.5 inches at a rate of 100\u2013120 compressions per minute.', points: 2, autoFail: true },
              { text: 'Rescuer correctly seals the mask and leaves the airway in neutral position while providing 2 small ventilations (puffs).', points: 2, autoFail: true },
              { text: 'After about 2 minutes of CPR (5\u20136 rounds), what do you need to check on?', answer: 'Answer: Check signs of life (pulse, breathing, responsiveness).', points: 1 },
            ]
          }
        ]
      }
    ]
  },

  {
    key: 'rescueBreathing',
    title: 'Rescue Breathing Test Rubric',
    rescuerLabel: 'Rescuer',
    sections: [
      {
        title: 'Rapid Assessment',
        subheading: 'Requirements and Questions',
        checkboxHeader: 'Correctly Demonstrated (X)',
        rows: [
          { text: 'Rescuer ensured the scene was safe and put on gloves.', points: 2 },
          { text: 'Rescuer checked for verbal and physical responsiveness.', points: 1 },
          { text: 'Rescuer simultaneously checked for pulse and breathing for 5\u201310 s.', points: 3, autoFail: true },
          { text: 'Rescuer pointed and shouted for bystanders to call 911 as well as retrieve an AED and BVM.', points: 4, autoFail: true },
        ]
      },
      {
        title: 'Basic Life Support Techniques',
        subheading: 'Requirements and Questions (Choose 1 Scenario)',
        checkboxHeader: 'Correctly Demonstrated (X)',
        scenarios: [
          {
            label: 'Scenario 1: Rescue Breathing on an Adult',
            passScore: 13, maxScore: 14,
            rows: [
              { text: 'Rescuer correctly seals the mask and opens the airway to the past neutral position.', points: 2, autoFail: true },
              { text: 'Rescuer provides rescue breaths at a rate of 1 breath per 5\u20136 s.', points: 1 },
              { text: 'After about 2 minutes of rescue breathing, what do you need to check on?', answer: 'Answer: Check signs of life (pulse, breathing, responsiveness).', points: 1 },
            ]
          },
          {
            label: 'Scenario 2: Rescue Breathing on a Child',
            passScore: 13, maxScore: 14,
            rows: [
              { text: 'Rescuer correctly seals the mask and opens the airway to the past neutral position.', points: 2, autoFail: true },
              { text: 'Rescuer provides rescue breaths at a rate of 1 breath per 5\u20136 s.', points: 1 },
              { text: 'After about 2 minutes of rescue breathing, what do you need to check on?', answer: 'Answer: Check signs of life (pulse, breathing, responsiveness).', points: 1 },
            ]
          },
          {
            label: 'Scenario 3: Rescue Breathing on an Infant',
            passScore: 13, maxScore: 14,
            rows: [
              { text: 'Rescuer correctly seals the mask and opens the airway to the past neutral position.', points: 2, autoFail: true },
              { text: 'Rescuer provides rescue breaths at a rate of 1 breath per 5\u20136 s.', points: 1 },
              { text: 'After about 2 minutes of rescue breathing, what do you need to check on?', answer: 'Answer: Check signs of life (pulse, breathing, responsiveness).', points: 1 },
            ]
          }
        ]
      }
    ]
  },

  {
    key: 'performanceAudit',
    title: 'Lifeguard Performance Audit',
    rescuerLabel: 'Rescuer',
    // Original rubric: 16/17 pts to pass. Visible items sum to 14 pts.
    // Using proportional threshold: 13/14 (93%) ≈ 94.1% of original.
    passScore: 13,
    sections: [
      {
        title: 'Guard Stand Behavior',
        subheading: 'Requirements',
        checkboxHeader: 'I Agree (X)',
        rows: [
          { text: 'Lifeguard is sitting with good posture.', points: 2 },
          { text: 'Lifeguard is moving their head to scan their entire zone.', points: 1 },
          { text: 'Lifeguard is enforcing rules frequently and loudly.', points: 2, autoFail: true },
          { text: 'Lifeguard is not engaging in extended (more than 30 seconds) conversation with someone off-stand.', points: 1 },
          { text: 'The lifeguard is wearing a whistle around their neck, a hip pack on their waist, and a rescue tube with the strap over their shoulder.', points: 3, autoFail: true },
          { text: 'Lifeguard is not distracted by an object (e.g., phone, fingernails, snack, etc.).', points: 1 },
        ]
      },
      {
        title: 'Off-Stand Behavior',
        subheading: 'Requirements',
        checkboxHeader: 'Correctly Demonstrated (X)',
        rows: [
          { text: 'Lifeguard does not remain in the guard room for more than 30 seconds at a time.', points: 1 },
          { text: 'Lifeguard is actively participating in cleaning or maintenance tasks or is watching the pool (as an extra guard).', points: 1 },
          { text: 'Lifeguard does not distract another on-stand lifeguard.', points: 1 },
          { text: 'Lifeguard is not distracted by objects/tasks not related to the pool.', points: 1 },
        ]
      }
    ]
  }
];

// ============================================================
// AUTH
// ============================================================

document.getElementById('testLogoutBtn')?.addEventListener('click', async (e) => {
  e.preventDefault();
  await signOut(auth);
  localStorage.removeItem('loginToken');
  localStorage.removeItem('ChemLogSupervisor');
  window.location.href = '../index.html';
});

// ============================================================
// INIT
// ============================================================

async function initPage() {
  await loadEmployees();
  document.body.classList.add('page-loaded');

  document.getElementById('rubricSelect')?.addEventListener('change', (e) => {
    const key = e.target.value;
    const container = document.getElementById('rubricFormContainer');
    container.innerHTML = '';
    if (key) {
      const rubric = RUBRICS.find(r => r.key === key);
      if (rubric) renderRubric(rubric);
    }
  });
}

async function loadEmployees() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'employees'));
    if (snap.exists()) {
      const data = snap.data();
      employeesData = Array.isArray(data.employees) ? data.employees : [];
    }
  } catch (err) {
    console.error('[Testing] Error loading employees:', err);
  }
}

// ============================================================
// RENDERING
// ============================================================

function renderRubric(rubric) {
  const container = document.getElementById('rubricFormContainer');
  container.innerHTML = '';

  const form = document.createElement('div');
  form.className = 'test-form';

  // --- Header: title + employee/date/pool ---
  const titleRow = document.createElement('div');
  titleRow.className = 'test-rubric-title-row';

  const titleEl = document.createElement('h2');
  titleEl.className = 'test-rubric-title';
  titleEl.textContent = rubric.title;

  const fields = document.createElement('div');
  fields.className = 'test-header-fields';
  fields.innerHTML = `
    <div class="test-header-field test-rescuer-picker-field">
      <label for="testEmployeeName">${escHtml(rubric.rescuerLabel)}:</label>
      <div class="test-rescuer-search-wrap">
        <input
          type="text"
          class="test-header-select"
          id="testEmployeeName"
          name="poolpro-rescuer-search"
          placeholder="Type to find employee"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="words"
          spellcheck="false"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="false"
          aria-controls="testEmployeeResults"
        />
        <div class="test-rescuer-results" id="testEmployeeResults" role="listbox" aria-label="Employee matches"></div>
      </div>
      <button type="button" class="test-rescuer-add-btn" id="testAddRescuerBtn">Add</button>
    </div>
    <div class="test-rescuer-list" id="testRescuerList"></div>
    <div class="test-header-field">
      <label>Date:</label>
      <input type="date" class="test-header-date" id="testDate" value="${todayStr()}" />
    </div>
  `;

  titleRow.appendChild(titleEl);
  titleRow.appendChild(fields);
  form.appendChild(titleRow);

  // --- Sections ---
  const hasScenarios = rubric.sections.some(s => s.scenarios);
  rubric.sections.forEach(section => {
    form.appendChild(buildSection(section, rubric));
  });

  // --- Score bar ---
  const staticMax = hasScenarios ? null : computeStaticMax(rubric);
  const scoreBar = document.createElement('div');
  scoreBar.className = 'test-score-bar';
  scoreBar.innerHTML = `
    <span class="test-score-text">Score:&nbsp;<strong id="testScore">0</strong>&nbsp;/&nbsp;<strong id="testMaxScore">${staticMax !== null ? staticMax : '—'}</strong></span>
    <span class="test-result-badge pending" id="testResultBadge">${hasScenarios ? 'Select a scenario' : '—'}</span>
    <span class="test-autofail-note hidden" id="testAutoFailNote">⚠ Automatic failure triggered</span>
  `;
  form.appendChild(scoreBar);

  // --- Auto-fail note ---
  const note = document.createElement('p');
  note.className = 'test-rubric-note';
  note.textContent = '★ Failure to correctly demonstrate starred items will result in automatic failure.';
  form.appendChild(note);

  // --- Submit button ---
  const submitRow = document.createElement('div');
  submitRow.className = 'test-submit-row';
  const submitBtn = document.createElement('button');
  submitBtn.className = 'submit-btn';
  submitBtn.id = 'testSubmitBtn';
  submitBtn.textContent = 'Submit Result';
  submitBtn.addEventListener('click', () => handleSubmit(rubric));
  submitRow.appendChild(submitBtn);
  form.appendChild(submitRow);

  const card = document.createElement('div');
  card.className = 'test-rubric-card';
  card.appendChild(form);
  container.appendChild(card);
  requestAnimationFrame(() => card.classList.add('visible'));

  const empInput = document.getElementById('testEmployeeName');
  if (empInput) {
    const clearValidation = () => empInput.setCustomValidity('');
    empInput.addEventListener('input', () => {
      clearValidation();
      renderRescuerSearchResults(empInput.value);
    });
    empInput.addEventListener('focus', () => renderRescuerSearchResults(empInput.value));
    empInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const employee = findEmployeeByName(empInput.value);
      addRescuer(employee ? fullName(employee) : empInput.value);
      hideRescuerSearchResults();
    });
  }
  document.getElementById('testAddRescuerBtn')?.addEventListener('click', () => {
    addRescuer(document.getElementById('testEmployeeName')?.value || '');
    hideRescuerSearchResults();
  });
  const results = document.getElementById('testEmployeeResults');
  results?.addEventListener('mousedown', (event) => event.preventDefault());
  results?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const option = target?.closest('[data-rescuer-name]');
    if (!option) return;
    addRescuer(option.dataset.rescuerName || '');
    hideRescuerSearchResults();
  });
  if (!rescuerOutsideClickBound) {
    rescuerOutsideClickBound = true;
    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('.test-rescuer-picker-field')) hideRescuerSearchResults();
    });
  }

  // Wire checkbox listeners for live score update
  container.querySelectorAll('.test-cb').forEach(cb => {
    cb.addEventListener('change', () => updateScore(rubric));
  });

  // Wire scenario radio listeners
  container.querySelectorAll('.test-scenario-radio').forEach(radio => {
    radio.addEventListener('change', () => {
      showScenario(parseInt(radio.value), rubric);
      updateScore(rubric);
    });
  });

  // Initialize score display for non-scenario rubrics
  if (!hasScenarios) updateScore(rubric);
}

function buildSection(section, rubric) {
  const wrap = document.createElement('div');
  wrap.className = 'test-section';

  const table = document.createElement('table');
  table.className = 'test-rubric-table';

  // Section header row
  const thead = document.createElement('thead');
  const secRow = document.createElement('tr');
  secRow.className = 'test-section-header';
  const secTh = document.createElement('th');
  secTh.colSpan = 2;
  secTh.textContent = section.title;
  secRow.appendChild(secTh);
  thead.appendChild(secRow);

  // Column sub-header row
  const colRow = document.createElement('tr');
  colRow.className = 'test-col-header';
  const thReq = document.createElement('th');
  thReq.textContent = section.subheading || 'Requirements';
  const thCheck = document.createElement('th');
  thCheck.textContent = section.checkboxHeader || 'Correctly Demonstrated (X)';
  thCheck.style.width = '150px';
  colRow.appendChild(thReq);
  colRow.appendChild(thCheck);
  thead.appendChild(colRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  if (section.rows) {
    section.rows.forEach(row => tbody.appendChild(buildRow(row, null)));
  } else if (section.scenarios) {
    section.scenarios.forEach((scenario, sIdx) => {
      // Scenario selector row
      const selTr = document.createElement('tr');
      selTr.className = 'test-scenario-header-row';
      const selTd = document.createElement('td');
      selTd.colSpan = 2;
      const radioLabel = document.createElement('label');
      radioLabel.className = 'test-scenario-radio-label';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `scenario_${rubric.key}`;
      radio.value = sIdx;
      radio.className = 'test-scenario-radio';
      radioLabel.appendChild(radio);
      radioLabel.appendChild(document.createTextNode('\u00a0' + scenario.label));
      selTd.appendChild(radioLabel);
      selTr.appendChild(selTd);
      tbody.appendChild(selTr);

      // Scenario criterion rows
      scenario.rows.forEach(row => {
        const tr = buildRow(row, sIdx);
        if (sIdx > 0) tr.classList.add('scenario-hidden');
        tbody.appendChild(tr);
      });
    });
  }

  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function buildRow(row, scenarioIdx) {
  const tr = document.createElement('tr');
  tr.className = 'test-row';
  if (row.autoFail) tr.classList.add('autofail-row');
  if (scenarioIdx !== null) tr.dataset.scenarioIdx = scenarioIdx;

  // Criterion cell
  const tdText = document.createElement('td');
  const textSpan = document.createElement('span');
  textSpan.className = 'test-criterion-text';
  textSpan.textContent = row.text;

  if (row.autoFail) {
    const badge = document.createElement('span');
    badge.className = 'autofail-badge';
    badge.textContent = ' ★';
    badge.title = 'Auto-Fail: missing any part of this item results in automatic failure';
    textSpan.appendChild(badge);
  }

  tdText.appendChild(textSpan);

  if (row.answer) {
    const ansSpan = document.createElement('span');
    ansSpan.className = 'test-criterion-answer';
    ansSpan.textContent = row.answer;
    tdText.appendChild(ansSpan);
  }

  tr.appendChild(tdText);

  // Checkboxes (one per point)
  const tdChecks = document.createElement('td');
  tdChecks.className = 'test-checks-cell';
  for (let i = 0; i < row.points; i++) {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'test-cb';
    if (row.autoFail) cb.dataset.autofail = 'true';
    tdChecks.appendChild(cb);
  }
  tr.appendChild(tdChecks);

  return tr;
}

// ============================================================
// SCENARIO VISIBILITY
// ============================================================

function showScenario(scenarioIdx, rubric) {
  // Show/hide rows for the selected scenario
  document.querySelectorAll('#rubricFormContainer [data-scenario-idx]').forEach(tr => {
    const idx = parseInt(tr.dataset.scenarioIdx);
    const hide = idx !== scenarioIdx;
    tr.classList.toggle('scenario-hidden', hide);
    // Uncheck hidden rows so they don't contribute to score
    if (hide) tr.querySelectorAll('.test-cb').forEach(cb => { cb.checked = false; });
  });

  // Update max score display from selected scenario
  const scenario = getScenarioData(rubric, scenarioIdx);
  if (scenario) {
    document.getElementById('testMaxScore').textContent = scenario.maxScore;
  }
}

function getScenarioData(rubric, scenarioIdx) {
  for (const section of rubric.sections) {
    if (section.scenarios && section.scenarios[scenarioIdx]) {
      return section.scenarios[scenarioIdx];
    }
  }
  return null;
}

function getSelectedScenarioIdx(rubric) {
  const radio = document.querySelector(`input[name="scenario_${rubric.key}"]:checked`);
  return radio ? parseInt(radio.value) : null;
}

// ============================================================
// SCORE COMPUTATION
// ============================================================

function computeStaticMax(rubric) {
  let total = 0;
  rubric.sections.forEach(s => {
    if (s.rows) s.rows.forEach(r => { total += r.points; });
  });
  return total;
}

function updateScore(rubric) {
  const hasScenarios = rubric.sections.some(s => s.scenarios);
  const scenarioIdx = hasScenarios ? getSelectedScenarioIdx(rubric) : null;

  if (hasScenarios && scenarioIdx === null) {
    document.getElementById('testScore').textContent = '0';
    document.getElementById('testResultBadge').textContent = 'Select a scenario';
    document.getElementById('testResultBadge').className = 'test-result-badge pending';
    document.getElementById('testAutoFailNote').classList.add('hidden');
    return;
  }

  // Count checked boxes in visible rows
  let score = 0;
  document.querySelectorAll('#rubricFormContainer .test-cb').forEach(cb => {
    const scenarioRow = cb.closest('[data-scenario-idx]');
    if (scenarioRow && scenarioRow.classList.contains('scenario-hidden')) return;
    if (cb.checked) score++;
  });

  // Check for auto-fail: any auto-fail row with unchecked box
  let autoFailed = false;
  document.querySelectorAll('#rubricFormContainer .autofail-row').forEach(tr => {
    if (tr.classList.contains('scenario-hidden')) return;
    if (tr.querySelectorAll('.test-cb:not(:checked)').length > 0) autoFailed = true;
  });

  // Determine pass threshold
  let passScore, maxScore;
  if (hasScenarios) {
    const scenario = getScenarioData(rubric, scenarioIdx);
    passScore = scenario?.passScore ?? 0;
    maxScore = scenario?.maxScore;
  } else {
    maxScore = computeStaticMax(rubric);
    passScore = rubric.passScore ?? Math.ceil((16 / 17) * maxScore);
  }

  const passed = !autoFailed && score >= passScore;

  document.getElementById('testScore').textContent = score;
  if (maxScore != null) document.getElementById('testMaxScore').textContent = maxScore;

  const badge = document.getElementById('testResultBadge');
  badge.textContent = passed ? 'PASS' : 'FAIL';
  badge.className = `test-result-badge ${passed ? 'pass' : 'fail'}`;
  document.getElementById('testAutoFailNote').classList.toggle('hidden', !(autoFailed && !passed));
}

// ============================================================
// RESCUER SELECTION
// ============================================================

function normalizeRescuerNameKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function syncRescuerEntry(input) {
  if (!input) return null;
  const name = input.value.trim();
  const employee = findEmployeeByName(name);
  if (employee) {
    input.value = fullName(employee);
    input.dataset.employeeId = String(employee.id || employee.email || '');
    input.dataset.employeeName = fullName(employee);
    input.dataset.unlisted = 'false';
    input.classList.remove('test-unlisted-rescuer-input');
    return employee;
  }
  input.dataset.employeeId = '';
  input.dataset.employeeName = name;
  input.dataset.unlisted = name ? 'true' : 'false';
  input.classList.toggle('test-unlisted-rescuer-input', !!name);
  return null;
}

function getEmployeeMatches(query) {
  const normalizedQuery = normalizeRescuerNameKey(query);
  if (!normalizedQuery) return [];
  return [...employeesData]
    .filter((emp) => {
      const haystack = [
        fullName(emp),
        emp?.email,
        emp?.username,
        emp?.id,
        emp?.homePool,
      ].filter(Boolean).map(normalizeRescuerNameKey);
      return haystack.some((value) => value.includes(normalizedQuery));
    })
    .sort((a, b) => {
      const aName = normalizeRescuerNameKey(fullName(a));
      const bName = normalizeRescuerNameKey(fullName(b));
      const aStarts = aName.startsWith(normalizedQuery) ? 0 : 1;
      const bStarts = bName.startsWith(normalizedQuery) ? 0 : 1;
      return aStarts - bStarts || fullName(a).localeCompare(fullName(b));
    });
}

function renderRescuerSearchResults(query) {
  const input = document.getElementById('testEmployeeName');
  const panel = document.getElementById('testEmployeeResults');
  if (!input || !panel) return;
  const raw = String(query || '').trim();
  panel.innerHTML = '';
  if (!raw) {
    hideRescuerSearchResults();
    return;
  }

  const matches = getEmployeeMatches(raw).slice(0, 8);
  const exact = findEmployeeByName(raw);
  matches.forEach((emp) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'test-rescuer-result';
    button.dataset.rescuerName = fullName(emp);
    button.setAttribute('role', 'option');
    button.innerHTML = `
      <span class="test-rescuer-result-name">${escHtml(fullName(emp))}</span>
      <span class="test-rescuer-result-meta">${escHtml([emp.email, emp.homePool].filter(Boolean).join(' - '))}</span>
    `;
    panel.appendChild(button);
  });

  if (!exact) {
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'test-rescuer-result test-rescuer-result-new';
    addButton.dataset.rescuerName = raw;
    addButton.setAttribute('role', 'option');
    addButton.innerHTML = `
      <span class="test-rescuer-result-name">Add "${escHtml(raw)}"</span>
      <span class="test-rescuer-result-meta">Unlisted rescuer</span>
    `;
    panel.appendChild(addButton);
  }

  const hasResults = panel.children.length > 0;
  panel.classList.toggle('visible', hasResults);
  input.setAttribute('aria-expanded', hasResults ? 'true' : 'false');
}

function hideRescuerSearchResults() {
  const input = document.getElementById('testEmployeeName');
  const panel = document.getElementById('testEmployeeResults');
  if (panel) {
    panel.classList.remove('visible');
    panel.innerHTML = '';
  }
  if (input) input.setAttribute('aria-expanded', 'false');
}

function renumberRescuers() {
  document.querySelectorAll('#testRescuerList .test-rescuer-entry').forEach((row, index) => {
    const label = row.querySelector('label');
    const input = row.querySelector('.test-rescuer-name-input');
    if (label) label.textContent = `Rescuer ${index + 1}:`;
    if (input) input.id = `testRescuer_${index + 1}`;
    if (label && input) label.setAttribute('for', input.id);
  });
}

function addRescuer(rawName) {
  const name = String(rawName || '').trim();
  const picker = document.getElementById('testEmployeeName');
  const list = document.getElementById('testRescuerList');
  if (!name || !list) return false;

  const employee = findEmployeeByName(name);
  const displayName = employee ? fullName(employee) : name;
  const duplicate = Array.from(list.querySelectorAll('.test-rescuer-name-input'))
    .some((input) => normalizeRescuerNameKey(input.value) === normalizeRescuerNameKey(displayName));
  if (duplicate) {
    if (picker) picker.value = '';
    return false;
  }

  const row = document.createElement('div');
  row.className = 'test-rescuer-entry';

  const label = document.createElement('label');
  label.textContent = 'Rescuer:';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'test-header-select test-rescuer-name-input';
  input.value = displayName;
  input.autocomplete = 'off';
  input.addEventListener('change', () => syncRescuerEntry(input));
  input.addEventListener('input', () => input.setCustomValidity(''));

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'test-rescuer-remove-btn';
  removeBtn.textContent = '\u00d7';
  removeBtn.setAttribute('aria-label', `Remove ${displayName}`);
  removeBtn.addEventListener('click', () => {
    row.remove();
    renumberRescuers();
  });

  row.append(label, input, removeBtn);
  list.appendChild(row);
  syncRescuerEntry(input);
  renumberRescuers();
  if (picker) picker.value = '';
  return true;
}

function collectRescuers() {
  const pendingName = document.getElementById('testEmployeeName')?.value?.trim();
  if (pendingName) addRescuer(pendingName);

  const seen = new Set();
  return Array.from(document.querySelectorAll('#testRescuerList .test-rescuer-name-input'))
    .map((input) => {
      syncRescuerEntry(input);
      const name = input.value.trim();
      const key = normalizeRescuerNameKey(name);
      if (!name || seen.has(key)) return null;
      seen.add(key);
      const employee = findEmployeeByName(name);
      return {
        name: employee ? fullName(employee) : name,
        employee,
        employeeId: employee ? String(employee.id || employee.email || '') : makeTypedRescuerId(name),
        unlisted: !employee,
      };
    })
    .filter(Boolean);
}

function makeTypedRescuerId(name) {
  const key = normalizeRescuerNameKey(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `typed:${key || 'unlisted-rescuer'}`;
}

// ============================================================
// SUBMISSION
// ============================================================

async function handleSubmit(rubric) {
  const empInput = document.getElementById('testEmployeeName');
  const dateInput = document.getElementById('testDate');
  const rescuers = collectRescuers();

  if (!rescuers.length) {
    if (empInput) {
      empInput.setCustomValidity('Add at least one rescuer.');
      empInput.reportValidity();
    } else {
      alert('Please add at least one rescuer.');
    }
    return;
  }
  if (!dateInput?.value) { alert('Please enter a date.'); return; }

  const hasScenarios = rubric.sections.some(s => s.scenarios);
  const scenarioIdx = hasScenarios ? getSelectedScenarioIdx(rubric) : null;
  if (hasScenarios && scenarioIdx === null) { alert('Please select a scenario.'); return; }

  // Compute final score + result
  let score = 0;
  document.querySelectorAll('#rubricFormContainer .test-cb').forEach(cb => {
    const sRow = cb.closest('[data-scenario-idx]');
    if (sRow && sRow.classList.contains('scenario-hidden')) return;
    if (cb.checked) score++;
  });

  let autoFailed = false;
  document.querySelectorAll('#rubricFormContainer .autofail-row').forEach(tr => {
    if (tr.classList.contains('scenario-hidden')) return;
    if (tr.querySelectorAll('.test-cb:not(:checked)').length > 0) autoFailed = true;
  });

  let passScore, maxScore;
  const scenario = hasScenarios ? getScenarioData(rubric, scenarioIdx) : null;
  if (scenario) {
    passScore = scenario.passScore;
    maxScore = scenario.maxScore;
  } else {
    maxScore = computeStaticMax(rubric);
    passScore = rubric.passScore ?? Math.ceil((16 / 17) * maxScore);
  }

  const passed = !autoFailed && score >= passScore;
  const questionResults = buildQuestionResults();

  const knownPoolName = rescuers.find((rescuer) => rescuer.employee?.homePool)?.employee.homePool || '';
  const rescuerSnapshots = rescuers.map((rescuer, index) => ({
    order: index + 1,
    employeeId: rescuer.employeeId,
    employeeName: rescuer.name,
    name: rescuer.name,
    poolName: rescuer.employee?.homePool || knownPoolName || '',
    unlisted: !!rescuer.unlisted,
  }));
  const auditGroupId = `${rubric.key}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const submitBtn = document.getElementById('testSubmitBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';

  try {
    await Promise.all(rescuers.map((rescuer, index) => {
      const poolName = rescuer.employee?.homePool || knownPoolName || '';
      return addDoc(collection(db, 'testingResults'), {
        auditGroupId,
        rescuerIndex: index + 1,
        employeeId: rescuer.employeeId,
        employeeName: rescuer.name,
        rescuerName: rescuer.name,
        typedRescuerName: rescuer.unlisted ? rescuer.name : '',
        unlistedRescuer: !!rescuer.unlisted,
        poolName,
        date: dateInput.value,
        rubricKey: rubric.key,
        rubricTitle: rubric.title,
        scenario: scenario?.label ?? null,
        score,
        maxScore: maxScore ?? null,
        passScore,
        passed,
        autoFailed,
        questionResults,
        rescuers: rescuerSnapshots,
        timestamp: Timestamp.now(),
      });
    }));

    const perfSnap = await getDoc(doc(db, 'settings', 'employeePerformance'));
    const perfData = perfSnap.exists()
      ? perfSnap.data()
      : { training: {}, set: {} };
    if (!perfData.set) perfData.set = {};
    rescuers
      .filter((rescuer) => !rescuer.unlisted && rescuer.employeeId)
      .forEach((rescuer) => {
        const empId = String(rescuer.employeeId);
        if (!perfData.set[empId]) perfData.set[empId] = {};
        perfData.set[empId][rubric.key] = passed ? 'Pass' : 'Fail';
      });
    await setDoc(doc(db, 'settings', 'employeePerformance'), perfData, { merge: false });

    const savedNames = rescuers.map((rescuer) => rescuer.name).join(', ');
    showToast(`Saved — ${savedNames}: ${passed ? 'PASS' : 'FAIL'}`);
    resetForm();
  } catch (err) {
    console.error('[Testing] Error saving result:', err);
    if (String(err?.code || '').includes('permission-denied')) {
      alert('Error saving result: missing Firestore permissions for testing results.');
    } else {
      alert('Error saving result. Please try again.');
    }
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Result';
  }
}

function resetForm() {
  document.getElementById('rubricFormContainer').innerHTML = '';
  document.getElementById('rubricSelect').value = '';
}

// ============================================================
// UTILITIES
// ============================================================

function buildEmployeeOptions() {
  if (!employeesData.length) return '';
  return [...employeesData]
    .sort((a, b) => fullName(a).localeCompare(fullName(b)))
    .map(emp => {
      return `<option value="${escHtml(fullName(emp))}"></option>`;
    })
    .join('');
}

function findEmployeeByName(name) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return null;
  return employeesData.find((emp) => fullName(emp).toLowerCase() === target) || null;
}

function buildQuestionResults() {
  const results = [];
  let questionNumber = 0;
  document.querySelectorAll('#rubricFormContainer .test-row').forEach((tr) => {
    if (tr.classList.contains('scenario-hidden')) return;
    questionNumber += 1;
    const checks = Array.from(tr.querySelectorAll('.test-cb'));
    const earned = checks.filter((cb) => cb.checked).length;
    const total = checks.length;
    const textNode = tr.querySelector('.test-criterion-text')?.childNodes?.[0];
    const questionText = (textNode?.textContent || tr.querySelector('.test-criterion-text')?.textContent || '').trim();
    const sectionTitle = tr.closest('table')?.querySelector('.test-section-header th')?.textContent?.trim() || '';
    results.push({
      questionNumber,
      questionText,
      sectionTitle,
      earned,
      total,
      correct: total > 0 && earned === total,
    });
  });
  return results;
}

function fullName(emp) {
  return [emp?.firstName, emp?.lastName].filter(Boolean).join(' ') || `Employee ${emp?.id || ''}`.trim();
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(message) {
  let toast = document.getElementById('testToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'testToast';
    toast.className = 'test-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 3500);
}

document.addEventListener('DOMContentLoaded', () => {
  initPage();
});
