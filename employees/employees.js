// employees.js — Employee Performance Dashboard

import {
  db, auth,
  getDoc, setDoc, getDocs,
  doc, collection,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from '../firebase.js';
import {
  sendEmailVerification,
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';

// ============================================================
// State
// ============================================================

let employeesData = [];   // [{id, firstName, lastName, homePool, phone}]
let trainingSessions = []; // [{id, trainingType, date, market, attendees: [{employeeId}]}]
let poolsData = [];        // [{id, name, markets: []}]
let testingResults = [];   // [{ rubricKey, date, employeeId, poolName, questionResults[] }]
let questionTypeMap = {};  // { [rubricKey]: { [questionNumber]: "Topic label" } }
let typedRescuerAssignment = null;
let pageInitialized = false;

// performanceData shape:
// { training: { empId: { hrOrientation, onSiteOrientation, juneInService, julyInService } },
//   set: { empId: { dropTest, dropTestRetrained, cprTest, cprTestRetrained,
//                   rescueBreathing, rescueBreathingRetrained,
//                   performanceAudit, performanceAuditRetrained } } }
let performanceData = { training: {}, set: {} };

// pool name → market string
let poolToMarket = {};

// sorted unique markets
let marketList = [];

// Active filters
let trainingFilters = { market: 'all', pool: 'all', completion: 'all' };
let setFilters = { market: 'all', pool: 'all' };
let overallFilters = { market: 'all', pool: 'all' };
let metricsFilters = { market: 'all', pool: 'all', week: 'all' };
let graphFilters = {
  test: 'all',
  market: 'all',
  pool: 'all',
  time: 'All Time',
  topic: 'all',
};
const trainingSectionOpenState = {};
const setSectionOpenState = {};
const trainingPageState = {};
const setPageState = {};
const metricsOpenState = {};
const metricsTopicEditState = {};
const EMPLOYEE_TABLE_PAGE_SIZE = 10;

// Training column definitions
const TRAINING_COLS = [
  { key: 'hrOrientation',     label: 'HR Orientation' },
  { key: 'onSiteOrientation', label: 'On-Site Orientation' },
  { key: 'juneInService',     label: 'June In-Service' },
  { key: 'julyInService',     label: 'July In-Service' },
];

// SET column definitions
const SET_COLS = [
  { key: 'dropTest',         label: 'Drop Test' },
  { key: 'rapidAssessment',  label: 'Rapid Assessment' },
  { key: 'cprTest',          label: 'CPR Test' },
  { key: 'rescueBreathing',  label: 'Rescue Breathing Test' },
  { key: 'performanceAudit', label: 'Performance Audit' },
];

const RUBRIC_LABELS = {
  dropTest: 'Drop Test',
  rapidAssessment: 'Rapid Assessment',
  cprTest: 'CPR Test',
  rescueBreathing: 'Rescue Breathing Test',
  performanceAudit: 'Performance Audit',
};

// ============================================================
// Auth gate
// ============================================================

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showAuthGate();
    return;
  }

  await user.reload().catch(() => {});
  if (!auth.currentUser?.emailVerified) {
    await signOut(auth).catch(() => {});
    showAuthGate();
    const errEl = document.getElementById('empAuthError');
    if (errEl) {
      errEl.textContent = 'Verify your email before opening Performance Tracking.';
      errEl.classList.remove('hidden');
    }
    return;
  }

  showPage();
  if (!pageInitialized) {
    pageInitialized = true;
    init();
  }
});

function showPage() {
  document.getElementById('authGate').classList.add('hidden');
  document.getElementById('empPageContent').classList.remove('hidden');
  document.body.classList.add('page-loaded');
}

function showAuthGate() {
  document.getElementById('authGate').classList.remove('hidden');
  document.getElementById('empPageContent').classList.add('hidden');
  document.body.classList.add('page-loaded');
}

document.getElementById('empAuthLoginBtn')?.addEventListener('click', async () => {
  const email = document.getElementById('empAuthEmail').value.trim();
  const password = document.getElementById('empAuthPassword').value;
  const errEl = document.getElementById('empAuthError');
  errEl.classList.add('hidden');
  try {
    await signInWithEmailAndPassword(auth, email, password);
    await auth.currentUser?.reload();
    if (!auth.currentUser?.emailVerified) {
      await sendEmailVerification(auth.currentUser, {
        url: window.location.href,
        handleCodeInApp: false,
      }).catch((verifyErr) => {
        console.warn('[Employees] Could not send verification email:', verifyErr);
      });
      await signOut(auth).catch(() => {});
      errEl.textContent = 'Verify your email before opening Performance Tracking. A verification email has been sent if Firebase allowed it.';
      errEl.classList.remove('hidden');
    }
  } catch (err) {
    errEl.textContent = 'Invalid credentials. Please try again.';
    errEl.classList.remove('hidden');
  }
});

document.getElementById('empLogoutBtn')?.addEventListener('click', async (e) => {
  e.preventDefault();
  await signOut(auth);
  window.location.href = '../Main/home.html';
});

// ============================================================
// Menu toggle (matches other pages)
// ============================================================

window.toggleMenu = function (btn) {
  const menu = document.getElementById('dropdownMenu');
  if (!menu) return;
  const isOpen = menu.classList.contains('show');
  menu.classList.toggle('show', !isOpen);
  document.querySelectorAll('.menu-btn').forEach(b => b.classList.toggle('open', !isOpen));
  if (!isOpen) {
    window.poolProShowMenuContentOverlay?.(btn);
  } else {
    window.poolProHideMenuContentOverlay?.();
  }
};

document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu-container')) {
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('open'));
    window.poolProHideMenuContentOverlay?.();
  }
});

// ============================================================
// Initialization
// ============================================================

async function init() {
  await Promise.all([
    loadPools(),
    loadEmployees(),
    loadTrainingSessions(),
    loadPerformanceData(),
    loadTestingResults(),
    loadQuestionTypeMap(),
  ]);

  buildPoolToMarket();
  buildMarketList();
  populateFilterDropdowns();
  setupPageTabs();
  setupFilterListeners();
  renderAll();
}

// ============================================================
// Data loaders
// ============================================================

async function loadPools() {
  try {
    const snap = await getDocs(collection(db, 'pools'));
    poolsData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('[Employees] Error loading pools:', err);
    poolsData = [];
  }
}

async function loadEmployees() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'employees'));
    if (snap.exists()) {
      const data = snap.data();
      employeesData = Array.isArray(data.employees) ? data.employees.map(normalizeEmployeeRecord) : [];
    }
  } catch (err) {
    console.error('[Employees] Error loading employees:', err);
    employeesData = [];
  }
}

async function loadTrainingSessions() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'trainingSchedule'));
    if (snap.exists()) {
      const data = snap.data();
      trainingSessions = Array.isArray(data.sessions) ? data.sessions : [];
    }
  } catch (err) {
    console.error('[Employees] Error loading training sessions:', err);
    trainingSessions = [];
  }
}

async function loadPerformanceData() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'employeePerformance'));
    if (snap.exists()) {
      const data = snap.data();
      performanceData = {
        training: data.training || {},
        set: data.set || {},
      };
    }
  } catch (err) {
    console.error('[Employees] Error loading performance data:', err);
    performanceData = { training: {}, set: {} };
  }
}

async function savePerformanceData() {
  try {
    await setDoc(doc(db, 'settings', 'employeePerformance'), performanceData, { merge: false });
  } catch (err) {
    console.error('[Employees] Error saving performance data:', err);
  }
}

async function loadTestingResults() {
  try {
    const snap = await getDocs(collection(db, 'testingResults'));
    testingResults = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('[Employees] Error loading testing results:', err);
    testingResults = [];
  }
}

async function loadQuestionTypeMap() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'setQuestionTypes'));
    questionTypeMap = snap.exists() ? (snap.data().types || {}) : {};
  } catch (err) {
    console.error('[Employees] Error loading question types:', err);
    questionTypeMap = {};
  }
}

async function saveQuestionTypeMap() {
  try {
    await setDoc(doc(db, 'settings', 'setQuestionTypes'), { types: questionTypeMap }, { merge: false });
  } catch (err) {
    console.error('[Employees] Error saving question types:', err);
  }
}

// ============================================================
// Derived data helpers
// ============================================================

function buildPoolToMarket() {
  poolToMarket = {};
  poolsData.forEach(pool => {
    const market = Array.isArray(pool.markets) && pool.markets.length > 0
      ? pool.markets[0]
      : (pool.market ? String(pool.market) : 'Other');
    const name = pool.name || pool.id;
    poolToMarket[name] = market;
  });
}

function buildMarketList() {
  const markets = new Set();
  employeesData.forEach(emp => {
    const m = poolToMarket[emp.homePool] || 'Other';
    markets.add(m);
  });
  testingResults.forEach((result) => {
    if (isUnlistedRescuerResult(result)) markets.add(getResultMarket(result));
  });
  marketList = Array.from(markets).sort();
}

function getEmployeeMarket(emp) {
  return poolToMarket[emp.homePool] || 'Other';
}

function normalizeEmployeeRecord(rawEmployee) {
  const employee = rawEmployee || {};
  const legacyId = (employee.id ?? employee.employeeId ?? '').toString().trim();
  const emailSource = employee.email ?? (legacyId.includes('@') ? legacyId : '');
  const email = emailSource.toString().trim().toLowerCase();
  return {
    ...employee,
    id: email || legacyId,
    employeeId: (employee.employeeId ?? legacyId).toString().trim(),
    email,
    username: (employee.username ?? '').toString().trim().toLowerCase(),
    firstName: (employee.firstName ?? '').toString().trim(),
    lastName: (employee.lastName ?? '').toString().trim(),
    homePool: (employee.homePool ?? '').toString().trim(),
    phone: (employee.phone ?? '').toString().replace(/\D/g, ''),
  };
}

function normalizeIdentityKey(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeNameKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function getResultPoolName(result) {
  const emp = getEmployeeById(result?.employeeId);
  return String(result?.poolName || emp?.homePool || '').trim();
}

function getResultMarket(result) {
  const emp = getEmployeeById(result?.employeeId);
  if (emp) return getEmployeeMarket(emp);
  const poolName = getResultPoolName(result);
  return poolToMarket[poolName] || 'Other';
}

function getAvailableMarkets() {
  const markets = new Set();
  employeesData.forEach((employee) => markets.add(getEmployeeMarket(employee)));
  testingResults.forEach((result) => {
    if (Object.prototype.hasOwnProperty.call(RUBRIC_LABELS, result.rubricKey)) {
      markets.add(getResultMarket(result));
    }
  });
  return [...markets].filter(Boolean).sort();
}

function getAvailablePools() {
  const pools = new Set();
  employeesData.forEach((employee) => {
    if (employee.homePool) pools.add(employee.homePool);
  });
  testingResults.forEach((result) => {
    const pool = getResultPoolName(result);
    if (pool) pools.add(pool);
  });
  return [...pools].sort();
}

function getTypedRescuerName(result = {}) {
  if (result.resolvedFromTypedRescuerName && !result.unlistedRescuer) return '';
  return String(
    result.typedRescuerName
      || (result.unlistedRescuer ? (result.rescuerName || result.employeeName) : '')
      || ''
  ).trim();
}

function isUnlistedRescuerResult(result = {}) {
  const typedName = getTypedRescuerName(result);
  if (!typedName) return false;
  return !getEmployeeById(result.employeeId);
}

// ============================================================
// Roster-derived training completion (from training sessions)
// ============================================================

function computeRosterCompletion(empId) {
  const id = String(empId);

  const attended = (type, month) =>
    trainingSessions.some(s => {
      if (s.trainingType !== type) return false;
      if (month !== undefined) {
        const d = new Date(s.date);
        if (isNaN(d) || d.getMonth() + 1 !== month) return false;
      }
      return (
        Array.isArray(s.attendees) &&
        s.attendees.some(a => String(a.employeeId) === id)
      );
    });

  return {
    hrOrientation:     attended('HR Orientation'),
    onSiteOrientation: attended('On-Site Orientation'),
    juneInService:     attended('In-Service', 6),
    julyInService:     attended('In-Service', 7),
  };
}

// Effective state = saved override (if any) else roster-derived
function getTrainingState(empId) {
  const saved = performanceData.training[String(empId)];
  if (saved) return saved;
  return computeRosterCompletion(empId);
}

function countUnchecked(empId) {
  const state = getTrainingState(empId);
  return TRAINING_COLS.filter(col => !state[col.key]).length;
}

// ============================================================
// Filter dropdowns
// ============================================================

function populateFilterDropdowns() {
  const markets = getAvailableMarkets();
  const allPools = getAvailablePools();

  const setOptions = (id, values) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    values.forEach((value) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      sel.appendChild(opt);
    });
  };

  [
    'trainingMarketFilter',
    'setMarketFilter',
    'overallMarketFilter',
    'metricsMarketFilter',
    'graphMarketFilter',
  ].forEach((id) => {
    setOptions(id, markets);
  });

  [
    'trainingPoolFilter',
    'setPoolFilter',
    'metricsPoolFilter',
    'graphPoolFilter',
  ].forEach((id) => {
    setOptions(id, allPools);
  });

  populateOverallPoolFilter();
  populateMetricsPoolFilter();
  populateGraphPoolFilter();
  populateMetricsWeekFilter();
  populateGraphTopicFilter();
}

function populateOverallPoolFilter() {
  const poolSel = document.getElementById('overallPoolFilter');
  if (!poolSel) return;
  poolSel.innerHTML = '<option value="all">All Pools</option>';
  if (overallFilters.market === 'all') return;
  const pools = [...new Set(
    [
      ...employeesData
        .filter(e => getEmployeeMarket(e) === overallFilters.market)
        .map(e => e.homePool),
      ...testingResults
        .filter((result) => getResultMarket(result) === overallFilters.market)
        .map((result) => getResultPoolName(result)),
    ].filter(Boolean)
  )].sort();
  pools.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    poolSel.appendChild(opt);
  });
}

function populateMetricsPoolFilter() {
  const poolSel = document.getElementById('metricsPoolFilter');
  if (!poolSel) return;
  poolSel.innerHTML = '<option value="all">All Pools</option>';
  const pools = [...new Set(
    [
      ...employeesData
        .filter((e) => metricsFilters.market === 'all' || getEmployeeMarket(e) === metricsFilters.market)
        .map((e) => e.homePool),
      ...testingResults
        .filter((result) => metricsFilters.market === 'all' || getResultMarket(result) === metricsFilters.market)
        .map((result) => getResultPoolName(result)),
    ].filter(Boolean)
  )].sort();
  pools.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    poolSel.appendChild(opt);
  });
}

function populateGraphPoolFilter() {
  const poolSel = document.getElementById('graphPoolFilter');
  if (!poolSel) return;
  poolSel.innerHTML = '<option value="all">All Pools</option>';
  const pools = [...new Set(
    [
      ...employeesData
        .filter((e) => graphFilters.market === 'all' || getEmployeeMarket(e) === graphFilters.market)
        .map((e) => e.homePool),
      ...testingResults
        .filter((result) => graphFilters.market === 'all' || getResultMarket(result) === graphFilters.market)
        .map((result) => getResultPoolName(result)),
    ].filter(Boolean)
  )].sort();
  pools.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    poolSel.appendChild(opt);
  });
}

function weekLabel(date) {
  const monday = startOfWeekMonday(date);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return `${fmtDate(monday)} - ${fmtDate(sunday)}`;
}

function populateMetricsWeekFilter() {
  const weekSel = document.getElementById('metricsWeekFilter');
  if (!weekSel) return;
  const current = weekSel.value || 'all';
  weekSel.innerHTML = '<option value="all">All Weeks</option>';
  const weeks = [...new Set(
    getFilteredResultsForMetrics({ market: 'all', pool: 'all', week: 'all' })
      .map((r) => weekLabel(parseResultDate(r)))
      .filter(Boolean)
  )].sort((a, b) => b.localeCompare(a));
  weeks.forEach((w) => {
    const opt = document.createElement('option');
    opt.value = w;
    opt.textContent = w;
    weekSel.appendChild(opt);
  });
  weekSel.value = weeks.includes(current) ? current : 'all';
}

function setupFilterListeners() {
  document.getElementById('trainingMarketFilter')?.addEventListener('change', e => {
    trainingFilters.market = e.target.value;
    resetTrainingPagination();
    renderTrainingTables();
  });
  document.getElementById('trainingPoolFilter')?.addEventListener('change', e => {
    trainingFilters.pool = e.target.value;
    resetTrainingPagination();
    renderTrainingTables();
  });
  document.getElementById('trainingCompletionFilter')?.addEventListener('change', e => {
    trainingFilters.completion = e.target.value;
    resetTrainingPagination();
    renderTrainingTables();
  });

  document.getElementById('setMarketFilter')?.addEventListener('change', e => {
    setFilters.market = e.target.value;
    resetSetPagination();
    renderSetTables();
  });
  document.getElementById('setPoolFilter')?.addEventListener('change', e => {
    setFilters.pool = e.target.value;
    resetSetPagination();
    renderSetTables();
  });

  document.getElementById('overallMarketFilter')?.addEventListener('change', e => {
    overallFilters.market = e.target.value;
    // Reset pool filter when market changes
    const poolSel = document.getElementById('overallPoolFilter');
    overallFilters.pool = 'all';
    if (poolSel) poolSel.value = 'all';
    populateOverallPoolFilter();
    renderOverallPerformance();
  });
  document.getElementById('overallPoolFilter')?.addEventListener('change', e => {
    overallFilters.pool = e.target.value;
    renderOverallPerformance();
  });

  document.getElementById('metricsMarketFilter')?.addEventListener('change', (e) => {
    metricsFilters.market = e.target.value;
    metricsFilters.pool = 'all';
    metricsFilters.week = 'all';
    const poolSel = document.getElementById('metricsPoolFilter');
    const weekSel = document.getElementById('metricsWeekFilter');
    if (poolSel) poolSel.value = 'all';
    if (weekSel) weekSel.value = 'all';
    populateMetricsPoolFilter();
    populateMetricsWeekFilter();
    renderQuestionMetrics();
  });

  document.getElementById('metricsPoolFilter')?.addEventListener('change', (e) => {
    metricsFilters.pool = e.target.value;
    metricsFilters.week = 'all';
    const weekSel = document.getElementById('metricsWeekFilter');
    if (weekSel) weekSel.value = 'all';
    populateMetricsWeekFilter();
    renderQuestionMetrics();
  });

  document.getElementById('metricsWeekFilter')?.addEventListener('change', (e) => {
    metricsFilters.week = e.target.value;
    renderQuestionMetrics();
  });

  document.getElementById('graphTestFilter')?.addEventListener('change', (e) => {
    graphFilters.test = e.target.value;
    graphFilters.topic = 'all';
    populateGraphTopicFilter();
    renderPerformanceGraph();
  });

  document.getElementById('graphMarketFilter')?.addEventListener('change', (e) => {
    graphFilters.market = e.target.value;
    graphFilters.pool = 'all';
    const poolSel = document.getElementById('graphPoolFilter');
    if (poolSel) poolSel.value = 'all';
    populateGraphPoolFilter();
    renderPerformanceGraph();
  });

  document.getElementById('graphPoolFilter')?.addEventListener('change', (e) => {
    graphFilters.pool = e.target.value;
    renderPerformanceGraph();
  });

  document.getElementById('graphTimeFilter')?.addEventListener('change', (e) => {
    graphFilters.time = e.target.value;
    renderPerformanceGraph();
  });

  document.getElementById('graphTopicFilter')?.addEventListener('change', (e) => {
    graphFilters.topic = e.target.value;
    renderPerformanceGraph();
  });
}

// ============================================================
// Page tabs
// ============================================================

function setupPageTabs() {
  document.querySelectorAll('.emp-page-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.emp-page-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.emp-tab-panel').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      const panelId =
        btn.dataset.tab === 'training' ? 'trainingSection' :
        btn.dataset.tab === 'set' ? 'setSection' :
        'setMetricsSection';
      document.getElementById(panelId)?.classList.remove('hidden');
    });
  });
}

// ============================================================
// Render all
// ============================================================

function renderAll() {
  renderTrainingTables();
  renderSetTables();
  renderOverallPerformance();
  renderQuestionMetrics();
  renderPerformanceGraph();
}

// ============================================================
// TRAINING COMPLETION TABLES
// ============================================================

function resetTrainingPagination() {
  Object.keys(trainingPageState).forEach((key) => delete trainingPageState[key]);
}

function resetSetPagination() {
  Object.keys(setPageState).forEach((key) => delete setPageState[key]);
}

function getClampedPage(state, key, totalRows) {
  const totalPages = Math.max(1, Math.ceil(totalRows / EMPLOYEE_TABLE_PAGE_SIZE));
  const current = Math.min(Math.max(1, Number(state[key]) || 1), totalPages);
  state[key] = current;
  return { current, totalPages };
}

function buildEmployeeTablePagination({ totalPages, currentPage, onPageChange }) {
  if (totalPages <= 1) return null;

  const container = document.createElement('div');
  container.className = 'emp-pagination-row emp-table-pagination';

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'emp-pagination-arrow';
  backBtn.textContent = '←';
  if (currentPage > 1) {
    backBtn.addEventListener('click', () => onPageChange(currentPage - 1));
  } else {
    backBtn.style.visibility = 'hidden';
    backBtn.disabled = true;
  }
  container.appendChild(backBtn);

  const select = document.createElement('select');
  select.className = 'training-filter-select emp-pagination-select';
  for (let page = 1; page <= totalPages; page++) {
    const option = document.createElement('option');
    option.value = String(page);
    option.textContent = `Page ${page}`;
    option.selected = page === currentPage;
    select.appendChild(option);
  }
  select.addEventListener('change', () => onPageChange(Number(select.value) || 1));
  container.appendChild(select);

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'emp-pagination-arrow';
  nextBtn.textContent = '→';
  if (currentPage < totalPages) {
    nextBtn.addEventListener('click', () => onPageChange(currentPage + 1));
  } else {
    nextBtn.style.visibility = 'hidden';
    nextBtn.disabled = true;
  }
  container.appendChild(nextBtn);

  return container;
}

function renderTrainingTables() {
  const container = document.getElementById('trainingTablesContainer');
  if (!container) return;
  container.innerHTML = '';

  const markets = trainingFilters.market === 'all'
    ? marketList
    : marketList.filter(m => m === trainingFilters.market);

  markets.forEach(market => {
    let employees = employeesData.filter(e => getEmployeeMarket(e) === market);

    // Pool filter
    if (trainingFilters.pool !== 'all') {
      employees = employees.filter(e => e.homePool === trainingFilters.pool);
    }

    if (employees.length === 0) return;

    // Filter by completion
    if (trainingFilters.completion === 'complete') {
      employees = employees.filter(e => countUnchecked(e.id) === 0);
    } else if (trainingFilters.completion === 'incomplete') {
      employees = employees.filter(e => countUnchecked(e.id) > 0);
    }

    if (employees.length === 0) return;

    // Always sort least completed first (most incomplete first), then alphabetical
    employees = [...employees].sort((a, b) => {
      const diff = countUnchecked(b.id) - countUnchecked(a.id);
      if (diff !== 0) return diff;
      return fullName(a).localeCompare(fullName(b));
    });

    const section = buildTrainingMarketSection(market, employees);
    container.appendChild(section);
  });

  if (container.childElementCount === 0) {
    container.innerHTML = '<p style="margin:20px 0; color:#999;">No employees match the current filters.</p>';
  }
}

function buildTrainingMarketSection(market, employees) {
  const section = document.createElement('div');
  section.className = 'emp-market-section';
  section.dataset.market = market;
  const pageKey = market;
  const { current, totalPages } = getClampedPage(trainingPageState, pageKey, employees.length);
  const pageEmployees = employees.slice(
    (current - 1) * EMPLOYEE_TABLE_PAGE_SIZE,
    current * EMPLOYEE_TABLE_PAGE_SIZE
  );

  const heading = document.createElement('button');
  heading.type = 'button';
  heading.className = 'emp-metrics-toggle';
  heading.innerHTML = `<span class="emp-metrics-arrow">▸</span><span>${market}</span>`;
  section.appendChild(heading);

  const contentWrap = document.createElement('div');
  contentWrap.className = 'emp-metrics-body hidden';
  if (trainingSectionOpenState[market]) {
    contentWrap.classList.remove('hidden');
    heading.querySelector('.emp-metrics-arrow').textContent = '▾';
  }

  // Table wrapper (overlay target)
  const tableSection = document.createElement('div');
  tableSection.className = 'emp-table-section sanitation-section overlay-disabled';

  const table = document.createElement('table');
  table.className = 'emp-table';

  // Header row
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const nameTh = document.createElement('th');
  nameTh.textContent = 'Employee';
  headerRow.appendChild(nameTh);
  TRAINING_COLS.forEach(col => {
    const th = document.createElement('th');
    th.textContent = col.label;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body rows
  const tbody = document.createElement('tbody');
  pageEmployees.forEach(emp => {
    const row = buildTrainingRow(emp);
    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  tableSection.appendChild(table);
  contentWrap.appendChild(tableSection);

  const pagination = buildEmployeeTablePagination({
    totalPages,
    currentPage: current,
    onPageChange: (nextPage) => {
      trainingPageState[pageKey] = nextPage;
      renderTrainingTables();
    },
  });
  if (pagination) contentWrap.appendChild(pagination);

  // Edit/Save controls
  const controls = buildEditSaveControls({
    onEdit: () => {
      tableSection.classList.remove('overlay-disabled');
      tableSection.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.disabled = false;
      });
    },
    onSave: async () => {
      // Read current checkbox states into performanceData.training
      tbody.querySelectorAll('tr').forEach(row => {
        const empId = row.dataset.empId;
        if (!empId) return;
        const saved = {};
        TRAINING_COLS.forEach((col, i) => {
          const cb = row.cells[i + 1]?.querySelector('input[type="checkbox"]');
          if (cb) saved[col.key] = cb.checked;
        });
        performanceData.training[empId] = saved;
      });
      await savePerformanceData();
      tableSection.classList.add('overlay-disabled');
      tableSection.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.disabled = true;
      });
      renderTrainingTables();
    },
  });
  contentWrap.appendChild(controls);

  heading.addEventListener('click', () => {
    contentWrap.classList.toggle('hidden');
    const open = !contentWrap.classList.contains('hidden');
    trainingSectionOpenState[market] = open;
    heading.querySelector('.emp-metrics-arrow').textContent = open ? '▾' : '▸';
  });
  section.appendChild(contentWrap);

  return section;
}

function buildTrainingRow(emp) {
  const tr = document.createElement('tr');
  tr.dataset.empId = String(emp.id);

  // Name cell with tooltip + green checkmark if fully complete
  const nameTd = document.createElement('td');
  nameTd.className = 'emp-name-cell';

  if (countUnchecked(emp.id) === 0) {
    const check = document.createElement('span');
    check.className = 'emp-complete-check';
    check.textContent = '✓ ';
    nameTd.appendChild(check);
  }

  const nameSpan = document.createElement('span');
  nameSpan.className = 'emp-name-text';
  nameSpan.textContent = fullName(emp);

  const tooltip = document.createElement('div');
  tooltip.className = 'emp-name-tooltip';
  tooltip.innerHTML = `
    <strong>${fullName(emp)}</strong><br>
    ID: ${emp.id || '—'}<br>
    Home Pool: ${emp.homePool || '—'}
  `;

  nameTd.appendChild(nameSpan);
  nameTd.appendChild(tooltip);
  tr.appendChild(nameTd);

  // Training checkbox cells
  const state = getTrainingState(emp.id);
  TRAINING_COLS.forEach(col => {
    const td = document.createElement('td');
    td.className = 'emp-check-cell';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'market-filter-checkbox emp-training-cb';
    cb.checked = !!state[col.key];
    cb.disabled = true; // read-only until Edit mode

    td.appendChild(cb);
    tr.appendChild(td);
  });

  return tr;
}

// ============================================================
// SET PERFORMANCE TABLES
// ============================================================

function renderSetTables() {
  const container = document.getElementById('setTablesContainer');
  if (!container) return;
  container.innerHTML = '';

  const markets = setFilters.market === 'all'
    ? marketList
    : marketList.filter(m => m === setFilters.market);

  markets.forEach(market => {
    let employees = employeesData.filter(e => getEmployeeMarket(e) === market);

    if (setFilters.pool !== 'all') {
      employees = employees.filter(e => e.homePool === setFilters.pool);
    }

    const unlistedRescuers = getUnlistedRescuersForSet(market, setFilters.pool);

    if (employees.length === 0 && unlistedRescuers.length === 0) return;

    employees = [...employees].sort((a, b) => fullName(a).localeCompare(fullName(b)));

    const section = buildSetMarketSection(market, employees, unlistedRescuers);
    container.appendChild(section);
  });

  if (container.childElementCount === 0) {
    container.innerHTML = '<p style="margin:20px 0; color:#999;">No employees match the current filters.</p>';
  }
}

function getResultTimeValue(result) {
  const date = parseResultDate(result);
  if (date) return date.getTime();
  return 0;
}

function getUnlistedRescuersForSet(market, pool) {
  const grouped = new Map();
  testingResults
    .filter((result) => Object.prototype.hasOwnProperty.call(RUBRIC_LABELS, result.rubricKey))
    .filter((result) => isUnlistedRescuerResult(result))
    .filter((result) => {
      const resultMarket = getResultMarket(result);
      const resultPool = getResultPoolName(result);
      if (market !== 'all' && resultMarket !== market) return false;
      if (pool !== 'all' && resultPool !== pool) return false;
      return true;
    })
    .forEach((result) => {
      const typedName = getTypedRescuerName(result);
      const nameKey = normalizeNameKey(typedName);
      if (!nameKey) return;
      const resultPool = getResultPoolName(result);
      const groupKey = `${getResultMarket(result)}|${resultPool}|${nameKey}`;
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, {
          id: result.employeeId || `typed:${nameKey.replace(/[^a-z0-9]+/g, '-')}`,
          isUnlistedRescuer: true,
          typedName,
          firstName: typedName,
          lastName: '',
          homePool: resultPool,
          setResults: {},
          resultIds: [],
          latestByRubric: {},
        });
      }
      const item = grouped.get(groupKey);
      if (!item.homePool && resultPool) item.homePool = resultPool;
      item.resultIds.push(result.id);
      const existing = item.latestByRubric[result.rubricKey];
      if (!existing || getResultTimeValue(result) >= getResultTimeValue(existing)) {
        item.latestByRubric[result.rubricKey] = result;
        item.setResults[result.rubricKey] = result.passed ? 'Pass' : 'Fail';
      }
    });

  return [...grouped.values()]
    .sort((a, b) => fullName(a).localeCompare(fullName(b)));
}

function buildSetMarketSection(market, employees, unlistedRescuers = []) {
  const section = document.createElement('div');
  section.className = 'emp-market-section';
  section.dataset.market = market;
  const pageKey = market;
  const { current, totalPages } = getClampedPage(setPageState, pageKey, employees.length);
  const pageEmployees = employees.slice(
    (current - 1) * EMPLOYEE_TABLE_PAGE_SIZE,
    current * EMPLOYEE_TABLE_PAGE_SIZE
  );

  const heading = document.createElement('button');
  heading.type = 'button';
  heading.className = 'emp-metrics-toggle';
  heading.innerHTML = `<span class="emp-metrics-arrow">▸</span><span>${market}</span>`;
  section.appendChild(heading);

  const contentWrap = document.createElement('div');
  contentWrap.className = 'emp-metrics-body hidden';
  if (setSectionOpenState[market]) {
    contentWrap.classList.remove('hidden');
    heading.querySelector('.emp-metrics-arrow').textContent = '▾';
  }

  const tableSection = document.createElement('div');
  tableSection.className = 'emp-table-section sanitation-section overlay-disabled';

  const table = document.createElement('table');
  table.className = 'emp-table emp-set-table';

  // Header
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const nameTh = document.createElement('th');
  nameTh.textContent = 'Employee';
  headerRow.appendChild(nameTh);
  SET_COLS.forEach(col => {
    const th = document.createElement('th');
    th.textContent = col.label;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body
  const tbody = document.createElement('tbody');
  pageEmployees.forEach(emp => {
    const row = buildSetRow(emp);
    tbody.appendChild(row);
  });
  unlistedRescuers.forEach((rescuer) => {
    const row = buildSetRow(rescuer);
    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  tableSection.appendChild(table);
  contentWrap.appendChild(tableSection);

  const pagination = buildEmployeeTablePagination({
    totalPages,
    currentPage: current,
    onPageChange: (nextPage) => {
      setPageState[pageKey] = nextPage;
      renderSetTables();
    },
  });
  if (pagination) contentWrap.appendChild(pagination);

  // Edit/Save controls
  const controls = buildEditSaveControls({
    onEdit: () => {
      tableSection.classList.remove('overlay-disabled');
      tableSection.querySelectorAll('select, input').forEach(el => {
        if (el.dataset.readonly === 'true') return;
        el.disabled = false;
      });
    },
    onSave: async () => {
      // Read current SET data into performanceData.set
      tbody.querySelectorAll('tr').forEach(row => {
        if (row.dataset.unlistedRescuer === 'true') return;
        const empId = row.dataset.empId;
        if (!empId) return;
        const saved = {};
        SET_COLS.forEach(col => {
          const cell = row.querySelector(`[data-col="${col.key}"]`);
          if (!cell) return;
          const sel = cell.querySelector('select');
          const retrainCb = cell.querySelector('.emp-retrain-cb');
          saved[col.key] = sel ? sel.value : '';
          saved[col.key + 'Retrained'] = retrainCb ? retrainCb.checked : false;
        });
        performanceData.set[empId] = saved;
      });
      await savePerformanceData();
      tableSection.classList.add('overlay-disabled');
      tableSection.querySelectorAll('select, input').forEach(el => {
        el.disabled = true;
      });
    },
  });
  contentWrap.appendChild(controls);
  heading.addEventListener('click', () => {
    contentWrap.classList.toggle('hidden');
    const open = !contentWrap.classList.contains('hidden');
    setSectionOpenState[market] = open;
    heading.querySelector('.emp-metrics-arrow').textContent = open ? '▾' : '▸';
  });
  section.appendChild(contentWrap);

  return section;
}

function buildSetRow(emp) {
  const tr = document.createElement('tr');
  tr.dataset.empId = String(emp.id);
  if (emp.isUnlistedRescuer) {
    tr.dataset.unlistedRescuer = 'true';
    tr.classList.add('emp-unlisted-rescuer-row');
  }

  // Name cell with tooltip
  const nameTd = document.createElement('td');
  nameTd.className = 'emp-name-cell';
  const nameSpan = emp.isUnlistedRescuer
    ? document.createElement('button')
    : document.createElement('span');
  nameSpan.className = emp.isUnlistedRescuer
    ? 'emp-name-text emp-unlisted-rescuer-name'
    : 'emp-name-text';
  nameSpan.textContent = fullName(emp);
  if (emp.isUnlistedRescuer) {
    nameSpan.type = 'button';
    nameSpan.addEventListener('click', () => openTypedRescuerAssignmentModal(emp));
  }

  const tooltip = document.createElement('div');
  tooltip.className = 'emp-name-tooltip';
  tooltip.innerHTML = `
    <strong>${escapeHtml(fullName(emp))}</strong><br>
    ID: ${escapeHtml(emp.isUnlistedRescuer ? 'Unlisted typed name' : (emp.id || '—'))}<br>
    Home Pool: ${escapeHtml(emp.homePool || '—')}${emp.isUnlistedRescuer ? '<br>Click to assign this name to an employee.' : ''}
  `;

  nameTd.appendChild(nameSpan);
  nameTd.appendChild(tooltip);
  tr.appendChild(nameTd);

  // SET cells
  const saved = emp.isUnlistedRescuer ? (emp.setResults || {}) : (performanceData.set[String(emp.id)] || {});
  SET_COLS.forEach(col => {
    const td = document.createElement('td');
    td.className = 'emp-set-cell';
    td.dataset.col = col.key;

    const wrapper = document.createElement('div');
    wrapper.className = 'emp-set-cell-inner';

    // Result dropdown
    const sel = document.createElement('select');
    sel.className = 'emp-result-select';
    sel.disabled = true;
    if (emp.isUnlistedRescuer) sel.dataset.readonly = 'true';
    ['', 'Pass', 'Fail'].forEach(val => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val || 'Result';
      sel.appendChild(opt);
    });
    const savedResult = (saved[col.key] || '').toLowerCase();
    sel.value = savedResult === 'pass' ? 'Pass' : savedResult === 'fail' ? 'Fail' : '';

    // Retrained checkbox container
    const retrainDiv = document.createElement('div');
    retrainDiv.className = 'emp-retrain-row';
    if (sel.value !== 'Fail') retrainDiv.classList.add('hidden');

    const retrainLabel = document.createElement('label');
    retrainLabel.className = 'emp-retrain-label';

    const retrainCb = document.createElement('input');
    retrainCb.type = 'checkbox';
    retrainCb.className = 'market-filter-checkbox emp-retrain-cb';
    retrainCb.disabled = true;
    if (emp.isUnlistedRescuer) retrainCb.dataset.readonly = 'true';
    retrainCb.checked = !!saved[col.key + 'Retrained'];

    const retrainText = document.createElement('span');
    retrainText.textContent = 'Retrained?';

    retrainLabel.appendChild(retrainCb);
    retrainLabel.appendChild(retrainText);
    retrainDiv.appendChild(retrainLabel);

    // Show/hide retrain row based on dropdown
    sel.addEventListener('change', () => {
      if (sel.value === 'Fail') {
        retrainDiv.classList.remove('hidden');
      } else {
        retrainDiv.classList.add('hidden');
        retrainCb.checked = false;
      }
    });

    wrapper.appendChild(sel);
    wrapper.appendChild(retrainDiv);
    td.appendChild(wrapper);
    tr.appendChild(td);
  });

  return tr;
}

// ============================================================
// Edit/Save controls builder (reusable per table)
// ============================================================

function buildEditSaveControls({ onEdit, onSave }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'emp-controls-row';

  // Build the toggle using same structure as #sanitationControls
  const controlsDiv = document.createElement('div');
  controlsDiv.className = 'emp-edit-save-controls sanitation-controls';

  const thumb = document.createElement('div');
  thumb.className = 'sanitation-controls-thumb';
  thumb.style.transform = 'translateX(100%)'; // Start on Save (read-only) side

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'editAndSave';
  editBtn.textContent = 'Edit';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'editAndSave active';
  saveBtn.textContent = 'Save';
  saveBtn.disabled = true;

  controlsDiv.append(thumb, editBtn, saveBtn);
  wrapper.appendChild(controlsDiv);

  editBtn.addEventListener('click', () => {
    editBtn.classList.add('active');
    saveBtn.classList.remove('active');
    editBtn.disabled = true;
    saveBtn.disabled = false;
    thumb.style.transform = 'translateX(0%)';
    onEdit();
  });

  saveBtn.addEventListener('click', async () => {
    saveBtn.classList.add('active');
    editBtn.classList.remove('active');
    saveBtn.disabled = true;
    editBtn.disabled = false;
    thumb.style.transform = 'translateX(100%)';
    await onSave();
  });

  return wrapper;
}

// ============================================================
// OVERALL PERFORMANCE TABLE
// ============================================================

/**
 * Compute pass rates for a list of employees.
 * Returns { [setKey]: { pass, total } }
 */
function computePassRates(employees) {
  const rates = {};
  SET_COLS.forEach(col => {
    rates[col.key] = { pass: 0, total: 0 };
  });
  employees.forEach(emp => {
    const saved = performanceData.set[String(emp.id)] || {};
    SET_COLS.forEach(col => {
      const val = saved[col.key];
      if (val === 'Pass' || val === 'Fail') {
        rates[col.key].total++;
        if (val === 'Pass') rates[col.key].pass++;
      }
    });
  });
  return rates;
}

/**
 * Interpolate color from red→yellow→green based on percentage 0–100.
 */
function passRateColor(pct) {
  // Benchmarks: 0%→#7b1e1e, 50%→#8a6d00, 100%→#1e7b29
  if (pct <= 50) {
    const t = pct / 50;
    const r = Math.round(123 + t * (138 - 123));
    const g = Math.round(30  + t * (109 - 30));
    const b = Math.round(30  + t * (0   - 30));
    return `rgb(${r},${g},${b})`;
  } else {
    const t = (pct - 50) / 50;
    const r = Math.round(138 + t * (30  - 138));
    const g = Math.round(109 + t * (123 - 109));
    const b = Math.round(0   + t * (41  - 0));
    return `rgb(${r},${g},${b})`;
  }
}

function renderOverallPerformance() {
  const container = document.getElementById('overallPerfContainer');
  if (!container) return;
  container.innerHTML = '';

  // Determine rows: market-level or pool-level
  const isAllMarkets = overallFilters.market === 'all';
  const isAllPools = overallFilters.pool === 'all';

  let rows = []; // [{label, employees}]

  if (isAllMarkets) {
    // One row per market, sorted
    [...marketList].sort().forEach(market => {
      const emps = employeesData.filter(e => getEmployeeMarket(e) === market);
      if (emps.length) rows.push({ label: market, employees: emps });
    });
  } else if (isAllPools) {
    // One row per pool in the selected market, sorted
    const pools = [...new Set(
      employeesData
        .filter(e => getEmployeeMarket(e) === overallFilters.market)
        .map(e => e.homePool).filter(Boolean)
    )].sort();
    pools.forEach(pool => {
      const emps = employeesData.filter(e =>
        getEmployeeMarket(e) === overallFilters.market && e.homePool === pool
      );
      if (emps.length) rows.push({ label: pool, employees: emps });
    });
  } else {
    // Single pool row
    const emps = employeesData.filter(e =>
      getEmployeeMarket(e) === overallFilters.market && e.homePool === overallFilters.pool
    );
    if (emps.length) rows.push({ label: overallFilters.pool, employees: emps });
  }

  if (!rows.length) {
    container.innerHTML = '<p style="margin:20px 0; color:#999;">No data available.</p>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'emp-table emp-overall-table';

  // Header row: label + one column per SET type (combined fraction/%)
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const firstColLabel = isAllMarkets ? 'Market' : 'Pool';
  const th0 = document.createElement('th');
  th0.textContent = firstColLabel;
  headerRow.appendChild(th0);
  SET_COLS.forEach(col => {
    const th = document.createElement('th');
    th.textContent = col.label;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach(({ label, employees }) => {
    const rates = computePassRates(employees);
    const tr = document.createElement('tr');

    const td0 = document.createElement('td');
    td0.textContent = label;
    tr.appendChild(td0);

    SET_COLS.forEach(col => {
      const { pass, total } = rates[col.key];
      const pct = total > 0 ? Math.round((pass / total) * 100) : null;

      const td = document.createElement('td');
      td.textContent = total > 0 ? `${pass}/${total} (${pct}%)` : '—';
      if (pct !== null) {
        td.style.backgroundColor = passRateColor(pct);
        td.style.color = '#fff';
      }
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}

function parseResultDate(result) {
  if (result?.date) {
    const d = new Date(`${result.date}T12:00:00`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (result?.timestamp?.toDate) return result.timestamp.toDate();
  if (result?.timestamp?.seconds) return new Date(result.timestamp.seconds * 1000);
  return null;
}

function startOfWeekMonday(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function fmtDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${m}/${d}/${y}`;
}

function getEmployeeById(empId) {
  const key = normalizeIdentityKey(empId);
  if (!key) return null;
  return employeesData.find((entry) => {
    const employee = normalizeEmployeeRecord(entry);
    return [
      employee.id,
      employee.email,
      employee.employeeId,
      employee.username,
    ].map(normalizeIdentityKey).some((candidate) => candidate && candidate === key);
  }) || null;
}

function resultMatchesMarketPool(result, market, pool) {
  const resultPool = getResultPoolName(result);
  const resultMarket = getResultMarket(result);
  if (market !== 'all' && resultMarket !== market) return false;
  if (pool !== 'all' && resultPool !== pool) return false;
  return true;
}

function getFilteredResultsForMetrics(filters = metricsFilters) {
  return testingResults
    .filter((r) => Object.prototype.hasOwnProperty.call(RUBRIC_LABELS, r.rubricKey))
    .filter((r) => resultMatchesMarketPool(r, filters.market, filters.pool))
    .filter((r) => {
      if (filters.week === 'all') return true;
      const date = parseResultDate(r);
      if (!date) return false;
      return weekLabel(date) === filters.week;
    });
}

function getTopicForQuestion(rubricKey, questionNumber) {
  return questionTypeMap?.[rubricKey]?.[String(questionNumber)] || '';
}

function setTopicForQuestion(rubricKey, questionNumber, value) {
  if (!questionTypeMap[rubricKey]) questionTypeMap[rubricKey] = {};
  if (!value) delete questionTypeMap[rubricKey][String(questionNumber)];
  else questionTypeMap[rubricKey][String(questionNumber)] = value;
}

function renderQuestionMetrics() {
  const container = document.getElementById('questionMetricsContainer');
  if (!container) return;
  container.innerHTML = '';

  const filtered = getFilteredResultsForMetrics();
  SET_COLS.forEach((rubric) => {
    const rubricResults = filtered.filter((r) => r.rubricKey === rubric.key);
    const section = document.createElement('div');
    section.className = 'emp-market-section';

    const heading = document.createElement('button');
    heading.type = 'button';
    heading.className = 'emp-metrics-toggle';
    heading.innerHTML = `<span class="emp-metrics-arrow">▸</span><span>${rubric.label}</span>`;

    const body = document.createElement('div');
    body.className = 'emp-metrics-body hidden';
    if (metricsOpenState[rubric.key]) {
      body.classList.remove('hidden');
      heading.querySelector('.emp-metrics-arrow').textContent = '▾';
    }

    const table = document.createElement('table');
    table.className = 'emp-table emp-overall-table';
    const topicEditable = !!metricsTopicEditState[rubric.key];
    table.classList.toggle('emp-topic-col-saved', !topicEditable);
    table.innerHTML = `
      <thead>
        <tr>
          <th style="width: 14%;">Question #</th>
          <th class="emp-question-type-th"></th>
          <th style="width: 26%;">Average Correctness</th>
        </tr>
      </thead>
    `;
    const topicTh = table.querySelector('.emp-question-type-th');
    if (topicTh) {
      topicTh.innerHTML = `
        <div class="emp-qtype-header">
          <span>Question Type</span>
          <div class="emp-qtype-controls" data-rubric-key="${rubric.key}">
            <button type="button" class="editAndSave ${topicEditable ? 'active' : ''}" data-action="edit">Edit</button>
            <button type="button" class="editAndSave ${topicEditable ? '' : 'active'}" data-action="save">Save</button>
          </div>
        </div>
      `;
    }
    const tbody = document.createElement('tbody');

    const agg = new Map();
    rubricResults.forEach((result) => {
      const rows = Array.isArray(result.questionResults) ? result.questionResults : [];
      rows.forEach((q) => {
        const qNum = String(q.questionNumber || '');
        if (!qNum) return;
        if (!agg.has(qNum)) {
          agg.set(qNum, {
            questionNumber: qNum,
            questionText: q.questionText || '',
            correct: 0,
            total: 0,
          });
        }
        const item = agg.get(qNum);
        item.questionText = item.questionText || q.questionText || '';
        item.total += 1;
        if (q.correct === true) item.correct += 1;
      });
    });

    [...agg.values()].sort((a, b) => Number(a.questionNumber) - Number(b.questionNumber)).forEach((row) => {
      const tr = document.createElement('tr');
      const pct = row.total > 0 ? Math.round((row.correct / row.total) * 100) : null;
      tr.innerHTML = `
        <td>${row.questionNumber}</td>
        <td></td>
        <td>${row.total > 0 ? `${row.correct}/${row.total} (${pct}%)` : '—'}</td>
      `;
      if (pct !== null) {
        tr.cells[2].style.backgroundColor = passRateColor(pct);
        tr.cells[2].style.color = '#fff';
      }

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'emp-question-type-input';
      input.value = getTopicForQuestion(rubric.key, row.questionNumber);
      input.placeholder = 'Enter topic';
      input.title = row.questionText || '';
      input.disabled = !topicEditable;
      input.addEventListener('change', async () => {
        setTopicForQuestion(rubric.key, row.questionNumber, input.value.trim());
        await saveQuestionTypeMap();
        populateGraphTopicFilter();
      });
      tr.cells[1].classList.add('emp-question-type-cell');
      tr.cells[1].appendChild(input);
      tbody.appendChild(tr);
    });

    if (!tbody.children.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="3" style="text-align:left;">No question-level data for current filters.</td>';
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    const qTypeControls = table.querySelector('.emp-qtype-controls');
    if (qTypeControls) {
      qTypeControls.addEventListener('click', async (event) => {
        const btn = event.target.closest('button[data-action]');
        if (!btn) return;
        const makeEditable = btn.dataset.action === 'edit';
        metricsTopicEditState[rubric.key] = makeEditable;
        table.classList.toggle('emp-topic-col-saved', !makeEditable);
        qTypeControls.querySelectorAll('button[data-action]').forEach((b) => {
          b.classList.toggle('active', b.dataset.action === (makeEditable ? 'edit' : 'save'));
        });
        table.querySelectorAll('.emp-question-type-input').forEach((input) => {
          input.disabled = !makeEditable;
        });
        if (!makeEditable) {
          await saveQuestionTypeMap();
          populateGraphTopicFilter();
        }
      });
    }
    body.appendChild(table);
    heading.addEventListener('click', () => {
      body.classList.toggle('hidden');
      const open = !body.classList.contains('hidden');
      metricsOpenState[rubric.key] = open;
      heading.querySelector('.emp-metrics-arrow').textContent = open ? '▾' : '▸';
    });

    section.appendChild(heading);
    section.appendChild(body);
    container.appendChild(section);
  });
}

function filterResultsByTime(results, timeLabel) {
  const now = new Date();
  const start = new Date(now);
  if (timeLabel === 'Past Week') start.setDate(now.getDate() - 7);
  else if (timeLabel === 'Past 2 Weeks') start.setDate(now.getDate() - 14);
  else if (timeLabel === 'Past Month') start.setMonth(now.getMonth() - 1);
  else if (timeLabel === 'Past 3 Months') start.setMonth(now.getMonth() - 3);
  else if (timeLabel === 'This Calendar Year') start.setMonth(0, 1);
  else return results;
  start.setHours(0, 0, 0, 0);
  return results.filter((r) => {
    const d = parseResultDate(r);
    return d && d >= start && d <= now;
  });
}

function populateGraphTopicFilter() {
  const topicSel = document.getElementById('graphTopicFilter');
  if (!topicSel) return;
  const current = graphFilters.topic || 'all';
  topicSel.innerHTML = '<option value="all">All Topics</option>';
  const tests = graphFilters.test === 'all' ? Object.keys(RUBRIC_LABELS) : [graphFilters.test];
  const topics = [];
  tests.forEach((testKey) => {
    const map = questionTypeMap[testKey] || {};
    Object.values(map).forEach((topic) => {
      const t = String(topic || '').trim();
      if (t) topics.push(t);
    });
  });
  [...new Set(topics)].sort().forEach((topic) => {
    const opt = document.createElement('option');
    opt.value = topic;
    opt.textContent = topic;
    topicSel.appendChild(opt);
  });
  topicSel.value = [...topicSel.options].some((o) => o.value === current) ? current : 'all';
}

function graphBucketMode() {
  if (graphFilters.time === 'Past Week' || graphFilters.time === 'Past 2 Weeks') return 'day';
  if (graphFilters.time === 'Past Month' || graphFilters.time === 'Past 3 Months') return 'week';
  return 'month';
}

function bucketLabel(date) {
  const mode = graphBucketMode();
  if (mode === 'day') return fmtDate(date);
  if (mode === 'week') return weekLabel(date);
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

function bucketStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const mode = graphBucketMode();
  if (mode === 'week') return startOfWeekMonday(d);
  if (mode === 'month') return new Date(d.getFullYear(), d.getMonth(), 1);
  return d;
}

function buildSeriesFromResults(results) {
  const grouped = new Map();
  results.forEach((result) => {
    const date = parseResultDate(result);
    if (!date) return;
    const start = bucketStart(date);
    const key = start.toISOString().slice(0, 10);
    if (!grouped.has(key)) grouped.set(key, { date: start, pass: 0, total: 0 });
    const bucket = grouped.get(key);

    if (graphFilters.topic !== 'all') {
      const rows = Array.isArray(result.questionResults) ? result.questionResults : [];
      const typedRows = rows.filter((q) => getTopicForQuestion(result.rubricKey, q.questionNumber) === graphFilters.topic);
      typedRows.forEach((q) => {
        bucket.total += 1;
        if (q.correct) bucket.pass += 1;
      });
    } else {
      bucket.total += 1;
      if (result.passed) bucket.pass += 1;
    }
  });

  return [...grouped.values()]
    .filter((b) => b.total > 0)
    .sort((a, b) => a.date - b.date)
    .map((b) => ({
      label: bucketLabel(b.date),
      pct: Math.round((b.pass / b.total) * 100),
      fraction: `${b.pass}/${b.total}`,
    }));
}

function renderPerformanceGraph() {
  const container = document.getElementById('performanceGraphContainer');
  if (!container) return;
  container.innerHTML = '';

  let filtered = testingResults.filter((r) => Object.prototype.hasOwnProperty.call(RUBRIC_LABELS, r.rubricKey));
  if (graphFilters.test !== 'all') filtered = filtered.filter((r) => r.rubricKey === graphFilters.test);
  filtered = filtered.filter((r) => resultMatchesMarketPool(r, graphFilters.market, graphFilters.pool));
  filtered = filterResultsByTime(filtered, graphFilters.time);
  const series = buildSeriesFromResults(filtered);

  if (!series.length) {
    container.innerHTML = '<p style="margin:20px 0; color:#999;">No data available for selected filters.</p>';
    return;
  }

  const width = 1040;
  const height = 360;
  const margin = { top: 22, right: 88, bottom: 92, left: 64 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const n = series.length;
  const xStep = n > 1 ? innerW / (n - 1) : 0;
  const toX = (idx) => margin.left + idx * xStep;
  const toY = (pct) => margin.top + (100 - pct) * (innerH / 100);

  const points = series.map((pt, idx) => ({ ...pt, x: toX(idx), y: toY(pt.pct), idx }));
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // Linear regression / best-fit
  const sumX = points.reduce((s, p) => s + p.idx, 0);
  const sumY = points.reduce((s, p) => s + p.pct, 0);
  const sumXY = points.reduce((s, p) => s + p.idx * p.pct, 0);
  const sumXX = points.reduce((s, p) => s + p.idx * p.idx, 0);
  const denom = (n * sumXX - sumX * sumX) || 1;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const yStart = Math.max(0, Math.min(100, intercept));
  const yEnd = Math.max(0, Math.min(100, slope * (n - 1) + intercept));
  const bestFitPath = `M ${toX(0)} ${toY(yStart)} L ${toX(Math.max(0, n - 1))} ${toY(yEnd)}`;

  const yTicks = [0, 25, 50, 75, 100].map((v) => {
    const y = toY(v);
    return `
      <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" class="emp-graph-grid"/>
      <text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" class="emp-graph-axis-text">${v}%</text>
    `;
  }).join('');

  const xTicks = points.map((p) => `
    <line x1="${p.x}" y1="${height - margin.bottom}" x2="${p.x}" y2="${height - margin.bottom + 6}" class="emp-graph-axis"/>
    <text x="${p.x}" y="${height - margin.bottom + 22}" text-anchor="end" transform="rotate(-60 ${p.x} ${height - margin.bottom + 22})" class="emp-graph-axis-text emp-graph-xlabel">${escapeHtml(p.label)}</text>
  `).join('');

  const circles = points.map((p) => `
    <circle cx="${p.x}" cy="${p.y}" r="4.8" fill="#69140e">
      <title>${escapeHtml(`${p.label}: ${p.fraction} (${p.pct}%)`)}</title>
    </circle>
  `).join('');

  container.innerHTML = `
    <div class="emp-graph-wrap">
      <svg viewBox="0 0 ${width} ${height}" class="emp-line-graph" role="img" aria-label="Performance trend line graph">
        ${yTicks}
        <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" class="emp-graph-axis"/>
        <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" class="emp-graph-axis"/>
        <path d="${linePath}" class="emp-graph-line"/>
        <path d="${bestFitPath}" class="emp-graph-bestfit"/>
        ${circles}
        ${xTicks}
        <text x="${width / 2}" y="${height - 8}" text-anchor="middle" class="emp-graph-label">Time</text>
        <text x="18" y="${height / 2}" text-anchor="middle" transform="rotate(-90 18 ${height / 2})" class="emp-graph-label">Performance</text>
      </svg>
    </div>
  `;
}

// ============================================================
// Unlisted rescuer assignment
// ============================================================

function ensureTypedRescuerAssignmentModal() {
  let modal = document.getElementById('typedRescuerAssignmentModal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'typedRescuerAssignmentModal';
  modal.className = 'emp-assignment-modal hidden';
  modal.innerHTML = `
    <div class="emp-assignment-card" role="dialog" aria-modal="true" aria-labelledby="typedRescuerAssignmentTitle">
      <div class="emp-assignment-header">
        <h3 id="typedRescuerAssignmentTitle">Assign Rescuer</h3>
        <button type="button" class="emp-assignment-close" id="typedRescuerAssignmentClose" aria-label="Close">&times;</button>
      </div>
      <p class="emp-assignment-copy" id="typedRescuerAssignmentCopy"></p>
      <label class="emp-assignment-label" for="typedRescuerEmployeeSelect">Employee</label>
      <select id="typedRescuerEmployeeSelect" class="training-filter-select"></select>
      <p class="emp-auth-error hidden" id="typedRescuerAssignmentError"></p>
      <div class="emp-assignment-actions">
        <button type="button" class="submit-btn" id="typedRescuerAssignBtn">Assign</button>
        <button type="button" class="submit-btn secondary-btn" id="typedRescuerCancelBtn">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#typedRescuerAssignmentClose')?.addEventListener('click', closeTypedRescuerAssignmentModal);
  modal.querySelector('#typedRescuerCancelBtn')?.addEventListener('click', closeTypedRescuerAssignmentModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeTypedRescuerAssignmentModal();
  });
  modal.querySelector('#typedRescuerAssignBtn')?.addEventListener('click', assignTypedRescuerToEmployee);
  return modal;
}

function openTypedRescuerAssignmentModal(rescuer) {
  typedRescuerAssignment = rescuer;
  const modal = ensureTypedRescuerAssignmentModal();
  const copy = modal.querySelector('#typedRescuerAssignmentCopy');
  const select = modal.querySelector('#typedRescuerEmployeeSelect');
  const error = modal.querySelector('#typedRescuerAssignmentError');
  if (copy) {
    copy.textContent = `Assign "${fullName(rescuer)}" to an employee. Matching audit results will move to that employee.`;
  }
  if (error) {
    error.textContent = '';
    error.classList.add('hidden');
  }
  if (select) {
    select.innerHTML = '<option value="">Select employee</option>';
    [...employeesData]
      .sort((a, b) => fullName(a).localeCompare(fullName(b)))
      .forEach((employee) => {
        const option = document.createElement('option');
        option.value = String(employee.id || employee.email || employee.employeeId || '');
        option.textContent = `${fullName(employee)}${employee.email ? ` (${employee.email})` : ''}`;
        select.appendChild(option);
      });
  }
  modal.classList.remove('hidden');
  select?.focus();
}

function closeTypedRescuerAssignmentModal() {
  typedRescuerAssignment = null;
  document.getElementById('typedRescuerAssignmentModal')?.classList.add('hidden');
}

function isMatchingTypedRescuerResult(result, rescuer) {
  if (!isUnlistedRescuerResult(result)) return false;
  if (Array.isArray(rescuer?.resultIds) && rescuer.resultIds.length) {
    return rescuer.resultIds.includes(result.id);
  }
  return normalizeNameKey(getTypedRescuerName(result)) === normalizeNameKey(fullName(rescuer));
}

function updateResultRescuerSnapshots(result, typedName, employee) {
  const employeeId = String(employee.id || employee.email || employee.employeeId || '');
  const employeeName = fullName(employee);
  const poolName = employee.homePool || result.poolName || '';
  if (!Array.isArray(result.rescuers)) return result.rescuers;
  return result.rescuers.map((rescuer) => {
    const rescuerName = String(rescuer.typedRescuerName || rescuer.name || rescuer.employeeName || '').trim();
    if (normalizeNameKey(rescuerName) !== normalizeNameKey(typedName)) return rescuer;
    return {
      ...rescuer,
      employeeId,
      employeeName,
      name: employeeName,
      poolName,
      unlisted: false,
      resolvedFromTypedName: typedName,
    };
  });
}

async function assignTypedRescuerToEmployee() {
  const modal = ensureTypedRescuerAssignmentModal();
  const select = modal.querySelector('#typedRescuerEmployeeSelect');
  const error = modal.querySelector('#typedRescuerAssignmentError');
  const assignBtn = modal.querySelector('#typedRescuerAssignBtn');
  const selectedEmployee = getEmployeeById(select?.value || '');

  if (!typedRescuerAssignment || !selectedEmployee) {
    if (error) {
      error.textContent = 'Select an employee.';
      error.classList.remove('hidden');
    }
    return;
  }

  const typedName = fullName(typedRescuerAssignment);
  const matches = testingResults.filter((result) => isMatchingTypedRescuerResult(result, typedRescuerAssignment));
  if (!matches.length) {
    if (error) {
      error.textContent = 'No matching typed rescuer results were found.';
      error.classList.remove('hidden');
    }
    return;
  }

  const employeeId = String(selectedEmployee.id || selectedEmployee.email || selectedEmployee.employeeId || '');
  const employeeName = fullName(selectedEmployee);
  if (assignBtn) {
    assignBtn.disabled = true;
    assignBtn.textContent = 'Assigning...';
  }

  try {
    await Promise.all(matches.map(async (result) => {
      const updated = {
        ...result,
        employeeId,
        employeeName,
        rescuerName: employeeName,
        poolName: selectedEmployee.homePool || result.poolName || '',
        unlistedRescuer: false,
        typedRescuerName: '',
        resolvedFromTypedRescuerName: typedName,
        resolvedAt: new Date().toISOString(),
        rescuers: updateResultRescuerSnapshots(result, typedName, selectedEmployee),
      };
      const { id, ...stored } = updated;
      await setDoc(doc(db, 'testingResults', id), stored, { merge: true });
      Object.assign(result, updated);
    }));

    if (!performanceData.set) performanceData.set = {};
    if (!performanceData.set[employeeId]) performanceData.set[employeeId] = {};
    matches
      .filter((result) => Object.prototype.hasOwnProperty.call(RUBRIC_LABELS, result.rubricKey))
      .sort((a, b) => getResultTimeValue(a) - getResultTimeValue(b))
      .forEach((result) => {
        performanceData.set[employeeId][result.rubricKey] = result.passed ? 'Pass' : 'Fail';
      });
    await savePerformanceData();
    closeTypedRescuerAssignmentModal();
    renderAll();
  } catch (err) {
    console.error('[Employees] Error assigning typed rescuer:', err);
    if (error) {
      error.textContent = 'Unable to assign this rescuer right now.';
      error.classList.remove('hidden');
    }
  } finally {
    if (assignBtn) {
      assignBtn.disabled = false;
      assignBtn.textContent = 'Assign';
    }
  }
}

// ============================================================
// Utilities
// ============================================================

function isPlaceholderNamePart(value) {
  const text = String(value || '').trim();
  if (!text) return true;
  const normalized = text.toLowerCase();
  if (['unknown', 'unnamed', 'n/a', 'na', 'null', 'undefined', '-', '—'].includes(normalized)) return true;
  return /^_+$/.test(text);
}

function fullName(emp) {
  if (emp?.typedName) return String(emp.typedName).trim();
  const name = [emp?.firstName, emp?.lastName]
    .filter((part) => !isPlaceholderNamePart(part))
    .join(' ')
    .trim();
  return name || emp?.email || emp?.id || '(unnamed)';
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

window.addEventListener('beforeunload', (e) => {
  const editingTables = document.querySelectorAll('.emp-table-section:not(.overlay-disabled)');
  if (editingTables.length > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});
