// script.js — Main ChemLog application logic
// Loaded as type="module" from chem/chem.html and training/training.html

import {
  db,
  auth,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  limit,
  Timestamp,
  serverTimestamp,
  writeBatch,
  deleteDoc,
  listenPools,
  signInWithEmailAndPassword,
  signOut,
  deleteUser,
  onAuthStateChanged,
  EmailAuthProvider,
  reauthenticateWithCredential
} from './firebase.js';
import { requireUserAgreement } from './agreement.js';
import { getApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { sendEmailVerification } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js';

// ============================================================
// PAGE-LOADED FADE-IN
// ============================================================

let formSubmissions = [];           // ✅ fixes ReferenceError at line 792
let filteredSubmissions = [];
let allSubmissions = [];
let filteredData = [];
let paginatedData = [];
let allDutyReports = [];
let allManagerialReports = [];
let allDesPreInspections = [];
let allInventoryReports = [];
let currentPage = 1;
const itemsPerPage = 20;
let isLoggedIn = false;
let sanitationSettings = {};        // ✅ fixes ReferenceError at line 695
let currentView = 'form';
let dashboardRows = [];
let trainingSchedule = {
  sessions: []
};
let securitySettings = {
  sessionTimeout: '360',
  requirePasswordConfirm: true,
};
let alertsRemindersData = {
  active: [],
  history: [],
};
let alertsReminderEditing = {
  id: '',
  source: '',
};
let alertsRemindersLoaded = false;
let alertsReminderPopupChecked = false;
let alertReminderCompletionCache = new Map();
let securityIdleTimer = null;
let securityEventsBound = false;
let agreementGatePromise = null;
let accountDeletionInProgress = false;
let sanitationEditing = false;
let sanitationMarketFilter = 'all';
const FEEDBACK_RESPONSES_ENABLED = true;
const SESSION_WINDOW_MS = 6 * 60 * 60 * 1000;
const LIFEGUARD_SESSION_KEY = 'poolproLifeguardSession';
const LIFEGUARD_SESSION_EXPIRED_KEY = 'poolproLifeguardSessionExpired';
const LIFEGUARD_SESSION_VERIFICATION_VERSION = 2;
const SUPERVISOR_SESSION_VERIFICATION_VERSION = 1;
const CHEM_AUTO_CONTROLLER_STORAGE = 'firestoreChemControllerPhoto';
const CHEM_CONTROLLER_CHUNK_SIZE = 350000;
const CHEM_CONTROLLER_IMAGE_MAX_SIDE = 1280;
const CHEM_CONTROLLER_IMAGE_QUALITY = 0.72;
const CHEM_CONTROLLER_COMPRESS_THRESHOLD_BYTES = 1.5 * 1024 * 1024;
const CHEM_AUTO_CONTROLLER_REUSE_WINDOW_MS = 30 * 60 * 1000;
window.trainingSchedule = trainingSchedule;

const PAGE_LOADING_MIN_MS = 180;
let pageLoadingStartedAt = Date.now();

function ensurePageLoadingOverlay() {
  if (!document.body || document.getElementById('poolproPageLoadingOverlay')) return null;
  const overlay = document.createElement('div');
  overlay.id = 'poolproPageLoadingOverlay';
  overlay.className = 'poolpro-loading-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = '<div class="poolpro-loading-spinner" role="status" aria-label="Loading"></div>';
  document.body.appendChild(overlay);
  return overlay;
}

function markPageLoaded() {
  document.body.classList.add('page-loaded');
}

function hidePageLoadingOverlay() {
  const overlay = document.getElementById('poolproPageLoadingOverlay');
  if (!overlay) return;
  const waitMs = Math.max(0, PAGE_LOADING_MIN_MS - (Date.now() - pageLoadingStartedAt));
  setTimeout(() => overlay.classList.add('hidden'), waitMs);
}

function showPageLoadingOverlay() {
  const overlay = ensurePageLoadingOverlay();
  pageLoadingStartedAt = Date.now();
  overlay?.classList.remove('hidden');
}

ensurePageLoadingOverlay();
markPageLoaded();
window.addEventListener('DOMContentLoaded', markPageLoaded);
window.addEventListener('load', () => {
  markPageLoaded();
  hidePageLoadingOverlay();
});
if (document.readyState === 'complete') hidePageLoadingOverlay();

// PoolPro now uses dark styling by default across the app.
localStorage.setItem('chemlogDarkMode', 'true');
document.body.classList.add('dark-mode');

// ============================================================
// MENU / DROPDOWN
// ============================================================

function ensureMenuContentOverlay() {
  if (!document.body) return null;
  let overlay = document.getElementById('poolproMenuContentOverlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'poolproMenuContentOverlay';
  overlay.className = 'menu-content-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.addEventListener('click', closeDropdownMenus);
  document.body.appendChild(overlay);
  return overlay;
}

function getOpenDropdownMenu() {
  return document.querySelector('.dropdown-menu.show');
}

function getMenuOverlayHeader(anchor) {
  return anchor?.closest?.('.floating-header.visible, .floating-header, .header, .app-header, header') ||
    getOpenDropdownMenu()?.closest('.floating-header.visible, .floating-header, .header, .app-header, header') ||
    document.querySelector('.floating-header.visible') ||
    document.querySelector('.header, .app-header, header');
}

function getMenuOverlayFooter() {
  return document.querySelector('.footer, footer');
}

function updateMenuContentOverlayBounds(anchor) {
  const overlay = ensureMenuContentOverlay();
  if (!overlay) return;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const header = getMenuOverlayHeader(anchor);
  const footer = getMenuOverlayFooter();
  let top = 0;
  let bottom = 0;

  if (header) {
    const rect = header.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < viewportHeight) {
      top = Math.max(0, Math.min(viewportHeight, rect.bottom));
    }
  }

  if (footer) {
    const rect = footer.getBoundingClientRect();
    if (rect.top < viewportHeight && rect.bottom > 0) {
      bottom = Math.max(0, viewportHeight - Math.max(0, rect.top));
    }
  }

  if (top + bottom > viewportHeight) bottom = Math.max(0, viewportHeight - top);
  overlay.style.setProperty('--menu-overlay-top', `${Math.round(top)}px`);
  overlay.style.setProperty('--menu-overlay-bottom', `${Math.round(bottom)}px`);
}

function showMenuContentOverlay(anchor) {
  const overlay = ensureMenuContentOverlay();
  if (!overlay) return;
  updateMenuContentOverlayBounds(anchor);
  overlay.setAttribute('aria-hidden', 'false');
  overlay.classList.add('visible');
}

function hideMenuContentOverlay() {
  const overlay = document.getElementById('poolproMenuContentOverlay');
  if (!overlay) return;
  overlay.classList.remove('visible');
  overlay.setAttribute('aria-hidden', 'true');
}

function syncMenuContentOverlay(anchor) {
  if (getOpenDropdownMenu()) showMenuContentOverlay(anchor || getOpenDropdownMenu());
  else hideMenuContentOverlay();
}

function closeDropdownMenus() {
  document.querySelectorAll('.dropdown-menu.show').forEach(m => m.classList.remove('show'));
  document.querySelectorAll('.menu-btn.open').forEach(btn => btn.classList.remove('open'));
  hideMenuContentOverlay();
}

window.toggleMenu = function (btn) {
  const container = btn.closest('.menu-container');
  if (!container) return;
  const menu = container.querySelector('.dropdown-menu');
  if (!menu) return;
  const isOpen = menu.classList.contains('show');
  // Close all open menus first
  document.querySelectorAll('.dropdown-menu.show').forEach(m => m.classList.remove('show'));
  document.querySelectorAll('.menu-btn.open').forEach(button => button.classList.remove('open'));
  if (!isOpen) menu.classList.add('show');
  btn.classList.toggle('open', !isOpen);
  syncMenuContentOverlay(!isOpen ? btn : null);
};

// Close dropdown when clicking outside any menu container
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu-container')) {
    closeDropdownMenus();
  }
});

window.addEventListener('resize', () => {
  if (getOpenDropdownMenu()) updateMenuContentOverlayBounds(getOpenDropdownMenu());
}, { passive: true });

window.addEventListener('scroll', () => {
  if (getOpenDropdownMenu()) updateMenuContentOverlayBounds(getOpenDropdownMenu());
}, { passive: true });

window.poolProCloseDropdownMenus = closeDropdownMenus;
window.poolProShowMenuContentOverlay = showMenuContentOverlay;
window.poolProHideMenuContentOverlay = hideMenuContentOverlay;
window.poolProSyncMenuContentOverlay = syncMenuContentOverlay;

// Open inline/chunked resources as blob URLs (direct data: links are blocked in modern browsers)
document.addEventListener('click', async (e) => {
  const link = e.target.closest('.resource-doc-link');
  if (!link) return;
  e.preventDefault();
  const key = link.dataset.resourceKey;
  const resource = resourcesData.find((item) => item.id === key);
  const resourceUrl = resource?.fileUrl || resourceDataUrlMap.get(key) || '';
  if (!resourceUrl) return;
  try {
    const dataUrl = resource?.storageType === FIRESTORE_RESOURCE_STORAGE
      || resourceUrl.startsWith(`${FIRESTORE_RESOURCE_STORAGE}:`)
      ? await getFirestoreResourceDataUrl(key)
      : resourceUrl;
    if (isResourceESignPdf(resource)) {
      await openResourceESignModal(resource, dataUrl);
      return;
    }
    openResourceDataUrl(dataUrl);
  } catch (err) {
    console.error('[PoolPro] Could not open resource file:', err);
    alert('Unable to open this resource right now.');
  }
});

function closeDashboardValuePopover() {
  document.getElementById('dashboardValuePopover')?.remove();
  document.querySelectorAll('.dash-value-cell[data-popover-open="true"]').forEach((cell) => {
    delete cell.dataset.popoverOpen;
  });
}

function openDashboardValuePopover(trigger) {
  const cell = trigger.closest('.dash-value-cell');
  const source = cell?.querySelector('.dash-value-popover');
  if (!cell || !source) return;
  if (cell.dataset.popoverOpen === 'true') {
    closeDashboardValuePopover();
    return;
  }
  closeDashboardValuePopover();
  cell.dataset.popoverOpen = 'true';

  const floating = document.createElement('div');
  floating.id = 'dashboardValuePopover';
  floating.className = 'dash-value-popover dash-value-popover-floating';
  floating.innerHTML = source.innerHTML;
  document.body.appendChild(floating);

  const rect = trigger.getBoundingClientRect();
  const gap = 8;
  const width = floating.offsetWidth;
  const height = floating.offsetHeight;
  let left = rect.left;
  let top = rect.bottom + gap;
  left = Math.max(gap, Math.min(left, window.innerWidth - width - gap));
  if (top + height > window.innerHeight - gap) {
    top = rect.top - height - gap;
  }
  top = Math.max(gap, Math.min(top, window.innerHeight - height - gap));
  floating.style.left = `${left}px`;
  floating.style.top = `${top}px`;
}

document.addEventListener('click', (e) => {
  const trigger = e.target.closest('.dash-value-trigger');
  if (!trigger) {
    if (!e.target.closest('#dashboardValuePopover')) closeDashboardValuePopover();
    return;
  }
  e.preventDefault();
  openDashboardValuePopover(trigger);
});

window.addEventListener('scroll', closeDashboardValuePopover, true);
window.addEventListener('resize', closeDashboardValuePopover);

function getPagePrefix() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  parts.pop();
  const subDirs = ['chem', 'Chem', 'training', 'Training', 'editor', 'Editor', 'main', 'Main', 'duties', 'Duties', 'des-logbooks', 'DES-Logbooks', 'managerial', 'Managerial', 'employees', 'Employees', 'testing', 'Testing', 'resources', 'Resources', 'operational', 'Operational', 'des', 'DES', 'inventory', 'Inventory', 'todo', 'Todo', 'ToDo'];
  const last = parts[parts.length - 1] || '';
  return subDirs.includes(last) ? '../' : '';
}

function injectOperationalStatusMenuLinks() {
  const prefix = getPagePrefix();
  const isOperationalPage = /\/operational\/operational\.html$/i.test(window.location.pathname);

  document.querySelectorAll('.dropdown-menu').forEach((menu) => {
    if (menu.querySelector('[data-nav="operational-status"]')) return;
    const anchorLink = menu.querySelector('[data-nav="duties"]');
    if (!anchorLink) return;

    const link = document.createElement('a');
    link.href = isOperationalPage ? 'operational.html' : `${prefix}operational/operational.html`;
    link.className = `dropdown-item${isOperationalPage ? ' active-page' : ''}`;
    link.dataset.nav = 'operational-status';
    link.textContent = 'Operational Status Log';
    anchorLink.insertAdjacentElement('afterend', link);
  });
}

function injectManagerialReportMenuLinks() {
  document.querySelectorAll('[data-nav="managerial-report"]').forEach((link) => link.remove());
}

function injectDesLogbooksMenuLinks() {
  const prefix = getPagePrefix();
  const isDesLogbooksPage = /\/des-logbooks\/des-logbooks\.html$/i.test(window.location.pathname);

  document.querySelectorAll('.dropdown-menu').forEach((menu) => {
    if (menu.querySelector('[data-nav="des-logbooks"]')) return;
    const anchorLink = menu.querySelector('[data-nav="duties"]') || menu.querySelector('[data-nav="training-signup"]') || menu.querySelector('[data-nav="chem"]');
    if (!anchorLink) return;

    const link = document.createElement('a');
    link.href = isDesLogbooksPage ? 'des-logbooks.html' : `${prefix}des-logbooks/des-logbooks.html`;
    link.className = `dropdown-item attendant-supervisor-only${isDesLogbooksPage ? ' active-page' : ''}`;
    link.dataset.nav = 'des-logbooks';
    link.textContent = 'DES Logbook Report';
    anchorLink.insertAdjacentElement('afterend', link);
  });
}

function injectResourcesMenuLinks() {
  const prefix = getPagePrefix();
  const isResourcesPage = /\/resources\/resources\.html$/i.test(window.location.pathname);

  document.querySelectorAll('.dropdown-menu').forEach((menu) => {
    if (menu.querySelector('[data-nav="resources"]')) return;
    const anchorLink = menu.querySelector('[data-nav="operational-status"]') || menu.querySelector('[data-nav="duties"]');
    if (!anchorLink) return;

    const link = document.createElement('a');
    link.href = isResourcesPage ? 'resources.html' : `${prefix}resources/resources.html`;
    link.className = `dropdown-item${isResourcesPage ? ' active-page' : ''}`;
    link.dataset.nav = 'resources';
    link.textContent = 'Resources';
    anchorLink.insertAdjacentElement('afterend', link);
  });
}

function injectInventoryMenuLinks() {
  const prefix = getPagePrefix();
  const isInventoryPage = /\/inventory\/inventory\.html$/i.test(window.location.pathname);

  document.querySelectorAll('.dropdown-menu').forEach((menu) => {
    if (menu.querySelector('[data-nav="inventory"]')) return;
    const anchorLink = menu.querySelector('[data-nav="resources"]') || menu.querySelector('[data-nav="operational-status"]') || menu.querySelector('[data-nav="duties"]');
    if (!anchorLink) return;

    const link = document.createElement('a');
    link.href = isInventoryPage ? 'inventory.html' : `${prefix}inventory/inventory.html`;
    link.className = `dropdown-item${isInventoryPage ? ' active-page' : ''}`;
    link.dataset.nav = 'inventory';
    link.textContent = 'Inventory';
    anchorLink.insertAdjacentElement('afterend', link);
  });
}

function injectTodoMenuLinks() {
  const prefix = getPagePrefix();
  const isTodoPage = /\/todo\/todo\.html$/i.test(window.location.pathname);

  document.querySelectorAll('.dropdown-menu').forEach((menu) => {
    if (menu.querySelector('[data-nav="todo-list"]')) return;
    const anchorLink = menu.querySelector('[data-nav="inventory"]') ||
      menu.querySelector('[data-nav="operational-status"]') ||
      menu.querySelector('[data-nav="duties"]');
    if (!anchorLink) return;

    const link = document.createElement('a');
    link.href = isTodoPage ? 'todo.html' : `${prefix}todo/todo.html`;
    link.className = `dropdown-item${isTodoPage ? ' active-page' : ''}`;
    link.dataset.nav = 'todo-list';
    link.textContent = 'To Do List';
    anchorLink.insertAdjacentElement('afterend', link);
  });
}

function injectDesPreInspectionMenuLinks() {
  const prefix = getPagePrefix();
  const isDesPage = /\/des\/des\.html$/i.test(window.location.pathname);

  document.querySelectorAll('.dropdown-menu').forEach((menu) => {
    if (menu.querySelector('[data-nav="des-pre-inspection"]')) return;
    const anchorLink = menu.querySelector('[data-nav="resources"]') || menu.querySelector('[data-nav="operational-status"]') || menu.querySelector('[data-nav="duties"]');
    if (!anchorLink) return;

    const link = document.createElement('a');
    link.href = isDesPage ? 'des.html' : `${prefix}des/des.html`;
    link.className = `dropdown-item${isDesPage ? ' active-page' : ''}`;
    link.dataset.nav = 'des-pre-inspection';
    link.textContent = 'DES Pre-Inspection';
    anchorLink.insertAdjacentElement('afterend', link);
  });
}

function injectLifeguardSettingsMenuLinks() {
  document.querySelectorAll('.dropdown-menu').forEach((menu) => {
    if (menu.querySelector('[data-nav="lifeguard-settings"]')) return;

    const link = document.createElement('a');
    link.href = '#';
    link.className = 'dropdown-item lifeguard-only';
    link.dataset.nav = 'lifeguard-settings';
    link.textContent = 'Settings';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      window.openSettings();
    });

    const logoutLink = menu.querySelector('[data-nav="logout"]');
    const supervisorStart = menu.querySelector('.supervisor-only');
    const anchor = logoutLink || supervisorStart;
    if (anchor) anchor.insertAdjacentElement('beforebegin', link);
    else menu.appendChild(link);
  });
}

function normalizeSharedHeaderCopy() {
  document.querySelectorAll('.header-title-block p, .header-left > div:first-child > p').forEach((subtitle) => {
    if (!subtitle || subtitle.dataset.headerCopyReady === 'true') return;
    subtitle.textContent = '';
    subtitle.dataset.headerCopyReady = 'true';
  });
}

function createFloatingHeader(sourceHeader) {
  if (!sourceHeader || sourceHeader.dataset.floatingReady === 'true') return;
  const menuContainer = sourceHeader.querySelector('.menu-container');
  const logo = sourceHeader.querySelector('#logo, img[alt*="logo" i]');
  if (!menuContainer || !logo) return;

  const floating = document.createElement(sourceHeader.tagName.toLowerCase());
  floating.className = `${sourceHeader.className} floating-header`;

  const content = document.createElement('div');
  content.className = 'header-content';
  const left = document.createElement('div');
  left.className = sourceHeader.matches('.app-header')
    ? 'training-header-left header-left--compact'
    : 'header-left header-left--compact';

  const menuClone = menuContainer.cloneNode(true);
  const logoClone = logo.cloneNode(true);
  menuClone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  logoClone.removeAttribute('id');

  left.appendChild(menuClone);
  left.appendChild(logoClone);
  content.appendChild(left);
  floating.appendChild(content);
  document.body.appendChild(floating);

  const updateFloatingHeader = () => {
    const rect = sourceHeader.getBoundingClientRect();
    const visible = sourceHeader.offsetParent !== null && rect.bottom <= 0;
    if (visible && !floating.classList.contains('visible')) {
      closeDropdownMenus();
    }
    floating.classList.toggle('visible', visible);
  };

  window.addEventListener('scroll', updateFloatingHeader, { passive: true });
  window.addEventListener('resize', updateFloatingHeader, { passive: true });
  requestAnimationFrame(updateFloatingHeader);

  sourceHeader.dataset.floatingReady = 'true';
}

function setupFloatingHeaders() {
  document.querySelectorAll('.header, .app-header').forEach(createFloatingHeader);
}

function getResponsiveTableMinWidth(table) {
  if (table.matches('.dashboard-operational-table')) return '760px';
  if (table.matches('.dashboard-cleanliness-table')) return '520px';
  if (table.matches('.dashboard-detail-table')) return '760px';
  if (table.matches('.dashboard-pool-table, .pool-table')) return '1200px';
  if (table.matches('.dashboard-compliance-table')) return '760px';
  if (table.matches('.training-schedule-table')) return '760px';
  if (table.matches('.attendance-table, .test-rubric-table')) return '900px';
  if (table.matches('.employee-unverified-table')) return '1260px';
  if (table.matches('.employee-table')) return '1520px';
  if (table.matches('.sanitation-table--settings')) return '420px';
  if (table.matches('.sanitation-table')) return '700px';
  if (table.matches('.resource-table-admin')) return '980px';
  if (table.matches('.resource-table')) return '760px';
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
      markStickyTableControls(existingWrapper);
      return;
    }
    if (table.closest('.rules-table')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'table-scroll-wrap';
    const shell = document.createElement('div');
    shell.className = 'table-scroll-shell';
    table.parentNode.insertBefore(shell, table);
    shell.appendChild(wrapper);
    wrapper.appendChild(table);
    bindTableScrollShadow(wrapper);
    markStickyTableControls(wrapper);
  });
}

function markStickyTableControls(wrapper) {
  const shell = ensureTableScrollShell(wrapper) || wrapper;
  let previous = shell.previousElementSibling;
  while (previous && previous.matches('script, style')) previous = previous.previousElementSibling;
  if (!previous) return;
  const hasControls = previous.matches('.settings-actions, .employee-actions, .sanitation-controls, .resource-actions') ||
    !!previous.querySelector?.('.editAndSave, .theme-toggle');
  if (hasControls) previous.classList.add('table-sticky-controls');
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
  setTimeout(refresh, 100);
  setTimeout(refresh, 500);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(refresh).observe(wrapper);
  }
}

function updateHorizontalScrollShadow(wrapper) {
  if (!wrapper) return;
  const shell = wrapper.closest('.dashboard-metrics-scroll-shell') || wrapper.parentElement;
  const hasOverflow = wrapper.scrollWidth > wrapper.clientWidth + 2;
  const hasRight = hasOverflow && (wrapper.scrollLeft + wrapper.clientWidth) < (wrapper.scrollWidth - 2);
  const hasLeft = hasOverflow && wrapper.scrollLeft > 2;
  shell?.classList.toggle('has-overflow-right', hasRight);
  shell?.classList.toggle('has-overflow-left', hasLeft);
  shell?.classList.toggle('has-overflow', hasOverflow);
}

function bindHorizontalScrollShadow(wrapper) {
  if (!wrapper || wrapper.dataset.horizontalShadowBound === 'true') return;
  wrapper.dataset.horizontalShadowBound = 'true';
  const refresh = () => updateHorizontalScrollShadow(wrapper);
  wrapper.addEventListener('scroll', refresh, { passive: true });
  window.addEventListener('resize', refresh, { passive: true });
  requestAnimationFrame(refresh);
  setTimeout(refresh, 100);
  setTimeout(refresh, 500);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(refresh).observe(wrapper);
  }
}

function observeResponsiveTables() {
  if (!document.body || document.body.dataset.tableObserverReady === 'true') return;
  document.body.dataset.tableObserverReady = 'true';

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

// ============================================================
// SETTINGS MODAL
// ============================================================

function showSharedModalOverlay() {
  const overlay = document.getElementById('settingsOverlay');
  if (!overlay) return;
  overlay.style.display = 'block';
  requestAnimationFrame(() => overlay.classList.add('visible'));
}

function hideSharedModalOverlayIfUnused() {
  const overlay = document.getElementById('settingsOverlay');
  if (!overlay) return;
  const settingsModal = document.getElementById('settingsModal');
  const feedbackModal = document.getElementById('feedbackModal');
  const settingsOpen = settingsModal?.classList.contains('visible');
  const feedbackOpen = feedbackModal?.classList.contains('visible');
  if (settingsOpen || feedbackOpen) return;
  overlay.classList.remove('visible');
  setTimeout(() => {
    if (!settingsModal?.classList.contains('visible') && !feedbackModal?.classList.contains('visible')) {
      overlay.style.display = 'none';
    }
  }, 250);
}

function resetOrphanedSharedModalOverlay() {
  const overlay = document.getElementById('settingsOverlay');
  if (!overlay) return;
  const settingsModal = document.getElementById('settingsModal');
  const feedbackModal = document.getElementById('feedbackModal');
  const settingsOpen = settingsModal?.classList.contains('visible');
  const feedbackOpen = feedbackModal?.classList.contains('visible');
  if (settingsOpen || feedbackOpen) return;
  overlay.classList.remove('visible');
  overlay.style.display = 'none';
}

window.addEventListener('load', resetOrphanedSharedModalOverlay);

window.openSettings = function () {
  ensureAccountManagementSection();
  ensureDataStorageSettingsSection();
  ensureResourcesSettingsSection();
  ensureAlertsRemindersSettingsSection();
  setupResourcesSettingsUI();
  refreshResourceControls();
  renderResourcesSettingsTable();
  loadAlertsRemindersSettings().catch((err) => console.error('[PoolPro] Error refreshing alerts and reminders for settings:', err));
  loadResourcesDocuments().catch((err) => console.error('[PoolPro] Error refreshing resources for settings:', err));
  setupSettingsAccordions();
  setupDataExport();
  setupClearData();
  updateSettingsModalForRole();
  const modal = document.getElementById('settingsModal');
  closeDropdownMenus();
  showSharedModalOverlay();
  if (modal) {
    modal.style.display = 'block';
    requestAnimationFrame(() => modal.classList.add('visible'));
  }
};

function getAgreementDocIdForContext(context) {
  const role = (context?.role || 'user').toString().trim().toLowerCase();
  const email = (context?.email || '').toString().trim().toLowerCase();
  const username = (context?.username || '').toString().trim().toLowerCase();
  const employeeId = (context?.employeeId || email || username || '').toString().trim();
  return email ? `email:${email}` : `${role}:${username || employeeId || 'unknown-user'}`;
}

function setAccountManagementMessage(text, isError = false) {
  const msg = document.getElementById('accountManagementMessage');
  if (!msg) return;
  msg.textContent = text || '';
  msg.classList.toggle('error', !!text && isError);
  msg.classList.toggle('success', !!text && !isError);
}

function ensureAccountManagementSection() {
  const modalContent = document.querySelector('#settingsModal .settings-modal-content');
  if (!modalContent || document.getElementById('accountManagementSection')) return;

  const section = document.createElement('section');
  section.className = 'settings-section settings-group account-management-section';
  section.id = 'accountManagementSection';
  section.innerHTML = `
    <h3>Account Management</h3>
    <p class="section-subtitle" id="accountManagementDescription">
      Permanently delete the currently signed-in PoolPro account.
    </p>
    <button type="button" class="submit-btn danger-button" id="deleteCurrentAccountBtn">Delete Account</button>
    <p class="form-message" id="accountManagementMessage"></p>
  `;

  const scrollBody = modalContent.querySelector(':scope > .settings-modal-scroll');
  if (scrollBody) scrollBody.prepend(section);
  else {
    const header = modalContent.querySelector('.modal-header');
    if (header) header.insertAdjacentElement('afterend', section);
    else modalContent.prepend(section);
  }
}

function updateSettingsModalForRole() {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;

  const limitedUser = !isSupervisor() && hasActivePoolProSession();
  modal.classList.toggle('lifeguard-settings-view', limitedUser);
  modal.querySelectorAll('.settings-section').forEach((section) => {
    section.style.display = limitedUser && section.id !== 'accountManagementSection' ? 'none' : '';
  });
  if (limitedUser) {
    document.getElementById('accountManagementSection')?.classList.remove('collapsed');
  }

  const description = document.getElementById('accountManagementDescription');
  if (description) {
    description.textContent = limitedUser
      ? 'Permanently delete your PoolPro account. This removes your login record and employee profile, then signs you out.'
      : 'Permanently delete the currently signed-in PoolPro account, then sign out.';
  }
}

async function reauthenticateAccountForDeletion(email, password) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  if (!normalizedEmail || !password) throw new Error('Email and password are required.');

  if (auth.currentUser && (auth.currentUser.email || '').trim().toLowerCase() === normalizedEmail) {
    const credential = EmailAuthProvider.credential(auth.currentUser.email, password);
    await reauthenticateWithCredential(auth.currentUser, credential);
    return auth.currentUser;
  }

  const credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
  return credential.user;
}

async function removeEmployeeRecordForAccount(email) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  if (!normalizedEmail) return;

  await loadEmployees();
  const before = employeesData.length;
  employeesData = employeesData.filter((employee) => normalizeEmployeeRecord(employee).email !== normalizedEmail);
  if (employeesData.length !== before) {
    await saveEmployees();
    renderEmployeesTable();
  }
}

async function findLinkedLifeguardAccountsByEmail(email) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  if (!normalizedEmail) return [];

  const snap = await getDocs(collection(db, 'lifeguardAccounts'));
  const matches = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const emails = [
      data.authEmail,
      data.employeeEmail,
      data.email,
      data.id,
    ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
    if (emails.includes(normalizedEmail)) {
      matches.push({
        username: docSnap.id,
        data,
      });
    }
  });
  return matches;
}

async function deleteLinkedLifeguardAccessForEmployee(employee) {
  const normalizedEmployee = normalizeEmployeeRecord(employee || {});
  const email = (normalizedEmployee.email || normalizedEmployee.id || '').trim().toLowerCase();
  if (!email) return { authDeleteError: null, linkedAccounts: [] };

  const linkedAccounts = await findLinkedLifeguardAccountsByEmail(email);

  const authTarget = linkedAccounts.find((account) => account.username) || linkedAccounts[0];
  let authDeleteError = null;
  try {
    await deleteFirebaseAuthCredentialForAccount({
      email,
      username: authTarget?.username || '',
      role: 'lifeguard',
      preferRemoteDelete: true,
    });
  } catch (err) {
    authDeleteError = err;
    console.warn('[PoolPro] Firebase Auth credential could not be deleted; removing PoolPro login records anyway.', err);
  }

  await Promise.all(
    linkedAccounts.map((account) => deleteDoc(doc(db, 'lifeguardAccounts', account.username)))
  );
  return { authDeleteError, linkedAccounts };
}

function buildDeletedEmployeeAccountContext(employee, linkedAccounts = []) {
  const normalizedEmployee = normalizeEmployeeRecord(employee || {});
  const accounts = Array.isArray(linkedAccounts) ? linkedAccounts : [];
  const accountEmails = accounts.flatMap((account) => {
    const data = account?.data || {};
    return [data.authEmail, data.employeeEmail, data.email, data.id];
  });
  return {
    email: normalizedEmployee.email || normalizedEmployee.id || accountEmails.find(Boolean) || '',
    employeeId: normalizedEmployee.id || normalizedEmployee.email || '',
    emails: [normalizedEmployee.email, normalizedEmployee.id, ...accountEmails],
    usernames: accounts.map((account) => account?.username),
  };
}

function isDeletedAccountMatch(value, identifiers) {
  const normalized = (value || '').toString().trim().toLowerCase();
  return !!normalized && identifiers.has(normalized);
}

function redactedIdentityPatch() {
  return {
    firstName: 'Anonymous',
    lastName: '',
    employeeId: '',
    email: '',
    submitterEmail: '',
    respondentEmail: '',
    authEmail: '',
    employeeEmail: '',
    phone: '',
    username: '',
    respondentUsername: '',
    submitterUsername: '',
    submitterName: 'Anonymous',
    respondentName: 'Anonymous',
  };
}

async function commitBatchChunks(batchUpdates) {
  for (let i = 0; i < batchUpdates.length; i += 400) {
    const batch = writeBatch(db);
    batchUpdates.slice(i, i + 400).forEach(({ ref, data }) => {
      batch.update(ref, data);
    });
    await batch.commit();
  }
}

async function redactCollectionIdentity(collectionName, identifiers, fieldsToCheck) {
  const snap = await getDocs(collection(db, collectionName));
  const updates = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const matched = fieldsToCheck.some((field) => isDeletedAccountMatch(data[field], identifiers));
    if (matched) updates.push({ ref: docSnap.ref, data: redactedIdentityPatch() });
  });
  if (updates.length) await commitBatchChunks(updates);
}

async function redactTrainingScheduleIdentity(identifiers) {
  const scheduleRef = doc(db, 'settings', 'trainingSchedule');
  const snap = await getDoc(scheduleRef);
  if (!snap.exists()) return;

  const data = snap.data() || {};
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  let changed = false;
  const redactedSessions = sessions.map((session) => {
    if (!Array.isArray(session.attendees)) return session;
    const attendees = session.attendees.map((attendee) => {
      const matched = ['employeeId', 'email', 'phone', 'firstName', 'lastName', 'name'].some((field) =>
        isDeletedAccountMatch(attendee?.[field], identifiers)
      );
      if (!matched) return attendee;
      changed = true;
      return {
        ...attendee,
        firstName: 'Anonymous',
        lastName: '',
        name: 'Anonymous',
        email: '',
        employeeId: '',
        phone: '',
      };
    });
    return { ...session, attendees };
  });

  if (changed) {
    await setDoc(scheduleRef, { sessions: redactedSessions }, { merge: true });
  }
}

async function redactDeletedAccountData(context) {
  const identifiers = new Set([
    context?.email,
    context?.username,
    context?.employeeId,
    ...(Array.isArray(context?.emails) ? context.emails : []),
    ...(Array.isArray(context?.usernames) ? context.usernames : []),
    ...(Array.isArray(context?.employeeIds) ? context.employeeIds : []),
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  if (!identifiers.size) return;

  const submitterFields = ['employeeId', 'email', 'submitterEmail', 'respondentEmail', 'authEmail', 'employeeEmail', 'username', 'submitterUsername', 'respondentUsername'];
  await Promise.all([
    redactCollectionIdentity('poolSubmissions', identifiers, submitterFields),
    redactCollectionIdentity('dutySubmissions', identifiers, submitterFields),
    redactCollectionIdentity('managerialReports', identifiers, submitterFields),
    redactCollectionIdentity('trainingSignups', identifiers, submitterFields),
    redactCollectionIdentity('operationalStatusLogs', identifiers, submitterFields),
    redactCollectionIdentity('inventorySubmissions', identifiers, submitterFields),
    redactCollectionIdentity('desPreInspections', identifiers, submitterFields),
    redactCollectionIdentity('desLogbookSubmissions', identifiers, submitterFields),
    redactTrainingScheduleIdentity(identifiers),
  ]);
}

async function deleteFirebaseAuthCredentialForAccount(context, password = '') {
  const email = (context?.email || '').trim().toLowerCase();
  const username = (context?.username || '').trim().toLowerCase();
  if (!email) return;

  if (!context?.preferRemoteDelete && auth.currentUser && (auth.currentUser.email || '').trim().toLowerCase() === email) {
    if (password) {
      const credential = EmailAuthProvider.credential(auth.currentUser.email, password);
      await reauthenticateWithCredential(auth.currentUser, credential);
    }
    await deleteUser(auth.currentUser);
    return;
  }

  if (context?.role !== 'lifeguard') return;

  const headers = { 'Content-Type': 'application/json' };
  if (auth.currentUser) {
    headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  }
  const response = await fetch(DELETE_AUTH_USER_FUNCTION_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, username }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || 'Unable to delete Firebase Auth credentials.');
  }
}

async function handleDeleteCurrentAccount() {
  const btn = document.getElementById('deleteCurrentAccountBtn');
  const context = getCurrentAgreementContext();
  const role = context?.role || '';
  const email = (context?.email || '').trim().toLowerCase();
  const username = (context?.username || '').trim().toLowerCase();

  setAccountManagementMessage('');
  if (!context || !email) {
    setAccountManagementMessage('Sign in before deleting an account.', true);
    return;
  }

  const confirmation = prompt(`Type DELETE to permanently delete the ${role} account for ${email}.`);
  if (confirmation !== 'DELETE') return;

  const passwordRequired = role !== 'lifeguard';
  const password = passwordRequired ? prompt('Enter your password to confirm account deletion:') : '';
  if (passwordRequired && !password) return;

  if (role === 'lifeguard' && !username) {
    setAccountManagementMessage('This lifeguard session is missing its username. Sign out and sign in again before deleting the account.', true);
    return;
  }

  if (btn) btn.disabled = true;
  accountDeletionInProgress = true;
  setAccountManagementMessage('Deleting account...');

  try {
    if (passwordRequired) {
      await reauthenticateAccountForDeletion(email, password);
    }
    await redactDeletedAccountData(context);

    if (role === 'lifeguard') {
      await deleteDoc(doc(db, 'lifeguardAccounts', username));
      await removeEmployeeRecordForAccount(email);
    }

    await deleteDoc(doc(db, 'userAgreements', getAgreementDocIdForContext(context))).catch(() => {});
    await deleteFirebaseAuthCredentialForAccount(context, password);

    setAccountManagementMessage('Account deleted. Signing out...');
    setTimeout(() => {
      window.logout();
    }, 500);
  } catch (err) {
    console.error('[PoolPro] Unable to delete account:', err);
    accountDeletionInProgress = false;
    if (btn) btn.disabled = false;
    const code = err?.code || '';
    const friendly = code === 'auth/wrong-password' || code === 'auth/invalid-credential'
      ? 'Incorrect password. Account deletion cancelled.'
      : code === 'auth/requires-recent-login'
        ? 'Please sign out, sign back in, and try deleting the account again.'
        : (err?.message || 'Unable to delete this account right now.');
    setAccountManagementMessage(friendly, true);
  }
}

function setupAccountManagement() {
  ensureAccountManagementSection();
  updateSettingsModalForRole();
  const btn = document.getElementById('deleteCurrentAccountBtn');
  if (!btn || btn.dataset.accountDeleteBound === 'true') return;
  btn.dataset.accountDeleteBound = 'true';
  btn.addEventListener('click', handleDeleteCurrentAccount);
}

window.closeSettings = function () {
  const modal = document.getElementById('settingsModal');
  if (modal) {
    modal.classList.remove('visible');
    setTimeout(() => { modal.style.display = 'none'; }, 250);
  }
  setTimeout(hideSharedModalOverlayIfUnused, 250);
};

// Close settings modal when clicking the overlay
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'settingsOverlay') {
    const feedbackModal = document.getElementById('feedbackModal');
    if (feedbackModal?.classList.contains('visible')) {
      window.closeModal();
      return;
    }
    window.closeSettings();
  }
});

// ============================================================
// SUPERVISOR DASHBOARD
// ============================================================

function applyDashboardAccessMode() {
  const dashboard = document.getElementById('supervisorDashboard');
  if (!dashboard) return;
  const fullAccess = isSupervisor();
  const canViewChemDashboard = canAccessPoolChemistryDashboard();
  const tabs = document.getElementById('supervisorDashTabs');
  const title = dashboard.querySelector('.page-content-title');
  const chemPanel = document.getElementById('dashboardContent');
  const jobPanel = document.getElementById('jobFormsContent');
  const managerialPanel = document.getElementById('managerialFormsContent');
  const operationalPanel = document.getElementById('operationalDashboardContent');
  const suppliesPanel = document.getElementById('dashboardSuppliesContent');
  const metricsPanel = document.getElementById('dashboardMetricsContent');
  if (!canViewChemDashboard) return;
  if (tabs) tabs.style.display = fullAccess ? '' : 'none';
  if (title) title.textContent = fullAccess ? 'Supervisor Dashboard' : 'Pool Chemistry Dashboard';
  if (!fullAccess) {
    document.querySelectorAll('[data-dash-tab]').forEach((tab) => tab.classList.toggle('active', tab.dataset.dashTab === 'chemistry'));
    if (chemPanel) chemPanel.style.display = '';
    if (jobPanel) jobPanel.style.display = 'none';
    if (managerialPanel) managerialPanel.style.display = 'none';
    if (operationalPanel) operationalPanel.style.display = 'none';
    if (suppliesPanel) suppliesPanel.style.display = 'none';
    if (metricsPanel) metricsPanel.style.display = 'none';
  }
}

function getActiveDashboardTab() {
  return document.querySelector('[data-dash-tab].active')?.dataset.dashTab || 'chemistry';
}

function showDashboardTabPanel(which) {
  Object.entries(DASHBOARD_PANEL_IDS).forEach(([key, id]) => {
    const panel = document.getElementById(id);
    if (!panel) return;
    const active = key === which;
    panel.style.display = active ? '' : 'none';
    panel.classList.toggle('dashboard-main-panel-active', active);
  });
}

async function renderActiveDashboardTab() {
  const activeTab = !isSupervisor() ? 'chemistry' : getActiveDashboardTab();
  showDashboardTabPanel(activeTab);

  if (!dashboardDataLoaded) {
    await loadDashboardData();
    return;
  }

  if (activeTab === 'chemistry') {
    renderDashboard(allLogs);
    return;
  }

  if (activeTab === 'jobforms') {
    loadJobFormSubmissions();
    return;
  }

  if (activeTab === 'managerial') {
    loadManagerialFormSubmissions();
    return;
  }

  if (activeTab === 'operational') {
    renderOperationalDashboard();
    return;
  }

  if (activeTab === 'supplies') {
    renderSuppliesDashboard();
    return;
  }

  if (activeTab === 'metrics') {
    renderDashboardMetrics();
  }
}

function activateDashboardTab(which) {
  const requested = DASHBOARD_PANEL_IDS[which] ? which : 'chemistry';
  const target = !isSupervisor() ? 'chemistry' : requested;
  document.querySelectorAll('[data-dash-tab]').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.dashTab === target);
  });
  showDashboardTabPanel(target);
  renderActiveDashboardTab().catch((err) => {
    console.error('[PoolPro] Unable to render dashboard tab:', err);
  });
}

window.goToDashboard = function () {
  closeDropdownMenus();
  if (!canAccessPoolChemistryDashboard()) {
    alert('You do not have permission to view the Pool Chemistry Dashboard.');
    return;
  }
  const dashboard = document.getElementById('supervisorDashboard');
  if (dashboard) {
    const mainForm = document.getElementById('mainForm');
    if (mainForm) mainForm.style.display = 'none';
    dashboard.classList.add('show');
    applyDashboardAccessMode();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    loadDashboardData();
  } else {
    // Navigate from training.html or other pages
    window.location.href = '../chem/chem.html#supervisorDashboard';
  }
};

// ============================================================
// LOGOUT
// ============================================================

window.logout = async function () {
  closeDropdownMenus();
  try {
    await signOut(auth);
  } catch (_) { /* ignore */ }
  try {
    localStorage.removeItem('loginToken');
    localStorage.removeItem('ChemLogSupervisor');
    localStorage.removeItem('chemlogRole');
    clearRequestedAccessMode();
    localStorage.removeItem(ROLE_PERMISSIONS_STORAGE_KEY);
    localStorage.removeItem(LIFEGUARD_SESSION_KEY);
    localStorage.removeItem(LIFEGUARD_SESSION_EXPIRED_KEY);
    localStorage.removeItem('trainingSupervisorLoggedIn');
    localStorage.removeItem('training_supervisor_logged_in_v1');
    localStorage.removeItem('chemlogTrainingSupervisorLoggedIn');
    sessionStorage.clear();
  } catch (_) { /* ignore */ }
  const _parts = window.location.pathname.split('/').filter(Boolean);
  _parts.pop();
  const _subDirs = ['chem', 'Chem', 'training', 'Training', 'editor', 'Editor', 'main', 'Main', 'duties', 'Duties', 'managerial', 'Managerial', 'employees', 'Employees', 'testing', 'Testing', 'resources', 'Resources', 'operational', 'Operational', 'des', 'DES', 'inventory', 'Inventory', 'todo', 'Todo', 'ToDo'];
  const _last = _parts[_parts.length - 1] || '';
  window.location.href = (_subDirs.includes(_last) ? '../' : '') + 'index.html';
};

function clearSupervisorLoginState() {
  try {
    localStorage.removeItem('loginToken');
    localStorage.removeItem('ChemLogSupervisor');
    localStorage.removeItem('trainingSupervisorLoggedIn');
    localStorage.removeItem('training_supervisor_logged_in_v1');
    localStorage.removeItem('chemlogTrainingSupervisorLoggedIn');
    const hasLifeguardSession = !!getStoredLifeguardSession() || sessionStorage.getItem('chemlogRole') === 'lifeguard';
    if (!hasLifeguardSession) {
      localStorage.removeItem('chemlogRole');
      clearRequestedAccessMode();
      localStorage.removeItem(ROLE_PERMISSIONS_STORAGE_KEY);
    }
  } catch (_) { /* ignore */ }
}

function writeLifeguardSessionToSessionStorage(session) {
  if (!session) return;
  const accessMode = normalizeAccessMode(session.accessMode || localStorage.getItem(ACCESS_MODE_STORAGE_KEY)) || 'lifeguard';
  sessionStorage.setItem('chemlogRole', 'lifeguard');
  sessionStorage.setItem('chemlogEmployeeEmail', session.email || '');
  sessionStorage.setItem('chemlogEmployeeId', session.employeeId || session.email || '');
  sessionStorage.setItem('chemlogEmployeeUsername', session.username || '');
  sessionStorage.setItem('chemlogEmployeeFirstName', session.firstName || '');
  sessionStorage.setItem('chemlogEmployeeLastName', session.lastName || '');
  sessionStorage.setItem('chemlogEmployeeHomePool', session.homePool || '');
  sessionStorage.setItem('chemlogEmployeePhone', session.phone || '');
  persistRequestedAccessMode(accessMode);
}

function hasFreshSupervisorToken() {
  try {
    const token = JSON.parse(localStorage.getItem('loginToken') || 'null');
    const verified =
      token?.emailVerified === true &&
      Number(token?.verificationVersion || 0) >= SUPERVISOR_SESSION_VERIFICATION_VERSION;
    return !!(token?.expires && Date.now() < Number(token.expires) && verified);
  } catch (_) {
    return false;
  }
}

function getStoredLifeguardSession() {
  try {
    const raw = localStorage.getItem(LIFEGUARD_SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    const expires = Number(session?.expires || 0);
    const hasIdentity = !!(session?.email || session?.employeeId || session?.username);
    const hasVerifiedMarker =
      session?.emailVerified === true &&
      Number(session?.verificationVersion || 0) >= LIFEGUARD_SESSION_VERIFICATION_VERSION &&
      !!session?.verifiedAt;
    const expired = !!expires && Date.now() >= expires;
    if (!hasIdentity || !hasVerifiedMarker || !expires || expired) {
      if (expired && hasIdentity) {
        localStorage.setItem(LIFEGUARD_SESSION_EXPIRED_KEY, JSON.stringify({
          email: session.email || session.employeeId || '',
          username: session.username || '',
          accessMode: session.accessMode || localStorage.getItem(ACCESS_MODE_STORAGE_KEY) || 'lifeguard',
          expiredAt: new Date().toISOString(),
          path: window.location.pathname + window.location.search + window.location.hash,
        }));
      }
      localStorage.removeItem(LIFEGUARD_SESSION_KEY);
      if (localStorage.getItem('chemlogRole') === 'lifeguard') localStorage.removeItem('chemlogRole');
      sessionStorage.removeItem('chemlogRole');
      sessionStorage.removeItem('chemlogEmployeeEmail');
      sessionStorage.removeItem('chemlogEmployeeId');
      sessionStorage.removeItem('chemlogEmployeeUsername');
      sessionStorage.removeItem('chemlogEmployeeFirstName');
      sessionStorage.removeItem('chemlogEmployeeLastName');
      sessionStorage.removeItem('chemlogEmployeeHomePool');
      sessionStorage.removeItem('chemlogEmployeePhone');
      if (!hasFreshSupervisorToken()) clearRequestedAccessMode();
      return null;
    }
    return session;
  } catch (_) {
    try {
      clearStoredLifeguardSession();
    } catch (err) { /* ignore */ }
    return null;
  }
}

function restoreLifeguardSessionFromLocalStorage() {
  if (hasFreshSupervisorToken()) return null;
  const session = getStoredLifeguardSession();
  if (!session) return null;
  try {
    writeLifeguardSessionToSessionStorage(session);
    localStorage.setItem('chemlogRole', 'lifeguard');
  } catch (_) { /* ignore */ }
  return session;
}

function clearStoredLifeguardSession() {
  try {
    sessionStorage.removeItem('chemlogRole');
    sessionStorage.removeItem('chemlogEmployeeEmail');
    sessionStorage.removeItem('chemlogEmployeeId');
    sessionStorage.removeItem('chemlogEmployeeUsername');
    sessionStorage.removeItem('chemlogEmployeeFirstName');
    sessionStorage.removeItem('chemlogEmployeeLastName');
    sessionStorage.removeItem('chemlogEmployeeHomePool');
    sessionStorage.removeItem('chemlogEmployeePhone');
    localStorage.removeItem(LIFEGUARD_SESSION_KEY);
    localStorage.removeItem(LIFEGUARD_SESSION_EXPIRED_KEY);
    if (localStorage.getItem('chemlogRole') === 'lifeguard') localStorage.removeItem('chemlogRole');
    if (!hasFreshSupervisorToken()) clearRequestedAccessMode();
  } catch (_) { /* ignore */ }
}

function getExpiredLifeguardSessionMarker() {
  try {
    return JSON.parse(localStorage.getItem(LIFEGUARD_SESSION_EXPIRED_KEY) || 'null') || null;
  } catch (_) {
    return null;
  }
}

function hasExpiredLifeguardSessionMarker() {
  return !!getExpiredLifeguardSessionMarker();
}

function accountHasEmailVerification(account = {}) {
  const normalized = normalizeLifeguardAccountRecord(account, account.username || '');
  return normalized.emailVerificationOverride === true ||
    normalized.emailVerified === true ||
    normalized.firebaseEmailVerified === true ||
    normalized.emailVerificationComplete === true ||
    !!normalized.lastVerifiedAt ||
    !!normalized.verifiedAt ||
    !!normalized.emailVerifiedAt;
}

function persistCurrentPageLifeguardSession(employee, account, accessMode = 'lifeguard') {
  const normalizedEmployee = normalizeEmployeeRecord(employee || {});
  const normalizedAccount = normalizeLifeguardAccountRecord(account || {}, account?.username || normalizedEmployee.username || '');
  const normalizedAccessMode = persistRequestedAccessMode(accessMode || normalizedAccount.role || normalizedEmployee.role || 'lifeguard');
  const session = {
    role: 'lifeguard',
    accessMode: normalizedAccessMode,
    emailVerified: true,
    verificationVersion: LIFEGUARD_SESSION_VERIFICATION_VERSION,
    verifiedAt: new Date().toISOString(),
    email: normalizedEmployee.email || normalizedAccount.employeeEmail || normalizedAccount.authEmail || '',
    employeeId: normalizedEmployee.id || normalizedEmployee.email || normalizedAccount.employeeEmail || normalizedAccount.authEmail || '',
    username: normalizedEmployee.username || normalizedAccount.username || '',
    firstName: normalizedEmployee.firstName || normalizedAccount.firstName || '',
    lastName: normalizedEmployee.lastName || normalizedAccount.lastName || '',
    homePool: normalizedEmployee.homePool || normalizedAccount.homePool || '',
    phone: normalizedEmployee.phone || normalizedAccount.phone || '',
    expires: Date.now() + SESSION_WINDOW_MS,
  };
  writeLifeguardSessionToSessionStorage(session);
  localStorage.setItem('chemlogRole', 'lifeguard');
  localStorage.setItem(LIFEGUARD_SESSION_KEY, JSON.stringify(session));
  localStorage.removeItem(LIFEGUARD_SESSION_EXPIRED_KEY);
  localStorage.removeItem('loginToken');
  localStorage.removeItem('ChemLogSupervisor');
  localStorage.removeItem('trainingSupervisorLoggedIn');
  localStorage.removeItem('training_supervisor_logged_in_v1');
  localStorage.removeItem('chemlogTrainingSupervisorLoggedIn');
  return session;
}

async function findLifeguardAccountForLogin(loginValue) {
  const login = normalizeIdentityKey(loginValue);
  if (!login) return null;
  if (!lifeguardAccountsLoaded) await loadLifeguardAccounts();
  return lifeguardAccountsData.find((account) => {
    const normalized = normalizeLifeguardAccountRecord(account, account.username || '');
    return getLifeguardAccountIdentityKeys(normalized).includes(login) ||
      normalizeIdentityKey(normalized.authEmail?.split('@')[0] || '') === login ||
      normalizeIdentityKey(normalized.employeeEmail?.split('@')[0] || '') === login;
  }) || null;
}

function findEmployeeForLifeguardAccount(account = {}) {
  const normalizedAccount = normalizeLifeguardAccountRecord(account, account.username || '');
  const accountKeys = new Set(getLifeguardAccountIdentityKeys(normalizedAccount).map(normalizeIdentityKey));
  return employeesData.map(normalizeEmployeeRecord).find((employee) => (
    getEmployeeIdentityKeys(employee).some((key) => accountKeys.has(key))
  )) || normalizeEmployeeRecord({
    email: normalizedAccount.employeeEmail || normalizedAccount.authEmail || '',
    id: normalizedAccount.employeeEmail || normalizedAccount.authEmail || normalizedAccount.username || '',
    username: normalizedAccount.username || '',
    firstName: normalizedAccount.firstName || '',
    lastName: normalizedAccount.lastName || '',
    homePool: normalizedAccount.homePool || '',
    phone: normalizedAccount.phone || '',
    role: normalizedAccount.role || '',
    roles: normalizedAccount.roles || [],
  });
}

function ensureCurrentPageLoginModal() {
  let modal = document.getElementById('poolproSessionLoginModal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'poolproSessionLoginModal';
  modal.className = 'poolpro-session-login-modal hidden';
  modal.innerHTML = `
    <div class="poolpro-session-login-card" role="dialog" aria-modal="true" aria-labelledby="poolproSessionLoginTitle">
      <h2 id="poolproSessionLoginTitle">Sign In Again</h2>
      <p>Your PoolPro session expired. Sign in to continue on this page.</p>
      <form id="poolproSessionLoginForm" class="poolpro-session-login-form">
        <label>
          <span>Email or username</span>
          <input type="text" id="poolproSessionLoginUser" autocomplete="username" required>
        </label>
        <label>
          <span>Password</span>
          <input type="password" id="poolproSessionLoginPassword" autocomplete="current-password" required>
        </label>
        <button type="submit" class="submit-btn" id="poolproSessionLoginSubmit">Sign In</button>
        <p class="form-message" id="poolproSessionLoginMessage"></p>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  const marker = getExpiredLifeguardSessionMarker();
  const input = modal.querySelector('#poolproSessionLoginUser');
  if (input && marker) input.value = marker.email || marker.username || '';
  modal.querySelector('#poolproSessionLoginForm')?.addEventListener('submit', handleCurrentPageLoginSubmit);
  return modal;
}

async function handleCurrentPageLoginSubmit(event) {
  event.preventDefault();
  const modal = document.getElementById('poolproSessionLoginModal');
  const loginInput = modal?.querySelector('#poolproSessionLoginUser');
  const passwordInput = modal?.querySelector('#poolproSessionLoginPassword');
  const submitButton = modal?.querySelector('#poolproSessionLoginSubmit');
  const message = modal?.querySelector('#poolproSessionLoginMessage');
  const login = (loginInput?.value || '').trim();
  const password = passwordInput?.value || '';
  if (!login || !password) {
    if (message) message.textContent = 'Enter your username or email and password.';
    return;
  }
  try {
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Signing in...';
    }
    if (message) message.textContent = '';
    if (!employeesData.length) await loadEmployees();
    const account = await findLifeguardAccountForLogin(login);
    const authEmail = account?.authEmail || account?.employeeEmail || (login.includes('@') ? login : '');
    if (!account || !authEmail) throw new Error('PoolPro could not find an account for that sign-in.');
    await signInWithEmailAndPassword(auth, authEmail, password);
    await auth.currentUser?.reload?.();
    if (!auth.currentUser?.emailVerified && !accountHasEmailVerification(account)) {
      await signOut(auth).catch(() => {});
      throw new Error('Verify your email before opening PoolPro.');
    }
    const employee = findEmployeeForLifeguardAccount(account);
    persistCurrentPageLifeguardSession(employee, account, account.role || account.roles?.[0] || getExpiredLifeguardSessionMarker()?.accessMode || 'lifeguard');
    if (account.username) {
      await setDoc(doc(db, 'lifeguardAccounts', account.username), {
        lastVerifiedAt: new Date().toISOString(),
        lastVerificationMethod: auth.currentUser?.emailVerified ? 'session-refresh' : 'supervisor-email-override',
      }, { merge: true }).catch(() => {});
    }
    await loadRolesPermissions();
    await enforceAgreementForCurrentUser();
    modal?.classList.add('hidden');
    window.setupDropdownVisibility?.();
    enforceCurrentPageAccess();
  } catch (err) {
    console.error('[PoolPro] Current-page sign-in failed:', err);
    if (message) message.textContent = err.message || 'Unable to sign in right now.';
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = 'Sign In';
    }
  }
}

function maybeShowCurrentPageLoginModal() {
  if (!hasExpiredLifeguardSessionMarker() || hasActivePoolProSession()) return;
  const modal = ensureCurrentPageLoginModal();
  modal.classList.remove('hidden');
  requestAnimationFrame(() => modal.querySelector('#poolproSessionLoginPassword')?.focus());
}

function getStoredSupervisorEmail() {
  try {
    const token = JSON.parse(localStorage.getItem('loginToken') || 'null');
    return (token?.username || '').toString().trim().toLowerCase();
  } catch (_) {
    return '';
  }
}

function getCurrentAgreementContext() {
  restoreLifeguardSessionFromLocalStorage();
  const storedRole = hasFreshSupervisorToken()
    ? 'supervisor'
    : (sessionStorage.getItem('chemlogRole') || localStorage.getItem('chemlogRole') || '').toLowerCase();

  if (storedRole === 'lifeguard') {
    const email = (sessionStorage.getItem('chemlogEmployeeEmail') || sessionStorage.getItem('chemlogEmployeeId') || '').trim().toLowerCase();
    const username = (sessionStorage.getItem('chemlogEmployeeUsername') || '').trim().toLowerCase();
    const firstName = (sessionStorage.getItem('chemlogEmployeeFirstName') || '').trim();
    const lastName = (sessionStorage.getItem('chemlogEmployeeLastName') || '').trim();
    if (!email && !username) return null;
    return {
      role: 'lifeguard',
      email,
      username,
      firstName,
      lastName,
      displayName: `${firstName} ${lastName}`.trim(),
      employeeId: email || username,
    };
  }

  const email = (auth.currentUser?.email || getStoredSupervisorEmail()).trim().toLowerCase();
  if (!email) return null;
  return {
    role: 'supervisor',
    email,
    username: email,
    displayName: (auth.currentUser?.displayName || '').trim(),
    employeeId: email,
  };
}

async function enforceAgreementForCurrentUser() {
  if (agreementGatePromise) return agreementGatePromise;
  const context = getCurrentAgreementContext();
  if (!context) return true;

  agreementGatePromise = requireUserAgreement(context, {
    onDecline: async () => {
      await window.logout();
    },
  });

  try {
    return await agreementGatePromise;
  } finally {
    agreementGatePromise = null;
  }
}

// Firebase Auth sign-in bridge — used by home.js and training.js
window.supervisorSignIn = async function (email, password) {
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  await userCredential.user?.reload?.();
  if (!auth.currentUser?.emailVerified) {
    const verifyUrl = new URL(window.location.href);
    verifyUrl.search = '';
    verifyUrl.hash = '';
    verifyUrl.searchParams.set('accessMode', 'supervisor');
    await sendEmailVerification(auth.currentUser, {
      url: verifyUrl.toString(),
      handleCodeInApp: false,
    }).catch((verifyErr) => {
      console.warn('[PoolPro] Could not send supervisor verification email:', verifyErr);
    });
    await signOut(auth).catch(() => {});
    clearSupervisorLoginState();
    throw new Error('Verify your email before opening PoolPro. A verification email has been sent if Firebase allowed it.');
  }
  const signedInEmail = normalizeIdentityKey(userCredential.user?.email || email);
  try {
    const snap = await getDoc(doc(db, 'settings', ROLE_PERMISSIONS_DOC_ID));
    rolesPermissionsData = normalizeRolesPermissionsData(snap.exists() ? snap.data() : {});
    const keys = [signedInEmail, normalizeIdentityKey(email)];
    const canUseSupervisorMode = keys.includes(SITE_DEVELOPER_EMAIL) || hasRoleMembershipForKeys(keys, 'supervisor');
    if (!canUseSupervisorMode) {
      await signOut(auth).catch(() => {});
      clearSupervisorLoginState();
      throw new Error('This account does not have supervisor access.');
    }
  } catch (err) {
    if ((err?.message || '').includes('supervisor access')) throw err;
    await signOut(auth).catch(() => {});
    clearSupervisorLoginState();
    throw err;
  }
  // Sync localStorage flags so isSupervisor() works synchronously
  const expires = Date.now() + SESSION_WINDOW_MS;
  localStorage.setItem('loginToken', JSON.stringify({
    username: email,
    expires,
    emailVerified: true,
    verificationVersion: SUPERVISOR_SESSION_VERIFICATION_VERSION,
    verifiedAt: new Date().toISOString(),
  }));
  localStorage.setItem('ChemLogSupervisor', 'true');
  localStorage.setItem('trainingSupervisorLoggedIn', 'true');
  localStorage.setItem('training_supervisor_logged_in_v1', 'true');
  localStorage.setItem('chemlogTrainingSupervisorLoggedIn', 'true');
  localStorage.setItem('chemlogRole', 'supervisor');
  persistRequestedAccessMode('supervisor');
  localStorage.removeItem(LIFEGUARD_SESSION_KEY);

  const accepted = await enforceAgreementForCurrentUser();
  if (!accepted) {
    const err = new Error('You must accept the user agreement before using PoolPro.');
    err.code = 'agreement/required';
    throw err;
  }
  return userCredential;
};

// ============================================================
// EDITOR NAVIGATION
// ============================================================

window.goToEditor = function () {
  closeDropdownMenus();
  if (!hasPermission('rulesEditor')) {
    alert('You do not have permission to view the Rules Editor.');
    return;
  }
  // Build a path that works from any subdirectory (chem/, training/, editor/, root)
  const parts = window.location.pathname.split('/').filter(Boolean);
  // Remove the filename (last element)
  parts.pop();
  // Remove segments that are known subdirectories to find the project root depth
  const subDirs = ['chem', 'training', 'editor', 'main', 'employees', 'testing', 'duties', 'managerial', 'resources', 'operational', 'des', 'inventory', 'todo'];
  const lastPart = parts[parts.length - 1] || '';
  const stepsUp = subDirs.some(d => d.toLowerCase() === lastPart.toLowerCase()) ? 1 : 0;
  const prefix = stepsUp > 0 ? '../' : '';
  window.location.href = prefix + 'Editor/newRules.html';
};

// ============================================================
// TRAINING SETUP NAVIGATION
// ============================================================

window.goToTrainingSetup = function () {
  closeDropdownMenus();
  if (!hasPermission('trainingSetup')) {
    alert('You do not have permission to view Training Setup.');
    return;
  }

  if (window.showSupervisorView) {
    window.showSupervisorView();
  } else {
    // On a different page — flag the intent and navigate to training
    sessionStorage.setItem('trainingIntentAdmin', '1');
    const parts = window.location.pathname.split('/').filter(Boolean);
    parts.pop();
    const subDirs = ['chem', 'Chem', 'training', 'Training', 'editor', 'Editor', 'main', 'Main', 'duties', 'Duties', 'managerial', 'Managerial', 'employees', 'Employees', 'testing', 'Testing', 'resources', 'Resources', 'operational', 'Operational', 'des', 'DES', 'inventory', 'Inventory', 'todo', 'Todo', 'ToDo'];
    const lastPart = parts[parts.length - 1] || '';
    const prefix = subDirs.includes(lastPart) ? '../' : '';
    window.location.href = prefix + 'Training/training.html';
  }
};

// ============================================================
// FEEDBACK MODAL
// ============================================================

window.closeModal = function () {
  const modal = document.getElementById('feedbackModal');
  if (!modal) return;
  const checkboxes = modal.querySelectorAll('.modal-rule-checkbox');
  if (checkboxes.length > 0) {
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    if (!allChecked) {
      alert('Please check off each item before closing.');
      return;
    }
  }
  modal.classList.remove('visible');
  setTimeout(() => {
    modal.style.display = 'none';
    hideSharedModalOverlayIfUnused();
  }, 250);
  const supSection = document.getElementById('supervisorNotifySection');
  if (supSection) supSection.style.display = 'none';
};

function forceCloseFeedbackModal() {
  const modal = document.getElementById('feedbackModal');
  if (!modal) return;
  modal.classList.remove('visible');
  modal.style.display = 'none';
  delete modal.dataset.submitterName;
  delete modal.dataset.poolName;
  delete modal.dataset.entry;
  delete modal.dataset.majorItems;
  const modalContent = document.getElementById('modalContent');
  if (modalContent) modalContent.innerHTML = '';
  const supSection = document.getElementById('supervisorNotifySection');
  if (supSection) supSection.style.display = 'none';
  hideSharedModalOverlayIfUnused();
}

function resetChemistryFormFields() {
  ['mainPoolPH', 'mainPoolCl', 'secondaryPoolPH', 'secondaryPoolCl'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['3', '4', '5'].forEach(n => {
    const ph = document.getElementById(`pool${n}PH`);
    const cl = document.getElementById(`pool${n}Cl`);
    if (ph) ph.value = '';
    if (cl) cl.value = '';
  });
  const poolLocation = document.getElementById('poolLocation');
  if (poolLocation) poolLocation.value = '';
  updateVisiblePoolSections(2);
  updatePoolSectionTitles(null);
}

window.showSupervisorNotify = function () {
  const section = document.getElementById('supervisorNotifySection');
  if (!section) return;
  // Populate supervisor dropdown from employee data
  const select = document.getElementById('supervisorSelect');
  if (select && select.options.length <= 1) {
    select.innerHTML = '';
    const withPhone = employeesData.filter(e => e.phone);
    if (withPhone.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No employees with phone numbers found';
      select.appendChild(opt);
    } else {
      withPhone.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.phone;
        opt.textContent = `${e.firstName || ''} ${e.lastName || ''}`.trim() || e.id;
        select.appendChild(opt);
      });
    }
  }
  section.style.display = 'block';
  // Scroll modal content to show the notify section
  const modal = document.getElementById('feedbackModal');
  if (modal) modal.scrollTop = modal.scrollHeight;
};

window.sendSupervisorNotification = function () {
  const select = document.getElementById('supervisorSelect');
  if (!select) return;
  const selected = Array.from(select.selectedOptions);
  if (selected.length === 0) { alert('Please select at least one supervisor.'); return; }

  const modal = document.getElementById('feedbackModal');
  const submitterName = modal?.dataset.submitterName || 'Unknown';
  const poolName = modal?.dataset.poolName || '';
  const entryStr = modal?.dataset.entry || '{}';
  const majorItems = modal?.dataset.majorItems || '';
  let entry = {};
  try { entry = JSON.parse(entryStr); } catch (_) {}

  // Build notification message
  let msg = `⚠️ POOL CHEMISTRY ALERT ⚠️\n`;
  msg += `Facility: ${poolName}\n`;
  msg += `Submitted by: ${submitterName}\n\n`;
  msg += `Pool readings:\n`;
  const poolFieldPairs = [
    { label: 'Main Pool', ph: 'mainPoolPH', cl: 'mainPoolCl' },
    { label: 'Secondary Pool', ph: 'secondaryPoolPH', cl: 'secondaryPoolCl' },
    { label: 'Pool 3', ph: 'pool3PH', cl: 'pool3Cl' },
    { label: 'Pool 4', ph: 'pool4PH', cl: 'pool4Cl' },
    { label: 'Pool 5', ph: 'pool5PH', cl: 'pool5Cl' },
  ];
  poolFieldPairs.forEach(p => {
    if (entry[p.ph] || entry[p.cl]) {
      msg += `  ${p.label} — pH: ${entry[p.ph] || '—'}, Cl: ${entry[p.cl] || '—'}\n`;
    }
  });
  if (majorItems) {
    msg += `\n⚠️ MAJOR CONCERNS:\n${majorItems}`;
  }

  const names = selected.map(o => o.textContent).join(', ');
  const phones = selected.map(o => o.value).join(', ');
  alert(`Message to ${names} (${phones}):\n\n${msg}\n\n(SMS delivery requires server-side integration.)`);
};

// ============================================================
// POOLS — populate all pool <select> dropdowns
// ============================================================

let poolsCache = [];

// Build market→pools map, sorted alphabetically within each market
function groupPoolsByMarket(pools) {
  const map = {};
  pools.forEach(pool => {
    // pools have a `markets` array or `market` string from the editor
    const rawMarkets = Array.isArray(pool.markets) ? pool.markets
      : (pool.market ? [pool.market] : []);
    const marketList = rawMarkets.length ? rawMarkets : ['Other'];
    // Use first market as primary grouping key
    const primary = marketList[0];
    if (!map[primary]) map[primary] = [];
    map[primary].push(pool);
  });
  // Sort pools alphabetically within each market
  Object.values(map).forEach(list =>
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  );
  // Return markets sorted alphabetically
  return Object.keys(map).sort().map(m => ({ market: m, pools: map[m] }));
}

function populatePoolSelects(pools) {
  poolsCache = pools || [];
  window._poolsForDuties = pools || []; // expose for duties.js
  window.dispatchEvent(new CustomEvent('poolpro:pools-ready', {
    detail: { pools: poolsCache },
  }));
  setupAlertReminderFacilityExclusionSelect?.();
  const groups = groupPoolsByMarket(pools);

  // Chemistry form pool select — grouped by market, value = pool.id
  const locationSelect = document.getElementById('poolLocation');
  if (locationSelect) {
    const current = locationSelect.value;
    // Keep only the first placeholder option
    while (locationSelect.options.length > 1) locationSelect.remove(1);
    // Remove any existing optgroups
    Array.from(locationSelect.querySelectorAll('optgroup')).forEach(g => g.remove());

    groups.forEach(({ market, pools: mPools }) => {
      const group = document.createElement('optgroup');
      group.label = market;
      mPools.forEach(pool => {
        const opt = document.createElement('option');
        opt.value = pool.id;
        opt.textContent = pool.name || pool.id;
        group.appendChild(opt);
      });
      locationSelect.appendChild(group);
    });
    if (current) locationSelect.value = current;
  }

  // Dashboard pool filter — flat list, value = pool.name
  const poolFilter = document.getElementById('poolFilter');
  if (poolFilter) {
    const current = poolFilter.value;
    while (poolFilter.options.length > 1) poolFilter.remove(1);
    Array.from(poolFilter.querySelectorAll('optgroup')).forEach(g => g.remove());
    if (poolFilter.options.length === 0) {
      const allOpt = document.createElement('option');
      allOpt.value = '';
      allOpt.textContent = 'All Pools';
      poolFilter.appendChild(allOpt);
    } else {
      poolFilter.options[0].textContent = 'All Pools';
    }
    groups.forEach(({ market, pools: mPools }) => {
      const group = document.createElement('optgroup');
      group.label = market;
      mPools.forEach(pool => {
        const opt = document.createElement('option');
        opt.value = pool.name || pool.id;
        opt.textContent = pool.name || pool.id;
        group.appendChild(opt);
      });
      poolFilter.appendChild(group);
    });
    if (current) poolFilter.value = current;
  }

  // Training signup home pool — grouped by market, value = pool.name
  const guardPool = document.getElementById('guardPool');
  if (guardPool) {
    const current = guardPool.value;
    while (guardPool.options.length > 1) guardPool.remove(1);
    Array.from(guardPool.querySelectorAll('optgroup')).forEach(g => g.remove());
    groups.forEach(({ market, pools: mPools }) => {
      const group = document.createElement('optgroup');
      group.label = market;
      mPools.forEach(pool => {
        const opt = document.createElement('option');
        opt.value = pool.name || pool.id;
        opt.textContent = pool.name || pool.id;
        group.appendChild(opt);
      });
      guardPool.appendChild(group);
    });
    if (current) guardPool.value = current;
  }

  // Attendance roster Home Pool select — grouped by market, value = pool.name
  const attendanceHomePool = document.getElementById('attendanceAddHomePool');
  if (attendanceHomePool && attendanceHomePool.tagName === 'SELECT') {
    const current = attendanceHomePool.value;
    while (attendanceHomePool.options.length > 1) attendanceHomePool.remove(1);
    Array.from(attendanceHomePool.querySelectorAll('optgroup')).forEach(g => g.remove());
    groups.forEach(({ market, pools: mPools }) => {
      const group = document.createElement('optgroup');
      group.label = market;
      mPools.forEach(pool => {
        const opt = document.createElement('option');
        opt.value = pool.name || pool.id;
        opt.textContent = pool.name || pool.id;
        group.appendChild(opt);
      });
      attendanceHomePool.appendChild(group);
    });
    if (current) attendanceHomePool.value = current;
    // Placeholder styling: grey when no value selected
    function syncPlaceholder() {
      attendanceHomePool.classList.toggle('is-placeholder', !attendanceHomePool.value);
    }
    syncPlaceholder();
    attendanceHomePool.removeEventListener('change', syncPlaceholder);
    attendanceHomePool.addEventListener('change', syncPlaceholder);
  }

  // Employee home pool select — grouped by market, value = pool.name
  const employeeHomePoolSelect = document.getElementById('employeeHomePoolInput');
  if (employeeHomePoolSelect) {
    const current = employeeHomePoolSelect.value;
    while (employeeHomePoolSelect.options.length > 1) employeeHomePoolSelect.remove(1);
    Array.from(employeeHomePoolSelect.querySelectorAll('optgroup')).forEach(g => g.remove());
    groups.forEach(({ market, pools: mPools }) => {
      const group = document.createElement('optgroup');
      group.label = market;
      mPools.forEach(pool => {
        const opt = document.createElement('option');
        opt.value = pool.name || pool.id;
        opt.textContent = pool.name || pool.id;
        group.appendChild(opt);
      });
      employeeHomePoolSelect.appendChild(group);
    });
    if (current) employeeHomePoolSelect.value = current;
  }

  // Training admin pool select — grouped by market, value = pool.name
  const trainingPoolSelect = document.getElementById('trainingPoolSelect');
  if (trainingPoolSelect) {
    const current = trainingPoolSelect.value;
    while (trainingPoolSelect.options.length > 1) trainingPoolSelect.remove(1);
    Array.from(trainingPoolSelect.querySelectorAll('optgroup')).forEach(g => g.remove());
    groups.forEach(({ market, pools: mPools }) => {
      const group = document.createElement('optgroup');
      group.label = market;
      mPools.forEach(pool => {
        const opt = document.createElement('option');
        opt.value = pool.name || pool.id;
        opt.textContent = pool.name || pool.id;
        group.appendChild(opt);
      });
      trainingPoolSelect.appendChild(group);
    });
    if (current) trainingPoolSelect.value = current;
  }

  // Duties page pool select — grouped by market, value = pool.name
  const dutiesPool = document.getElementById('dutiesPool');
  if (dutiesPool) {
    const current = dutiesPool.value;
    while (dutiesPool.options.length > 1) dutiesPool.remove(1);
    Array.from(dutiesPool.querySelectorAll('optgroup')).forEach(g => g.remove());
    groups.forEach(({ market, pools: mPools }) => {
      const group = document.createElement('optgroup');
      group.label = market;
      mPools.forEach(pool => {
        const opt = document.createElement('option');
        opt.value = pool.name || pool.id;
        opt.textContent = pool.name || pool.id;
        group.appendChild(opt);
      });
      dutiesPool.appendChild(group);
    });
    if (current) dutiesPool.value = current;
  }

  // DES Pre-Inspection facility select — grouped by market, value = pool.name
  const desPoolSelect = document.getElementById('desPoolSelect');
  if (desPoolSelect) {
    const current = desPoolSelect.value;
    while (desPoolSelect.options.length > 1) desPoolSelect.remove(1);
    Array.from(desPoolSelect.querySelectorAll('optgroup')).forEach(g => g.remove());
    groups.forEach(({ market, pools: mPools }) => {
      const group = document.createElement('optgroup');
      group.label = market;
      mPools.forEach(pool => {
        const opt = document.createElement('option');
        opt.value = pool.name || pool.id;
        opt.textContent = pool.name || pool.id;
        group.appendChild(opt);
      });
      desPoolSelect.appendChild(group);
    });
    if (current) desPoolSelect.value = current;
  }

  // Operational Status page facility select — grouped by market, value = pool.id
  const operationalPool = document.getElementById('operationalPoolLocation');
  if (operationalPool) {
    const current = operationalPool.value;
    while (operationalPool.options.length > 1) operationalPool.remove(1);
    Array.from(operationalPool.querySelectorAll('optgroup')).forEach(g => g.remove());
    groups.forEach(({ market, pools: mPools }) => {
      const group = document.createElement('optgroup');
      group.label = market;
      mPools.forEach(pool => {
        const opt = document.createElement('option');
        opt.value = pool.id;
        opt.textContent = pool.name || pool.id;
        group.appendChild(opt);
      });
      operationalPool.appendChild(group);
    });
    if (current) operationalPool.value = current;
    renderOperationalStatusLog();
  }

  // Refresh employee pool filter options when pools update
  populateEmployeePoolFilter(employeeMarketFilter);
  refreshResourceControls();
  renderResourcesPageTable();
  renderResourcesSettingsTable();

  const dashboard = document.getElementById('supervisorDashboard');
  if (dashboard?.classList.contains('show') && canAccessPoolChemistryDashboard()) {
    const activeDashTab = document.querySelector('[data-dash-tab].active')?.dataset.dashTab || 'chemistry';
    if (activeDashTab === 'jobforms') {
      loadJobFormSubmissions();
    } else if (allLogs.length) {
      renderDashboard(allLogs);
    } else {
      loadDashboardData();
    }
  }
}

// ============================================================
// AUTH HELPERS
// ============================================================

const SITE_DEVELOPER_EMAIL = 'samaharmon@icloud.com';
const ACCESS_MODE_STORAGE_KEY = 'poolproAccessMode';
const ROLE_PERMISSIONS_STORAGE_KEY = 'poolproRolePermissionsProfile';
const ROLE_PERMISSIONS_DOC_ID = 'rolesPermissions';
const DELETE_AUTH_USER_FUNCTION_URL = 'https://us-central1-chemlog-43c08.cloudfunctions.net/deleteAuthUserByEmail';
const ROLE_DEFINITIONS = [
  { key: 'lifeguard', label: 'Lifeguard' },
  { key: 'attendant', label: 'Attendant' },
  { key: 'poolManager', label: 'Pool Manager' },
  { key: 'supervisor', label: 'Supervisor' },
];
const ROLE_KEY_ALIASES = {
  lifeguard: 'lifeguard',
  'life guard': 'lifeguard',
  attendant: 'attendant',
  'gate attendant': 'attendant',
  gate: 'attendant',
  manager: 'poolManager',
  poolmanager: 'poolManager',
  'pool manager': 'poolManager',
  supervisor: 'supervisor',
};
const PERMISSION_DEFINITIONS = [
  { key: 'poolChemistryLog', label: 'Pool Chemistry Log' },
  { key: 'trainingSignup', label: 'Training Signup' },
  { key: 'cleanlinessReport', label: 'Cleanliness Report' },
  { key: 'desLogbooks', label: 'DES Logbook Report' },
  { key: 'managerialReport', label: 'Managerial Report' },
  { key: 'operationalStatusLog', label: 'Operational Status Log' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'todoList', label: 'To Do List' },
  { key: 'resources', label: 'Resources' },
  { key: 'desPreInspection', label: 'DES Pre-Inspection' },
  { key: 'poolChemistryDashboard', label: 'Pool Chemistry Dashboard' },
  { key: 'trainingSetup', label: 'Training Setup' },
  { key: 'performanceTracking', label: 'Performance Tracking' },
  { key: 'auditingForms', label: 'Auditing Forms' },
  { key: 'rulesEditor', label: 'Rules Editor' },
  { key: 'settings', label: 'Settings' },
];
const ROLE_DEFAULT_PERMISSIONS = {
  lifeguard: {
    poolChemistryLog: true,
    trainingSignup: true,
    cleanlinessReport: true,
    desLogbooks: false,
    managerialReport: false,
    operationalStatusLog: true,
    inventory: true,
    todoList: true,
    resources: true,
    desPreInspection: false,
    poolChemistryDashboard: false,
    trainingSetup: false,
    performanceTracking: false,
    auditingForms: false,
    rulesEditor: false,
    settings: true,
  },
  attendant: {
    poolChemistryLog: true,
    trainingSignup: false,
    cleanlinessReport: false,
    desLogbooks: true,
    managerialReport: false,
    operationalStatusLog: true,
    inventory: true,
    todoList: true,
    resources: true,
    desPreInspection: false,
    poolChemistryDashboard: false,
    trainingSetup: false,
    performanceTracking: false,
    auditingForms: false,
    rulesEditor: false,
    settings: true,
  },
  poolManager: {
    poolChemistryLog: true,
    trainingSignup: true,
    cleanlinessReport: true,
    desLogbooks: false,
    managerialReport: true,
    operationalStatusLog: true,
    inventory: true,
    todoList: true,
    resources: true,
    desPreInspection: true,
    poolChemistryDashboard: false,
    trainingSetup: false,
    performanceTracking: false,
    auditingForms: false,
    rulesEditor: false,
    settings: true,
  },
  supervisor: Object.fromEntries(PERMISSION_DEFINITIONS.map(({ key }) => [key, true])),
};
let rolesPermissionsData = {
  roles: Object.fromEntries(ROLE_DEFINITIONS.map(({ key }) => [key, []])),
  permissions: ROLE_DEFAULT_PERMISSIONS,
  individualPermissions: {},
};

function normalizeIdentityKey(value) {
  return (value || '').toString().trim().toLowerCase();
}

function timestampToMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function normalizeAccessMode(value) {
  const mode = (value || '').toString().trim().toLowerCase();
  return ['attendant', 'lifeguard', 'manager', 'supervisor'].includes(mode) ? mode : '';
}

function getRoleKeyForAccessMode(accessMode) {
  if (accessMode === 'manager') return 'poolManager';
  if (accessMode === 'attendant') return 'attendant';
  if (accessMode === 'supervisor') return 'supervisor';
  return 'lifeguard';
}

function normalizeRoleKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const direct = ROLE_DEFINITIONS.find(({ key }) => key === raw)?.key;
  if (direct) return direct;
  const lookup = raw
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return ROLE_KEY_ALIASES[lookup] || '';
}

function normalizeEmployeeRoleKeys(source = {}) {
  const roles = [];
  const addRole = (roleValue) => {
    const roleKey = normalizeRoleKey(roleValue);
    if (roleKey && !roles.includes(roleKey)) roles.push(roleKey);
  };

  if (Array.isArray(source.roles)) {
    source.roles.forEach(addRole);
  } else if (typeof source.roles === 'string') {
    source.roles.split(',').forEach(addRole);
  }
  addRole(source.role);
  return roles;
}

function getRoleLabel(roleKey) {
  const normalized = normalizeRoleKey(roleKey);
  return ROLE_DEFINITIONS.find((entry) => entry.key === normalized)?.label || String(roleKey || '').trim();
}

function getRequestedAccessMode() {
  if (hasFreshSupervisorToken()) return 'supervisor';
  try {
    const storedMode = normalizeAccessMode(
      sessionStorage.getItem(ACCESS_MODE_STORAGE_KEY) ||
      localStorage.getItem(ACCESS_MODE_STORAGE_KEY)
    );
    if (storedMode && storedMode !== 'supervisor') return storedMode;
  } catch (_) { /* ignore */ }
  return 'lifeguard';
}

function persistRequestedAccessMode(mode) {
  const normalized = normalizeAccessMode(mode) || 'lifeguard';
  try {
    sessionStorage.setItem(ACCESS_MODE_STORAGE_KEY, normalized);
    localStorage.setItem(ACCESS_MODE_STORAGE_KEY, normalized);
  } catch (_) { /* ignore */ }
  return normalized;
}

function clearRequestedAccessMode() {
  try {
    sessionStorage.removeItem(ACCESS_MODE_STORAGE_KEY);
    localStorage.removeItem(ACCESS_MODE_STORAGE_KEY);
  } catch (_) { /* ignore */ }
}

function getEmployeeRoleKey(employee) {
  const normalized = normalizeEmployeeRecord(employee || {});
  return normalizeIdentityKey(normalized.email || normalized.id || normalized.username);
}

function getEmployeeIdentityKeys(employee = {}) {
  const normalized = normalizeEmployeeRecord(employee || {});
  return [
    normalized.email,
    normalized.id,
    normalized.username,
    normalized.employeeId,
  ].map(normalizeIdentityKey).filter(Boolean);
}

function getPermissionRoleKeysForEmployee(employee = {}) {
  const employeeKeys = new Set(getEmployeeIdentityKeys(employee));
  if (!employeeKeys.size) return [];
  return ROLE_DEFINITIONS
    .filter(({ key }) => (rolesPermissionsData.roles?.[key] || [])
      .map(normalizeIdentityKey)
      .some((memberKey) => employeeKeys.has(memberKey)))
    .map(({ key }) => key);
}

function getResolvedEmployeeRoleKeys(employee = {}) {
  return [
    ...getPermissionRoleKeysForEmployee(employee),
    ...normalizeEmployeeRoleKeys(employee),
  ].filter((roleKey, index, roleKeys) => roleKey && roleKeys.indexOf(roleKey) === index);
}

function formatEmployeeRoles(employee = {}) {
  return getResolvedEmployeeRoleKeys(employee)
    .map(getRoleLabel)
    .filter(Boolean)
    .join(', ');
}

function getCurrentIdentityKeys() {
  restoreLifeguardSessionFromLocalStorage();
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
    PERMISSION_DEFINITIONS.forEach(({ key: permissionKey }) => {
      if (Object.prototype.hasOwnProperty.call(value || {}, permissionKey)) {
        permissionOverrides[permissionKey] = !!value[permissionKey];
      }
    });
    return [normalizeIdentityKey(key), permissionOverrides];
  }));
  return {
    roles: Object.fromEntries(ROLE_DEFINITIONS.map(({ key }) => [
      key,
      Array.isArray(roles[key]) ? roles[key].map(normalizeIdentityKey).filter(Boolean) : [],
    ])),
    permissions: Object.fromEntries(ROLE_DEFINITIONS.map(({ key }) => [
      key,
      normalizePermissionMap(permissions[key], key),
    ])),
    individualPermissions: normalizedIndividual,
  };
}

function normalizePermissionMap(source = {}, roleKey = '') {
  const defaults = ROLE_DEFAULT_PERMISSIONS[roleKey] || {};
  const legacyKeys = new Set(['poolChemistryDashboard', 'managerialReport', 'desPreInspection']);
  const hasExpandedPermissionShape = PERMISSION_DEFINITIONS.some(({ key }) =>
    !legacyKeys.has(key) && Object.prototype.hasOwnProperty.call(source || {}, key)
  );
  if (roleKey === 'supervisor' && !hasExpandedPermissionShape) {
    return { ...defaults };
  }
  return Object.fromEntries(PERMISSION_DEFINITIONS.map(({ key }) => [
    key,
    Object.prototype.hasOwnProperty.call(source || {}, key) ? !!source[key] : !!defaults[key],
  ]));
}

function applyIndividualPermissionOverrides(permissions, keys) {
  const merged = { ...permissions };
  PERMISSION_DEFINITIONS.forEach(({ key: permissionKey }) => {
    const overrides = Array.from(keys || [])
      .map((identityKey) => rolesPermissionsData.individualPermissions?.[identityKey])
      .filter((individual) => Object.prototype.hasOwnProperty.call(individual || {}, permissionKey))
      .map((individual) => !!individual[permissionKey]);
    if (overrides.includes(false)) {
      merged[permissionKey] = false;
    } else if (overrides.includes(true)) {
      merged[permissionKey] = true;
    }
  });
  return merged;
}

function getPermissionsForAccessMode(accessMode, keys = getCurrentIdentityKeys()) {
  const roleKey = getRoleKeyForAccessMode(normalizeAccessMode(accessMode) || 'lifeguard');
  const base = normalizePermissionMap(rolesPermissionsData.permissions?.[roleKey], roleKey);
  return applyIndividualPermissionOverrides(base, new Set((keys || []).map(normalizeIdentityKey).filter(Boolean)));
}

function getEffectiveRolePermissionsForKeys(keys) {
  const normalizedKeys = new Set((keys || []).map(normalizeIdentityKey).filter(Boolean));
  const effective = Object.fromEntries(PERMISSION_DEFINITIONS.map(({ key }) => [key, false]));
  ROLE_DEFINITIONS.forEach(({ key }) => {
    const members = rolesPermissionsData.roles[key] || [];
    if (!members.some((memberKey) => normalizedKeys.has(memberKey))) return;
    PERMISSION_DEFINITIONS.forEach(({ key: permissionKey }) => {
      if (rolesPermissionsData.permissions[key]?.[permissionKey]) {
        effective[permissionKey] = true;
      }
    });
  });
  PERMISSION_DEFINITIONS.forEach(({ key: permissionKey }) => {
    const overrides = Array.from(normalizedKeys)
      .map((identityKey) => rolesPermissionsData.individualPermissions?.[identityKey])
      .filter((individual) => Object.prototype.hasOwnProperty.call(individual || {}, permissionKey))
      .map((individual) => !!individual[permissionKey]);
    if (overrides.includes(false)) {
      effective[permissionKey] = false;
    } else if (overrides.includes(true)) {
      effective[permissionKey] = true;
    }
  });
  return effective;
}

function hasRoleMembershipForKeys(keys, roleKey) {
  const normalizedKeys = new Set((keys || []).map(normalizeIdentityKey).filter(Boolean));
  return (rolesPermissionsData.roles?.[roleKey] || []).some((memberKey) => normalizedKeys.has(memberKey));
}

function isDeveloperUser() {
  return getCurrentIdentityKeys().includes(SITE_DEVELOPER_EMAIL);
}

function getCurrentAccessProfile() {
  const keys = getCurrentIdentityKeys();
  const accessMode = getRequestedAccessMode();
  const permissions = getPermissionsForAccessMode(accessMode, keys);
  return {
    isDeveloper: isDeveloperUser(),
    accessMode,
    permissions,
  };
}

function cacheCurrentAccessProfile() {
  try {
    localStorage.setItem(ROLE_PERMISSIONS_STORAGE_KEY, JSON.stringify(getCurrentAccessProfile()));
  } catch (_) { /* ignore */ }
}

function readCachedAccessProfile() {
  try {
    return JSON.parse(localStorage.getItem(ROLE_PERMISSIONS_STORAGE_KEY) || 'null') || null;
  } catch (_) {
    return null;
  }
}

async function loadRolesPermissions() {
  try {
    const snap = await getDoc(doc(db, 'settings', ROLE_PERMISSIONS_DOC_ID));
    rolesPermissionsData = normalizeRolesPermissionsData(snap.exists() ? snap.data() : {});
  } catch (err) {
    console.error('[PoolPro] Error loading roles and permissions:', err);
    rolesPermissionsData = normalizeRolesPermissionsData({});
  }
  cacheCurrentAccessProfile();
  window.setupDropdownVisibility?.();
  applyDashboardAccessMode();
  enforceDesPreInspectionAccess();
  enforceCurrentPageAccess();
  renderEmployeesTable();
  renderUnverifiedAccountsTable();
  renderRolesPermissionsSettings();
  return rolesPermissionsData;
}

async function saveRolesPermissions() {
  rolesPermissionsData = normalizeRolesPermissionsData(rolesPermissionsData);
  await setDoc(doc(db, 'settings', ROLE_PERMISSIONS_DOC_ID), rolesPermissionsData, { merge: false });
  cacheCurrentAccessProfile();
  window.setupDropdownVisibility?.();
  applyDashboardAccessMode();
  enforceDesPreInspectionAccess();
  enforceCurrentPageAccess();
  renderEmployeesTable();
  renderUnverifiedAccountsTable();
}

function hasPermission(permissionKey) {
  const accessMode = getRequestedAccessMode();
  const live = getCurrentAccessProfile();
  if (Object.prototype.hasOwnProperty.call(live.permissions || {}, permissionKey)) {
    return !!live.permissions[permissionKey];
  }
  const cached = readCachedAccessProfile();
  return !!cached?.permissions?.[permissionKey];
}

window.poolProHasPermission = hasPermission;

function canAccessPoolChemistryDashboard() {
  return hasPermission('poolChemistryDashboard');
}

function canAccessManagerialReport() {
  return hasPermission('managerialReport');
}

function canAccessDesPreInspection() {
  return hasPermission('desPreInspection');
}

window.poolProCanAccessManagerialReport = canAccessManagerialReport;
window.poolProCanAccessDesPreInspection = canAccessDesPreInspection;

function canAccessPage(permissionKey) {
  return !permissionKey || hasPermission(permissionKey);
}

const NAV_PERMISSION_MAP = {
  chem: 'poolChemistryLog',
  'training-signup': 'trainingSignup',
  duties: 'cleanlinessReport',
  'des-logbooks': 'desLogbooks',
  'managerial-report': 'managerialReport',
  'operational-status': 'operationalStatusLog',
  inventory: 'inventory',
  'todo-list': 'todoList',
  resources: 'resources',
  'des-pre-inspection': 'desPreInspection',
  dashboard: 'poolChemistryDashboard',
  'training-setup': 'trainingSetup',
  employees: 'performanceTracking',
  testing: 'auditingForms',
  settings: 'settings',
  'lifeguard-settings': 'settings',
};

function getCurrentPagePermissionKey() {
  const path = window.location.pathname;
  if (/\/chem\/chem\.html$/i.test(path)) {
    return window.location.hash === '#supervisorDashboard' ? 'poolChemistryDashboard' : 'poolChemistryLog';
  }
  if (/\/Training\/training\.html$/i.test(path) || /\/training\/training\.html$/i.test(path)) return 'trainingSignup';
  if (/\/duties\/duties\.html$/i.test(path)) return 'cleanlinessReport';
  if (/\/des-logbooks\/des-logbooks\.html$/i.test(path)) return 'desLogbooks';
  if (/\/managerial\/managerial\.html$/i.test(path)) return 'managerialReport';
  if (/\/operational\/operational\.html$/i.test(path)) return 'operationalStatusLog';
  if (/\/inventory\/inventory\.html$/i.test(path)) return 'inventory';
  if (/\/todo\/todo\.html$/i.test(path)) return 'todoList';
  if (/\/resources\/resources\.html$/i.test(path)) return 'resources';
  if (/\/des\/des\.html$/i.test(path)) return 'desPreInspection';
  if (/\/employees\/employees\.html$/i.test(path)) return 'performanceTracking';
  if (/\/testing\/testing\.html$/i.test(path)) return 'auditingForms';
  if (/\/Editor\/newRules\.html$/i.test(path) || /\/editor\/newRules\.html$/i.test(path)) return 'rulesEditor';
  return '';
}

function pageTitleForPermission(permissionKey) {
  return PERMISSION_DEFINITIONS.find(({ key }) => key === permissionKey)?.label || 'This page';
}

function enforceCurrentPageAccess() {
  const permissionKey = getCurrentPagePermissionKey();
  if (permissionKey && hasExpiredLifeguardSessionMarker() && !hasActivePoolProSession()) {
    maybeShowCurrentPageLoginModal();
    return;
  }
  if (!permissionKey || canAccessPage(permissionKey)) return;
  const title = pageTitleForPermission(permissionKey);
  const container = document.querySelector('.container') || document.querySelector('main') || document.body;
  container.innerHTML = `
    <h2 class="page-content-title">${escapeHtml(title)}</h2>
    <div class="form-container">
      <div class="section">
        <h2>Access Required</h2>
        <p>You do not have permission to view ${escapeHtml(title)}.</p>
      </div>
    </div>
  `;
}

function isDesPreInspectionPage() {
  return /\/des\/des\.html$/i.test(window.location.pathname);
}

function enforceDesPreInspectionAccess() {
  if (!isDesPreInspectionPage()) return;
  const allowed = canAccessDesPreInspection();
  document.body.classList.toggle('des-access-denied', !allowed);
  const container = document.querySelector('.container');
  if (!container) return;
  if (!allowed) {
    container.innerHTML = `
      <h2 class="page-content-title">DES Pre-Inspection</h2>
      <div class="form-container">
        <div class="section">
          <h2>Access Required</h2>
          <p>You do not have permission to view the DES Pre-Inspection form.</p>
        </div>
      </div>
    `;
  }
}

function isLifeguardSession() {
  try {
    restoreLifeguardSessionFromLocalStorage();
    const role = sessionStorage.getItem('chemlogRole') || localStorage.getItem('chemlogRole');
    const email = sessionStorage.getItem('chemlogEmployeeEmail') || sessionStorage.getItem('chemlogEmployeeId');
    const username = sessionStorage.getItem('chemlogEmployeeUsername');
    return role === 'lifeguard' && !!(email || username);
  } catch (_) {
    return false;
  }
}

function isSupervisor() {
  return hasFreshSupervisorToken();
}

const IMPORTANT_UPDATES_NOTICE_CONFIG = {
  enabled: false,
  storageKey: 'poolproImportantUpdatesNoticeDismissed_v2',
  title: '',
  items: [],
  endAt: null,
};

function isImportantUpdatesNoticeActive() {
  const config = IMPORTANT_UPDATES_NOTICE_CONFIG;
  if (!config.enabled || !Array.isArray(config.items) || !config.items.length) return false;
  if (!config.endAt) return true;
  const endAt = config.endAt instanceof Date ? config.endAt : new Date(config.endAt);
  return !Number.isNaN(endAt.getTime()) && Date.now() < endAt.getTime();
}

function hasActivePoolProSession() {
  return hasFreshSupervisorToken() ||
    isLifeguardSession() ||
    !!(sessionStorage.getItem('chemlogRole') || localStorage.getItem('chemlogRole'));
}

function dismissImportantUpdatesNotice() {
  try {
    sessionStorage.setItem(IMPORTANT_UPDATES_NOTICE_CONFIG.storageKey, 'true');
  } catch (_) {
    // Ignore storage failures; the close button should still hide the notice.
  }
  document.getElementById('importantUpdatesNotice')?.remove();
}

function maybeShowImportantUpdatesNotice() {
  if (!isImportantUpdatesNoticeActive() || !hasActivePoolProSession()) return;
  const config = IMPORTANT_UPDATES_NOTICE_CONFIG;
  try {
    if (sessionStorage.getItem(config.storageKey) === 'true') return;
  } catch (_) {
    // Continue without persistence if sessionStorage is unavailable.
  }
  if (document.getElementById('importantUpdatesNotice')) return;

  const overlay = document.createElement('div');
  overlay.id = 'importantUpdatesNotice';
  overlay.className = 'important-updates-notice';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'importantUpdatesNoticeTitle');
  const listItems = config.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  overlay.innerHTML = `
    <button type="button" class="important-updates-close" aria-label="Close important updates">&times;</button>
    <div class="important-updates-card">
      <h2 id="importantUpdatesNoticeTitle">${escapeHtml(config.title || 'Important Updates')}</h2>
      <ol type="a">${listItems}</ol>
    </div>
  `;
  overlay.querySelector('.important-updates-close')?.addEventListener('click', dismissImportantUpdatesNotice);
  document.body.appendChild(overlay);
}

// Show/hide supervisor-only dropdown items based on login state.
// Called on DOMContentLoaded and exported so training.js can re-call after login.
window.setupDropdownVisibility = function () {
  const sup = isSupervisor();
  const accessMode = getRequestedAccessMode();
  const lifeguard = accessMode === 'lifeguard' && isLifeguardSession() && !sup;
  const attendant = accessMode === 'attendant' && isLifeguardSession() && !sup;
  const limitedSettings = !sup && hasActivePoolProSession() && hasPermission('settings');
  Object.entries(NAV_PERMISSION_MAP).forEach(([nav, permissionKey]) => {
    document.querySelectorAll(`[data-nav="${nav}"]`).forEach((el) => {
      const isSupervisorTool = el.classList.contains('supervisor-only');
      if (nav === 'settings' && isSupervisorTool && !sup) {
        el.style.display = 'none';
        return;
      }
      el.style.display = hasPermission(permissionKey) ? '' : 'none';
    });
  });
  document.querySelectorAll('[data-nav="dashboard"]').forEach((el) => {
    el.style.display = hasPermission('poolChemistryDashboard') ? '' : 'none';
    el.textContent = sup ? 'Supervisor Dashboard' : 'Pool Chemistry Dashboard';
  });
  document.querySelectorAll('[data-nav="lifeguard-settings"]').forEach((el) => {
    el.style.display = limitedSettings ? '' : 'none';
  });
  document.querySelectorAll('.lifeguard-only').forEach((item) => {
    if (item.dataset.nav === 'lifeguard-settings') return;
    item.style.display = lifeguard ? '' : 'none';
  });
  document.querySelectorAll('.attendant-only').forEach((item) => {
    item.style.display = attendant && hasPermission(item.dataset.nav === 'des-logbooks' ? 'desLogbooks' : 'settings') ? '' : 'none';
  });
  document.querySelectorAll('.attendant-supervisor-only').forEach((item) => {
    item.style.display = (attendant || sup) && hasPermission(item.dataset.nav === 'des-logbooks' ? 'desLogbooks' : 'settings') ? '' : 'none';
  });
  document.querySelectorAll('.dropdown-menu').forEach((m) => {
    m.classList.toggle('lifeguard-active', lifeguard);
    m.classList.toggle('attendant-active', attendant);
    m.querySelectorAll('.supervisor-only').forEach((item) => {
      item.classList.remove('supervisor-group-start', 'supervisor-group-end');
    });
    const visibleSupervisorItems = Array.from(m.querySelectorAll('.supervisor-only'))
      .filter((item) => item.style.display !== 'none');
    m.classList.toggle('supervisor-active', visibleSupervisorItems.length > 0);
    if (visibleSupervisorItems.length) {
      visibleSupervisorItems[0].classList.add('supervisor-group-start');
      visibleSupervisorItems[visibleSupervisorItems.length - 1].classList.add('supervisor-group-end');
    }
  });
  maybeShowImportantUpdatesNotice();
};

function footerLogoPrefix() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const lastDir = parts.length > 1 ? parts[parts.length - 2] : '';
  const subDirs = ['chem', 'training', 'editor', 'employees', 'testing', 'main', 'duties', 'des-logbooks', 'managerial', 'resources', 'operational', 'des', 'inventory', 'todo', 'Chem', 'Training', 'Editor', 'Main', 'Duties', 'DES-Logbooks', 'Managerial', 'Employees', 'Testing', 'Resources', 'Operational', 'DES', 'Inventory', 'Todo', 'ToDo'];
  return subDirs.includes(lastDir) ? '../' : '';
}

function mountUnifiedFooter() {
  const prefix = footerLogoPrefix();
  document.querySelectorAll('.footer').forEach((footer) => {
    if (footer.dataset.unifiedFooter === 'true') return;
    footer.innerHTML = `
      <div class="site-footer-shell">
        <div class="site-footer-meta">
          <img src="${prefix}Images/Logos/logo.png" alt="PoolPro logo" class="site-footer-logo">
          <span class="site-footer-divider" aria-hidden="true"></span>
          <div class="site-footer-copy">
            <div class="site-footer-title">PoolPro v3.1</div>
            <div class="site-footer-date">Published April 2026</div>
          </div>
        </div>
        <div class="site-footer-company-row">Capital City Aquatics &amp; Upstate Pool Management</div>
      </div>
    `;
    footer.dataset.unifiedFooter = 'true';
  });
}

function removeSiteAppearanceSections() {
  document.querySelectorAll('#settingsModal .settings-section').forEach((section) => {
    const heading = section.querySelector(':scope > h3, :scope > .settings-section-toggle .settings-section-title');
    const label = heading?.textContent?.trim().toLowerCase() || '';
    if (label === 'site appearance') {
      section.remove();
    }
  });
}

function ensureSettingsModalScrollBody() {
  const modalContent = document.querySelector('#settingsModal .settings-modal-content');
  if (!modalContent || modalContent.querySelector(':scope > .settings-modal-scroll')) return;

  const header = modalContent.querySelector(':scope > .modal-header');
  const scrollBody = document.createElement('div');
  scrollBody.className = 'settings-modal-scroll';

  Array.from(modalContent.children).forEach((child) => {
    if (child !== header) scrollBody.appendChild(child);
  });

  modalContent.appendChild(scrollBody);
}

function ensureStandardSettingsSections() {
  const modalContent = document.querySelector('#settingsModal .settings-modal-content');
  if (!modalContent || document.getElementById('marketSection')) return;

  const websiteSection = modalContent.querySelector('.settings-section');
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="settings-section">
      <h3>Market</h3>
      <p class="section-subtitle">Select which markets' pools are visible on the supervisor dashboard.</p>
      <div id="marketSection" class="sanitation-section overlay-disabled">
        <div class="market-options">
          <label class="market-option"><input type="checkbox" class="market-filter-checkbox" name="marketFilter" value="Columbia"> Columbia</label>
          <label class="market-option"><input type="checkbox" class="market-filter-checkbox" name="marketFilter" value="Greenville"> Greenville</label>
          <label class="market-option"><input type="checkbox" class="market-filter-checkbox" name="marketFilter" value="Charlotte"> Charlotte</label>
          <label class="market-option"><input type="checkbox" class="market-filter-checkbox" name="marketFilter" value="Charleston"> Charleston</label>
        </div>
      </div>
      <div class="toggle-btn">
        <div class="sanitation-controls">
          <button type="button" class="editAndSave active" id="marketEditBtn">Edit</button>
          <button type="button" class="editAndSave" id="marketSaveBtn" disabled>Save</button>
        </div>
      </div>
    </div>
    <section class="settings-section settings-group" id="employeeSettings">
      <h3>Employees</h3>
      <p class="section-subtitle">Add employee information by uploading a master staffing file, or add employees individually.</p>
      <div class="settings-row employee-file-row" style="margin-top: 20px;">
        <input type="file" id="employeeFileInput" accept=".csv,.txt,.xlsx,.xls" />
      </div>
      <div class="settings-row employee-add-row">
        <div class="settings-field">
          <label for="employeeFirstNameInput">Preferred First Name</label>
          <input type="text" id="employeeFirstNameInput" />
        </div>
        <div class="settings-field">
          <label for="employeeLastNameInput">Last Name</label>
          <input type="text" id="employeeLastNameInput" />
        </div>
        <div class="settings-field">
          <label for="employeeIdInput">Email</label>
          <input type="email" id="employeeIdInput" />
        </div>
        <div class="settings-field">
          <label for="employeePhoneInput">Phone Number</label>
          <input type="tel" id="employeePhoneInput" />
        </div>
        <div class="settings-field">
          <label for="employeeHomePoolInput">Home Pool</label>
          <select id="employeeHomePoolInput"><option value="">Select pool</option></select>
        </div>
      </div>
      <div class="employee-add-btn-row">
        <button type="button" class="submit-btn button-shadow employee-action-btn" id="employeeAddBtn">Add</button>
      </div>
      <div class="training-filter-bar employee-filter-bar" id="employeeFilterBar" style="margin: 20px 0 4px;">
        <span class="filter-by-label">Filter By:</span>
        <div class="settings-field roles-search-field employee-search-field">
          <label for="employeeSettingsSearch">Search</label>
          <input type="text" id="employeeSettingsSearch" class="employee-search-input" autocomplete="off" placeholder="Search employees">
        </div>
        <select id="employeeMarketFilter" class="training-filter-select">
          <option value="all">Market</option>
          <option value="Charleston">Charleston</option>
          <option value="Charlotte">Charlotte</option>
          <option value="Columbia">Columbia</option>
          <option value="Greenville">Greenville</option>
        </select>
        <select id="employeePoolFilter" class="training-filter-select">
          <option value="all">Home Pool</option>
        </select>
      </div>
      <div id="employeeTableSection" class="sanitation-section overlay-disabled">
        <table class="employee-table">
          <thead>
            <tr>
              <th>Preferred First Name</th>
              <th>Last Name</th>
              <th>Email</th>
              <th>Phone Number</th>
              <th>Home Pool</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="employeesTableBody"></tbody>
        </table>
      </div>
      <div style="margin-top:10px;">
        <button type="button" id="employeeDeleteAllBtn" class="submit-btn danger-button">Delete All Employees</button>
      </div>
    </section>
    <div class="settings-section">
      <div id="sanitationMethodsSection">
        <h3>Sanitation Methods</h3>
        <p class="section-subtitle">Sanitation methods are managed per market. Only markets selected below are shown.</p>
        <div id="sanitationTablesContainer"></div>
      </div>
    </div>
    <div class="settings-section">
      <h3>Data Storage</h3>
      <button id="clearAllData" class="submit-btn">Clear All Chemistry Log Data</button>
      <br>
      <button id="exportCsvBtn" class="submit-btn">Export Data to CSV</button>
    </div>
    <div class="settings-section">
      <h3>Security</h3>
      <p class="section-subtitle">Control inactivity logout and confirmation requirements for destructive actions.</p>
      <div class="security-content-wrap">
        <div style="margin-top: 10px;">
          <label for="securityTimeoutSelect">Auto-logout after inactivity</label>
          <div style="margin-top: 4px;">
            <select id="securityTimeoutSelect">
              <option value="never">Never</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">60 minutes</option>
            </select>
          </div>
        </div>
        <div style="margin-top: 20px;">
          <label style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="securityRequirePassword" checked>
            Require password confirmation before destructive actions
          </label>
        </div>
      </div>
      <div class="security-controls-row">
        <button type="button" id="securitySaveBtn" class="editAndSave" style="margin-top: 4px;">Save</button>
      </div>
    </div>
  `;

  let anchor = websiteSection;
  Array.from(wrapper.children).forEach((section) => {
    if (anchor) {
      anchor.insertAdjacentElement('afterend', section);
      anchor = section;
    } else {
      modalContent.appendChild(section);
    }
  });
}

function getSettingsSectionTitle(section) {
  return (section?.querySelector(':scope > h3, :scope > .settings-section-toggle .settings-section-title, :scope > #sanitationMethodsSection > h3')?.textContent || '')
    .trim()
    .toLowerCase();
}

function findSettingsSectionByTitle(title) {
  const normalized = (title || '').trim().toLowerCase();
  return Array.from(document.querySelectorAll('#settingsModal .settings-section'))
    .find((section) => getSettingsSectionTitle(section) === normalized) || null;
}

function ensureDataStorageSettingsSection() {
  const modalContent = document.querySelector('#settingsModal .settings-modal-content');
  if (!modalContent) return;

  let section = document.getElementById('dataStorageSettings') || findSettingsSectionByTitle('Data Storage');
  const wasNew = !section;
  if (!section) {
    section = document.createElement('section');
    section.className = 'settings-section settings-group data-storage-section';
    section.id = 'dataStorageSettings';
    const securitySection = findSettingsSectionByTitle('Security');
    const scrollBody = modalContent.querySelector(':scope > .settings-modal-scroll');
    if (securitySection) securitySection.insertAdjacentElement('beforebegin', section);
    else if (scrollBody) scrollBody.appendChild(section);
    else modalContent.appendChild(section);
  }

  section.id = 'dataStorageSettings';
  section.classList.add('data-storage-section');
  if (section.dataset.dataStorageReady === 'true') return;

  section.innerHTML = `
    <h3>Data Storage</h3>
    <p class="section-subtitle">Export or delete stored PoolPro table data by category.</p>
    <div class="settings-row data-storage-row">
      <div class="settings-field">
        <label for="dataExportCategorySelect">Export Data</label>
        <select id="dataExportCategorySelect" class="training-filter-select"></select>
      </div>
      <button type="button" id="exportCsvBtn" class="submit-btn">Export Selected Data</button>
    </div>
    <div class="settings-row data-storage-row">
      <div class="settings-field">
        <label for="dataDeleteCategorySelect">Delete Data</label>
        <select id="dataDeleteCategorySelect" class="training-filter-select"></select>
      </div>
      <button type="button" id="clearAllData" class="submit-btn danger-button">Delete Selected Data</button>
    </div>
  `;
  section.dataset.dataStorageReady = 'true';
  populateDataStorageSelectors();
  if (!wasNew) return;
  section.dataset.accordionReady = '';
}

// ============================================================
// ALERTS AND REMINDERS
// ============================================================

function generateAlertReminderId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `alert-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const ALERT_REMINDER_ROLE_OPTIONS = [
  { key: 'lifeguard', label: 'Lifeguard' },
  { key: 'attendant', label: 'Gate Attendant' },
  { key: 'poolManager', label: 'Pool Manager' },
  { key: 'supervisor', label: 'Supervisor' },
];
const ALERT_REMINDER_DEFAULT_ROLES = ALERT_REMINDER_ROLE_OPTIONS.map(({ key }) => key);
const ALERT_REMINDER_FONT_SIZE_OPTIONS = [
  { value: '', label: 'Default' },
  { value: '28', label: 'Small' },
  { value: '36', label: 'Normal' },
  { value: '44', label: 'Large' },
  { value: '56', label: 'Extra Large' },
  { value: '72', label: 'Huge' },
];
const ALERT_REMINDER_CANCEL_FORM_OPTIONS = [
  { key: '', label: 'Do not cancel', collection: '', facilityFields: [], timeFields: [] },
  {
    key: 'weeklyBackwashComplete',
    label: 'Weekly Backwashing Complete',
    completionType: 'weeklyBackwash',
  },
  {
    key: 'cleanlinessReport',
    label: 'Cleanliness Report',
    collection: 'dutySubmissions',
    facilityFields: ['pool', 'facilityName', 'poolName', 'homePool'],
    timeFields: ['timestamp', 'submittedAt', 'createdAt'],
  },
  {
    key: 'poolChemistryLog',
    label: 'Pool Chemistry Log',
    collection: 'poolSubmissions',
    facilityFields: ['poolLocation', 'facilityName', 'pool', 'poolName'],
    timeFields: ['timestamp', 'submittedAt', 'createdAt'],
  },
  {
    key: 'desPreInspection',
    label: 'DES Pre-Inspection',
    collection: 'desPreInspections',
    facilityFields: ['pool', 'facilityName', 'poolLocation', 'poolName'],
    timeFields: ['timestamp', 'submittedAt', 'createdAt'],
  },
  {
    key: 'desLogbooks',
    label: 'DES Logbook Form',
    collection: 'desLogbookSubmissions',
    facilityFields: ['pool', 'facilityName', 'poolLocation', 'poolName'],
    timeFields: ['timestamp', 'reportDate', 'submittedAt', 'createdAt'],
  },
  {
    key: 'managerialReport',
    label: 'Managerial Report',
    collection: 'managerialReports',
    facilityFields: ['pool', 'facilityName', 'poolLocation', 'poolName', 'homePool'],
    timeFields: ['timestamp', 'submittedAt', 'createdAt'],
  },
  {
    key: 'trainingSignup',
    label: 'Training Signup',
    collection: 'trainingSignups',
    facilityFields: ['homePool', 'pool', 'facilityName', 'poolLocation', 'poolName'],
    timeFields: ['signedUpAt', 'timestamp', 'submittedAt', 'createdAt'],
  },
];
const ALERT_REMINDER_CANCEL_PERIOD_OPTIONS = [
  { key: 'hour', label: 'Hour' },
  { key: 'half-day', label: 'Half-day' },
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'two-weeks', label: '2 Weeks' },
  { key: 'month', label: 'Month' },
];

function getAlertReminderRoleOptionsMarkup(selectedRoles = ALERT_REMINDER_DEFAULT_ROLES) {
  const selected = new Set(normalizeAlertReminderRoles(selectedRoles));
  return ALERT_REMINDER_ROLE_OPTIONS.map(({ key, label }) => `
    <label class="alerts-role-option">
      <input type="checkbox" class="market-filter-checkbox alert-reminder-role-checkbox" value="${escapeHtml(key)}" ${selected.has(key) ? 'checked' : ''}>
      <span>${escapeHtml(label)}</span>
    </label>
  `).join('');
}

function getAlertReminderFontSizeOptionsMarkup(selectedValue = '') {
  const selected = normalizeAlertReminderFontSize(selectedValue);
  return ALERT_REMINDER_FONT_SIZE_OPTIONS.map(({ value, label }) =>
    `<option value="${escapeHtml(value)}" ${selected === value ? 'selected' : ''}>${escapeHtml(label)}</option>`
  ).join('');
}

function getAlertReminderCancelFormOptionsMarkup(selectedValue = '') {
  const selected = normalizeAlertCancelFormKey(selectedValue);
  return ALERT_REMINDER_CANCEL_FORM_OPTIONS.map(({ key, label }) =>
    `<option value="${escapeHtml(key)}" ${selected === key ? 'selected' : ''}>${escapeHtml(label)}</option>`
  ).join('');
}

function getAlertReminderCancelPeriodOptionsMarkup(selectedValue = 'day') {
  const selected = normalizeAlertCancelPeriod(selectedValue);
  return ALERT_REMINDER_CANCEL_PERIOD_OPTIONS.map(({ key, label }) =>
    `<option value="${escapeHtml(key)}" ${selected === key ? 'selected' : ''}>${escapeHtml(label)}</option>`
  ).join('');
}

function getAlertReminderFacilityOptionsMarkup() {
  const groups = groupPoolsByMarket(poolsCache || []);
  const options = ['<option value="">Select a facility staff to exclude</option>'];
  groups.forEach(({ market, pools }) => {
    options.push(`<optgroup label="${escapeHtml(market)}">`);
    pools.forEach((pool) => {
      const poolName = getPoolName(pool);
      if (!poolName) return;
      options.push(`<option value="${escapeHtml(normalizeAlertFacilityKey(poolName))}">${escapeHtml(poolName)}</option>`);
    });
    options.push('</optgroup>');
  });
  return options.join('');
}

function ensureAlertsRemindersSettingsSection() {
  const modalContent = document.querySelector('#settingsModal .settings-modal-content');
  if (!modalContent) return;

  let section = document.getElementById('alertsRemindersSettings') || findSettingsSectionByTitle('Alerts and Reminders');
  const wasNew = !section;
  if (!section) {
    section = document.createElement('section');
    section.className = 'settings-section settings-group alerts-reminders-section';
    section.id = 'alertsRemindersSettings';
    const dataStorageSection = findSettingsSectionByTitle('Data Storage');
    const scrollBody = modalContent.querySelector(':scope > .settings-modal-scroll');
    if (dataStorageSection) dataStorageSection.insertAdjacentElement('beforebegin', section);
    else if (scrollBody) scrollBody.appendChild(section);
    else modalContent.appendChild(section);
  }

  section.id = 'alertsRemindersSettings';
  section.classList.add('alerts-reminders-section');
  if (section.dataset.alertsRemindersReady === 'true') {
    setupAlertsRemindersUI();
    setupAlertReminderEmployeeExclusionSearch();
    setupAlertReminderFacilityExclusionSelect();
    renderAlertsReminderLists();
    return;
  }

  section.innerHTML = `
    <h3>Alerts and Reminders</h3>
    <p class="section-subtitle">Create reminders that appear on a full-screen yellow popup after users log in.</p>
    <div class="alerts-reminders-form sanitation-section">
      <h4>Display Settings</h4>
      <div class="settings-row alerts-reminders-grid">
        <div class="settings-field">
          <label for="alertReminderStartDate">Start Date</label>
          <input type="date" id="alertReminderStartDate" class="training-filter-select">
        </div>
        <div class="settings-field">
          <label for="alertReminderEndDate">End Date</label>
          <input type="date" id="alertReminderEndDate" class="training-filter-select">
        </div>
        <div class="settings-field">
          <label for="alertReminderStartTime">Start Time</label>
          <input type="time" id="alertReminderStartTime" class="training-filter-select">
        </div>
        <div class="settings-field">
          <label for="alertReminderEndTime">End Time</label>
          <input type="time" id="alertReminderEndTime" class="training-filter-select">
        </div>
        <div class="settings-field">
          <label for="alertReminderRepeat">Repeat</label>
          <select id="alertReminderRepeat" class="training-filter-select">
            <option value="Hourly">Hourly</option>
            <option value="Daily" selected>Daily</option>
            <option value="Weekly">Weekly</option>
            <option value="Biweekly">Biweekly</option>
            <option value="Monthly">Monthly</option>
          </select>
        </div>
        <div class="settings-field">
          <label for="alertReminderFontSize">Font Size</label>
          <select id="alertReminderFontSize" class="training-filter-select">
            ${getAlertReminderFontSizeOptionsMarkup()}
          </select>
        </div>
      </div>
      <fieldset class="alerts-reminder-fieldset">
        <legend>Roles</legend>
        <div class="alerts-role-checkboxes" id="alertReminderRoles">
          ${getAlertReminderRoleOptionsMarkup()}
        </div>
      </fieldset>
      <fieldset class="alerts-reminder-fieldset">
        <legend>Excluded Employees</legend>
        <div class="settings-field roles-search-field alert-reminder-exclusion-search-field">
          <label for="alertReminderEmployeeExcludeSearch">Employee</label>
          <input type="text" id="alertReminderEmployeeExcludeSearch" autocomplete="off" placeholder="Type a name, email, or username">
          <div class="roles-search-results" id="alertReminderEmployeeExcludeResults"></div>
        </div>
        <div id="alertReminderExcludedEmployees" class="alerts-excluded-employees"></div>
        <div class="settings-field settings-field-full alert-reminder-facility-exclusion-field">
          <label for="alertReminderFacilityExcludeSelect">Entire Staff</label>
          <select id="alertReminderFacilityExcludeSelect" class="training-filter-select">
            ${getAlertReminderFacilityOptionsMarkup()}
          </select>
        </div>
        <div id="alertReminderExcludedFacilities" class="alerts-excluded-facilities"></div>
      </fieldset>
      <h4>Completion Cancellation</h4>
      <div class="settings-row alerts-reminders-grid alerts-reminders-cancel-grid">
        <label class="alerts-reminder-toggle settings-field-full">
          <input type="checkbox" id="alertReminderContinueUntilComplete" class="market-filter-checkbox">
          <span>Continue showing until the selected completion condition is satisfied</span>
        </label>
        <div class="settings-field settings-field-full">
          <label for="alertReminderCancelForm">Cancel the alert if:</label>
          <select id="alertReminderCancelForm" class="training-filter-select">
            ${getAlertReminderCancelFormOptionsMarkup()}
          </select>
        </div>
        <div class="settings-field">
          <label for="alertReminderCancelPeriod">Completion Period</label>
          <select id="alertReminderCancelPeriod" class="training-filter-select">
            ${getAlertReminderCancelPeriodOptionsMarkup()}
          </select>
        </div>
      </div>
      <div class="alerts-editor-toolbar" aria-label="Reminder formatting">
        <button type="button" data-alert-cmd="bold" aria-label="Bold"><strong>B</strong></button>
        <button type="button" data-alert-cmd="italic" aria-label="Italic"><em>I</em></button>
        <button type="button" data-alert-cmd="underline" aria-label="Underline"><u>U</u></button>
        <button type="button" data-alert-cmd="insertOrderedList" aria-label="Ordered list">1.</button>
        <button type="button" data-alert-cmd="insertUnorderedList" aria-label="Unordered list">•</button>
        <button type="button" data-alert-cmd="indent" aria-label="Indent">→</button>
        <button type="button" data-alert-cmd="outdent" aria-label="Unindent">←</button>
      </div>
      <div id="alertsReminderEditor" class="alerts-reminder-editor" contenteditable="true" role="textbox" aria-label="Reminder text"></div>
      <div class="alerts-reminders-actions">
        <button type="button" class="submit-btn button-shadow" id="alertReminderSaveBtn">Deploy Reminder</button>
        <button type="button" class="submit-btn" id="alertReminderClearBtn">Clear</button>
      </div>
      <p class="form-message" id="alertsReminderMessage"></p>
    </div>
    <div class="alerts-reminders-list-section">
      <h4>Currently Deployed Alerts and Reminders</h4>
      <div id="activeAlertsRemindersList" class="alerts-reminders-list"></div>
    </div>
    <div class="alerts-reminders-list-section">
      <h4>History</h4>
      <div id="alertsRemindersHistoryList" class="alerts-reminders-list"></div>
    </div>
  `;
  section.dataset.alertsRemindersReady = 'true';
  if (wasNew) section.dataset.accordionReady = '';
  setupAlertsRemindersUI();
  setupAlertReminderEmployeeExclusionSearch();
  setupAlertReminderFacilityExclusionSelect();
  renderAlertsReminderLists();
}

function sanitizeReminderHtml(rawHtml) {
  const allowedTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'OL', 'UL', 'LI', 'DIV', 'P', 'BR', 'SPAN']);
  const template = document.createElement('template');
  template.innerHTML = String(rawHtml || '');

  const cleanNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
    const tag = node.tagName;
    const fragment = document.createDocumentFragment();
    Array.from(node.childNodes).forEach((child) => fragment.appendChild(cleanNode(child)));
    if (!allowedTags.has(tag)) return fragment;
    const clean = document.createElement(tag.toLowerCase());
    clean.appendChild(fragment);
    return clean;
  };

  const output = document.createElement('div');
  Array.from(template.content.childNodes).forEach((node) => output.appendChild(cleanNode(node)));
  return output.innerHTML.trim();
}

function stripReminderText(html) {
  const div = document.createElement('div');
  div.innerHTML = sanitizeReminderHtml(html);
  return (div.textContent || '').replace(/\s+/g, ' ').trim();
}

function normalizeAlertReminderRoles(roles) {
  const valid = new Set(ALERT_REMINDER_ROLE_OPTIONS.map(({ key }) => key));
  const normalized = Array.isArray(roles)
    ? roles.map((role) => String(role || '').trim()).filter((role) => valid.has(role))
    : [];
  return normalized.length ? [...new Set(normalized)] : [...ALERT_REMINDER_DEFAULT_ROLES];
}

function normalizeAlertReminderFontSize(value) {
  const clean = String(value || '').trim();
  return ALERT_REMINDER_FONT_SIZE_OPTIONS.some((option) => option.value === clean) ? clean : '';
}

function normalizeAlertCancelFormKey(value) {
  const clean = String(value || '').trim();
  return ALERT_REMINDER_CANCEL_FORM_OPTIONS.some((option) => option.key === clean) ? clean : '';
}

function normalizeAlertCancelPeriod(value) {
  const clean = String(value || '').trim();
  return ALERT_REMINDER_CANCEL_PERIOD_OPTIONS.some((option) => option.key === clean) ? clean : 'day';
}

function getAlertReminderRoleLabels(roles) {
  const normalized = normalizeAlertReminderRoles(roles);
  return normalized.map((roleKey) =>
    ALERT_REMINDER_ROLE_OPTIONS.find((option) => option.key === roleKey)?.label || roleKey
  );
}

function getAlertCancelFormConfig(key) {
  const normalized = normalizeAlertCancelFormKey(key);
  return ALERT_REMINDER_CANCEL_FORM_OPTIONS.find((option) =>
    option.key === normalized && (option.collection || option.completionType)
  ) || null;
}

function getAlertCancelFormLabel(key) {
  return ALERT_REMINDER_CANCEL_FORM_OPTIONS.find((option) => option.key === normalizeAlertCancelFormKey(key))?.label || '';
}

function getAlertCancelPeriodLabel(key) {
  return ALERT_REMINDER_CANCEL_PERIOD_OPTIONS.find((option) => option.key === normalizeAlertCancelPeriod(key))?.label || 'Day';
}

function getSelectedAlertReminderRoles() {
  const valid = new Set(ALERT_REMINDER_ROLE_OPTIONS.map(({ key }) => key));
  return [...new Set(Array.from(document.querySelectorAll('.alert-reminder-role-checkbox:checked'))
    .map((checkbox) => String(checkbox.value || '').trim())
    .filter((role) => valid.has(role)))];
}

function setAlertReminderRoleCheckboxes(roles) {
  const selected = new Set(normalizeAlertReminderRoles(roles));
  document.querySelectorAll('.alert-reminder-role-checkbox').forEach((checkbox) => {
    checkbox.checked = selected.has(checkbox.value);
  });
}

function normalizeAlertReminderExcludedEmployees(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map((item) => {
    if (typeof item === 'string') return normalizeIdentityKey(item);
    return normalizeIdentityKey(
      item?.employeeKey ||
      item?.key ||
      item?.email ||
      item?.id ||
      item?.username ||
      getEmployeeRoleKey(item)
    );
  }).filter(Boolean))];
}

function normalizeAlertReminderExcludedFacilities(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map((item) => {
    if (typeof item === 'string') return normalizeAlertFacilityKey(item);
    return normalizeAlertFacilityKey(
      item?.facilityKey ||
      item?.key ||
      item?.pool ||
      item?.poolName ||
      item?.facilityName ||
      item?.homePool ||
      getPoolName(item)
    );
  }).filter(Boolean))];
}

function getAlertReminderEmployeeLabel(employeeKey) {
  const employee = findEmployeeByRoleKey(employeeKey);
  if (!employee) return employeeKey;
  const normalized = normalizeEmployeeRecord(employee);
  const name = employeeDisplayName(normalized);
  return normalized.email ? `${name} - ${normalized.email}` : name;
}

function getAlertReminderFacilityLabel(facilityKey) {
  const normalizedKey = normalizeAlertFacilityKey(facilityKey);
  const pool = poolsCache.find((poolDoc) => normalizeAlertFacilityKey(getPoolName(poolDoc)) === normalizedKey);
  return getPoolName(pool) || facilityKey;
}

function getSelectedAlertReminderExcludedEmployees() {
  return normalizeAlertReminderExcludedEmployees(
    Array.from(document.querySelectorAll('#alertReminderExcludedEmployees [data-excluded-employee-key]'))
      .map((chip) => chip.dataset.excludedEmployeeKey)
  );
}

function setAlertReminderExcludedEmployees(keys = []) {
  const container = document.getElementById('alertReminderExcludedEmployees');
  if (!container) return;
  const normalizedKeys = normalizeAlertReminderExcludedEmployees(keys);
  container.innerHTML = '';
  normalizedKeys.forEach((key) => {
    const chip = document.createElement('span');
    chip.className = 'alerts-excluded-chip';
    chip.dataset.excludedEmployeeKey = key;
    chip.innerHTML = `
      <span>${escapeHtml(getAlertReminderEmployeeLabel(key))}</span>
      <button type="button" class="alerts-excluded-remove" aria-label="Remove excluded employee">&times;</button>
    `;
    container.appendChild(chip);
  });
}

function getSelectedAlertReminderExcludedFacilities() {
  return normalizeAlertReminderExcludedFacilities(
    Array.from(document.querySelectorAll('#alertReminderExcludedFacilities [data-excluded-facility-key]'))
      .map((chip) => chip.dataset.excludedFacilityKey)
  );
}

function setAlertReminderExcludedFacilities(keys = []) {
  const container = document.getElementById('alertReminderExcludedFacilities');
  if (!container) return;
  const normalizedKeys = normalizeAlertReminderExcludedFacilities(keys);
  container.innerHTML = '';
  normalizedKeys.forEach((key) => {
    const chip = document.createElement('span');
    chip.className = 'alerts-excluded-chip';
    chip.dataset.excludedFacilityKey = key;
    chip.innerHTML = `
      <span>${escapeHtml(getAlertReminderFacilityLabel(key))}</span>
      <button type="button" class="alerts-excluded-remove" aria-label="Remove excluded staff">&times;</button>
    `;
    container.appendChild(chip);
  });
}

function addAlertReminderExcludedEmployee(employeeKey) {
  const keys = getSelectedAlertReminderExcludedEmployees();
  const normalized = normalizeIdentityKey(employeeKey);
  if (!normalized || keys.includes(normalized)) return;
  setAlertReminderExcludedEmployees([...keys, normalized]);
}

function addAlertReminderExcludedFacility(facilityKey) {
  const keys = getSelectedAlertReminderExcludedFacilities();
  const normalized = normalizeAlertFacilityKey(facilityKey);
  if (!normalized || keys.includes(normalized)) return;
  setAlertReminderExcludedFacilities([...keys, normalized]);
}

function setupAlertReminderEmployeeExclusionSearch() {
  const input = document.getElementById('alertReminderEmployeeExcludeSearch');
  const results = document.getElementById('alertReminderEmployeeExcludeResults');
  if (!input || !results || input.dataset.bound === 'true') return;
  input.dataset.bound = 'true';

  const renderResults = () => {
    const term = normalizeIdentityKey(input.value);
    const excluded = new Set(getSelectedAlertReminderExcludedEmployees());
    results.innerHTML = '';
    if (!term) {
      results.classList.remove('visible');
      return;
    }
    const matches = employeesData
      .map(normalizeEmployeeRecord)
      .filter((employee) => {
        const key = getEmployeeRoleKey(employee);
        if (!key || excluded.has(key)) return false;
        const haystack = [
          employeeDisplayName(employee),
          employee.email,
          employee.username,
          employee.id,
          employee.homePool,
        ].join(' ').toLowerCase();
        return haystack.includes(term);
      })
      .slice(0, 8);

    matches.forEach((employee) => {
      const key = getEmployeeRoleKey(employee);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'roles-search-option';
      button.textContent = getAlertReminderEmployeeLabel(key);
      button.addEventListener('click', () => {
        addAlertReminderExcludedEmployee(key);
        input.value = '';
        results.innerHTML = '';
        results.classList.remove('visible');
      });
      results.appendChild(button);
    });
    results.classList.toggle('visible', matches.length > 0);
  };

  input.addEventListener('input', renderResults);
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.alert-reminder-exclusion-search-field')) results.classList.remove('visible');
  });
}

function setupAlertReminderFacilityExclusionSelect() {
  const select = document.getElementById('alertReminderFacilityExcludeSelect');
  if (!select) return;
  select.innerHTML = getAlertReminderFacilityOptionsMarkup();
  if (select.dataset.bound === 'true') return;
  select.dataset.bound = 'true';
  select.addEventListener('change', () => {
    addAlertReminderExcludedFacility(select.value);
    select.value = '';
  });
}

function applyAlertReminderEditorFontSize(value) {
  const editor = document.getElementById('alertsReminderEditor');
  if (!editor) return;
  const fontSize = normalizeAlertReminderFontSize(value);
  editor.style.fontSize = fontSize ? `${fontSize}px` : '';
  editor.dataset.fontSize = fontSize;
}

function normalizeAlertReminder(item = {}) {
  return {
    id: String(item.id || generateAlertReminderId()),
    startDate: String(item.startDate || ''),
    endDate: String(item.endDate || ''),
    startTime: String(item.startTime || ''),
    endTime: String(item.endTime || ''),
    repeat: ['Hourly', 'Daily', 'Weekly', 'Biweekly', 'Monthly'].includes(item.repeat) ? item.repeat : 'Daily',
    fontSize: normalizeAlertReminderFontSize(item.fontSize),
    roles: normalizeAlertReminderRoles(item.roles),
    excludedEmployees: normalizeAlertReminderExcludedEmployees(item.excludedEmployees || item.excludedEmployeeKeys || item.employeeExclusions),
    excludedFacilities: normalizeAlertReminderExcludedFacilities(item.excludedFacilities || item.excludedFacilityKeys || item.facilityExclusions || item.excludedPools),
    cancelFormKey: normalizeAlertCancelFormKey(item.cancelFormKey || item.cancelForm || ''),
    cancelPeriod: normalizeAlertCancelPeriod(item.cancelPeriod || 'day'),
    continueUntilComplete: item.continueUntilComplete === true || item.stayVisibleUntilComplete === true,
    html: sanitizeReminderHtml(item.html || item.messageHtml || item.text || ''),
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
    deletedAt: item.deletedAt || '',
    redeployedAt: item.redeployedAt || '',
  };
}

function normalizeAlertsRemindersData(data = {}) {
  return {
    active: Array.isArray(data.active) ? data.active.map(normalizeAlertReminder).filter((item) => item.html) : [],
    history: Array.isArray(data.history) ? data.history.map(normalizeAlertReminder).filter((item) => item.html) : [],
  };
}

async function loadAlertsRemindersSettings() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'alertsReminders'));
    alertsRemindersData = normalizeAlertsRemindersData(snap.exists() ? snap.data() : {});
  } catch (err) {
    console.error('[PoolPro] Error loading alerts and reminders:', err);
    alertsRemindersData = { active: [], history: [] };
  }
  alertsRemindersLoaded = true;
  renderAlertsReminderLists();
}

async function saveAlertsRemindersSettings() {
  await setDoc(doc(db, 'settings', 'alertsReminders'), {
    ...alertsRemindersData,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

function setAlertsReminderMessage(text, isError = false) {
  const msg = document.getElementById('alertsReminderMessage');
  if (!msg) return;
  msg.textContent = text || '';
  msg.classList.toggle('error', !!text && isError);
  msg.classList.toggle('success', !!text && !isError);
}

function clearAlertsReminderForm() {
  alertsReminderEditing = { id: '', source: '' };
  ['alertReminderStartDate', 'alertReminderEndDate', 'alertReminderStartTime', 'alertReminderEndTime'].forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
  const repeat = document.getElementById('alertReminderRepeat');
  if (repeat) repeat.value = 'Daily';
  const fontSize = document.getElementById('alertReminderFontSize');
  if (fontSize) fontSize.value = '';
  const cancelForm = document.getElementById('alertReminderCancelForm');
  if (cancelForm) cancelForm.value = '';
  const cancelPeriod = document.getElementById('alertReminderCancelPeriod');
  if (cancelPeriod) cancelPeriod.value = 'day';
  const continueUntilComplete = document.getElementById('alertReminderContinueUntilComplete');
  if (continueUntilComplete) continueUntilComplete.checked = false;
  setAlertReminderRoleCheckboxes(ALERT_REMINDER_DEFAULT_ROLES);
  setAlertReminderExcludedEmployees([]);
  setAlertReminderExcludedFacilities([]);
  const excludeSearch = document.getElementById('alertReminderEmployeeExcludeSearch');
  if (excludeSearch) excludeSearch.value = '';
  const excludeResults = document.getElementById('alertReminderEmployeeExcludeResults');
  if (excludeResults) {
    excludeResults.innerHTML = '';
    excludeResults.classList.remove('visible');
  }
  const facilityExcludeSelect = document.getElementById('alertReminderFacilityExcludeSelect');
  if (facilityExcludeSelect) facilityExcludeSelect.value = '';
  applyAlertReminderEditorFontSize('');
  const editor = document.getElementById('alertsReminderEditor');
  if (editor) editor.innerHTML = '';
  const saveBtn = document.getElementById('alertReminderSaveBtn');
  if (saveBtn) saveBtn.textContent = 'Deploy Reminder';
  setAlertsReminderMessage('');
}

function populateAlertsReminderForm(reminder, source = 'active') {
  const normalized = normalizeAlertReminder(reminder);
  alertsReminderEditing = { id: normalized.id, source };
  const values = {
    alertReminderStartDate: normalized.startDate,
    alertReminderEndDate: normalized.endDate,
    alertReminderStartTime: normalized.startTime,
    alertReminderEndTime: normalized.endTime,
    alertReminderRepeat: normalized.repeat,
    alertReminderFontSize: normalized.fontSize,
    alertReminderCancelForm: normalized.cancelFormKey,
    alertReminderCancelPeriod: normalized.cancelPeriod,
  };
  Object.entries(values).forEach(([id, value]) => {
    const input = document.getElementById(id);
    if (input) input.value = value;
  });
  setAlertReminderRoleCheckboxes(normalized.roles);
  setAlertReminderExcludedEmployees(normalized.excludedEmployees);
  setAlertReminderExcludedFacilities(normalized.excludedFacilities);
  const continueUntilComplete = document.getElementById('alertReminderContinueUntilComplete');
  if (continueUntilComplete) continueUntilComplete.checked = !!normalized.continueUntilComplete;
  applyAlertReminderEditorFontSize(normalized.fontSize);
  const editor = document.getElementById('alertsReminderEditor');
  if (editor) editor.innerHTML = normalized.html;
  const saveBtn = document.getElementById('alertReminderSaveBtn');
  if (saveBtn) saveBtn.textContent = source === 'active' ? 'Update Reminder' : 'Redeploy Reminder';
  setAlertsReminderMessage(source === 'active' ? 'Editing deployed reminder.' : 'History item loaded. Deploy to redeploy it.');
}

function getAlertsReminderFormValues() {
  const editor = document.getElementById('alertsReminderEditor');
  return {
    startDate: document.getElementById('alertReminderStartDate')?.value || '',
    endDate: document.getElementById('alertReminderEndDate')?.value || '',
    startTime: document.getElementById('alertReminderStartTime')?.value || '',
    endTime: document.getElementById('alertReminderEndTime')?.value || '',
    repeat: document.getElementById('alertReminderRepeat')?.value || 'Daily',
    fontSize: normalizeAlertReminderFontSize(document.getElementById('alertReminderFontSize')?.value || ''),
    roles: getSelectedAlertReminderRoles(),
    excludedEmployees: getSelectedAlertReminderExcludedEmployees(),
    excludedFacilities: getSelectedAlertReminderExcludedFacilities(),
    cancelFormKey: normalizeAlertCancelFormKey(document.getElementById('alertReminderCancelForm')?.value || ''),
    cancelPeriod: normalizeAlertCancelPeriod(document.getElementById('alertReminderCancelPeriod')?.value || 'day'),
    continueUntilComplete: document.getElementById('alertReminderContinueUntilComplete')?.checked === true,
    html: sanitizeReminderHtml(editor?.innerHTML || ''),
  };
}

function parseDateOnly(value) {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function validateAlertsReminder(values) {
  if (!values.startDate || !values.endDate) return 'Start and end dates are required.';
  if (!values.startTime || !values.endTime) return 'Start and end times are required.';
  const startDate = parseDateOnly(values.startDate);
  const endDate = parseDateOnly(values.endDate);
  if (!startDate || !endDate || endDate < startDate) return 'End date must be on or after the start date.';
  if (!Array.isArray(values.roles) || !values.roles.length) return 'Select at least one role.';
  if (values.continueUntilComplete && !values.cancelFormKey) {
    return 'Select a completion condition before using the continue-until-submitted option.';
  }
  if (!stripReminderText(values.html)) return 'Reminder text is required.';
  return '';
}

async function handleSaveAlertReminder() {
  const values = getAlertsReminderFormValues();
  const validationError = validateAlertsReminder(values);
  if (validationError) {
    setAlertsReminderMessage(validationError, true);
    return;
  }

  const now = new Date().toISOString();
  const existing = alertsReminderEditing.source === 'active'
    ? alertsRemindersData.active.find((item) => item.id === alertsReminderEditing.id)
    : null;
  const reminder = normalizeAlertReminder({
    ...(existing || {}),
    ...values,
    id: existing?.id || generateAlertReminderId(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    redeployedAt: alertsReminderEditing.source === 'history' ? now : existing?.redeployedAt || '',
  });

  if (existing) {
    alertsRemindersData.active = alertsRemindersData.active.map((item) => item.id === reminder.id ? reminder : item);
  } else {
    alertsRemindersData.active = [reminder, ...alertsRemindersData.active.filter((item) => item.id !== reminder.id)];
  }

  try {
    await saveAlertsRemindersSettings();
    renderAlertsReminderLists();
    clearAlertsReminderForm();
    setAlertsReminderMessage('Reminder deployed.');
  } catch (err) {
    console.error('[PoolPro] Error saving alert reminder:', err);
    setAlertsReminderMessage('Unable to save this reminder right now.', true);
  }
}

function renderReminderListItem(reminder, source) {
  const item = document.createElement('div');
  item.className = 'alerts-reminder-list-item';
  item.dataset.alertReminderId = reminder.id;
  item.dataset.alertReminderSource = source;

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'alerts-reminder-delete';
  deleteBtn.textContent = '×';
  deleteBtn.setAttribute('aria-label', 'Delete reminder');
  deleteBtn.hidden = source !== 'active';
  item.appendChild(deleteBtn);

  const loadBtn = document.createElement('button');
  loadBtn.type = 'button';
  loadBtn.className = 'alerts-reminder-load';
  const preview = stripReminderText(reminder.html) || 'Untitled reminder';
  const rolesLabel = getAlertReminderRoleLabels(reminder.roles).join(', ');
  const fontSizeLabel = reminder.fontSize ? ` • Font ${reminder.fontSize}px` : '';
  const excludedCount = normalizeAlertReminderExcludedEmployees(reminder.excludedEmployees).length;
  const excludedLabel = excludedCount ? ` • Excludes ${excludedCount} employee${excludedCount === 1 ? '' : 's'}` : '';
  const excludedStaffCount = normalizeAlertReminderExcludedFacilities(reminder.excludedFacilities).length;
  const excludedStaffLabel = excludedStaffCount ? ` • Excludes ${excludedStaffCount} staff${excludedStaffCount === 1 ? '' : 's'}` : '';
  const cancelConfig = getAlertCancelFormConfig(reminder.cancelFormKey);
  const cancelLabel = cancelConfig?.completionType === 'weeklyBackwash'
    ? ' • Cancels when weekly backwashing is complete'
    : reminder.cancelFormKey
      ? ` • Cancels when ${getAlertCancelFormLabel(reminder.cancelFormKey)} is complete for the ${getAlertCancelPeriodLabel(reminder.cancelPeriod).toLowerCase()}`
      : '';
  const continueLabel = reminder.continueUntilComplete ? ' • Continues until completed/submitted' : '';
  loadBtn.innerHTML = `
    <span class="alerts-reminder-list-title">${escapeHtml(preview)}</span>
    <span class="alerts-reminder-list-meta">${escapeHtml(reminder.startDate)} ${escapeHtml(reminder.startTime)} - ${escapeHtml(reminder.endDate)} ${escapeHtml(reminder.endTime)} • ${escapeHtml(reminder.repeat)} • ${escapeHtml(rolesLabel)}${escapeHtml(fontSizeLabel)}${escapeHtml(excludedLabel)}${escapeHtml(excludedStaffLabel)}${escapeHtml(cancelLabel)}${escapeHtml(continueLabel)}</span>
  `;
  item.appendChild(loadBtn);
  return item;
}

function renderAlertsReminderLists() {
  const activeList = document.getElementById('activeAlertsRemindersList');
  const historyList = document.getElementById('alertsRemindersHistoryList');
  if (activeList) {
    activeList.innerHTML = '';
    if (!alertsRemindersData.active.length) {
      activeList.innerHTML = '<p class="alerts-reminders-empty">No alerts or reminders are currently deployed.</p>';
    } else {
      alertsRemindersData.active.forEach((item) => activeList.appendChild(renderReminderListItem(item, 'active')));
    }
  }
  if (historyList) {
    historyList.innerHTML = '';
    if (!alertsRemindersData.history.length) {
      historyList.innerHTML = '<p class="alerts-reminders-empty">No alert or reminder history yet.</p>';
    } else {
      alertsRemindersData.history.forEach((item) => historyList.appendChild(renderReminderListItem(item, 'history')));
    }
  }
}

function setupAlertsRemindersUI() {
  const section = document.getElementById('alertsRemindersSettings');
  if (!section || section.dataset.alertsRemindersBound === 'true') return;
  section.dataset.alertsRemindersBound = 'true';
  setupAlertReminderEmployeeExclusionSearch();
  setupAlertReminderFacilityExclusionSelect();

  section.addEventListener('click', async (event) => {
    const toolbarBtn = event.target.closest('[data-alert-cmd]');
    if (toolbarBtn) {
      event.preventDefault();
      document.getElementById('alertsReminderEditor')?.focus();
      document.execCommand(toolbarBtn.dataset.alertCmd, false, null);
      return;
    }

    if (event.target.closest('#alertReminderSaveBtn')) {
      event.preventDefault();
      await handleSaveAlertReminder();
      return;
    }

    if (event.target.closest('#alertReminderClearBtn')) {
      event.preventDefault();
      clearAlertsReminderForm();
      return;
    }

    const excludedRemove = event.target.closest('.alerts-excluded-remove');
    if (excludedRemove) {
      event.preventDefault();
      const chip = excludedRemove.closest('[data-excluded-employee-key], [data-excluded-facility-key]');
      if (chip) chip.remove();
      return;
    }

    const deleteBtn = event.target.closest('.alerts-reminder-delete');
    if (deleteBtn && !deleteBtn.hidden) {
      event.preventDefault();
      const item = deleteBtn.closest('.alerts-reminder-list-item');
      if (item?.dataset.alertReminderId) await deleteAlertReminder(item.dataset.alertReminderId);
      return;
    }

    const loadBtn = event.target.closest('.alerts-reminder-load');
    if (loadBtn) {
      event.preventDefault();
      const item = loadBtn.closest('.alerts-reminder-list-item');
      const source = item?.dataset.alertReminderSource || 'active';
      const list = source === 'history' ? alertsRemindersData.history : alertsRemindersData.active;
      const reminder = list.find((entry) => entry.id === item?.dataset.alertReminderId);
      if (reminder) populateAlertsReminderForm(reminder, source);
    }
  });

  section.addEventListener('change', (event) => {
    if (event.target?.id === 'alertReminderFontSize') {
      applyAlertReminderEditorFontSize(event.target.value);
    }
  });
}

function showPoolProConfirmation({ title = 'Confirm Action', message = '', confirmText = 'Confirm' } = {}) {
  return new Promise((resolve) => {
    let modal = document.getElementById('poolproConfirmModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'poolproConfirmModal';
      modal.className = 'poolpro-confirm-modal';
      document.body.appendChild(modal);
    }
    modal.innerHTML = `
      <div class="poolpro-confirm-card">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <div class="poolpro-confirm-actions">
          <button type="button" class="submit-btn" data-confirm-cancel>Cancel</button>
          <button type="button" class="submit-btn danger-button" data-confirm-ok>${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;
    const handleBackdropClick = (event) => {
      if (event.target === modal) close(false);
    };
    const close = (result) => {
      modal.classList.remove('visible');
      modal.removeEventListener('click', handleBackdropClick);
      setTimeout(() => {
        modal.style.display = 'none';
        resolve(result);
      }, 180);
    };
    modal.querySelector('[data-confirm-cancel]')?.addEventListener('click', () => close(false), { once: true });
    modal.querySelector('[data-confirm-ok]')?.addEventListener('click', () => close(true), { once: true });
    modal.addEventListener('click', handleBackdropClick);
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('visible'));
  });
}

async function deleteAlertReminder(id) {
  const reminder = alertsRemindersData.active.find((item) => item.id === id);
  if (!reminder) return;
  const confirmed = await showPoolProConfirmation({
    title: 'Delete Reminder',
    message: 'Delete this deployed alert or reminder? It will move to history.',
    confirmText: 'Delete',
  });
  if (!confirmed) return;

  const deletedReminder = normalizeAlertReminder({
    ...reminder,
    deletedAt: new Date().toISOString(),
  });
  alertsRemindersData.active = alertsRemindersData.active.filter((item) => item.id !== id);
  alertsRemindersData.history = [deletedReminder, ...alertsRemindersData.history.filter((item) => item.id !== id)];

  try {
    await saveAlertsRemindersSettings();
    renderAlertsReminderLists();
    if (alertsReminderEditing.id === id) clearAlertsReminderForm();
    setAlertsReminderMessage('Reminder deleted and moved to history.');
  } catch (err) {
    console.error('[PoolPro] Error deleting alert reminder:', err);
    setAlertsReminderMessage('Unable to delete this reminder right now.', true);
  }
}

function isTimeWithinReminderWindow(now, startTime, endTime) {
  const [startH, startM] = String(startTime || '').split(':').map(Number);
  const [endH, endM] = String(endTime || '').split(':').map(Number);
  if (!Number.isFinite(startH) || !Number.isFinite(endH)) return false;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startH * 60 + (Number.isFinite(startM) ? startM : 0);
  const endMinutes = endH * 60 + (Number.isFinite(endM) ? endM : 0);
  if (startMinutes <= endMinutes) return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
  return nowMinutes >= startMinutes || nowMinutes <= endMinutes;
}

function parseTimeParts(value) {
  const [hours, minutes] = String(value || '').split(':').map(Number);
  return {
    hours: Number.isFinite(hours) ? hours : 0,
    minutes: Number.isFinite(minutes) ? minutes : 0,
  };
}

function setDateTimeFromTime(date, timeValue) {
  const result = new Date(date);
  const { hours, minutes } = parseTimeParts(timeValue);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

function endOfDate(date) {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMonthsClamped(date, months) {
  const desiredDay = date.getDate();
  const result = new Date(date.getFullYear(), date.getMonth() + months, 1, 0, 0, 0, 0);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(desiredDay, lastDay));
  return result;
}

function getMonthlyRepeatOccurrenceStart(startDate, now, startTime) {
  const monthDiff = (now.getFullYear() - startDate.getFullYear()) * 12 + (now.getMonth() - startDate.getMonth());
  let candidate = addMonthsClamped(startDate, Math.max(0, monthDiff));
  if (candidate > new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
    candidate = addMonthsClamped(startDate, Math.max(0, monthDiff - 1));
  }
  return setDateTimeFromTime(candidate, startTime);
}

function getAlertReminderRepeatWindow(reminder, now = new Date()) {
  const startDate = parseDateOnly(reminder.startDate);
  const endDate = parseDateOnly(reminder.endDate);
  if (!startDate || !endDate) return null;
  const finalEnd = endOfDate(endDate);
  if (now < startDate || now > finalEnd) return null;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDiff = Math.floor((today - startDate) / (24 * 60 * 60 * 1000));
  if (dayDiff < 0) return null;

  let windowStart = null;
  let windowEnd = null;
  if (reminder.repeat === 'Hourly') {
    const hourStart = new Date(now);
    hourStart.setMinutes(0, 0, 0);
    const scheduledStart = setDateTimeFromTime(today, reminder.startTime);
    const scheduledEnd = setDateTimeFromTime(today, reminder.endTime);
    windowEnd = new Date(hourStart);
    windowEnd.setMinutes(59, 59, 999);
    if (scheduledStart > scheduledEnd) {
      if (!isTimeWithinReminderWindow(hourStart, reminder.startTime, reminder.endTime)) return null;
      windowStart = hourStart;
    } else {
      if (hourStart > scheduledEnd || windowEnd < scheduledStart) return null;
      windowStart = hourStart > scheduledStart ? hourStart : scheduledStart;
    }
  } else if (reminder.repeat === 'Weekly' || reminder.repeat === 'Biweekly') {
    const intervalDays = reminder.repeat === 'Biweekly' ? 14 : 7;
    const periodIndex = Math.floor(dayDiff / intervalDays);
    const periodStartDate = addDays(startDate, periodIndex * intervalDays);
    windowStart = setDateTimeFromTime(periodStartDate, reminder.startTime);
    windowEnd = addDays(periodStartDate, intervalDays);
    windowEnd.setMilliseconds(-1);
  } else if (reminder.repeat === 'Monthly') {
    windowStart = getMonthlyRepeatOccurrenceStart(startDate, now, reminder.startTime);
    const nextOccurrence = addMonthsClamped(parseDateOnly(formatDateInputValue(windowStart)), 1);
    windowEnd = new Date(nextOccurrence);
    windowEnd.setMilliseconds(-1);
  } else {
    windowStart = setDateTimeFromTime(today, reminder.startTime);
    windowEnd = endOfDate(today);
  }

  if (!windowStart || !windowEnd) return null;
  if (windowEnd > finalEnd) windowEnd = finalEnd;
  if (now < windowStart || now > windowEnd) return null;
  return { start: windowStart, end: windowEnd };
}

function isAlertReminderDueNow(reminder, now = new Date()) {
  const startDate = parseDateOnly(reminder.startDate);
  const endDate = parseDateOnly(reminder.endDate);
  if (!startDate || !endDate) return false;
  endDate.setHours(23, 59, 59, 999);
  if (now < startDate || now > endDate) return false;
  if (reminder.continueUntilComplete && reminder.cancelFormKey) {
    return !!getAlertReminderRepeatWindow(reminder, now);
  }
  if (!isTimeWithinReminderWindow(now, reminder.startTime, reminder.endTime)) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDiff = Math.floor((today - startDate) / (24 * 60 * 60 * 1000));
  if (dayDiff < 0) return false;
  if (reminder.repeat === 'Weekly') return dayDiff % 7 === 0;
  if (reminder.repeat === 'Biweekly') return dayDiff % 14 === 0;
  if (reminder.repeat === 'Monthly') return now.getDate() === startDate.getDate();
  return true;
}

function canDisplayLoginAlertReminders() {
  return !!auth.currentUser?.emailVerified || hasFreshSupervisorToken() || hasActivePoolProSession();
}

function getAlertReminderShownKey(reminder, now = new Date()) {
  const dateKey = formatDateInputValue(now);
  const repeatKey = reminder.repeat === 'Hourly'
    ? `${dateKey}:${String(now.getHours()).padStart(2, '0')}`
    : dateKey;
  return `poolproAlertReminderShown:${reminder.id}:${repeatKey}`;
}

function normalizeAlertFacilityKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s-]/g, '');
}

function getCurrentAlertReminderRoleKey() {
  if (isSupervisor()) return 'supervisor';
  return getRoleKeyForAccessMode(getRequestedAccessMode());
}

function isAlertReminderRoleAllowed(reminder) {
  const roles = normalizeAlertReminderRoles(reminder.roles);
  return roles.includes(getCurrentAlertReminderRoleKey());
}

function isAlertReminderEmployeeExcluded(reminder) {
  const excluded = new Set(normalizeAlertReminderExcludedEmployees(reminder.excludedEmployees));
  if (!excluded.size) return false;
  const currentKeys = getCurrentIdentityKeys();
  const currentRecord = typeof window.getCurrentEmployeeRecord === 'function'
    ? window.getCurrentEmployeeRecord()
    : null;
  if (currentRecord) {
    currentKeys.push(
      currentRecord.email,
      currentRecord.id,
      currentRecord.employeeId,
      currentRecord.username,
      getEmployeeRoleKey(currentRecord)
    );
  }
  return [...new Set(currentKeys.map(normalizeIdentityKey).filter(Boolean))]
    .some((key) => excluded.has(key));
}

function isAlertReminderFacilityExcluded(reminder) {
  const excluded = new Set(normalizeAlertReminderExcludedFacilities(reminder.excludedFacilities));
  if (!excluded.size) return false;
  const currentFacilityKey = getCurrentAlertReminderFacilityKey();
  return !!currentFacilityKey && excluded.has(currentFacilityKey);
}

function getCurrentAlertReminderFacilityKey() {
  const currentRecord = typeof window.getCurrentEmployeeRecord === 'function'
    ? window.getCurrentEmployeeRecord()
    : null;
  const values = [
    currentRecord?.homePool,
    currentRecord?.facilityName,
    currentRecord?.pool,
  ];
  try {
    values.push(
      sessionStorage.getItem('chemlogEmployeeHomePool'),
      localStorage.getItem('chemlogEmployeeHomePool')
    );
  } catch (_) { /* ignore */ }
  return normalizeAlertFacilityKey(values.find((value) => String(value || '').trim()));
}

function getAlertSubmissionFacilityKey(record = {}, config = {}) {
  const fields = Array.isArray(config.facilityFields) ? config.facilityFields : [];
  const direct = fields.map((field) => record?.[field]).find((value) => String(value || '').trim());
  return normalizeAlertFacilityKey(direct);
}

function getAlertSubmissionDate(record = {}, config = {}) {
  const fields = Array.isArray(config.timeFields) ? config.timeFields : [];
  for (const field of fields) {
    const date = toDateObject(record?.[field]);
    if (date) return date;
  }
  return null;
}

async function getAlertReminderFacilityPoolDoc(facilityKey) {
  if (!facilityKey) return null;
  const cached = poolsCache.find((poolDoc) => normalizeAlertFacilityKey(getPoolName(poolDoc)) === facilityKey);
  if (cached) return cached;

  try {
    const snap = await getDocs(collection(db, 'pools'));
    const pools = snap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));
    if (pools.length) poolsCache = pools;
    return pools.find((poolDoc) => normalizeAlertFacilityKey(getPoolName(poolDoc)) === facilityKey) || null;
  } catch (err) {
    console.warn('[PoolPro] Unable to load facility rules for alert reminder completion checks:', err);
    return null;
  }
}

async function hasFacilityWeeklyBackwashingCompleteForAlertReminder(facilityKey, now = new Date()) {
  const weekKey = getOperationalWeekKey(now);
  const cacheKey = ['weeklyBackwashComplete', facilityKey, weekKey].join(':');
  if (alertReminderCompletionCache.has(cacheKey)) return alertReminderCompletionCache.get(cacheKey);

  try {
    const poolDoc = await getAlertReminderFacilityPoolDoc(facilityKey);
    if (!poolDoc) {
      alertReminderCompletionCache.set(cacheKey, false);
      return false;
    }

    await loadOperationalStatusLogs();
    const facilityName = getPoolName(poolDoc);
    const poolCount = Math.max(1, Number(poolDoc.numPools || poolDoc.poolCount || 1));
    const requiredPoolIndexes = [];
    for (let idx = 0; idx < poolCount; idx += 1) {
      if (poolRequiresWeeklyBackwashing(poolDoc, idx)) requiredPoolIndexes.push(idx);
    }

    const complete = !requiredPoolIndexes.length || requiredPoolIndexes.every((idx) => {
      const latestBackwash = getLatestOperationalStatus(facilityName, idx, 'backwash');
      return getEffectiveWeeklyBackwashStatus(latestBackwash || {}, now) === 'Yes';
    });
    alertReminderCompletionCache.set(cacheKey, complete);
    return complete;
  } catch (err) {
    console.warn('[PoolPro] Unable to check weekly backwashing alert reminder status:', err);
    alertReminderCompletionCache.set(cacheKey, false);
    return false;
  }
}

function getAlertCompletionWindow(period, now = new Date(), reminder = {}) {
  const current = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const start = new Date(current);
  const end = new Date(current);

  switch (normalizeAlertCancelPeriod(period)) {
    case 'hour':
      start.setMinutes(0, 0, 0);
      end.setMinutes(59, 59, 999);
      break;
    case 'half-day': {
      const startHour = current.getHours() < 12 ? 0 : 12;
      start.setHours(startHour, 0, 0, 0);
      end.setHours(startHour + 11, 59, 59, 999);
      break;
    }
    case 'week': {
      const day = current.getDay();
      const daysSinceFriday = (day + 2) % 7;
      start.setDate(current.getDate() - daysSinceFriday);
      start.setHours(0, 0, 0, 0);
      end.setTime(start.getTime());
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      break;
    }
    case 'two-weeks': {
      const anchor = parseDateOnly(reminder.startDate) || new Date(current.getFullYear(), current.getMonth(), current.getDate());
      const today = new Date(current.getFullYear(), current.getMonth(), current.getDate());
      const dayDiff = Math.max(0, Math.floor((today - anchor) / (24 * 60 * 60 * 1000)));
      const periodStart = addDays(anchor, Math.floor(dayDiff / 14) * 14);
      start.setTime(periodStart.getTime());
      start.setHours(0, 0, 0, 0);
      end.setTime(start.getTime());
      end.setDate(start.getDate() + 14);
      end.setMilliseconds(-1);
      break;
    }
    case 'month':
      if (current.getDate() >= 24) {
        start.setDate(24);
        start.setHours(0, 0, 0, 0);
        end.setMonth(start.getMonth() + 1, 23);
      } else {
        start.setMonth(current.getMonth() - 1, 24);
        start.setHours(0, 0, 0, 0);
        end.setDate(23);
      }
      end.setHours(23, 59, 59, 999);
      break;
    case 'day':
    default:
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
  }

  return { start, end };
}

async function hasFacilitySubmissionForAlertReminder(reminder, now = new Date()) {
  const config = getAlertCancelFormConfig(reminder.cancelFormKey);
  if (!config) return false;
  const facilityKey = getCurrentAlertReminderFacilityKey();
  if (!facilityKey) return false;
  if (config.completionType === 'weeklyBackwash') {
    return hasFacilityWeeklyBackwashingCompleteForAlertReminder(facilityKey, now);
  }
  if (!config.collection) return false;
  const { start, end } = getAlertCompletionWindow(reminder.cancelPeriod, now, reminder);
  const cacheKey = [
    config.key,
    facilityKey,
    normalizeAlertCancelPeriod(reminder.cancelPeriod),
    start.getTime(),
    end.getTime(),
  ].join(':');
  if (alertReminderCompletionCache.has(cacheKey)) return alertReminderCompletionCache.get(cacheKey);

  try {
    const snap = await getDocs(collection(db, config.collection));
    const found = snap.docs.some((docSnap) => {
      const data = docSnap.data() || {};
      if (getAlertSubmissionFacilityKey(data, config) !== facilityKey) return false;
      const submittedAt = getAlertSubmissionDate(data, config);
      return !!submittedAt && submittedAt >= start && submittedAt <= end;
    });
    alertReminderCompletionCache.set(cacheKey, found);
    return found;
  } catch (err) {
    console.warn('[PoolPro] Unable to check alert reminder completion status:', err);
    alertReminderCompletionCache.set(cacheKey, false);
    return false;
  }
}

function getAlertReminderPopupStyle(reminder) {
  const fontSize = normalizeAlertReminderFontSize(reminder.fontSize);
  return fontSize ? `font-size: ${fontSize}px;` : '';
}

async function maybeShowActiveAlertRemindersOnPageLoad() {
  if (!alertsRemindersLoaded || alertsReminderPopupChecked || !canDisplayLoginAlertReminders()) return;
  alertsReminderPopupChecked = true;
  const now = new Date();
  const due = [];
  for (const rawItem of alertsRemindersData.active) {
    const item = normalizeAlertReminder(rawItem);
    if (!isAlertReminderDueNow(item, now)) continue;
    if (!isAlertReminderRoleAllowed(item)) continue;
    if (isAlertReminderEmployeeExcluded(item)) continue;
    if (isAlertReminderFacilityExcluded(item)) continue;
    const key = getAlertReminderShownKey(item, now);
    if (sessionStorage.getItem(key) === 'true') continue;
    if (await hasFacilitySubmissionForAlertReminder(item, now)) continue;
    sessionStorage.setItem(key, 'true');
    due.push(item);
  }
  if (due.length) showActiveAlertReminderPopup(due);
}

function showActiveAlertReminderPopup(reminders) {
  let modal = document.getElementById('poolproAlertReminderPopup');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'poolproAlertReminderPopup';
    modal.className = 'poolpro-alert-popup';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="poolpro-alert-popup-card">
      <button type="button" class="poolpro-alert-popup-close" aria-label="Close">&times;</button>
      <div class="poolpro-alert-popup-content">
        ${reminders.map((item) => {
          const style = getAlertReminderPopupStyle(item);
          return `<article class="poolpro-alert-popup-item"${style ? ` style="${escapeHtml(style)}"` : ''}>${sanitizeReminderHtml(item.html)}</article>`;
        }).join('')}
      </div>
    </div>
  `;
  const close = () => {
    modal.classList.remove('visible');
    setTimeout(() => {
      if (!modal.classList.contains('visible')) modal.style.display = 'none';
    }, 220);
  };
  modal.querySelector('.poolpro-alert-popup-close')?.addEventListener('click', close);
  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('visible'));
}

// ============================================================
// POOL SECTIONS — show/hide pools 3-5 based on pool config
// ============================================================

function updateVisiblePoolSections(numPools) {
  ['pool3Section', 'pool4Section', 'pool5Section'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (i + 3 <= (numPools || 2)) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });
}

function updatePoolSectionTitles(pool) {
  const sectionIds = ['mainPoolSection', 'secondaryPoolSection', 'pool3Section', 'pool4Section', 'pool5Section'];
  const defaultNames = ['Pool 1 (Main Pool)', 'Pool 2', 'Pool 3', 'Pool 4', 'Pool 5'];
  const rulesForPools = pool?.rules?.pools;

  sectionIds.forEach((id, idx) => {
    const section = document.getElementById(id);
    if (!section) return;
    const h3 = section.querySelector('h3');
    if (!h3) return;
    const customName = Array.isArray(rulesForPools) && rulesForPools[idx]?.poolName
      ? rulesForPools[idx].poolName
      : null;
    h3.textContent = customName || defaultNames[idx];
  });
}

function getChemSectionIds() {
  return ['mainPoolSection', 'secondaryPoolSection', 'pool3Section', 'pool4Section', 'pool5Section'];
}

function getChemPoolOrdinalLabel(idx, fallbackTitle = '') {
  const title = String(fallbackTitle || '').trim();
  if (title) return title;
  if (idx === 0) return 'Pool 1';
  if (idx === 1) return 'Pool 2';
  return `Pool ${idx + 1}`;
}

function ensureChemAutoControllerUploadSections() {
  getChemSectionIds().forEach((sectionId, idx) => {
    const section = document.getElementById(sectionId);
    if (!section) return;
    const content = section.querySelector('.pool-section-content');
    if (!content || content.querySelector('.chem-auto-controller-group')) return;

    const group = document.createElement('div');
    group.className = 'chem-auto-controller-group hidden';
    group.dataset.poolIndex = String(idx);
    group.innerHTML = `
      <div class="chem-auto-controller-copy">
        <h4 class="chem-auto-controller-title">Auto Controller <span class="duties-req-badge">1 required</span></h4>
        <p class="chem-auto-controller-desc"></p>
        <p class="chem-auto-controller-note hidden"></p>
      </div>
      <div class="chem-auto-controller-slot">
        <div class="chem-auto-controller-upload-area" role="button" tabindex="0">
          <div class="chem-auto-controller-placeholder">
            <span class="chem-auto-controller-icon">&#128247;</span>
            <span>Tap to add</span>
          </div>
          <img class="chem-auto-controller-preview" alt="Auto controller preview" />
          <input type="file" class="chem-auto-controller-input" accept="image/*" hidden>
        </div>
        <button type="button" class="chem-auto-controller-remove duties-clear-btn">Remove</button>
      </div>
    `;

    const uploadArea = group.querySelector('.chem-auto-controller-upload-area');
    const fileInput = group.querySelector('.chem-auto-controller-input');
    const preview = group.querySelector('.chem-auto-controller-preview');
    const placeholder = group.querySelector('.chem-auto-controller-placeholder');
    const removeBtn = group.querySelector('.chem-auto-controller-remove');

    const clearFile = () => {
      if (fileInput) {
        fileInput.value = '';
        fileInput._selectedFile = null;
      }
      if (preview) {
        preview.removeAttribute('src');
        preview.style.display = 'none';
      }
      if (placeholder) placeholder.style.display = 'flex';
      if (removeBtn) removeBtn.style.display = 'none';
    };

    const setFile = (file) => {
      if (!fileInput || !preview || !placeholder || !removeBtn || !file) return;
      try {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        fileInput.files = transfer.files;
      } catch (_) {
        fileInput._selectedFile = file;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        preview.src = event.target?.result || '';
        preview.style.display = 'block';
        placeholder.style.display = 'none';
        removeBtn.style.display = 'inline-flex';
      };
      reader.readAsDataURL(file);
    };

    uploadArea?.addEventListener('click', () => fileInput?.click());
    uploadArea?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput?.click();
      }
    });
    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0] || fileInput._selectedFile;
      if (file) setFile(file);
    });
    removeBtn?.addEventListener('click', () => clearFile());

    clearFile();
    content.appendChild(group);
  });
}

function getChemAutoControllerPhotoFile(poolIdx) {
  const input = document.querySelector(`.chem-auto-controller-group[data-pool-index="${poolIdx}"] .chem-auto-controller-input`);
  return input?.files?.[0] || input?._selectedFile || null;
}

function clearChemAutoControllerPhoto(poolIdx) {
  const group = document.querySelector(`.chem-auto-controller-group[data-pool-index="${poolIdx}"]`);
  if (!group) return;
  const input = group.querySelector('.chem-auto-controller-input');
  const preview = group.querySelector('.chem-auto-controller-preview');
  const placeholder = group.querySelector('.chem-auto-controller-placeholder');
  const removeBtn = group.querySelector('.chem-auto-controller-remove');
  if (input) {
    input.value = '';
    input._selectedFile = null;
  }
  if (preview) {
    preview.removeAttribute('src');
    preview.style.display = 'none';
  }
  if (placeholder) placeholder.style.display = 'flex';
  if (removeBtn) removeBtn.style.display = 'none';
}

async function hasRecentChemSubmissionForFacility(poolName) {
  if (!poolName) return false;
  try {
    const snap = await getDocs(query(collection(db, 'poolSubmissions'), orderBy('timestamp', 'desc'), limit(25)));
    const cutoff = Date.now() - CHEM_AUTO_CONTROLLER_REUSE_WINDOW_MS;
    return snap.docs.some((docSnap) => {
      const data = docSnap.data() || {};
      if (String(data.poolLocation || '').trim() !== String(poolName).trim()) return false;
      const ts = toDateObject(data.timestamp);
      return !!ts && ts.getTime() >= cutoff;
    });
  } catch (err) {
    console.warn('[ChemLog] Unable to check recent chemistry submissions for auto-controller reuse.', err);
    return false;
  }
}

async function updateChemAutoControllerSections(poolDoc) {
  ensureChemAutoControllerUploadSections();
  const poolName = getPoolName(poolDoc);
  const recentSubmission = await hasRecentChemSubmissionForFacility(poolName);

  getChemSectionIds().forEach((sectionId, idx) => {
    const section = document.getElementById(sectionId);
    const group = section?.querySelector('.chem-auto-controller-group');
    if (!section || !group) return;

    const sectionVisible = idx < Number(poolDoc?.numPools || poolDoc?.poolCount || 2);
    const rulesPool = poolDoc?.rules?.pools?.[idx];
    const enabled = !!rulesPool?.autoController && sectionVisible;
    group.classList.toggle('hidden', !enabled);
    if (!enabled) {
      clearChemAutoControllerPhoto(idx);
      return;
    }

    const titleText = section.querySelector('h3')?.textContent?.trim() || `Pool ${idx + 1}`;
    const poolDisplayName = rulesPool?.poolName || titleText;
    const desc = group.querySelector('.chem-auto-controller-desc');
    const note = group.querySelector('.chem-auto-controller-note');
    if (desc) {
      desc.textContent = `Upload an image of the ${getChemPoolOrdinalLabel(idx, poolDisplayName)} auto controller.`;
    }
    if (note) {
      note.textContent = recentSubmission
        ? 'A recent chemistry submission was made within the last 30 minutes, so this photo is optional right now.'
        : 'This image is required unless another chemistry submission was recorded for this facility within the last 30 minutes.';
      note.classList.toggle('hidden', false);
    }
  });
}

function getChemControllerPhotoRows(entry, poolDoc) {
  const rows = [];
  const poolCount = Math.max(1, Number(poolDoc?.numPools || poolDoc?.poolCount || 1));
  for (let idx = 0; idx < poolCount; idx += 1) {
    const fields = poolFieldNames(idx);
    const hasReading = !!(entry?.[fields.ph] || entry?.[fields.cl]);
    if (!hasReading) continue;
    if (!poolDoc?.rules?.pools?.[idx]?.autoController) continue;
    rows.push({
      poolIdx: idx,
      label: getFacilityPoolLabel(poolDoc, idx),
      file: getChemAutoControllerPhotoFile(idx),
    });
  }
  return rows;
}

function resetChemAutoControllerUploads() {
  getChemSectionIds().forEach((_, idx) => clearChemAutoControllerPhoto(idx));
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

async function prepareChemControllerPhotoForUpload(file) {
  if (!file || !(file.type || '').startsWith('image/')) {
    return { body: file, contentType: file?.type || 'application/octet-stream' };
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Unable to prepare auto controller preview.'));
      img.src = objectUrl;
    });

    const sourceWidth = image.naturalWidth || image.width || 1;
    const sourceHeight = image.naturalHeight || image.height || 1;
    const largestSide = Math.max(sourceWidth, sourceHeight);
    if (file.size <= CHEM_CONTROLLER_COMPRESS_THRESHOLD_BYTES && largestSide <= CHEM_CONTROLLER_IMAGE_MAX_SIDE) {
      return { body: file, contentType: file.type || 'image/jpeg' };
    }

    const scale = Math.min(1, CHEM_CONTROLLER_IMAGE_MAX_SIDE / largestSide);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is unavailable for auto controller compression.');
    ctx.drawImage(image, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, 'image/jpeg', CHEM_CONTROLLER_IMAGE_QUALITY);
    return { body: blob, contentType: 'image/jpeg' };
  } catch (err) {
    console.warn('[ChemLog] Auto controller compression failed; using original file.', err);
    return { body: file, contentType: file.type || 'application/octet-stream' };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function uploadChemControllerPhoto({ submissionId, poolName, poolIdx, file }) {
  const safeName = String(file.name || 'auto-controller.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
  const uploadPayload = await prepareChemControllerPhotoForUpload(file);
  const photoId = `${Date.now()}_${poolIdx}_${safeName}`;
  const photoDoc = doc(db, 'chemSubmissionMedia', submissionId, 'photos', photoId);
  const dataUrl = await readFileAsDataURL(uploadPayload.body);
  const [prefix, encoded = ''] = String(dataUrl || '').split(',');
  if (!encoded) throw new Error(`Unable to encode ${file.name || 'auto controller image'} for upload.`);

  const chunks = [];
  for (let i = 0; i < encoded.length; i += CHEM_CONTROLLER_CHUNK_SIZE) {
    chunks.push(encoded.slice(i, i + CHEM_CONTROLLER_CHUNK_SIZE));
  }

  await setDoc(photoDoc, {
    submissionId,
    poolName,
    poolIdx,
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
      batch.set(doc(db, 'chemSubmissionMedia', submissionId, 'photos', photoId, 'chunks', String(chunkIndex).padStart(4, '0')), {
        index: chunkIndex,
        data: chunk,
      });
    });
    await batch.commit();
  }

  return {
    poolIdx,
    poolName,
    url: `${CHEM_AUTO_CONTROLLER_STORAGE}:${submissionId}:${photoId}`,
    name: file.name || safeName,
    source: CHEM_AUTO_CONTROLLER_STORAGE,
    contentType: uploadPayload.contentType,
    dataUrlPrefix: prefix,
    chunkCount: chunks.length,
    photoId,
    submissionId,
  };
}

async function uploadChemControllerPhotos({ submissionId, poolName, photoRows, onProgress }) {
  const uploaded = {};
  for (let i = 0; i < photoRows.length; i += 1) {
    const row = photoRows[i];
    if (!row.file) continue;
    onProgress?.({
      completed: i,
      total: photoRows.length,
      label: row.label,
      fileName: row.file.name || `Photo ${i + 1}`,
    });
    uploaded[`pool${row.poolIdx + 1}`] = [await uploadChemControllerPhoto({
      submissionId,
      poolName,
      poolIdx: row.poolIdx,
      file: row.file,
    })];
  }
  if (photoRows.length) onProgress?.({ completed: photoRows.length, total: photoRows.length, done: true });
  return uploaded;
}

// ============================================================
// CHEMISTRY FORM — submit to Firestore
// ============================================================

function getLoggedInEmployeeName() {
  const currentRecord = typeof window.getCurrentEmployeeRecord === 'function'
    ? window.getCurrentEmployeeRecord()
    : null;
  if (currentRecord?.firstName || currentRecord?.lastName) {
    return { firstName: currentRecord.firstName || '', lastName: currentRecord.lastName || '' };
  }
  const empId = sessionStorage.getItem('chemlogEmployeeEmail') || sessionStorage.getItem('chemlogEmployeeId');
  if (empId && employeesData.length) {
    const emp = employeesData.find(e =>
      String(e.email || '').toLowerCase() === String(empId).toLowerCase() ||
      String(e.id || '').toLowerCase() === String(empId).toLowerCase()
    );
    if (emp) return { firstName: emp.firstName || '', lastName: emp.lastName || '' };
  }
  const sessionFirstName = sessionStorage.getItem('chemlogEmployeeFirstName') || '';
  const sessionLastName = sessionStorage.getItem('chemlogEmployeeLastName') || '';
  if (sessionFirstName || sessionLastName) {
    return { firstName: sessionFirstName, lastName: sessionLastName };
  }
  // Fallback: supervisor name from localStorage if set
  try {
    const token = localStorage.getItem('loginToken');
    if (token) {
      const parsed = JSON.parse(token);
      if (parsed.firstName || parsed.lastName) {
        return { firstName: parsed.firstName || '', lastName: parsed.lastName || '' };
      }
    }
  } catch (_) { /* ignore */ }
  return { firstName: '', lastName: '' };
}

function getLoggedInSubmissionIdentity() {
  const currentRecord = typeof window.getCurrentEmployeeRecord === 'function'
    ? window.getCurrentEmployeeRecord()
    : null;
  const { firstName, lastName } = getLoggedInEmployeeName();
  const cleanFirstName = String(currentRecord?.firstName || firstName || '').trim();
  const cleanLastName = String(currentRecord?.lastName || lastName || '').trim();
  const fullName = [cleanFirstName, cleanLastName].filter(Boolean).join(' ').trim();
  const sessionEmail = sessionStorage.getItem('chemlogEmployeeEmail') || '';
  const sessionId = sessionStorage.getItem('chemlogEmployeeId') || '';
  const sessionUsername = sessionStorage.getItem('chemlogEmployeeUsername') || '';
  const authEmail = typeof auth !== 'undefined' ? (auth.currentUser?.email || '') : '';
  const email = String(currentRecord?.email || sessionEmail || authEmail || '').trim().toLowerCase();
  const username = String(currentRecord?.username || sessionUsername || '').trim().toLowerCase();
  const employeeId = String(currentRecord?.employeeId || currentRecord?.id || sessionId || email || username || '').trim();

  return {
    firstName: cleanFirstName,
    lastName: cleanLastName,
    submitterName: fullName || 'Unknown',
    respondentName: fullName || 'Unknown',
    submitterEmail: email,
    respondentEmail: email,
    email,
    employeeId,
    username,
    submitterUsername: username,
    respondentUsername: username,
  };
}

function setupChemForm() {
  const submitBtn = document.getElementById('submitBtn');
  if (!submitBtn) return;
  ensureChemAutoControllerUploadSections();

  // Show/hide pool sections when location changes
  const locationSelect = document.getElementById('poolLocation');
  if (locationSelect) {
    locationSelect.addEventListener('change', async () => {
      const pool = poolsCache.find(p => p.id === locationSelect.value);
      const latestPool = pool ? await getFreshPoolDoc(pool.id, pool) : null;
      updateVisiblePoolSections(latestPool ? (latestPool.numPools || 2) : 2);
      updatePoolSectionTitles(latestPool);
      await updateChemAutoControllerSections(latestPool || null);
    });
    const initialPool = poolsCache.find(p => p.id === locationSelect.value);
    updateVisiblePoolSections(initialPool ? (initialPool.numPools || 2) : 2);
    updatePoolSectionTitles(initialPool || null);
    updateChemAutoControllerSections(initialPool || null).catch((err) => {
      console.warn('[ChemLog] Unable to initialize auto-controller upload sections.', err);
    });
  }

  submitBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    const submitter = getLoggedInSubmissionIdentity();
    const { firstName, lastName } = submitter;
    const poolId = document.getElementById('poolLocation')?.value || '';

    if (!poolId) {
      alert('Please select a pool.');
      return;
    }

    const pool = poolsCache.find(p => p.id === poolId);
    let poolName = pool?.name || poolId;
    const submissionRef = doc(collection(db, 'poolSubmissions'));

    const entry = {
      timestamp: Timestamp.now(),
      firstName,
      lastName,
      submitterName: submitter.submitterName,
      respondentName: submitter.respondentName,
      submitterEmail: submitter.submitterEmail,
      respondentEmail: submitter.respondentEmail,
      email: submitter.email,
      employeeId: submitter.employeeId,
      username: submitter.username,
      submitterUsername: submitter.submitterUsername,
      respondentUsername: submitter.respondentUsername,
      poolLocation: poolName,
      mainPoolPH: document.getElementById('mainPoolPH')?.value || '',
      mainPoolCl: document.getElementById('mainPoolCl')?.value || '',
      secondaryPoolPH: document.getElementById('secondaryPoolPH')?.value || '',
      secondaryPoolCl: document.getElementById('secondaryPoolCl')?.value || ''
    };

    // Include optional pool sections if visible
    ['3', '4', '5'].forEach(n => {
      const section = document.getElementById(`pool${n}Section`);
      if (section && !section.classList.contains('hidden')) {
        entry[`pool${n}PH`] = document.getElementById(`pool${n}PH`)?.value || '';
        entry[`pool${n}Cl`] = document.getElementById(`pool${n}Cl`)?.value || '';
      }
    });

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting…';
      const poolDocForSubmission = await getFreshPoolDoc(poolId, pool);
      poolName = getPoolName(poolDocForSubmission) || poolName;
      entry.poolLocation = poolName;
      const recentSubmission = await hasRecentChemSubmissionForFacility(poolName);
      const autoControllerRows = getChemControllerPhotoRows(entry, poolDocForSubmission || pool);
      const missingAutoControllerPhoto = !recentSubmission && autoControllerRows.some((row) => !row.file);
      if (missingAutoControllerPhoto) {
        alert('Please upload each required auto controller image before submitting.');
        return;
      }

      let uploadedControllerPhotos = {};
      const controllerRowsToUpload = autoControllerRows.filter((row) => row.file);
      if (controllerRowsToUpload.length) {
        uploadedControllerPhotos = await uploadChemControllerPhotos({
          submissionId: submissionRef.id,
          poolName,
          photoRows: controllerRowsToUpload,
          onProgress: ({ completed, total, label, fileName, done }) => {
            submitBtn.textContent = done
              ? 'Saving…'
              : `Uploading ${label} (${completed + 1}/${total})`;
          },
        });
      }

      entry.autoControllerPhotos = uploadedControllerPhotos;
      entry.autoControllerPhotoWindowBypassed = recentSubmission;
      await setDoc(submissionRef, entry);

      if (!FEEDBACK_RESPONSES_ENABLED) {
        forceCloseFeedbackModal();
        alert('Chemistry log submitted successfully!');
        resetChemistryFormFields();
        resetChemAutoControllerUploads();
        return;
      }

      await refreshSanitationSelections();
      const poolDoc = poolDocForSubmission || pool;
      const poolRules = poolDoc ? normalizePoolRules(poolDoc) : [];

      // Check concern levels for all submitted pools
      const numPools = poolDoc?.numPools || poolDoc?.poolCount || pool?.numPools || pool?.poolCount || 2;
      let allClear = true;
      for (let i = 0; i < numPools; i++) {
        const fields = poolFieldNames(i);
        const phVal = entry[fields.ph];
        const clVal = entry[fields.cl];
        const method = getSanitationMethodForPool(poolDoc || pool, i);
        const phRule = getRuleForReading(poolRules, i, method, 'ph', phVal);
        const clRule = getRuleForReading(poolRules, i, method, 'cl', clVal);
        if (phVal && getRuleConcernLevel(phRule) !== 'none') { allClear = false; break; }
        if (clVal && getRuleConcernLevel(clRule) !== 'none') { allClear = false; break; }
      }

      // Show feedback modal with rule responses
      const feedbackModal = document.getElementById('feedbackModal');
      const modalContent = document.getElementById('modalContent');
      if (feedbackModal && modalContent) {
        const submitterName = [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';

        // Store submission data on modal for notify function
        feedbackModal.dataset.submitterName = submitterName;
        feedbackModal.dataset.poolName = poolName;
        feedbackModal.dataset.entry = JSON.stringify(entry);

        let html = `
          <div class="feedback-warning-callout">
            DO NOT HANDLE ANY POOL CHEMISTRY BALANCING SKILL UNTIL TAUGHT BY A MANAGER/SUPERVISOR AND GIVEN APPROVAL.
          </div>
          <h3 class="modal-facility-name">${poolName}</h3>
        `;
        let checkboxIdx = 0;
        let majorLines = [];

        for (let i = 0; i < numPools; i++) {
          const fields = poolFieldNames(i);
          const phVal = entry[fields.ph];
          const clVal = entry[fields.cl];
          if (!phVal && !clVal) continue;

          const method = getSanitationMethodForPool(poolDoc || pool, i);
          const methodLabel = getSanitationMethodLabel(method);
          const poolLabel = getFacilityPoolLabel(poolDoc || pool, i);
          const phRule = getRuleForReading(poolRules, i, method, 'ph', phVal);
          const clRule = getRuleForReading(poolRules, i, method, 'cl', clVal);
          const phResponse = getRuleResponse(phRule);
          const clResponse = getRuleResponse(clRule);

          if (phResponse || clResponse) {
            html += `<div class="modal-pool-section">`;
            html += `<h4 class="modal-pool-label">${escapeHtml(poolLabel)} <span class="modal-rule-method">(${escapeHtml(methodLabel)} rules)</span></h4>`;

            if (phResponse) {
              const isMajor = getRuleConcernLevel(phRule) === 'major';
              checkboxIdx++;
              html += `<div class="modal-rule-item${isMajor ? ' modal-rule-major' : ''}">`;
              html += `<label class="checkbox-item">`;
              html += `<input type="checkbox" class="modal-rule-checkbox" id="rule_cb_${checkboxIdx}">`;
              html += `<span><strong>pH ${escapeHtml(phVal)}:</strong> ${phResponse}</span>`;
              html += `</label>`;
              if (isMajor) {
                html += `<button type="button" class="notify-supervisor-btn" onclick="showSupervisorNotify()">Notify Supervisor</button>`;
                majorLines.push(`${poolLabel} (${methodLabel}) pH ${phVal}: ${stripHtml(phResponse)}`);
              }
              html += `</div>`;
            }

            if (clResponse) {
              const isMajor = getRuleConcernLevel(clRule) === 'major';
              checkboxIdx++;
              html += `<div class="modal-rule-item${isMajor ? ' modal-rule-major' : ''}">`;
              html += `<label class="checkbox-item">`;
              html += `<input type="checkbox" class="modal-rule-checkbox" id="rule_cb_${checkboxIdx}">`;
              html += `<span><strong>Cl ${escapeHtml(clVal)}:</strong> ${clResponse}</span>`;
              html += `</label>`;
              if (isMajor) {
                html += `<button type="button" class="notify-supervisor-btn" onclick="showSupervisorNotify()">Notify Supervisor</button>`;
                majorLines.push(`${poolLabel} (${methodLabel}) Cl ${clVal}: ${stripHtml(clResponse)}`);
              }
              html += `</div>`;
            }

            html += `</div>`;
          }
        }

        if (checkboxIdx === 0) {
          html += '<p style="margin-top:10px;">All chemistry values are within normal range.</p>';
        }

        feedbackModal.dataset.majorItems = majorLines.join('\n');
        modalContent.innerHTML = html;
        showSharedModalOverlay();
        feedbackModal.style.display = 'block';
        requestAnimationFrame(() => feedbackModal.classList.add('visible'));
      } else {
        alert('Chemistry log submitted successfully!');
      }

      // Fire confetti if all chemistry values are within acceptable range
      if (allClear && typeof confetti === 'function') {
        confetti({
          particleCount: 120,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#69140e', '#ffffff', '#c8a47e', '#ff6b6b', '#ffd700'],
        });
      }

      // Reset form fields
      resetChemistryFormFields();
      resetChemAutoControllerUploads();
      await updateChemAutoControllerSections(null);

    } catch (err) {
      console.error('[ChemLog] Error submitting chemistry log:', err);
      alert('Error submitting log. Please try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit';
    }
  });
}

// ============================================================
// SUPERVISOR DASHBOARD — market/tab/most-recent structure
// ============================================================

let allLogs = [];
let sanitationSelections = {}; // poolId::poolIdx -> 'bleach' | 'granular' | 'tablet' | 'off'
const PH_RULE_METHODS = ['muriaticAcid', 'noChanges'];
let dashboardPoolFilter = 'all';
let dashboardDateFilter = getTodayDateValue();
let dashboardInspectionDateFilter = getTodayDateValue();
let dashboardChemPage = 1;
let dashboardChemPageByTable = {};
let dashboardJobPage = 1;
let dashboardManagerialPage = 1;
let dashboardCleanlinessShiftFilter = 'opening';
let dashboardOperationalPage = 1;
let dashboardDataLoaded = false;
const DASHBOARD_PAGE_SIZE = 10;
const DASHBOARD_PANEL_IDS = {
  chemistry: 'dashboardContent',
  jobforms: 'jobFormsContent',
  managerial: 'managerialFormsContent',
  operational: 'operationalDashboardContent',
  supplies: 'dashboardSuppliesContent',
  metrics: 'dashboardMetricsContent',
};
const SUPPLY_STATUS_PRIORITY = { Out: 0, 'Critically Low': 1, Low: 2, Moderate: 3, High: 4 };
const SUPPLY_NEED_STATUSES = new Set(['Low', 'Critically Low', 'Out']);
const SUPPLY_SECTIONS = [
  {
    label: 'Pool Chemistry Supplies',
    items: [
      { id: 'r001_reagent', label: 'R-001 reagent (DPD reagent 1)' },
      { id: 'r002_reagent', label: 'R-002 reagent (DPD reagent 2)' },
      { id: 'r004_reagent', label: 'R-004 reagent (pH indicator)' },
    ],
  },
  {
    label: 'First Aid Supplies',
    items: [
      { id: 'bandaids', label: 'Bandaids' },
      { id: 'gauze', label: 'Gauze' },
      { id: 'roller_bandages', label: 'Roller bandages' },
      { id: 'sanitation_wipes', label: 'Sanitation wipes' },
      { id: 'sting_relief', label: 'Sting relief' },
      { id: 'antibiotic_gel', label: 'Antibiotic gel' },
      { id: 'disposable_gloves', label: 'Disposable gloves' },
    ],
  },
  {
    label: 'Cleaning Supplies',
    items: [
      { id: 'toilet_paper', label: 'Toilet paper' },
      { id: 'paper_towels', label: 'Paper towels' },
      { id: 'black_trash_bags', label: 'Black trash bags' },
      { id: 'clear_trash_bags', label: 'Clear trash bags' },
      { id: 'disinfectant_spray', label: 'Disinfectant spray' },
      { id: 'glass_cleaner', label: 'Glass cleaner' },
      { id: 'scrub_pads', label: 'Scrub pads' },
      { id: 'hand_soap', label: 'Hand soap' },
      { id: 'toilet_bowl_cleaner', label: 'Toilet bowl cleaner' },
    ],
  },
];
let supplyNeededEditMode = false;
let supplyResolvedItems = {};
let supplyUndoItem = null;
let dashboardSupplyFilters = { market: 'all', pool: 'all' };
const FILL_LINE_STATUS_OPTIONS = ['Off', 'On full blast', 'On halfway', 'On a trickle'];
const BLEACH_FEEDER_STATUS_OPTIONS = ['Not applicable', 'Off', '0 or L', '1', '1.5', '1.75', '2', '2.25', '2.5', '3', '4', '5', '6', '7', '8', '9', '10'];
const POOL_CLOSURE_OPTIONS = ['Open', 'Weather', 'Contamination', 'Chemical Imbalance', 'System Malfunction', 'Other'];
const WEEKLY_BACKWASH_COMPLETION_OPTIONS = [
  { value: 'No', label: 'Not Completed' },
  { value: 'Yes', label: 'Completed' },
];
const POOL_CLOSURE_TODOS = {
  Weather: ['Close and tie shut all umbrellas, then remove any equipment that may be damaged by the storm.'],
  Contamination: ['Do not make any changes until instructed by a supervisor.'],
  'Chemical Imbalance': ['Do not make any changes until instructed by a supervisor.'],
  'System Malfunction': ['Do not make any changes until instructed by a supervisor.'],
};
let operationalStatusLogs = [];
let operationalStatusLatestMap = {};
let operationalStatusPageReady = false;
let operationalAutosaveTimer = null;
let operationalAutosaveInProgress = false;
let operationalAutosaveQueued = false;
let dashboardMetricsFilters = {
  market: 'all',
  pool: 'all',
  time: 'All Time',
};

async function refreshSanitationSelections() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'sanitation'));
    sanitationSelections = snap.exists() ? (snap.data().pools || {}) : {};
  } catch (err) {
    console.warn('[ChemLog] Unable to refresh sanitation methods; using cached selections.', err);
  }
  return sanitationSelections;
}

async function getFreshPoolDoc(poolId, fallbackPool) {
  if (!poolId) return fallbackPool || null;
  try {
    const snap = await getDoc(doc(db, 'pools', poolId));
    if (!snap.exists()) return fallbackPool || null;
    const freshPool = { id: snap.id, ...snap.data() };
    const idx = poolsCache.findIndex((pool) => pool.id === freshPool.id);
    if (idx >= 0) poolsCache[idx] = freshPool;
    else poolsCache.push(freshPool);
    return freshPool;
  } catch (err) {
    console.warn('[ChemLog] Unable to fetch latest pool rules; using cached pool rules.', err);
    return fallbackPool || null;
  }
}

function getSanitationMethodForPool(poolDoc, poolIdx) {
  if (!poolDoc) return 'bleach';
  const poolId = poolDoc.id || '';
  const primaryName = (poolDoc.name || '').trim();
  return sanitationSelections[`${poolId}::${poolIdx}`] ||
    sanitationSelections[`${primaryName}::${poolIdx}`] ||
    sanitationSelections[poolId] ||
    sanitationSelections[primaryName] ||
    'bleach';
}

function getSanitationMethodLabel(method) {
  return {
    bleach: 'Bleach',
    granular: 'Granular',
    tablet: 'Tablet',
    off: 'No Changes',
  }[method] || 'Bleach';
}

function getPhRuleMethodForSanitation(method) {
  return method === 'off' ? 'noChanges' : 'muriaticAcid';
}

function getFacilityPoolLabel(poolDoc, poolIdx) {
  const rulesPool = poolDoc?.rules?.pools?.[poolIdx];
  const customName = (rulesPool?.poolName || '').trim();
  if (customName) return `Pool ${poolIdx + 1}: ${customName}`;
  if (poolIdx === 0) return 'Pool 1 (Main)';
  return `Pool ${poolIdx + 1}`;
}

function poolRequiresWeeklyBackwashing(poolDoc, poolIdx) {
  const rulesPool = poolDoc?.rules?.pools?.[poolIdx];
  return rulesPool?.requiresWeeklyBackwashing !== false;
}

function formatWeeklyBackwashStatus(status) {
  return status === 'Yes' ? 'Completed' : 'Not Completed';
}

// Map submitted pH select value → rule key used in pool docs
function phToRuleKey(val) {
  return { '< 7.0': 'lt_7_0', '7.0': '7_0', '7.2': '7_2', '7.4': '7_4',
           '7.6': '7_6', '7.8': '7_8', '8.0': '8_0', '> 8.0': 'gt_8_0' }[val] || null;
}

// Map submitted Cl select value → rule key used in pool docs
function clToRuleKey(val) {
  return { '0': '0', '1': '1', '2': '2', '3': '3',
           '5': '5', '7.5': '7_5', '10': '10', '> 10': 'gt_10' }[val] || null;
}

// Return CSS class for a concern level string
// Kept for backward compatibility with any external references
window.filterData = function () { loadDashboardData(); };

function concernClass(level) {
  if (level === 'minor' || level === 'yellow') return 'concern-minor';
  if (level === 'major' || level === 'red') return 'concern-major';
  return '';
}

// Normalize pool rules from either old flat format or new nested format.
// Returns an array where index 0 = pool 1, each entry has one object per sanitation method.
function normalizePoolRules(poolDoc) {
  // New format: poolDoc.rules.pools[i] = { bleach, granular, tablet, off }
  if (poolDoc.rules?.pools && Array.isArray(poolDoc.rules.pools) && poolDoc.rules.pools.length) {
    return poolDoc.rules.pools.map((poolRules = {}) => {
      const methods = ['bleach', 'granular', 'tablet', 'off'];
      const sharedPh = methods.reduce((acc, method) => ({
        ...acc,
        ...(poolRules[method]?.ph || {}),
      }), {});
      const phMethods = Object.fromEntries(
        PH_RULE_METHODS.map((method) => {
          const hasPhMethod = !!poolRules.phMethods?.[method];
          const directPh = poolRules.phMethods?.[method]?.ph || {};
          return [
            method,
            { ph: hasPhMethod ? directPh : sharedPh },
          ];
        })
      );
      const fallbackCl = methods
        .map(method => poolRules[method]?.cl || {})
        .find(cl => Object.keys(cl).length > 0) || {};

      return {
        ...poolRules,
        phMethods,
        bleach: poolRules.bleach || { ph: sharedPh, cl: fallbackCl },
        granular: poolRules.granular || { ph: sharedPh, cl: fallbackCl },
        tablet: poolRules.tablet || { ph: sharedPh, cl: fallbackCl },
        off: poolRules.off || { ph: sharedPh, cl: fallbackCl },
      };
    });
  }
  // Old flat format: pool1_ph_lt_7_0, pool1_ph_lt_7_0_level, pool1_cl_0, pool1_cl_0_level, etc.
  const maxPools = Math.max(2, Number(poolDoc.numPools || poolDoc.poolCount || 2));
  const pools = [];
  for (let i = 1; i <= maxPools; i++) {
    const ph = {}, cl = {};
    Object.keys(poolDoc).forEach(key => {
      const phPfx = `pool${i}_ph_`, clPfx = `pool${i}_cl_`;
      if (key.startsWith(phPfx) && !key.endsWith('_level')) {
        const rk = key.slice(phPfx.length);
        ph[rk] = { response: poolDoc[key], concernLevel: poolDoc[`${key}_level`] || 'none' };
      }
      if (key.startsWith(clPfx) && !key.endsWith('_level')) {
        const rk = key.slice(clPfx.length);
        cl[rk] = { response: poolDoc[key], concernLevel: poolDoc[`${key}_level`] || 'none' };
      }
    });
    pools.push({
      phMethods: {
        muriaticAcid: { ph },
        noChanges: { ph },
      },
      bleach: { ph, cl },
      granular: { ph, cl },
      tablet: { ph, cl },
      off: { ph, cl },
    });
  }
  return pools;
}

function getRuleForReading(poolRules, poolIdx, method, type, submittedValue) {
  if (!submittedValue) return null;
  const key = type === 'ph' ? phToRuleKey(submittedValue) : clToRuleKey(submittedValue);
  if (!key) return null;
  const poolRuleSet = poolRules?.[poolIdx] || {};
  if (type === 'ph' && poolRuleSet.phMethods) {
    const phMethod = getPhRuleMethodForSanitation(method);
    const phMethodRules = poolRuleSet.phMethods?.[phMethod];
    if (phMethodRules) return phMethodRules.ph?.[key] || null;
    return poolRuleSet.phMethods?.muriaticAcid?.ph?.[key] ||
      poolRuleSet[method]?.ph?.[key] ||
      null;
  }
  const selectedRules = poolRuleSet[method] || {};
  return selectedRules?.[type]?.[key] || null;
}

function getRuleResponse(rule) {
  return (rule?.response || '').toString().trim();
}

function getRuleConcernLevel(rule) {
  const raw = (rule?.concernLevel || rule?.concern || rule?.level || 'none').toString().toLowerCase();
  if (raw === 'major' || raw === 'red') return 'major';
  if (raw === 'minor' || raw === 'yellow') return 'minor';
  return 'none';
}

function stripHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = String(html || '');
  return (div.textContent || div.innerText || '').trim();
}

// Look up concern level for a pH value at a given pool facility + pool index (0-based)
function getPhConcernLevel(poolName, poolIdx, phValue) {
  const poolDoc = poolsCache.find(p => (p.name || p.id) === poolName);
  if (!poolDoc) return 'none';
  const method = getSanitationMethodForPool(poolDoc, poolIdx);
  const poolRules = normalizePoolRules(poolDoc);
  return getRuleConcernLevel(getRuleForReading(poolRules, poolIdx, method, 'ph', phValue));
}

// Look up concern level for a Cl value at a given pool facility + pool index (0-based)
function getClConcernLevel(poolName, poolIdx, clValue) {
  const poolDoc = poolsCache.find(p => (p.name || p.id) === poolName);
  if (!poolDoc) return 'none';
  const method = getSanitationMethodForPool(poolDoc, poolIdx);
  const poolRules = normalizePoolRules(poolDoc);
  return getRuleConcernLevel(getRuleForReading(poolRules, poolIdx, method, 'cl', clValue));
}

// Pool submission field names for each pool index (0-based)
function poolFieldNames(idx) {
  if (idx === 0) return { ph: 'mainPoolPH', cl: 'mainPoolCl' };
  if (idx === 1) return { ph: 'secondaryPoolPH', cl: 'secondaryPoolCl' };
  return { ph: `pool${idx + 1}PH`, cl: `pool${idx + 1}Cl` };
}

function getTodayDateValue() {
  return formatDateInputValue(new Date());
}

function formatDateInputValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getOperationalWeekStart(date = new Date()) {
  const weekStart = date instanceof Date ? new Date(date) : new Date(date);
  if (Number.isNaN(weekStart.getTime())) return null;
  weekStart.setHours(0, 0, 0, 0);
  const daysSinceMonday = (weekStart.getDay() + 6) % 7;
  weekStart.setDate(weekStart.getDate() - daysSinceMonday);
  return weekStart;
}

function getOperationalWeekKey(date = new Date()) {
  const weekStart = getOperationalWeekStart(date);
  return weekStart ? formatDateInputValue(weekStart) : '';
}

function toDateObject(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTimestampDisplay(value) {
  const date = toDateObject(value);
  return date ? date.toLocaleString() : '—';
}

function formatElapsedSince(value) {
  const date = toDateObject(value);
  if (!date) return '—';
  const diffMs = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes ? `${hours} hr ${remainingMinutes} min` : `${hours} hr`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days} day ${remainingHours} hr` : `${days} day`;
}

function getLogRespondentName(log) {
  return log ? getSubmissionRespondentName(log) : '—';
}

function getWeeklyBackwashRecordWeekKey(data = {}) {
  const explicitWeek = (data.weeklyBackwashWeek || data.weeklyBackwashWeekKey || '').toString().trim();
  if (explicitWeek) return explicitWeek;
  const recordDate = toDateObject(data.weeklyBackwashTimestamp || data.timestamp || data.updatedAt || data.createdAt);
  return recordDate ? getOperationalWeekKey(recordDate) : '';
}

function normalizeWeeklyBackwashStatus(data = {}) {
  const status = (data.weeklyBackwashStatus || data.backwashStatus || '').toString().trim();
  return status === 'Yes' || status === 'No' ? status : '';
}

function getEffectiveWeeklyBackwashStatus(data = {}, now = new Date()) {
  const status = normalizeWeeklyBackwashStatus(data);
  if (status !== 'Yes') return status;
  return getWeeklyBackwashRecordWeekKey(data) === getOperationalWeekKey(now) ? 'Yes' : 'No';
}

function normalizeOperationalStatusRecord(rawDoc, idOverride = '') {
  const data = rawDoc || {};
  const poolIndex = Number(data.poolIndex ?? data.poolIdx ?? 0);
  const closureReason = (data.closureReason || data.poolClosureReason || '').toString().trim();
  const closureStatus = (data.closureStatus || data.poolClosureStatus || '').toString().trim()
    || (closureReason && closureReason !== 'Open' ? 'Closed' : (closureReason === 'Open' ? 'Open' : ''));
  return {
    id: idOverride || data.id || '',
    facilityId: (data.facilityId || '').toString().trim(),
    facilityName: (data.facilityName || data.poolLocation || '').toString().trim(),
    market: (data.market || '').toString().trim(),
    poolIndex: Number.isFinite(poolIndex) ? poolIndex : 0,
    poolLabel: (data.poolLabel || '').toString().trim(),
    fillStatus: (data.fillStatus || '').toString().trim(),
    bleachStatus: (data.bleachStatus || '').toString().trim(),
    closureStatus,
    closureReason: closureReason || closureStatus,
    weeklyBackwashStatus: normalizeWeeklyBackwashStatus(data),
    weeklyBackwashWeek: getWeeklyBackwashRecordWeekKey(data),
    firstName: (data.firstName || '').toString().trim(),
    lastName: (data.lastName || '').toString().trim(),
    employeeId: (data.employeeId || '').toString().trim(),
    timestamp: data.timestamp || data.updatedAt || data.createdAt || null,
  };
}

function operationalStatusKey(facilityName, poolIdx, type) {
  return `${String(facilityName || '').trim()}::${Number(poolIdx || 0)}::${type}`;
}

function refreshOperationalStatusLatestMap() {
  const next = {};
  operationalStatusLogs.forEach((log) => {
    if (!log.facilityName) return;
    if (log.fillStatus) {
      const key = operationalStatusKey(log.facilityName, log.poolIndex, 'fill');
      if (!next[key]) next[key] = log;
    }
    if (log.bleachStatus) {
      const key = operationalStatusKey(log.facilityName, log.poolIndex, 'bleach');
      if (!next[key]) next[key] = log;
    }
    if (log.closureStatus || log.closureReason) {
      const key = operationalStatusKey(log.facilityName, log.poolIndex, 'closure');
      if (!next[key]) next[key] = log;
    }
    const effectiveBackwashStatus = getEffectiveWeeklyBackwashStatus(log);
    if (effectiveBackwashStatus) {
      const key = operationalStatusKey(log.facilityName, log.poolIndex, 'backwash');
      if (!next[key]) next[key] = { ...log, weeklyBackwashStatus: effectiveBackwashStatus };
    }
  });
  operationalStatusLatestMap = next;
}

async function loadOperationalStatusLogs() {
  try {
    const q = query(collection(db, 'operationalStatusLogs'), orderBy('timestamp', 'desc'));
    const snap = await getDocs(q);
    operationalStatusLogs = snap.docs.map((docSnap) => normalizeOperationalStatusRecord(docSnap.data(), docSnap.id));
    refreshOperationalStatusLatestMap();
  } catch (err) {
    console.error('[PoolPro] Error loading operational status logs:', err);
    operationalStatusLogs = [];
    operationalStatusLatestMap = {};
  }
  return operationalStatusLogs;
}

function getLatestOperationalStatus(facilityName, poolIdx, type) {
  return operationalStatusLatestMap[operationalStatusKey(facilityName, poolIdx, type)] || null;
}

function getOperationalClosureDisplayValue(statusLog) {
  if (!statusLog) return '—';
  return statusLog.closureStatus === 'Closed' ? 'Closed' : 'Open';
}

function getOperationalClosureSummary(statusLog) {
  if (!statusLog) return 'Not recorded';
  if (statusLog.closureStatus === 'Closed') {
    return `Closed${statusLog.closureReason ? ` (${statusLog.closureReason})` : ''}`;
  }
  return 'Open';
}

function getPoolRuleName(poolDoc, poolIdx) {
  return (poolDoc?.rules?.pools?.[poolIdx]?.poolName || '').toString().trim();
}

function getPoolSimpleLabel(poolDoc, poolIdx) {
  return getPoolRuleName(poolDoc, poolIdx) || (poolIdx === 0 ? 'Pool 1 (Main)' : `Pool ${poolIdx + 1}`);
}

function isBabyPool(poolDoc, poolIdx) {
  const label = `${getPoolSimpleLabel(poolDoc, poolIdx)} ${poolIdx === 0 ? 'main' : ''}`.toLowerCase();
  return /\b(baby|wading|kiddie|tot|splash)\b/.test(label);
}

function getElapsedMs(log) {
  const date = toDateObject(log?.timestamp);
  return date ? Math.max(0, Date.now() - date.getTime()) : 0;
}

function getFillLineConcernLevel(poolDoc, poolIdx, statusLog) {
  const status = statusLog?.fillStatus || '';
  const elapsed = getElapsedMs(statusLog);
  const hour = 60 * 60 * 1000;
  const minute = 60 * 1000;
  if (status === 'On full blast') {
    if (isBabyPool(poolDoc, poolIdx)) {
      if (elapsed > 25 * minute) return 'major';
      if (elapsed > 15 * minute) return 'minor';
      return 'none';
    }
    if (elapsed > 2 * hour) return 'major';
    if (elapsed > hour) return 'minor';
  }
  if (status === 'On halfway' && !isBabyPool(poolDoc, poolIdx)) {
    if (elapsed > 3 * hour) return 'major';
    if (elapsed >= 2 * hour) return 'minor';
  }
  return 'none';
}

function bleachStatusToNumber(status) {
  if (status === '0 or L') return 0;
  const num = Number(status);
  return Number.isFinite(num) ? num : null;
}

function getBleachFeederConcernLevel(statusLog) {
  const status = statusLog?.bleachStatus || '';
  if (!status || status === 'Not applicable' || status === 'Off') return 'none';
  const value = bleachStatusToNumber(status);
  if (value === null) return 'none';
  const elapsed = getElapsedMs(statusLog);
  const hour = 60 * 60 * 1000;
  const outOfRange = value > 2 || value < 1.5;
  if (!outOfRange) return 'none';
  if (elapsed > 4 * hour) return 'major';
  if (elapsed > 2 * hour) return 'minor';
  return 'none';
}

function createDashboardValueControl({
  value,
  log,
  includeElapsed = false,
  elapsedPosition = 'end',
  extraRows = [],
} = {}) {
  const wrapper = document.createElement('span');
  wrapper.className = 'dash-value-cell';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dash-value-trigger';
  button.textContent = value || '—';
  wrapper.appendChild(button);

  const popover = document.createElement('div');
  popover.className = 'dash-value-popover';
  const rows = [
    ['Timestamp', formatTimestampDisplay(log?.timestamp)],
    ['Respondent', getLogRespondentName(log)],
  ];
  if (includeElapsed && elapsedPosition === 'second') {
    rows.splice(1, 0, ['Time Elapsed', formatElapsedSince(log?.timestamp)]);
  } else if (includeElapsed) {
    rows.push(['Time Elapsed', formatElapsedSince(log?.timestamp)]);
  }
  if (Array.isArray(extraRows) && extraRows.length) {
    rows.push(...extraRows);
  }
  popover.innerHTML = rows.map(([label, rowValue]) =>
    `<div><strong>${escapeHtml(label)}:</strong> ${escapeHtml(rowValue)}</div>`
  ).join('');
  wrapper.appendChild(popover);
  return wrapper;
}

function fillDashboardValueCell(cell, {
  value,
  log,
  concern = 'none',
  includeElapsed = false,
  elapsedPosition = 'end',
  extraRows = [],
} = {}) {
  if (!cell) return;
  cell.innerHTML = '';
  cell.className = concernClass(concern);
  cell.appendChild(createDashboardValueControl({
    value: value || '—',
    log,
    includeElapsed,
    elapsedPosition,
    extraRows,
  }));
}

function getChemAutoControllerPhotoList(log, poolIdx = null) {
  const groups = log?.autoControllerPhotos;
  if (!groups || typeof groups !== 'object') return [];
  if (poolIdx !== null && poolIdx !== undefined) {
    const key = `pool${Number(poolIdx) + 1}`;
    return Array.isArray(groups[key]) ? groups[key] : [];
  }
  return Object.values(groups).flatMap((items) => Array.isArray(items) ? items : []);
}

function getChemControllerPhotoCacheKey(photo) {
  const url = String(photo?.url || '');
  if (url.startsWith(`${CHEM_AUTO_CONTROLLER_STORAGE}:`)) return url;
  if (photo?.submissionId && photo?.photoId) {
    return `${CHEM_AUTO_CONTROLLER_STORAGE}:${photo.submissionId}:${photo.photoId}`;
  }
  return `${photo?.submissionId || ''}:${photo?.photoId || ''}`;
}

async function getFirestoreChemControllerPhotoDataUrl(photo) {
  const cacheKey = getChemControllerPhotoCacheKey(photo);
  if (chemControllerPhotoDataUrlMap.has(cacheKey)) return chemControllerPhotoDataUrlMap.get(cacheKey);

  let submissionId = String(photo?.submissionId || '');
  let photoId = String(photo?.photoId || '');
  if ((!submissionId || !photoId) && cacheKey.startsWith(`${CHEM_AUTO_CONTROLLER_STORAGE}:`)) {
    const parts = cacheKey.split(':');
    submissionId = submissionId || parts[1] || '';
    photoId = photoId || parts[2] || '';
  }
  if (!submissionId || !photoId) throw new Error('Auto controller photo reference is incomplete.');

  const chunksSnap = await getDocs(collection(db, 'chemSubmissionMedia', submissionId, 'photos', photoId, 'chunks'));
  const chunks = chunksSnap.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
    .sort((a, b) => Number(a.index ?? a.id) - Number(b.index ?? b.id))
    .map((chunk) => chunk.data || '');
  if (!chunks.length) throw new Error('Auto controller photo chunks were not found.');

  const prefix = photo.dataUrlPrefix || `data:${photo.contentType || 'image/jpeg'};base64`;
  const dataUrl = `${prefix},${chunks.join('')}`;
  chemControllerPhotoDataUrlMap.set(cacheKey, dataUrl);
  return dataUrl;
}

function getAutoControllerPoolLabel(log, poolIdx, photo) {
  if (photo?.poolName) return photo.poolName;
  const poolDoc = getDashboardPoolDocByName(log?.poolLocation);
  return poolDoc ? getFacilityPoolLabel(poolDoc, poolIdx) : `Pool ${Number(poolIdx || 0) + 1}`;
}

function showChemAutoControllerPhotos(log, poolIdx = null) {
  const photosByPool = [];
  if (poolIdx !== null && poolIdx !== undefined) {
    const photos = getChemAutoControllerPhotoList(log, poolIdx);
    if (photos.length) photosByPool.push({ poolIdx, photos });
  } else {
    const groups = log?.autoControllerPhotos || {};
    Object.keys(groups).forEach((key) => {
      const idx = Math.max(0, Number(key.replace(/\D+/g, '')) - 1);
      const photos = Array.isArray(groups[key]) ? groups[key] : [];
      if (photos.length) photosByPool.push({ poolIdx: idx, photos });
    });
  }
  if (!photosByPool.length) return;

  let modal = document.getElementById('chemAutoControllerModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'chemAutoControllerModal';
    modal.className = 'chem-controller-modal';
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeChemAutoControllerModal();
    });
    document.body.appendChild(modal);
  }

  const esc = escapeHtml;
  const content = photosByPool.map(({ poolIdx: idx, photos }) => `
    <section class="chem-controller-photo-section">
      <h3>${esc(getAutoControllerPoolLabel(log, idx, photos[0]))}</h3>
      <div class="chem-controller-photo-grid">
        ${photos.map((photo) => `
          <figure class="chem-controller-photo-card">
            <img src="${EMPTY_INLINE_IMAGE}" alt="${esc(photo?.name || 'Auto controller photo')}" data-chem-controller-meta="${encodeURIComponent(JSON.stringify(photo || {}))}">
            <figcaption>${esc(photo?.name || 'Auto controller')}</figcaption>
          </figure>
        `).join('')}
      </div>
    </section>
  `).join('');

  modal.innerHTML = `
    <div class="chem-controller-modal-card">
      <div class="modal-header duty-report-modal-header">
        <h2>Auto Controller Photos</h2>
        <button type="button" class="close" aria-label="Close auto controller photos">&times;</button>
      </div>
      <div class="chem-controller-modal-scroll">${content}</div>
    </div>
  `;
  modal.querySelector('.close')?.addEventListener('click', closeChemAutoControllerModal);
  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('visible'));
  hydrateChemAutoControllerImages(modal).catch((err) => {
    console.error('[ChemLog] Could not load auto controller photos:', err);
  });
}

function closeChemAutoControllerModal() {
  const modal = document.getElementById('chemAutoControllerModal');
  if (!modal) return;
  modal.classList.remove('visible');
  setTimeout(() => {
    if (!modal.classList.contains('visible')) modal.style.display = 'none';
  }, 220);
}

async function hydrateChemAutoControllerImages(root) {
  const images = Array.from(root.querySelectorAll('[data-chem-controller-meta]'));
  await Promise.all(images.map(async (img) => {
    try {
      const meta = JSON.parse(decodeURIComponent(img.dataset.chemControllerMeta || ''));
      const fullUrl = await getFirestoreChemControllerPhotoDataUrl(meta);
      img.src = fullUrl;
      img.dataset.fullUrl = fullUrl;
      img.addEventListener('click', () => window.openPhotoModal(fullUrl, images.map((node) => node.dataset.fullUrl).filter(Boolean)));
    } catch (err) {
      console.error('[ChemLog] Could not hydrate auto controller image:', err);
      img.alt = 'Unable to load auto controller photo';
      img.classList.add('duty-report-photo--error');
    }
  }));
}

function fillFacilityCellWithControllerFlag(cell, facilityName, log, poolIdx = null) {
  if (!cell) return;
  cell.innerHTML = '';
  cell.className = 'dashboard-facility-cell';
  const label = document.createElement('span');
  label.textContent = facilityName || '—';
  cell.appendChild(label);
  const photos = getChemAutoControllerPhotoList(log, poolIdx);
  if (!photos.length) return;

  const flag = document.createElement('button');
  flag.type = 'button';
  flag.className = 'dashboard-cell-flag';
  flag.title = 'View auto controller photos';
  flag.setAttribute('aria-label', 'View auto controller photos');
  flag.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showChemAutoControllerPhotos(log, poolIdx);
  });
  cell.appendChild(flag);
}

function getLatestChemistryLogForPool(logs, facilityName, poolIdx) {
  const fields = poolFieldNames(poolIdx);
  return logs.find((log) => log.poolLocation === facilityName && (log?.[fields.ph] || log?.[fields.cl])) || null;
}

function isDashboardDate(value, dateFilter) {
  const date = toDateObject(value);
  if (!date || !dateFilter) return false;
  return formatDateInputValue(date) === dateFilter;
}

function getSelectedDashboardMarkets() {
  try {
    const saved = JSON.parse(localStorage.getItem('chemlogMarkets') || '[]');
    return saved.length ? saved : null;
  } catch (_) {
    return null;
  }
}

function getDashboardMarketMap({ docs = true } = {}) {
  const marketMap = {};
  poolsCache.forEach((pool) => {
    const markets = Array.isArray(pool.markets) ? pool.markets
      : (pool.market ? [pool.market] : ['Other']);
    const primary = markets[0] || 'Other';
    if (!marketMap[primary]) marketMap[primary] = [];
    marketMap[primary].push(docs ? pool : (pool.name || pool.id));
  });

  Object.values(marketMap).forEach((list) => {
    list.sort((a, b) => {
      const aName = docs ? (a.name || a.id || '') : String(a || '');
      const bName = docs ? (b.name || b.id || '') : String(b || '');
      return aName.localeCompare(bName);
    });
  });

  return marketMap;
}

function getVisibleDashboardMarkets(marketMap) {
  const selectedMarkets = getSelectedDashboardMarkets();
  return selectedMarkets
    ? selectedMarkets.filter((market) => marketMap[market])
    : Object.keys(marketMap).sort();
}

function getPoolName(poolDoc) {
  return (poolDoc?.name || poolDoc?.id || '').toString().trim();
}

function getDashboardPoolOptions() {
  return groupPoolsByMarket(poolsCache).map(({ market, pools }) => ({
    market,
    pools: pools.map((pool) => getPoolName(pool)).filter(Boolean),
  }));
}

function renderDashboardFilterBar(container, onChange, { includeDate = true } = {}) {
  const filterBar = document.createElement('div');
  filterBar.className = 'training-filter-bar dashboard-filter-bar';

  const label = document.createElement('span');
  label.className = 'filter-by-label';
  label.textContent = 'Filter By:';

  const poolField = document.createElement('label');
  poolField.className = 'dashboard-filter-field';
  const poolLabel = document.createElement('span');
  poolLabel.textContent = 'Pool';
  const poolSelect = document.createElement('select');
  poolSelect.className = 'training-filter-select';
  poolSelect.setAttribute('aria-label', 'Filter dashboard by pool');
  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = 'All Pools';
  poolSelect.appendChild(allOption);

  getDashboardPoolOptions().forEach(({ market, pools }) => {
    const group = document.createElement('optgroup');
    group.label = market;
    pools.forEach((poolName) => {
      const option = document.createElement('option');
      option.value = poolName;
      option.textContent = poolName;
      group.appendChild(option);
    });
    poolSelect.appendChild(group);
  });
  poolSelect.value = dashboardPoolFilter;
  if (poolSelect.value !== dashboardPoolFilter) {
    dashboardPoolFilter = 'all';
    poolSelect.value = 'all';
  }

  const dateField = document.createElement('label');
  dateField.className = 'dashboard-filter-field';
  const dateLabel = document.createElement('span');
  dateLabel.textContent = 'Date';
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'training-filter-select dashboard-date-input';
  dateInput.value = dashboardDateFilter || getTodayDateValue();
  dateInput.setAttribute('aria-label', 'Filter dashboard by date');

  poolField.appendChild(poolLabel);
  poolField.appendChild(poolSelect);
  dateField.appendChild(dateLabel);
  dateField.appendChild(dateInput);
  filterBar.appendChild(label);
  filterBar.appendChild(poolField);
  if (includeDate) filterBar.appendChild(dateField);
  container.appendChild(filterBar);

  const handleChange = () => {
    dashboardPoolFilter = poolSelect.value || 'all';
    if (includeDate) dashboardDateFilter = dateInput.value || getTodayDateValue();
    dashboardChemPage = 1;
    dashboardChemPageByTable = {};
    dashboardJobPage = 1;
    dashboardManagerialPage = 1;
    dashboardOperationalPage = 1;
    onChange?.();
  };

  poolSelect.addEventListener('change', handleChange);
  if (includeDate) dateInput.addEventListener('change', handleChange);
}

function renderDashboardPagination(container, { page, totalRows, totalPages: suppliedTotalPages, onPageChange, alwaysRender = false }) {
  const totalPages = suppliedTotalPages || Math.max(1, Math.ceil(totalRows / DASHBOARD_PAGE_SIZE));
  if (!alwaysRender && totalPages <= 1) return;

  const pagination = document.createElement('div');
  pagination.className = 'emp-pagination-row dashboard-pagination';

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'emp-pagination-arrow';
  prev.textContent = '←';
  if (page <= 1) {
    prev.disabled = true;
    prev.style.visibility = 'hidden';
  }

  const pageSelect = document.createElement('select');
  pageSelect.className = 'training-filter-select emp-pagination-select dashboard-page-select';
  for (let i = 1; i <= totalPages; i++) {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = `Page ${i}`;
    pageSelect.appendChild(option);
  }
  pageSelect.value = String(page);

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'emp-pagination-arrow';
  next.textContent = '→';
  if (page >= totalPages) {
    next.disabled = true;
    next.style.visibility = 'hidden';
  }

  prev.addEventListener('click', () => onPageChange(Math.max(1, page - 1)));
  next.addEventListener('click', () => onPageChange(Math.min(totalPages, page + 1)));
  pageSelect.addEventListener('change', () => onPageChange(Number(pageSelect.value) || 1));

  pagination.appendChild(prev);
  pagination.appendChild(pageSelect);
  pagination.appendChild(next);
  container.appendChild(pagination);
}

async function loadDashboardData() {
  const activeTab = !isSupervisor() ? 'chemistry' : getActiveDashboardTab();
  const container = document.getElementById(DASHBOARD_PANEL_IDS[activeTab] || 'dashboardContent');
  if (!container) return;
  if (!canAccessPoolChemistryDashboard()) {
    container.innerHTML = '<p style="padding:16px;color:#c0392b;">You do not have permission to view the Pool Chemistry Dashboard.</p>';
    return;
  }
  applyDashboardAccessMode();
  container.innerHTML = '<p style="padding:16px;color:#666;">Loading…</p>';

  try {
    const fullAccess = isSupervisor();
    const optionalDocs = async (label, promise) => {
      try {
        return await promise;
      } catch (err) {
        console.warn(`[ChemLog] Unable to load optional dashboard data: ${label}`, err);
        return null;
      }
    };
    const optionalDoc = optionalDocs;
    const [sanSnap, chemSnap, dutySnap, managerialSnap, desSnap, inventorySnap, resolvedSupplySnap, trainingScheduleSnap] = await Promise.all([
      getDoc(doc(db, 'settings', 'sanitation')),
      getDocs(query(collection(db, 'poolSubmissions'), orderBy('timestamp', 'desc'))),
      fullAccess ? optionalDocs('cleanliness reports', getDocs(query(collection(db, 'dutySubmissions'), orderBy('timestamp', 'desc')))) : Promise.resolve(null),
      fullAccess ? optionalDocs('managerial reports', getDocs(query(collection(db, 'managerialReports'), orderBy('timestamp', 'desc')))) : Promise.resolve(null),
      fullAccess ? optionalDocs('DES pre-inspections', getDocs(query(collection(db, 'desPreInspections'), orderBy('timestamp', 'desc')))) : Promise.resolve(null),
      fullAccess ? optionalDocs('inventory reports', getDocs(query(collection(db, 'inventorySubmissions'), orderBy('timestamp', 'desc')))) : Promise.resolve(null),
      fullAccess ? optionalDoc('resolved supply needs', getDoc(doc(db, 'settings', 'resolvedSupplyNeeds'))) : Promise.resolve(null),
      fullAccess ? optionalDoc('training schedule', getDoc(doc(db, 'settings', 'trainingSchedule'))) : Promise.resolve(null),
    ]);
    sanitationSelections = sanSnap.exists() ? (sanSnap.data().pools || {}) : {};
    allLogs = chemSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    allDutyReports = dutySnap ? dutySnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) : [];
    allManagerialReports = managerialSnap ? managerialSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) : [];
    allDesPreInspections = desSnap ? desSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) : [];
    allInventoryReports = inventorySnap ? inventorySnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) : [];
    if (trainingScheduleSnap?.exists?.()) {
      trainingSchedule.sessions = Array.isArray(trainingScheduleSnap.data().sessions) ? trainingScheduleSnap.data().sessions : [];
      window.trainingSchedule = trainingSchedule;
    }
    supplyResolvedItems = resolvedSupplySnap?.exists?.() ? (resolvedSupplySnap.data().items || {}) : {};
    await loadOperationalStatusLogs();
    dashboardDataLoaded = true;
    await renderActiveDashboardTab();
  } catch (err) {
    console.error('[ChemLog] Error loading dashboard data:', err);
    dashboardDataLoaded = false;
    if (container) container.innerHTML = '<p style="color:red;padding:16px;">Error loading data. Check console.</p>';
  }
}

function fillDashboardRespondentCell(cell, log) {
  cell.innerHTML = '';
  const fullName = getSubmissionRespondentName(log);
  const empId = getSubmissionIdentityKeys(log)[0] || '';
  const empRecord = findEmployeeForSubmission(log);
  const rawPhone = empRecord?.phone || '';
  const homePool = empRecord?.homePool || '—';
  const phoneDigits = getTenDigitPhone(rawPhone);
  const displayPhone = phoneDigits ? formatPhoneDisplay(phoneDigits) : '—';
  const phoneHref = phoneDigits ? `+1${phoneDigits}` : '';

  const nameWrapper = document.createElement('span');
  nameWrapper.className = 'dash-respondent-cell';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'dash-respondent-name';
  nameSpan.textContent = fullName;

  const tooltip = document.createElement('div');
  tooltip.className = 'dash-respondent-tooltip';
  const tooltipName = document.createElement('strong');
  tooltipName.textContent = fullName;
  const idLine = document.createElement('div');
  idLine.textContent = `ID: ${empId || '—'}`;
  const homePoolLine = document.createElement('div');
  homePoolLine.textContent = `Home Pool: ${homePool}`;
  const phoneLine = document.createElement('div');
  phoneLine.className = 'dash-phone-line';
  phoneLine.textContent = `Phone: ${displayPhone}`;

  tooltip.appendChild(tooltipName);
  tooltip.appendChild(idLine);
  tooltip.appendChild(homePoolLine);
  tooltip.appendChild(phoneLine);

  if (phoneHref) {
    const actions = document.createElement('div');
    actions.className = 'dash-phone-actions';

    const textLink = document.createElement('a');
    textLink.href = `sms:${phoneHref}`;
    textLink.textContent = 'Text';
    textLink.addEventListener('click', (event) => event.stopPropagation());

    const callLink = document.createElement('a');
    callLink.href = `tel:${phoneHref}`;
    callLink.textContent = 'Call';
    callLink.addEventListener('click', (event) => event.stopPropagation());

    actions.appendChild(textLink);
    actions.appendChild(callLink);
    tooltip.appendChild(actions);
  }

  nameWrapper.appendChild(nameSpan);
  nameWrapper.appendChild(tooltip);
  cell.appendChild(nameWrapper);
}

function getChemistryDetailRows(logs, facilityName, poolDoc) {
  const poolCount = Number(poolDoc?.numPools || poolDoc?.poolCount || 1);
  const rows = [];
  logs
    .filter((log) => log.poolLocation === facilityName && isDashboardDate(log.timestamp, dashboardDateFilter))
    .forEach((log) => {
      for (let i = 0; i < poolCount; i++) {
        const fields = poolFieldNames(i);
        const phVal = log?.[fields.ph] || '';
        const clVal = log?.[fields.cl] || '';
        if (!phVal && !clVal) continue;
        rows.push({ log, poolIdx: i, phVal, clVal });
      }
    });
  return rows;
}

function getChemistryLogsForPoolOnDate(logs, facilityName, poolIdx) {
  const fields = poolFieldNames(poolIdx);
  return logs
    .filter((log) => log.poolLocation === facilityName && isDashboardDate(log.timestamp, dashboardDateFilter))
    .filter((log) => log?.[fields.ph] || log?.[fields.cl]);
}

function getDashboardChemTablePageKey(market, poolIdx) {
  return `${market}::pool${poolIdx + 1}`;
}

function getDashboardChemTablePage(market, poolIdx, totalPages) {
  const key = getDashboardChemTablePageKey(market, poolIdx);
  const page = Math.min(Math.max(1, Number(dashboardChemPageByTable[key]) || 1), totalPages);
  dashboardChemPageByTable[key] = page;
  return page;
}

function renderChemistryPoolDetail(container, logs, poolDoc) {
  const facilityName = getPoolName(poolDoc);
  const rows = getChemistryDetailRows(logs, facilityName, poolDoc);
  const totalPages = Math.max(1, Math.ceil(rows.length / DASHBOARD_PAGE_SIZE));
  dashboardChemPage = Math.min(Math.max(1, dashboardChemPage), totalPages);
  const pageRows = rows.slice((dashboardChemPage - 1) * DASHBOARD_PAGE_SIZE, dashboardChemPage * DASHBOARD_PAGE_SIZE);

  const section = document.createElement('div');
  section.className = 'dashboard-market-section dashboard-single-pool-section';

  const heading = document.createElement('h2');
  heading.className = 'dashboard-market-heading';
  heading.textContent = facilityName || 'Selected Pool';
  section.appendChild(heading);

  const table = document.createElement('table');
  table.className = 'data-table dashboard-pool-table dashboard-detail-table';
  table.innerHTML = `
    <thead><tr>
      <th>Facility Name</th>
      <th>Pool</th>
      <th>pH</th>
      <th>Cl</th>
      <th>Fill Line/Hose</th>
      <th>Bleach Feeder Rate</th>
      <th>Facility Open/Closed</th>
    </tr></thead>
  `;
  const tbody = document.createElement('tbody');

  if (!pageRows.length) {
    tbody.innerHTML = '<tr><td colspan="7">No pool chemistry submissions match the selected filters.</td></tr>';
  } else {
    pageRows.forEach(({ log, poolIdx, phVal, clVal }) => {
      const phConcern = phVal ? getPhConcernLevel(facilityName, poolIdx, phVal) : 'none';
      const clConcern = clVal ? getClConcernLevel(facilityName, poolIdx, clVal) : 'none';
      const fillLog = getLatestOperationalStatus(facilityName, poolIdx, 'fill');
      const bleachLog = getLatestOperationalStatus(facilityName, poolIdx, 'bleach');
      const closureLog = getLatestOperationalStatus(facilityName, poolIdx, 'closure');
      const fillConcern = getFillLineConcernLevel(poolDoc, poolIdx, fillLog);
      const bleachConcern = getBleachFeederConcernLevel(bleachLog);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(facilityName)}</td>
        <td>Pool ${poolIdx + 1}</td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
      `;
      const cells = tr.querySelectorAll('td');
      fillFacilityCellWithControllerFlag(cells[0], facilityName, log, poolIdx);
      fillDashboardValueCell(cells[2], { value: phVal || '—', log, concern: phConcern });
      fillDashboardValueCell(cells[3], { value: clVal || '—', log, concern: clConcern });
      fillDashboardValueCell(cells[4], {
        value: fillLog?.fillStatus || '—',
        log: fillLog,
        concern: fillConcern,
        includeElapsed: true,
        elapsedPosition: 'second',
      });
      fillDashboardValueCell(cells[5], {
        value: bleachLog?.bleachStatus || '—',
        log: bleachLog,
        concern: bleachConcern,
        includeElapsed: true,
      });
      fillDashboardValueCell(cells[6], {
        value: getOperationalClosureDisplayValue(closureLog),
        log: closureLog,
        concern: closureLog?.closureStatus === 'Closed' ? 'major' : 'none',
        extraRows: [['Type', closureLog?.closureReason || '—']],
      });
      tbody.appendChild(tr);
    });
  }

  table.appendChild(tbody);
  section.appendChild(table);
  renderDashboardPagination(section, {
    page: dashboardChemPage,
    totalRows: rows.length,
    alwaysRender: true,
    onPageChange: (nextPage) => {
      dashboardChemPage = nextPage;
      renderDashboard(logs);
    },
  });
  container.appendChild(section);
}

function renderDashboard(logs) {
  const container = document.getElementById('dashboardContent');
  if (!container) return;
  container.innerHTML = '';

  renderDashboardFilterBar(container, () => renderDashboard(logs));

  const marketMap = getDashboardMarketMap({ docs: true });
  const marketsToShow = getVisibleDashboardMarkets(marketMap);

  if (!marketsToShow.length) {
    container.insertAdjacentHTML('beforeend', '<p style="padding:16px;color:#666;">No markets selected. Enable markets in Settings.</p>');
    return;
  }

  if (dashboardPoolFilter !== 'all') {
    const selectedPool = poolsCache.find((pool) => getPoolName(pool) === dashboardPoolFilter);
    if (selectedPool) {
      renderChemistryPoolDetail(container, logs, selectedPool);
      wrapResponsiveTables(container);
    } else {
      container.insertAdjacentHTML('beforeend', '<p style="padding:16px;color:#666;">Selected pool was not found.</p>');
    }
    return;
  }

  marketsToShow.forEach(market => {
    const marketPools = marketMap[market] || [];
    if (!marketPools.length) return;

    // Max pools across all facilities in this market
    const maxPools = Math.max(...marketPools.map(p => p.numPools || p.poolCount || 2));

    // Create market section
    const section = document.createElement('div');
    section.className = 'dashboard-market-section';

    const heading = document.createElement('h2');
    heading.className = 'dashboard-market-heading';
    heading.textContent = market;
    section.appendChild(heading);

    // Tab bar
    const tabBar = document.createElement('div');
    tabBar.className = 'dashboard-tab-bar';
    const tabPanels = [];

    for (let i = 0; i < maxPools; i++) {
      const tabBtn = document.createElement('button');
      tabBtn.className = 'dashboard-tab-btn' + (i === 0 ? ' active' : '');
      tabBtn.textContent = `Pool ${i + 1}`;
      tabBtn.dataset.tabIdx = String(i);
      tabBar.appendChild(tabBtn);

      // Tab panel
      const panel = document.createElement('div');
      panel.className = 'dashboard-tab-panel' + (i === 0 ? ' active' : '');
      panel.dataset.tabIdx = String(i);

      const table = document.createElement('table');
      table.className = 'data-table dashboard-pool-table';
      table.innerHTML = `
        <thead><tr>
          <th>Facility Name</th>
          <th>pH</th>
          <th>Cl</th>
          <th>Fill Line/Hose</th>
          <th>Bleach Feeder Rate</th>
          <th>Facility Open/Closed</th>
        </tr></thead>
      `;
      const tbody = document.createElement('tbody');

      // Sort facilities alphabetically, then render one same-day submission per facility on each page.
      const sortedPools = [...marketPools].sort((a, b) =>
        (a.name || '').localeCompare(b.name || ''));
      const eligiblePools = sortedPools
        .filter((poolDoc) => (poolDoc.numPools || poolDoc.poolCount || 1) > i)
        .map((poolDoc) => {
          const facilityName = poolDoc.name || poolDoc.id;
          return {
            poolDoc,
            facilityName,
            sameDayLogs: getChemistryLogsForPoolOnDate(logs, facilityName, i),
          };
        });
      const totalPages = Math.max(1, ...eligiblePools.map(({ sameDayLogs }) => sameDayLogs.length || 1));
      const currentPage = getDashboardChemTablePage(market, i, totalPages);
      const pageIndex = currentPage - 1;
      let renderedRows = 0;

      eligiblePools.forEach(({ poolDoc, facilityName, sameDayLogs }) => {
        const log = sameDayLogs[pageIndex] || null;
        if (currentPage > 1 && !log) return;
        const fields = poolFieldNames(i);
        const phVal = log?.[fields.ph] || '';
        const clVal = log?.[fields.cl] || '';
        const fillLog = getLatestOperationalStatus(facilityName, i, 'fill');
        const bleachLog = getLatestOperationalStatus(facilityName, i, 'bleach');
        const closureLog = getLatestOperationalStatus(facilityName, i, 'closure');

        const phConcern = phVal ? getPhConcernLevel(facilityName, i, phVal) : 'none';
        const clConcern = clVal ? getClConcernLevel(facilityName, i, clVal) : 'none';
        const fillConcern = getFillLineConcernLevel(poolDoc, i, fillLog);
        const bleachConcern = getBleachFeederConcernLevel(bleachLog);

        // Item 9: Consecutive major concern — check 2 most recent logs for this facility
        const facilityLogs = allLogs.filter(l => l.poolLocation === facilityName && (l?.[fields.ph] || l?.[fields.cl]));
        const recent2 = facilityLogs.slice(0, 2);
        const hasConsecutiveMajor = recent2.length >= 2 && ['ph', 'cl'].some(type => {
          const field = fields[type];
          return recent2.every(l => {
            const val = l[field] || '';
            if (!val) return false;
            const level = type === 'ph'
              ? getPhConcernLevel(facilityName, i, val)
              : getClConcernLevel(facilityName, i, val);
            return level === 'major';
          });
        });

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(facilityName)}</td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
        `;

        if (hasConsecutiveMajor) {
          tr.style.outline = '4px solid #8b0000';
        }

        const cells = tr.querySelectorAll('td');
        fillFacilityCellWithControllerFlag(cells[0], facilityName, log, i);
        fillDashboardValueCell(cells[1], { value: phVal || '—', log, concern: phConcern });
        fillDashboardValueCell(cells[2], { value: clVal || '—', log, concern: clConcern });
        fillDashboardValueCell(cells[3], {
          value: fillLog?.fillStatus || '—',
          log: fillLog,
          concern: fillConcern,
          includeElapsed: true,
          elapsedPosition: 'second',
        });
        fillDashboardValueCell(cells[4], {
          value: bleachLog?.bleachStatus || '—',
          log: bleachLog,
          concern: bleachConcern,
          includeElapsed: true,
        });
        fillDashboardValueCell(cells[5], {
          value: getOperationalClosureDisplayValue(closureLog),
          log: closureLog,
          concern: closureLog?.closureStatus === 'Closed' ? 'major' : 'none',
          extraRows: [['Type', closureLog?.closureReason || '—']],
        });

        tbody.appendChild(tr);
        renderedRows += 1;
      });

      if (!renderedRows) {
        tbody.innerHTML = '<tr><td colspan="6">No previous same-day submissions for this page.</td></tr>';
      }

      table.appendChild(tbody);
      panel.appendChild(table);
      renderDashboardPagination(panel, {
        page: currentPage,
        totalPages,
        alwaysRender: true,
        onPageChange: (nextPage) => {
          dashboardChemPageByTable[getDashboardChemTablePageKey(market, i)] = nextPage;
          renderDashboard(logs);
        },
      });
      tabPanels.push(panel);
    }

    // Tab switching logic
    tabBar.addEventListener('click', e => {
      const btn = e.target.closest('.dashboard-tab-btn');
      if (!btn) return;
      const idx = btn.dataset.tabIdx;
      tabBar.querySelectorAll('.dashboard-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      tabPanels.forEach(p => p.classList.toggle('active', p.dataset.tabIdx === idx));
    });

    section.appendChild(tabBar);
    tabPanels.forEach(p => section.appendChild(p));
    container.appendChild(section);
  });

  wrapResponsiveTables(container);
}

// ============================================================
// OPERATIONAL STATUS LOG
// ============================================================

function buildOperationalOptionGroup({ name, options, selected, variant = '', onChange = null, disabled = false }) {
  const group = document.createElement('div');
  group.className = `operational-switch-group${variant ? ` operational-switch-group--${variant}` : ''}`;
  if (disabled) group.classList.add('operational-switch-group--disabled');
  options.forEach((optionConfig) => {
    const option = typeof optionConfig === 'object' && optionConfig !== null
      ? String(optionConfig.value || '')
      : String(optionConfig || '');
    const labelText = typeof optionConfig === 'object' && optionConfig !== null
      ? String(optionConfig.label || option)
      : option;
    const label = document.createElement('label');
    label.className = 'operational-switch-option';
    if (variant === 'closure' && option === 'Open') {
      label.classList.add('operational-switch-option--open');
    }
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = option;
    input.checked = option === selected;
    input.disabled = disabled;
    input.id = `${name}_${option.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
    if (typeof onChange === 'function') {
      input.addEventListener('change', () => {
        if (input.checked) onChange(option);
      });
    }
    const text = document.createElement('span');
    text.textContent = labelText;
    label.appendChild(input);
    label.appendChild(text);
    group.appendChild(label);
  });
  return group;
}

function setOperationalMessage(message, isError = false) {
  const el = document.getElementById('operationalStatusMessage');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('error', !!message && isError);
  el.classList.toggle('success', !!message && !isError);
}

function closeOperationalClosureModal() {
  const modal = document.getElementById('operationalClosureModal');
  const overlay = document.getElementById('operationalClosureOverlay');
  if (modal) {
    modal.classList.remove('visible');
    modal.setAttribute('aria-hidden', 'true');
    modal.style.display = 'none';
  }
  if (overlay) {
    overlay.classList.remove('visible');
    overlay.style.display = 'none';
  }
}

function openOperationalClosureModal(poolLabel, closureReason) {
  const modal = document.getElementById('operationalClosureModal');
  const overlay = document.getElementById('operationalClosureOverlay');
  const title = document.getElementById('operationalClosureTitle');
  const poolEl = document.getElementById('operationalClosurePool');
  const checklist = document.getElementById('operationalClosureChecklist');
  if (!modal || !overlay || !title || !poolEl || !checklist) return;

  title.textContent = closureReason === 'Open' ? 'Pool Status Updated' : 'Pool Closure Reminder';
  poolEl.textContent = poolLabel || 'Selected pool';
  checklist.innerHTML = '';

  const items = POOL_CLOSURE_TODOS[closureReason] || [];
  items.forEach((item, index) => {
    const row = document.createElement('label');
    row.className = 'checkbox-item';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `operational_closure_check_${index}`;
    checkbox.name = `operational_closure_check_${index}`;
    const text = document.createElement('span');
    text.textContent = item;
    row.appendChild(checkbox);
    row.appendChild(text);
    checklist.appendChild(row);
  });

  overlay.style.display = 'block';
  modal.style.display = 'block';
  requestAnimationFrame(() => {
    overlay.classList.add('visible');
    modal.classList.add('visible');
    modal.setAttribute('aria-hidden', 'false');
  });
}

function getOperationalSelectedFacility() {
  const select = document.getElementById('operationalPoolLocation');
  const poolId = select?.value || '';
  return poolsCache.find((pool) => pool.id === poolId) || null;
}

function canEditWeeklyBackwashCompletion() {
  return isSupervisor() ||
    getRoleKeyForAccessMode(getRequestedAccessMode()) === 'poolManager' ||
    hasRoleMembershipForKeys(getCurrentIdentityKeys(), 'poolManager');
}

function renderOperationalStatusLog() {
  const cards = document.getElementById('operationalStatusCards');
  const panel = document.getElementById('operationalStatusPanel');
  if (!cards) return;

  const poolDoc = getOperationalSelectedFacility();
  cards.innerHTML = '';
  setOperationalMessage('');

  if (!poolDoc) {
    if (panel) panel.hidden = true;
    cards.innerHTML = '<p class="operational-empty-state">Select a facility to update fill line, hose, and bleach feeder statuses.</p>';
    return;
  }

  if (panel) panel.hidden = false;
  const facilityName = getPoolName(poolDoc);
  const poolCount = Math.max(1, Number(poolDoc.numPools || poolDoc.poolCount || 1));
  const canEditBackwash = canEditWeeklyBackwashCompletion();

  for (let idx = 0; idx < poolCount; idx++) {
    const fillLog = getLatestOperationalStatus(facilityName, idx, 'fill');
    const bleachLog = getLatestOperationalStatus(facilityName, idx, 'bleach');
    const closureLog = getLatestOperationalStatus(facilityName, idx, 'closure');
    const backwashLog = getLatestOperationalStatus(facilityName, idx, 'backwash');
    const backwashStatus = backwashLog?.weeklyBackwashStatus || 'No';
    const requiresBackwash = poolRequiresWeeklyBackwashing(poolDoc, idx);
    const poolLabel = getPoolSimpleLabel(poolDoc, idx);

    const card = document.createElement('section');
    card.className = 'operational-status-card';
    card.dataset.poolIndex = String(idx);

    const heading = document.createElement('h3');
    heading.textContent = poolLabel;
    card.appendChild(heading);

    const fillBlock = document.createElement('div');
    fillBlock.className = 'operational-control-block';
    fillBlock.innerHTML = `
      <div class="operational-control-heading">
        <span>Fill Line / Hose</span>
        <small>Current: ${escapeHtml(fillLog?.fillStatus || 'Not recorded')}</small>
      </div>
    `;
    fillBlock.appendChild(buildOperationalOptionGroup({
      name: `operational_fill_${idx}`,
      options: FILL_LINE_STATUS_OPTIONS,
      selected: fillLog?.fillStatus || 'Off',
    }));

    const bleachBlock = document.createElement('div');
    bleachBlock.className = 'operational-control-block';
    bleachBlock.innerHTML = `
      <div class="operational-control-heading">
        <span>Bleach Feeder Rate</span>
        <small>Current: ${escapeHtml(bleachLog?.bleachStatus || 'Not recorded')}</small>
      </div>
    `;
    bleachBlock.appendChild(buildOperationalOptionGroup({
      name: `operational_bleach_${idx}`,
      options: BLEACH_FEEDER_STATUS_OPTIONS,
      selected: bleachLog?.bleachStatus || 'Not applicable',
    }));

    let backwashBlock = null;
    if (requiresBackwash) {
      backwashBlock = document.createElement('div');
      backwashBlock.className = 'operational-control-block';
      backwashBlock.innerHTML = `
        <div class="operational-control-heading">
          <span>Weekly Backwash Completion</span>
          <small>Current: ${escapeHtml(formatWeeklyBackwashStatus(backwashStatus))}</small>
        </div>
      `;
      backwashBlock.appendChild(buildOperationalOptionGroup({
        name: `operational_backwash_${idx}`,
        options: WEEKLY_BACKWASH_COMPLETION_OPTIONS,
        selected: backwashStatus,
        variant: 'backwash',
        disabled: !canEditBackwash,
      }));
      if (!canEditBackwash) {
        backwashBlock.insertAdjacentHTML('beforeend', '<p class="operational-control-note">Managers and supervisors only.</p>');
      }
    }

    const closureBlock = document.createElement('div');
    closureBlock.className = 'operational-control-block';
    closureBlock.innerHTML = `
      <div class="operational-control-heading">
        <span>Facility Open / Closed</span>
        <small>Current: ${escapeHtml(getOperationalClosureSummary(closureLog))}</small>
      </div>
    `;
    closureBlock.appendChild(buildOperationalOptionGroup({
      name: `operational_closure_${idx}`,
      options: POOL_CLOSURE_OPTIONS,
      selected: closureLog?.closureReason || 'Open',
      variant: 'closure',
      onChange: (selectedOption) => {
        if (selectedOption !== 'Open') {
          openOperationalClosureModal(poolLabel, selectedOption);
        }
      },
    }));

    card.appendChild(fillBlock);
    card.appendChild(bleachBlock);
    if (backwashBlock) card.appendChild(backwashBlock);
    card.appendChild(closureBlock);
    cards.appendChild(card);
  }

  bindOperationalAutosaveInputs();
}

function bindOperationalAutosaveInputs() {
  const cards = document.getElementById('operationalStatusCards');
  if (!cards) return;
  cards.querySelectorAll('input[type="radio"]').forEach((input) => {
    if (input.dataset.operationalAutosaveBound === 'true') return;
    input.dataset.operationalAutosaveBound = 'true';
    input.addEventListener('change', scheduleOperationalStatusAutosave);
  });
}

function scheduleOperationalStatusAutosave() {
  window.clearTimeout(operationalAutosaveTimer);
  operationalAutosaveTimer = window.setTimeout(() => {
    saveOperationalStatusLog();
  }, 250);
}

async function saveOperationalStatusLog() {
  if (operationalAutosaveInProgress) {
    operationalAutosaveQueued = true;
    return;
  }

  const poolDoc = getOperationalSelectedFacility();
  if (!poolDoc) {
    setOperationalMessage('Select a facility before saving operational status.', true);
    return;
  }

  const facilityName = getPoolName(poolDoc);
  const poolCount = Math.max(1, Number(poolDoc.numPools || poolDoc.poolCount || 1));
  const market = Array.isArray(poolDoc.markets) ? (poolDoc.markets[0] || '') : (poolDoc.market || '');
  const submitter = getLoggedInSubmissionIdentity();
  const { firstName, lastName } = submitter;
  const writes = [];

  try {
    operationalAutosaveInProgress = true;
    setOperationalMessage('Saving changes...');

    for (let idx = 0; idx < poolCount; idx++) {
      const fillStatus = document.querySelector(`input[name="operational_fill_${idx}"]:checked`)?.value || '';
      const bleachStatus = document.querySelector(`input[name="operational_bleach_${idx}"]:checked`)?.value || '';
      const requiresBackwash = poolRequiresWeeklyBackwashing(poolDoc, idx);
      const weeklyBackwashStatus = requiresBackwash
        ? document.querySelector(`input[name="operational_backwash_${idx}"]:checked`)?.value || 'No'
        : '';
      const closureReason = document.querySelector(`input[name="operational_closure_${idx}"]:checked`)?.value || 'Open';
      const latestFill = getLatestOperationalStatus(facilityName, idx, 'fill');
      const latestBleach = getLatestOperationalStatus(facilityName, idx, 'bleach');
      const latestBackwash = getLatestOperationalStatus(facilityName, idx, 'backwash');
      const latestClosure = getLatestOperationalStatus(facilityName, idx, 'closure');
      const fillChanged = fillStatus && fillStatus !== (latestFill?.fillStatus || '');
      const bleachChanged = bleachStatus && bleachStatus !== (latestBleach?.bleachStatus || '');
      const backwashChanged = requiresBackwash && canEditWeeklyBackwashCompletion() && weeklyBackwashStatus !== (latestBackwash?.weeklyBackwashStatus || 'No');
      const closureChanged = closureReason !== (latestClosure?.closureReason || '');
      if (!fillChanged && !bleachChanged && !backwashChanged && !closureChanged) continue;

      const payload = {
        timestamp: Timestamp.now(),
        facilityId: poolDoc.id || '',
        facilityName,
        market,
        poolIndex: idx,
        poolLabel: getPoolSimpleLabel(poolDoc, idx),
        firstName,
        lastName,
        submitterName: submitter.submitterName,
        respondentName: submitter.respondentName,
        submitterEmail: submitter.submitterEmail,
        respondentEmail: submitter.respondentEmail,
        email: submitter.email,
        employeeId: submitter.employeeId,
        username: submitter.username,
        submitterUsername: submitter.submitterUsername,
        respondentUsername: submitter.respondentUsername,
      };
      if (fillChanged) payload.fillStatus = fillStatus;
      if (bleachChanged) payload.bleachStatus = bleachStatus;
      if (backwashChanged) {
        payload.weeklyBackwashStatus = weeklyBackwashStatus;
        payload.weeklyBackwashWeek = getOperationalWeekKey();
      }
      if (closureChanged) {
        payload.closureReason = closureReason;
        payload.closureStatus = closureReason === 'Open' ? 'Open' : 'Closed';
      }
      writes.push(addDoc(collection(db, 'operationalStatusLogs'), payload));
    }

    if (!writes.length) {
      setOperationalMessage('All changes saved.');
      return;
    }

    await Promise.all(writes);
    await loadOperationalStatusLogs();
    renderOperationalStatusLog();
    if (allLogs.length && document.getElementById('supervisorDashboard')?.classList.contains('show')) {
      renderDashboard(allLogs);
    }
    setOperationalMessage('Changes saved.');
  } catch (err) {
    console.error('[PoolPro] Unable to save operational status:', err);
    setOperationalMessage('Unable to save operational status right now.', true);
  } finally {
    operationalAutosaveInProgress = false;
    if (operationalAutosaveQueued) {
      operationalAutosaveQueued = false;
      scheduleOperationalStatusAutosave();
    }
  }
}

function setupOperationalStatusLog() {
  const select = document.getElementById('operationalPoolLocation');
  if (!select || operationalStatusPageReady) return;
  operationalStatusPageReady = true;
  document.getElementById('operationalClosureCloseBtn')?.addEventListener('click', closeOperationalClosureModal);
  document.getElementById('operationalClosureConfirmBtn')?.addEventListener('click', closeOperationalClosureModal);
  document.getElementById('operationalClosureOverlay')?.addEventListener('click', closeOperationalClosureModal);
  select.addEventListener('change', renderOperationalStatusLog);
  loadOperationalStatusLogs().then(renderOperationalStatusLog);
}

// ============================================================
// EMPLOYEE MANAGEMENT
// ============================================================

let employeesData = [];
let lifeguardAccountsData = [];
let lifeguardAccountsLoaded = false;
let editingEmployeeIdx = -1;
let employeeMarketFilter = 'all';
let employeePoolFilter = 'all';
let employeeSearchTerm = '';
let employeePage = 1;
let employeeTableEditable = false;
let employeeUndoState = null;
const EMPLOYEES_PER_PAGE = 10;
const EMPLOYEE_TABLE_COLUMNS = [
  { key: 'firstName', label: 'Preferred First Name' },
  { key: 'lastName', label: 'Last Name' },
  { key: 'email', label: 'Email' },
  { key: 'username', label: 'Username' },
  { key: 'phone', label: 'Phone Number' },
  { key: 'homePool', label: 'Home Pool' },
  { key: 'role', label: 'Role(s)' },
  { key: 'createdAt', label: 'Account Created' },
  { key: 'lastVerifiedAt', label: 'Last Verified' },
  { key: 'emailVerificationOverride', label: 'Email Override' },
];
const UNVERIFIED_ACCOUNT_COLUMNS = [
  'Name',
  'Email',
  'Username',
  'Phone Number',
  'Home Pool',
  'Role',
  'Created',
  'Status',
];
let resolvePoolProEmployeesReady = null;
window.poolProEmployeesLoaded = false;
window.poolProEmployeesReady = new Promise((resolve) => {
  resolvePoolProEmployeesReady = resolve;
});

function ensureEmployeeSearchField() {
  const filterBar = document.getElementById('employeeFilterBar');
  if (!filterBar || document.getElementById('employeeSettingsSearch')) return;

  const searchField = document.createElement('div');
  searchField.className = 'settings-field roles-search-field employee-search-field';
  searchField.innerHTML = `
    <label for="employeeSettingsSearch">Search</label>
    <input type="text" id="employeeSettingsSearch" class="employee-search-input" autocomplete="off" placeholder="Search employees">
  `;

  const marketFilter = document.getElementById('employeeMarketFilter');
  if (marketFilter && marketFilter.parentElement === filterBar) {
    filterBar.insertBefore(searchField, marketFilter);
    return;
  }

  filterBar.appendChild(searchField);
}

function setEmployeeTableHeaders() {
  const headerRow = document.querySelector('#employeeTableSection .employee-table thead tr');
  if (!headerRow) return;
  headerRow.innerHTML = EMPLOYEE_TABLE_COLUMNS
    .map(({ label }) => `<th>${escapeHtml(label)}</th>`)
    .join('');
}

function ensureUnverifiedAccountsSection() {
  if (document.getElementById('unverifiedAccountsSection')) return;

  const tableSection = document.getElementById('employeeTableSection');
  if (!tableSection?.parentElement) return;

  const section = document.createElement('div');
  section.id = 'unverifiedAccountsSection';
  section.className = 'employee-unverified-section';
  section.innerHTML = `
    <h4>Unverified Account Attempts</h4>
    <p class="section-subtitle">PoolPro signup records that have not completed app email verification.</p>
    <div id="unverifiedAccountsTableSection" class="sanitation-section">
      <table class="employee-table employee-unverified-table">
        <thead>
          <tr>
            ${UNVERIFIED_ACCOUNT_COLUMNS.map((label) => `<th>${escapeHtml(label)}</th>`).join('')}
          </tr>
        </thead>
        <tbody id="unverifiedAccountsTableBody"></tbody>
      </table>
    </div>
  `;

  const deleteAllWrap = document.getElementById('employeeDeleteAllBtn')?.parentElement;
  if (deleteAllWrap && deleteAllWrap.parentElement === tableSection.parentElement) {
    deleteAllWrap.insertAdjacentElement('beforebegin', section);
  } else {
    tableSection.insertAdjacentElement('afterend', section);
  }

  const table = section.querySelector('.employee-unverified-table');
  if (table) {
    wrapResponsiveTables(section);
    table.style.setProperty('--table-min-width', '1260px');
    const wrap = table.closest('.table-scroll-wrap');
    if (wrap) {
      wrap.style.setProperty('--table-min-width', '1260px');
      bindTableScrollShadow(wrap);
      updateTableScrollShadow(wrap);
    }
  }
}

function ensureEmployeeSettingsUi() {
  const tableSection = document.getElementById('employeeTableSection');
  if (!tableSection) return;

  ensureEmployeeSearchField();
  ensureUnverifiedAccountsSection();

  if (!document.getElementById('employeeControls')) {
    const controlsRow = document.createElement('div');
    controlsRow.className = 'toggle-btn employee-toggle-row';
    controlsRow.innerHTML = `
      <div id="employeeControls" class="sanitation-controls">
        <div class="sanitation-controls-thumb"></div>
        <button type="button" class="editAndSave active" id="employeeEditBtn">Edit</button>
        <button type="button" class="editAndSave" id="employeeSaveBtn" disabled>Save</button>
      </div>
    `;
    tableSection.parentElement?.insertBefore(controlsRow, tableSection);
  }

  const table = tableSection.querySelector('.employee-table');
  if (table && !table.closest('.table-scroll-wrap')) {
    const shell = document.createElement('div');
    shell.className = 'table-scroll-shell';
    const wrap = document.createElement('div');
    wrap.className = 'table-scroll-wrap';
    wrap.style.setProperty('--table-min-width', '1520px');
    tableSection.insertBefore(shell, table);
    shell.appendChild(wrap);
    wrap.appendChild(table);
    bindTableScrollShadow(wrap);
    updateTableScrollShadow(wrap);
  } else if (table) {
    table.style.setProperty('--table-min-width', '1520px');
    const wrap = table.closest('.table-scroll-wrap');
    if (wrap) {
      wrap.style.setProperty('--table-min-width', '1520px');
      bindTableScrollShadow(wrap);
      updateTableScrollShadow(wrap);
    }
  }

  setEmployeeTableHeaders();

  const addRow = document.querySelector('.employee-add-btn-row');
  if (addRow) {
    addRow.classList.add('employee-action-row');

    if (!document.getElementById('employeeDeleteBtn')) {
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.id = 'employeeDeleteBtn';
      deleteBtn.className = 'submit-btn button-shadow employee-action-btn hidden';
      deleteBtn.textContent = 'Delete';
      addRow.appendChild(deleteBtn);
    }

    if (!document.getElementById('employeeUndoBtn')) {
      const undoBtn = document.createElement('button');
      undoBtn.type = 'button';
      undoBtn.id = 'employeeUndoBtn';
      undoBtn.className = 'submit-btn button-shadow employee-action-btn hidden';
      undoBtn.textContent = 'Undo';
      addRow.appendChild(undoBtn);
    }
  }
}

function populateEmployeeForm(employee) {
  const normalized = normalizeEmployeeRecord(employee || {});
  const emailField = document.getElementById('employeeIdInput');
  const firstNameField = document.getElementById('employeeFirstNameInput');
  const lastNameField = document.getElementById('employeeLastNameInput');
  const phoneField = document.getElementById('employeePhoneInput');
  const homePoolField = document.getElementById('employeeHomePoolInput');
  if (emailField) emailField.value = normalized.email || normalized.id || '';
  if (firstNameField) firstNameField.value = normalized.firstName || '';
  if (lastNameField) lastNameField.value = normalized.lastName || '';
  if (phoneField) phoneField.value = normalized.phone || '';
  if (homePoolField) homePoolField.value = normalized.homePool || '';
}

function clearEmployeeForm() {
  ['employeeIdInput', 'employeeFirstNameInput', 'employeeLastNameInput', 'employeePhoneInput'].forEach((fieldId) => {
    const field = document.getElementById(fieldId);
    if (field) field.value = '';
  });
  const homePoolField = document.getElementById('employeeHomePoolInput');
  if (homePoolField) homePoolField.value = '';
}

function syncEmployeeActionButtons() {
  ensureEmployeeSettingsUi();
  const addBtn = document.getElementById('employeeAddBtn');
  const deleteBtn = document.getElementById('employeeDeleteBtn');
  const undoBtn = document.getElementById('employeeUndoBtn');
  const hasSelectedRow = employeeTableEditable && editingEmployeeIdx >= 0 && !!employeesData[editingEmployeeIdx];

  if (addBtn) addBtn.textContent = hasSelectedRow ? 'Save' : 'Add';
  if (deleteBtn) deleteBtn.classList.toggle('hidden', !hasSelectedRow);
  if (undoBtn) undoBtn.classList.toggle('hidden', !employeeUndoState);
}

function selectEmployeeRow(sourceIndex) {
  if (!employeeTableEditable) return;
  const employee = employeesData[sourceIndex];
  if (!employee) return;
  editingEmployeeIdx = sourceIndex;
  populateEmployeeForm(employee);
  syncEmployeeActionButtons();
  renderEmployeesTable();
}

function setEmployeeUndoAction(action) {
  employeeUndoState = action || null;
  syncEmployeeActionButtons();
}

async function undoLastEmployeeAction() {
  if (!employeeUndoState) return;
  const { type, employee, index } = employeeUndoState;
  const normalized = normalizeEmployeeRecord(employee);

  if (type === 'add') {
    const matchIndex = employeesData.findIndex((item, itemIndex) => itemIndex === index
      || normalizeEmployeeRecord(item).email === normalized.email);
    if (matchIndex >= 0) {
      employeesData.splice(matchIndex, 1);
      await saveEmployees();
    }
    editingEmployeeIdx = -1;
    populateEmployeeForm(normalized);
  } else if (type === 'delete') {
    if (!employeeTableEditable) setEmployeeTableEditable(true);
    editingEmployeeIdx = -1;
    populateEmployeeForm(normalized);
  }

  setEmployeeUndoAction(null);
  renderEmployeesTable();
}

function setEmployeeTableEditable(editable) {
  ensureEmployeeSettingsUi();
  employeeTableEditable = !!editable;
  const editBtn = document.getElementById('employeeEditBtn');
  const saveBtn = document.getElementById('employeeSaveBtn');
  const section = document.getElementById('employeeTableSection');
  const controls = document.getElementById('employeeControls');

  if (section) section.classList.toggle('overlay-disabled', !employeeTableEditable);
  if (editBtn) {
    editBtn.classList.toggle('active', employeeTableEditable);
    editBtn.disabled = employeeTableEditable;
  }
  if (saveBtn) {
    saveBtn.classList.toggle('active', !employeeTableEditable);
    saveBtn.disabled = !employeeTableEditable;
  }
  setSegmentedToggleThumb(controls, employeeTableEditable ? 'edit' : 'save');

  if (!employeeTableEditable) {
    editingEmployeeIdx = -1;
    clearEmployeeForm();
  }

  syncEmployeeActionButtons();
  renderEmployeesTable();
}

async function loadEmployees() {
  try {
    const ref = doc(db, 'settings', 'employees');
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      employeesData = Array.isArray(data.employees) ? data.employees.map(normalizeEmployeeRecord) : [];
    } else {
      employeesData = [];
    }
    await loadLifeguardAccounts();
    renderEmployeesTable();
    renderUnverifiedAccountsTable();
  } catch (err) {
    console.error('[ChemLog] Error loading employees:', err);
    renderEmployeesTable();
    renderUnverifiedAccountsTable();
  } finally {
    const normalizedEmployees = employeesData.map(normalizeEmployeeRecord);
    window.poolProEmployees = normalizedEmployees;
    window.poolProEmployeesData = normalizedEmployees;
    window.poolProEmployeesLoaded = true;
    if (resolvePoolProEmployeesReady) {
      resolvePoolProEmployeesReady(normalizedEmployees);
      resolvePoolProEmployeesReady = null;
    }
    window.dispatchEvent(new CustomEvent('poolpro:employees-loaded', {
      detail: { employees: normalizedEmployees },
    }));
  }
}

async function loadLifeguardAccounts() {
  try {
    const snap = await getDocs(collection(db, 'lifeguardAccounts'));
    lifeguardAccountsData = snap.docs
      .map((docSnap) => normalizeLifeguardAccountRecord(docSnap.data(), docSnap.id));
    lifeguardAccountsLoaded = true;
  } catch (err) {
    lifeguardAccountsLoaded = false;
    lifeguardAccountsData = [];
    console.error('[ChemLog] Error loading lifeguard accounts:', err);
  }
}

async function saveEmployees() {
  try {
    employeesData = employeesData.map(normalizeEmployeeRecord);
    window.poolProEmployees = employeesData;
    window.poolProEmployeesData = employeesData;
    await setDoc(doc(db, 'settings', 'employees'), { employees: employeesData }, { merge: true });
    renderRolesPermissionsSettings();
  } catch (err) {
    console.error('[ChemLog] Error saving employees:', err);
  }
}

async function loadSecuritySettings() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'security'));
    if (snap.exists()) {
      const data = snap.data() || {};
      const savedTimeout = String(data.sessionTimeout || '360');
      const allowedTimeouts = new Set(Array.from({ length: 10 }, (_, i) => String((i + 1) * 60)));
      securitySettings = {
        sessionTimeout: allowedTimeouts.has(savedTimeout) ? savedTimeout : '360',
        requirePasswordConfirm: data.requirePasswordConfirm !== false,
      };
    } else {
      securitySettings = {
        sessionTimeout: '360',
        requirePasswordConfirm: true,
      };
    }
  } catch (err) {
    console.error('[ChemLog] Error loading security settings:', err);
  }
}

function clearSecurityIdleTimer() {
  if (securityIdleTimer) {
    clearTimeout(securityIdleTimer);
    securityIdleTimer = null;
  }
}

function applySecuritySessionTimeout() {
  clearSecurityIdleTimer();
  const timeoutMinutes = Number(securitySettings.sessionTimeout || 0);
  if (!isSupervisor() || !timeoutMinutes || Number.isNaN(timeoutMinutes)) return;

  const resetTimer = () => {
    clearSecurityIdleTimer();
    securityIdleTimer = setTimeout(() => {
      alert('You have been logged out due to inactivity.');
      if (typeof window.logout === 'function') window.logout();
    }, timeoutMinutes * 60 * 1000);
  };

  if (!securityEventsBound) {
    ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach((evt) => {
      window.addEventListener(evt, resetTimer, { passive: true });
    });
    securityEventsBound = true;
  }
  resetTimer();
}

function setupSecuritySettingsUI() {
  const timeoutSelect = document.getElementById('securityTimeoutSelect');
  const requirePassCb = document.getElementById('securityRequirePassword');
  let editBtn = document.getElementById('securityEditBtn');
  let saveBtn = document.getElementById('securitySaveBtn');
  if (!timeoutSelect || !requirePassCb || !saveBtn) return;

  // Apply the overlay only to the content wrapper (not the whole section with title/buttons)
  const contentWrap = document.querySelector('.security-content-wrap');
  if (!contentWrap) return;
  contentWrap.classList.add('sanitation-section', 'security-section');

  const securitySection = saveBtn.closest('.settings-section') || timeoutSelect.closest('.settings-section');
  if (securitySection) securitySection.id = 'securitySection';

  let controls = document.getElementById('securityControls');
  if (!controls) {
    const controlsRow = securitySection?.querySelector('.security-controls-row') || securitySection;
    const controlsWrap = document.createElement('div');
    controlsWrap.className = 'toggle-btn';
    controlsWrap.innerHTML = `
      <div id="securityControls" class="sanitation-controls">
        <div class="sanitation-controls-thumb"></div>
        <button type="button" class="editAndSave active" id="securityEditBtn">Edit</button>
      </div>
    `;
    controlsRow.appendChild(controlsWrap);
    controls = controlsWrap.querySelector('#securityControls');
    editBtn = controls.querySelector('#securityEditBtn');
    controls.appendChild(saveBtn);
  } else if (!editBtn) {
    editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'editAndSave active';
    editBtn.id = 'securityEditBtn';
    editBtn.textContent = 'Edit';
    controls.appendChild(editBtn);
  }

  saveBtn.classList.remove('submit-btn');
  saveBtn.classList.add('editAndSave');
  saveBtn.style.marginTop = '';

  const timeoutOptions = Array.from({ length: 10 }, (_, i) => {
    const hours = i + 1;
    return { value: String(hours * 60), label: `${hours} hour${hours === 1 ? '' : 's'}` };
  });
  timeoutSelect.innerHTML = '';
  timeoutOptions.forEach(({ value, label }) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    timeoutSelect.appendChild(opt);
  });
  requirePassCb.classList.add('market-filter-checkbox');
  requirePassCb.style.marginRight = '10px';

  timeoutSelect.value = timeoutOptions.some((option) => option.value === securitySettings.sessionTimeout)
    ? securitySettings.sessionTimeout
    : '360';
  requirePassCb.checked = securitySettings.requirePasswordConfirm !== false;

  const setEditable = (editable) => {
    contentWrap.classList.toggle('overlay-disabled', !editable);
    timeoutSelect.disabled = !editable;
    requirePassCb.disabled = !editable;
    editBtn.classList.toggle('active', editable);
    saveBtn.classList.toggle('active', !editable);
    editBtn.disabled = editable;
    saveBtn.disabled = !editable;
    const thumb = document.querySelector('#securityControls .sanitation-controls-thumb');
    if (thumb) thumb.style.transform = editable ? 'translateX(0%)' : 'translateX(100%)';
  };

  setEditable(false);

  if (!editBtn || !saveBtn || controls?.dataset.securityBound === 'true') return;
  controls.dataset.securityBound = 'true';

  editBtn.addEventListener('click', () => setEditable(true));

  saveBtn.addEventListener('click', async () => {
    securitySettings = {
      sessionTimeout: timeoutSelect.value || 'never',
      requirePasswordConfirm: !!requirePassCb.checked,
    };
    try {
      await setDoc(doc(db, 'settings', 'security'), securitySettings, { merge: true });
      applySecuritySessionTimeout();
      setEditable(false);
    } catch (err) {
      console.error('[ChemLog] Error saving security settings:', err);
      alert('Unable to save security settings.');
    }
  });
}

function formatPhoneDisplay(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  return raw || '';
}

function getTenDigitPhone(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return '';
}

function normalizePhoneDigits(raw) {
  return (raw || '').replace(/\D/g, '');
}

function normalizeEmployeeRecord(rawEmployee) {
  const employee = rawEmployee || {};
  const legacyId = (employee.id ?? '').toString().trim();
  const emailSource = employee.email ?? (legacyId.includes('@') ? legacyId : '');
  const email = emailSource.toString().trim().toLowerCase();
  const roleKeys = normalizeEmployeeRoleKeys(employee);
  return {
    ...employee,
    id: email || legacyId,
    email,
    username: (employee.username ?? '').toString().trim().toLowerCase(),
    firstName: (employee.firstName ?? '').toString().trim(),
    lastName: (employee.lastName ?? '').toString().trim(),
    homePool: (employee.homePool ?? '').toString().trim(),
    phone: normalizePhoneDigits(employee.phone ?? ''),
    role: roleKeys[0] || '',
    roles: roleKeys,
  };
}

function normalizeLifeguardAccountRecord(rawAccount, docId = '') {
  const account = rawAccount || {};
  const username = normalizeEmployeeLookupKey(account.username || docId);
  const authEmail = (account.authEmail || account.employeeEmail || account.email || account.id || '')
    .toString()
    .trim()
    .toLowerCase();
  const employeeEmail = (account.employeeEmail || account.email || account.id || account.authEmail || '')
    .toString()
    .trim()
    .toLowerCase();
  return {
    ...account,
    id: (account.id || employeeEmail || authEmail || username).toString().trim(),
    username,
    authEmail,
    employeeEmail,
    email: (account.email || employeeEmail || authEmail).toString().trim().toLowerCase(),
    firstName: (account.firstName ?? '').toString().trim(),
    lastName: (account.lastName ?? '').toString().trim(),
    phone: normalizePhoneDigits(account.phone ?? ''),
    homePool: (account.homePool ?? '').toString().trim(),
    role: normalizeEmployeeRoleKeys(account)[0] || '',
    roles: normalizeEmployeeRoleKeys(account),
    createdAt: account.createdAt || '',
    lastVerifiedAt: account.lastVerifiedAt || '',
    lastVerificationMethod: account.lastVerificationMethod || '',
    emailVerificationOverride: account.emailVerificationOverride === true,
    emailVerificationOverrideAt: account.emailVerificationOverrideAt || '',
    emailVerificationOverrideBy: account.emailVerificationOverrideBy || '',
  };
}

function normalizeEmployeeLookupKey(value) {
  return String(value || '').trim().toLowerCase();
}

function getLifeguardAccountIdentityKeys(account = {}) {
  return [
    account.username,
    account.authEmail,
    account.employeeEmail,
    account.email,
    account.id,
  ].map(normalizeEmployeeLookupKey).filter(Boolean);
}

function findLifeguardAccountForEmployee(employee = {}) {
  const normalizedEmployee = normalizeEmployeeRecord(employee);
  const employeeKeys = new Set([
    normalizedEmployee.email,
    normalizedEmployee.id,
    normalizedEmployee.username,
  ].map(normalizeEmployeeLookupKey).filter(Boolean));
  if (!employeeKeys.size) return null;
  return lifeguardAccountsData.find((account) => (
    getLifeguardAccountIdentityKeys(account).some((key) => employeeKeys.has(key))
  )) || null;
}

function mergeEmployeeAndAccountData(employee = {}) {
  const normalizedEmployee = normalizeEmployeeRecord(employee);
  const account = findLifeguardAccountForEmployee(normalizedEmployee);
  if (!account) return normalizedEmployee;

  return normalizeEmployeeRecord({
    ...account,
    ...normalizedEmployee,
    id: normalizedEmployee.id || normalizedEmployee.email || account.employeeEmail || account.authEmail || account.username,
    email: normalizedEmployee.email || account.employeeEmail || account.authEmail || account.email,
    username: normalizedEmployee.username || account.username,
    firstName: normalizedEmployee.firstName || account.firstName,
    lastName: normalizedEmployee.lastName || account.lastName,
    phone: normalizedEmployee.phone || account.phone,
    homePool: normalizedEmployee.homePool || account.homePool,
    role: normalizedEmployee.role || account.role,
    roles: [
      ...normalizeEmployeeRoleKeys(normalizedEmployee),
      ...normalizeEmployeeRoleKeys(account),
    ].filter((roleKey, index, roleKeys) => roleKey && roleKeys.indexOf(roleKey) === index),
    createdAt: normalizedEmployee.createdAt || account.createdAt,
    lastVerifiedAt: normalizedEmployee.lastVerifiedAt || account.lastVerifiedAt,
    lastVerificationMethod: normalizedEmployee.lastVerificationMethod || account.lastVerificationMethod,
    emailVerificationOverride: normalizedEmployee.emailVerificationOverride === true || account.emailVerificationOverride === true,
    emailVerificationOverrideAt: normalizedEmployee.emailVerificationOverrideAt || account.emailVerificationOverrideAt,
    emailVerificationOverrideBy: normalizedEmployee.emailVerificationOverrideBy || account.emailVerificationOverrideBy,
  });
}

function formatEmployeeDateTime(value) {
  const millis = timestampToMillis(value);
  if (!millis) return '';
  return new Date(millis).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatEmployeeRole(value) {
  return getRoleLabel(value) || '';
}

function formatEmployeeCell(record, columnKey) {
  switch (columnKey) {
    case 'phone':
      return formatPhoneDisplay(record.phone);
    case 'role':
      return formatEmployeeRoles(record);
    case 'createdAt':
    case 'lastVerifiedAt':
      return formatEmployeeDateTime(record[columnKey]);
    case 'emailVerificationOverride':
      return record.emailVerificationOverride === true
        ? `Yes${record.emailVerificationOverrideAt ? ` (${formatEmployeeDateTime(record.emailVerificationOverrideAt)})` : ''}`
        : 'No';
    default:
      return record[columnKey] || '';
  }
}

function getSubmissionIdentityKeys(record = {}) {
  const source = record || {};
  return [
    source.employeeId,
    source.respondentEmail,
    source.submitterEmail,
    source.email,
    source.username,
    source.respondentUsername,
    source.submitterUsername,
    source.id,
  ].map(normalizeEmployeeLookupKey).filter(Boolean);
}

function isOpaqueSubmissionDisplayName(value, record = {}) {
  const raw = String(value || '').trim();
  if (!raw) return true;
  const normalized = normalizeEmployeeLookupKey(raw);
  if (['unknown', 'unnamed', 'n/a', 'na', 'null', 'undefined', '-', '—'].includes(normalized)) return true;
  if (/^_+$/.test(raw)) return true;
  if (normalized.includes('@')) return true;
  if (getSubmissionIdentityKeys(record).includes(normalized)) return true;
  return !/\s/.test(raw) && /[0-9]/.test(raw) && /^[a-z0-9_-]{10,}$/i.test(raw);
}

function getStoredSubmissionName(record = {}) {
  const source = record || {};
  return [
    source.respondentName,
    source.submitterName,
    source.displayName,
  ].map((value) => String(value || '').trim())
    .find((value) => value && !isOpaqueSubmissionDisplayName(value, source)) || '';
}

function findEmployeeForSubmission(record = {}) {
  const source = record || {};
  const keys = new Set(getSubmissionIdentityKeys(source));
  if (!keys.size || !Array.isArray(employeesData)) return null;
  return employeesData
    .map(normalizeEmployeeRecord)
    .find((employee) => [
      employee.email,
      employee.id,
      employee.username,
      employee.employeeId,
    ].map(normalizeEmployeeLookupKey).some((key) => key && keys.has(key))) || null;
}

function getSubmissionRespondentName(record = {}) {
  const source = record || {};
  const employee = findEmployeeForSubmission(source);
  const recordName = [
    source.firstName,
    source.lastName,
  ].map((value) => String(value || '').trim()).filter(Boolean).join(' ');
  const employeeName = [
    employee?.firstName,
    employee?.lastName,
  ].map((value) => String(value || '').trim()).filter(Boolean).join(' ');
  const storedName = getStoredSubmissionName(source);
  return (!isOpaqueSubmissionDisplayName(recordName, source) ? recordName : '')
    || employeeName
    || storedName
    || '—';
}

function getSubmissionRespondentEmail(record = {}) {
  const source = record || {};
  const employee = findEmployeeForSubmission(source);
  return String(source.respondentEmail || source.submitterEmail || source.email || employee?.email || '').trim();
}

function renderEmployeesTable() {
  ensureEmployeeSettingsUi();
  const tbody = document.getElementById('employeesTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  // Determine which employees to show based on active filters
  let filteredEmployees = employeesData.map((emp, index) => ({
    emp: mergeEmployeeAndAccountData(emp),
    index,
  }));
  if (employeePoolFilter !== 'all') {
    filteredEmployees = filteredEmployees.filter(({ emp }) => emp.homePool === employeePoolFilter);
  } else if (employeeMarketFilter !== 'all') {
    const marketPoolNames = poolsCache
      .filter(p => {
        const markets = Array.isArray(p.markets) ? p.markets : (p.market ? [p.market] : []);
        return markets.includes(employeeMarketFilter);
      })
      .map(p => p.name || p.id);
    filteredEmployees = filteredEmployees.filter(({ emp }) => marketPoolNames.includes(emp.homePool));
  }
  const normalizedSearch = employeeSearchTerm.trim().toLowerCase();
  if (normalizedSearch) {
    filteredEmployees = filteredEmployees.filter(({ emp }) => {
      const normalized = normalizeEmployeeRecord(emp);
      const haystack = [
        employeeDisplayName(normalized),
        normalized.firstName,
        normalized.lastName,
        normalized.email,
        normalized.id,
        normalized.username,
        normalized.phone,
        formatPhoneDisplay(normalized.phone),
        normalized.homePool,
        formatEmployeeRoles(normalized),
        formatEmployeeDateTime(normalized.createdAt),
        formatEmployeeDateTime(normalized.lastVerifiedAt),
        normalized.emailVerificationOverride === true ? 'email override yes' : 'email override no',
      ].join(' ').toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }
  filteredEmployees.sort((a, b) => {
    const aLast = String(a.emp.lastName || '').toLowerCase();
    const bLast = String(b.emp.lastName || '').toLowerCase();
    if (aLast !== bLast) return aLast.localeCompare(bLast);
    const aFirst = String(a.emp.firstName || '').toLowerCase();
    const bFirst = String(b.emp.firstName || '').toLowerCase();
    if (aFirst !== bFirst) return aFirst.localeCompare(bFirst);
    return String(a.emp.email || a.emp.id || '').localeCompare(String(b.emp.email || b.emp.id || ''));
  });

  // Pagination: show 10 rows per page
  const totalPages = Math.max(1, Math.ceil(filteredEmployees.length / EMPLOYEES_PER_PAGE));
  if (employeePage > totalPages) employeePage = totalPages;
  const pageStart = (employeePage - 1) * EMPLOYEES_PER_PAGE;
  const pageEmployees = filteredEmployees.slice(pageStart, pageStart + EMPLOYEES_PER_PAGE);

  if (!pageEmployees.length) {
    tbody.innerHTML = `<tr><td colspan="${EMPLOYEE_TABLE_COLUMNS.length}">No employees match the current filters.</td></tr>`;
  }

  pageEmployees.forEach(({ emp, index: sourceIndex }) => {
    const displayRecord = mergeEmployeeAndAccountData(emp);
    const tr = document.createElement('tr');
    tr.dataset.employeeIndex = String(sourceIndex);
    if (employeeTableEditable) tr.classList.add('employee-row-clickable');
    if (employeeTableEditable && sourceIndex === editingEmployeeIdx) {
      tr.classList.add('employee-row-selected');
    }
    tr.innerHTML = EMPLOYEE_TABLE_COLUMNS
      .map(({ key }) => `<td>${escapeHtml(formatEmployeeCell(displayRecord, key))}</td>`)
      .join('');
    tr.addEventListener('click', () => selectEmployeeRow(sourceIndex));
    tbody.appendChild(tr);
  });

  syncEmployeeActionButtons();
  renderEmployeePagination(totalPages);
}

function isUnverifiedAccountAttempt(account = {}) {
  const normalized = normalizeLifeguardAccountRecord(account, account.username || '');
  return !accountHasEmailVerification(normalized);
}

function getUnverifiedAccountRows() {
  return lifeguardAccountsData
    .map((account) => normalizeLifeguardAccountRecord(account, account.username || ''))
    .filter(isUnverifiedAccountAttempt)
    .sort((a, b) => {
      const bTime = timestampToMillis(b.createdAt);
      const aTime = timestampToMillis(a.createdAt);
      if (aTime !== bTime) return bTime - aTime;
      return employeeDisplayName(a).localeCompare(employeeDisplayName(b));
    });
}

function renderUnverifiedAccountsTable() {
  ensureEmployeeSettingsUi();
  const tbody = document.getElementById('unverifiedAccountsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!lifeguardAccountsLoaded) {
    tbody.innerHTML = `<tr><td colspan="${UNVERIFIED_ACCOUNT_COLUMNS.length}">Unable to load account attempts right now.</td></tr>`;
    return;
  }

  const rows = getUnverifiedAccountRows();
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${UNVERIFIED_ACCOUNT_COLUMNS.length}">No unverified account attempts found.</td></tr>`;
    return;
  }

  rows.forEach((account) => {
    const tr = document.createElement('tr');
    tr.className = 'employee-unverified-row';
    tr.tabIndex = 0;
    tr.dataset.accountUsername = account.username || '';
    const name = employeeDisplayName(account);
    const email = account.employeeEmail || account.authEmail || account.email || '';
    tr.innerHTML = `
      <td>${escapeHtml(name)}</td>
      <td>${escapeHtml(email)}</td>
      <td>${escapeHtml(account.username || '')}</td>
      <td>${escapeHtml(formatPhoneDisplay(account.phone))}</td>
      <td>${escapeHtml(account.homePool || '')}</td>
      <td>${escapeHtml(formatEmployeeRoles(account))}</td>
      <td>${escapeHtml(formatEmployeeDateTime(account.createdAt))}</td>
      <td><span class="employee-unverified-status">Awaiting verification</span></td>
    `;
    const openOverrideModal = () => openEmailVerificationOverrideModal(account);
    tr.addEventListener('click', openOverrideModal);
    tr.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openOverrideModal();
      }
    });
    tbody.appendChild(tr);
  });

  const wrap = document.querySelector('#unverifiedAccountsTableSection .table-scroll-wrap');
  if (wrap) updateTableScrollShadow(wrap);
}

function closeEmailVerificationOverrideModal() {
  const modal = document.getElementById('emailVerificationOverrideModal');
  if (!modal) return;
  modal.classList.remove('visible');
  setTimeout(() => {
    modal.style.display = 'none';
  }, 180);
}

function ensureEmailVerificationOverrideModal() {
  let modal = document.getElementById('emailVerificationOverrideModal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'emailVerificationOverrideModal';
  modal.className = 'poolpro-confirm-modal email-override-modal';
  document.body.appendChild(modal);
  return modal;
}

function openEmailVerificationOverrideModal(account = {}) {
  const normalized = normalizeLifeguardAccountRecord(account, account.username || '');
  const modal = ensureEmailVerificationOverrideModal();
  const email = normalized.employeeEmail || normalized.authEmail || normalized.email || '';
  modal.innerHTML = `
    <div class="poolpro-confirm-card email-override-card" role="dialog" aria-modal="true" aria-labelledby="emailOverrideTitle">
      <h3 id="emailOverrideTitle">Override Email Verification</h3>
      <p>Allow this PoolPro account to continue without Firebase email verification.</p>
      <div class="email-override-summary">
        <div><strong>Name</strong><span>${escapeHtml(employeeDisplayName(normalized))}</span></div>
        <div><strong>Email</strong><span>${escapeHtml(email || '—')}</span></div>
        <div><strong>Username</strong><span>${escapeHtml(normalized.username || '—')}</span></div>
        <div><strong>Home Pool</strong><span>${escapeHtml(normalized.homePool || '—')}</span></div>
      </div>
      <div class="poolpro-confirm-actions">
        <button type="button" class="submit-btn" data-override-cancel>Cancel</button>
        <button type="button" class="submit-btn danger-button" data-override-confirm>Override Email Verification</button>
      </div>
    </div>
  `;

  modal.onclick = (event) => {
    if (event.target === modal) closeEmailVerificationOverrideModal();
  };
  const cancelButton = modal.querySelector('[data-override-cancel]');
  const confirmButton = modal.querySelector('[data-override-confirm]');
  if (cancelButton) cancelButton.onclick = closeEmailVerificationOverrideModal;
  if (confirmButton) confirmButton.onclick = async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Saving...';
    try {
      await overrideEmailVerificationForAccount(normalized);
      closeEmailVerificationOverrideModal();
    } catch (err) {
      console.error('[ChemLog] Error overriding email verification:', err);
      button.disabled = false;
      button.textContent = 'Override Email Verification';
      alert(err.message || 'Unable to override email verification right now.');
    }
  };

  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('visible'));
}

async function overrideEmailVerificationForAccount(account = {}) {
  const normalized = normalizeLifeguardAccountRecord(account, account.username || '');
  if (!normalized.username) throw new Error('This account is missing a username.');
  const supervisor = (auth.currentUser?.email || getStoredSupervisorEmail() || '').trim().toLowerCase();
  const overrideAt = new Date().toISOString();
  await setDoc(doc(db, 'lifeguardAccounts', normalized.username), {
    emailVerificationOverride: true,
    emailVerificationOverrideAt: overrideAt,
    emailVerificationOverrideBy: supervisor,
  }, { merge: true });
  await loadLifeguardAccounts();
  renderEmployeesTable();
  renderUnverifiedAccountsTable();
}

function renderEmployeePagination(totalPages) {
  // Remove existing pagination
  document.getElementById('employeePagination')?.remove();
  const tableSection = document.getElementById('employeeTableSection');
  if (!tableSection || totalPages <= 1) return;

  const container = document.createElement('div');
  container.id = 'employeePagination';
  container.className = 'emp-pagination-row';

  const backBtn = document.createElement('button');
  backBtn.className = 'emp-pagination-arrow';
  backBtn.textContent = '←';
  if (employeePage > 1) {
    backBtn.addEventListener('click', () => { employeePage--; renderEmployeesTable(); });
  } else {
    backBtn.style.visibility = 'hidden';
    backBtn.disabled = true;
  }
  container.appendChild(backBtn);

  const sel = document.createElement('select');
  sel.className = 'training-filter-select emp-pagination-select';
  for (let p = 1; p <= totalPages; p++) {
    const opt = document.createElement('option');
    opt.value = String(p);
    opt.textContent = `Page ${p}`;
    if (p === employeePage) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => { employeePage = Number(sel.value); renderEmployeesTable(); });
  container.appendChild(sel);

  const fwdBtn = document.createElement('button');
  fwdBtn.className = 'emp-pagination-arrow';
  fwdBtn.textContent = '→';
  if (employeePage < totalPages) {
    fwdBtn.addEventListener('click', () => { employeePage++; renderEmployeesTable(); });
  } else {
    fwdBtn.style.visibility = 'hidden';
    fwdBtn.disabled = true;
  }
  container.appendChild(fwdBtn);

  tableSection.insertAdjacentElement('afterend', container);
}

function setupEmployeeManagement() {
  ensureEmployeeSettingsUi();
  // Add single employee
  const addBtn = document.getElementById('employeeAddBtn');
  if (addBtn && !addBtn.dataset.bound) {
    addBtn.dataset.bound = 'true';
    addBtn.addEventListener('click', async () => {
      const email = (document.getElementById('employeeIdInput')?.value.trim() || '').toLowerCase();
      const firstName = document.getElementById('employeeFirstNameInput')?.value.trim() || '';
      const lastName = document.getElementById('employeeLastNameInput')?.value.trim();
      const homePool = document.getElementById('employeeHomePoolInput')?.value || '';
      const phone = normalizePhoneDigits(document.getElementById('employeePhoneInput')?.value);
      if (!email || !email.includes('@') || !firstName || !lastName || !homePool) {
        alert('Preferred First Name, Last Name, Email, and Home Pool are required.');
        return;
      }
      const wasEditing = editingEmployeeIdx >= 0;
      const nextEmployee = normalizeEmployeeRecord({
        ...(wasEditing ? employeesData[editingEmployeeIdx] : {}),
        email,
        id: email,
        firstName,
        lastName,
        homePool,
        phone
      });
      if (wasEditing) {
        employeesData[editingEmployeeIdx] = nextEmployee;
      } else {
        const insertIndex = employeesData.length;
        employeesData.push(nextEmployee);
        setEmployeeUndoAction({
          type: 'add',
          employee: nextEmployee,
          index: insertIndex,
        });
      }
      await saveEmployees();
      if (wasEditing) {
        editingEmployeeIdx = employeesData.findIndex((employee) => normalizeEmployeeRecord(employee).email === nextEmployee.email);
        populateEmployeeForm(nextEmployee);
      } else {
        editingEmployeeIdx = -1;
        clearEmployeeForm();
      }
      renderEmployeesTable();
    });
  }

  const deleteBtn = document.getElementById('employeeDeleteBtn');
  if (deleteBtn && !deleteBtn.dataset.bound) {
    deleteBtn.dataset.bound = 'true';
    deleteBtn.addEventListener('click', async () => {
      if (editingEmployeeIdx < 0 || !employeesData[editingEmployeeIdx]) return;
      const removed = normalizeEmployeeRecord(employeesData[editingEmployeeIdx]);
      const removedIndex = editingEmployeeIdx;
      let linkedAccessResult = { authDeleteError: null };
      try {
        linkedAccessResult = await deleteLinkedLifeguardAccessForEmployee(removed);
        await redactDeletedAccountData(buildDeletedEmployeeAccountContext(removed, linkedAccessResult?.linkedAccounts));
      } catch (err) {
        console.error('[ChemLog] Could not delete linked lifeguard access or anonymize employee submissions:', err);
        alert('Unable to delete the linked PoolPro login or anonymize this employee\'s submissions right now. The employee record was not removed.');
        return;
      }
      employeesData.splice(removedIndex, 1);
      editingEmployeeIdx = -1;
      clearEmployeeForm();
      setEmployeeUndoAction({
        type: 'delete',
        employee: removed,
        index: removedIndex,
      });
      await saveEmployees();
      renderEmployeesTable();
      if (linkedAccessResult?.authDeleteError) {
        alert('Employee removed from PoolPro, but the Firebase Auth credential could not be deleted automatically. If this email needs to be reused later, delete it from Firebase Authentication manually.');
      }
    });
  }

  const undoBtn = document.getElementById('employeeUndoBtn');
  if (undoBtn && !undoBtn.dataset.bound) {
    undoBtn.dataset.bound = 'true';
    undoBtn.addEventListener('click', async () => {
      await undoLastEmployeeAction();
    });
  }

  // Import from Excel/CSV — auto-import on file selection
  const fileInput = document.getElementById('employeeFileInput');
  if (fileInput && !fileInput.dataset.bound) {
    fileInput.dataset.bound = 'true';
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const XLSX = window.XLSX;
          if (!XLSX) { alert('XLSX library not loaded.'); return; }
          const wb = XLSX.read(evt.target.result, { type: 'binary' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
          const newEmps = rows
            .map((row) => {
              const data = Object.fromEntries(
                Object.entries(row).map(([key, value]) => [String(key || '').trim().toLowerCase(), value])
              );
              const email = String(
                data.email ||
                data['email address'] ||
                data['employee email'] ||
                ''
              ).trim().toLowerCase();
              const firstName = String(
                data['preferred first name'] ||
                data['first name'] ||
                data.firstname ||
                ''
              ).trim();
              const lastName = String(data['last name'] || data.lastname || '').trim();
              const phone = String(data['phone number'] || data.phone || '').trim();
              const homePool = String(
                data['home pool'] ||
                data['home facility'] ||
                data.facility ||
                ''
              ).trim();
              if (!email) return null;
              return normalizeEmployeeRecord({
                email,
                id: email,
                firstName,
                lastName,
                phone,
                homePool
              });
            })
            .filter(Boolean);
          employeesData = [...employeesData, ...newEmps];
          await saveEmployees();
          renderEmployeesTable();
          alert(`Imported ${newEmps.length} employee(s).`);
        } catch (err) {
          console.error('[ChemLog] Import error:', err);
          alert('Failed to import. Use Excel (.xlsx) or CSV format.');
        }
        fileInput.value = '';
      };
      reader.readAsBinaryString(file);
    });
  }
}

function setupDeleteAllEmployees() {
  const deleteAllBtn = document.getElementById('employeeDeleteAllBtn');
  if (!deleteAllBtn) return;
  const fileRow = document.querySelector('.employee-file-row');
  if (fileRow && deleteAllBtn.parentElement !== fileRow) {
    deleteAllBtn.classList.add('employee-delete-inline-btn');
    fileRow.appendChild(deleteAllBtn);
  }

  deleteAllBtn.addEventListener('click', async () => {
    if (!auth.currentUser) {
      alert('You must be logged in to perform this action.');
      return;
    }
    if (!confirm('Delete ALL employees? This cannot be undone.')) return;

    if (securitySettings.requirePasswordConfirm !== false) {
      const password = prompt('Enter your password to confirm:');
      if (!password) return;

      try {
        const credential = EmailAuthProvider.credential(auth.currentUser.email, password);
        await reauthenticateWithCredential(auth.currentUser, credential);
      } catch (err) {
        alert('Incorrect password. Deletion cancelled.');
        return;
      }
    }

    employeesData = [];
    await saveEmployees();
    renderEmployeesTable();
  });
}

function populateEmployeePoolFilter(market) {
  const poolFilter = document.getElementById('employeePoolFilter');
  if (!poolFilter) return;
  const current = poolFilter.value;
  poolFilter.innerHTML = '<option value="all">Home Pool</option>';
  let pools = market === 'all' ? poolsCache : poolsCache.filter(p => {
    const markets = Array.isArray(p.markets) ? p.markets : (p.market ? [p.market] : []);
    return markets.includes(market);
  });
  pools.sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.name || p.id;
    opt.textContent = p.name || p.id;
    poolFilter.appendChild(opt);
  });
  if (current && current !== 'all') poolFilter.value = current;
}

function setupEmployeeFilters() {
  const searchInput = document.getElementById('employeeSettingsSearch');
  const marketFilter = document.getElementById('employeeMarketFilter');
  const poolFilter = document.getElementById('employeePoolFilter');
  if (!marketFilter || !poolFilter) return;

  // Populate pool filter options initially with all pools
  populateEmployeePoolFilter('all');

  if (searchInput && searchInput.dataset.bound !== 'true') {
    searchInput.dataset.bound = 'true';
    searchInput.value = employeeSearchTerm;
    searchInput.addEventListener('input', () => {
      employeeSearchTerm = searchInput.value || '';
      employeePage = 1;
      renderEmployeesTable();
    });
  }

  marketFilter.addEventListener('change', () => {
    employeeMarketFilter = marketFilter.value;
    employeePoolFilter = 'all';
    employeePage = 1;
    poolFilter.value = 'all';
    populateEmployeePoolFilter(marketFilter.value);
    renderEmployeesTable();
  });

  poolFilter.addEventListener('change', () => {
    employeePoolFilter = poolFilter.value;
    employeePage = 1;
    renderEmployeesTable();
  });
}

// ============================================================
// ROLES AND PERMISSIONS
// ============================================================

function employeeDisplayName(employee) {
  const normalized = normalizeEmployeeRecord(employee || {});
  const name = [normalized.firstName, normalized.lastName].filter(Boolean).join(' ').trim();
  return name || normalized.email || normalized.username || normalized.id || 'Unnamed employee';
}

function findEmployeeByRoleKey(roleKey) {
  const key = normalizeIdentityKey(roleKey);
  return employeesData.find((employee) => getEmployeeIdentityKeys(employee).includes(key)) || null;
}

const ROLE_MEMBERS_PER_PAGE = 10;
const roleMemberPages = Object.fromEntries(ROLE_DEFINITIONS.map(({ key }) => [key, 1]));

function ensureRolesPermissionsSettingsSection() {
  if (document.getElementById('rolesPermissionsSettings')) {
    setupSettingsAccordions();
    setupRolePermissionModalEvents();
    renderRolesPermissionsSettings();
    return;
  }
  const employeeSection = document.getElementById('employeeSettings');
  if (!employeeSection) return;

  const section = document.createElement('section');
  section.className = 'settings-section settings-group roles-permissions-section';
  section.id = 'rolesPermissionsSettings';
  section.innerHTML = `
    <h3>Roles and Permissions</h3>
    <p class="section-subtitle">Assign limited site access to existing employees.</p>
    <div class="roles-add-row">
      <div class="settings-field">
        <label for="roleAssignmentSelect">Role</label>
        <select id="roleAssignmentSelect">
          <option value="lifeguard">Lifeguard</option>
          <option value="attendant">Attendant</option>
          <option value="poolManager">Pool Manager</option>
          <option value="supervisor">Supervisor</option>
        </select>
      </div>
      <div class="settings-field roles-search-field">
        <label for="roleEmployeeSearch">Employee</label>
        <input type="text" id="roleEmployeeSearch" autocomplete="off" placeholder="Type a name, email, or username">
        <div class="roles-search-results" id="roleEmployeeSearchResults"></div>
      </div>
    </div>
    <div class="roles-tables-grid">
      <div>
        <h4>Lifeguards</h4>
        <div class="table-scroll-wrap">
          <table class="employee-table roles-table">
            <thead><tr><th>Name</th><th>Email</th><th>Permissions</th><th>Remove</th></tr></thead>
            <tbody id="lifeguardRoleBody"></tbody>
          </table>
        </div>
      </div>
      <div>
        <h4>Attendants</h4>
        <div class="table-scroll-wrap">
          <table class="employee-table roles-table">
            <thead><tr><th>Name</th><th>Email</th><th>Permissions</th><th>Remove</th></tr></thead>
            <tbody id="attendantRoleBody"></tbody>
          </table>
        </div>
      </div>
      <div>
        <h4>Pool Managers</h4>
        <div class="table-scroll-wrap">
          <table class="employee-table roles-table">
            <thead><tr><th>Name</th><th>Email</th><th>Permissions</th><th>Remove</th></tr></thead>
            <tbody id="poolManagerRoleBody"></tbody>
          </table>
        </div>
      </div>
      <div>
        <h4>Supervisors</h4>
        <div class="table-scroll-wrap">
          <table class="employee-table roles-table">
            <thead><tr><th>Name</th><th>Email</th><th>Permissions</th><th>Remove</th></tr></thead>
            <tbody id="supervisorRoleBody"></tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="permissions-table-wrap">
      <h4>Permissions</h4>
      <div class="table-scroll-wrap">
        <table class="employee-table roles-permissions-table">
          <thead><tr><th>Role</th>${PERMISSION_DEFINITIONS.map(({ label }) => `<th>${escapeHtml(label)}</th>`).join('')}</tr></thead>
          <tbody id="rolePermissionsBody"></tbody>
        </table>
      </div>
    </div>
    <div class="roles-permission-modal hidden" id="rolePermissionModal" aria-hidden="true">
      <div class="roles-permission-modal-card" role="dialog" aria-modal="true" aria-labelledby="rolePermissionModalTitle">
        <div class="roles-permission-modal-header">
          <div>
            <h4 id="rolePermissionModalTitle">Permissions</h4>
            <p class="section-subtitle" id="rolePermissionModalSubtitle"></p>
          </div>
          <div class="roles-permission-modal-actions">
            <button type="button" class="submit-btn roles-permission-modal-save" id="rolePermissionModalSave">Save</button>
            <button type="button" class="roles-permission-modal-close" id="rolePermissionModalClose" aria-label="Close permissions">&times;</button>
          </div>
        </div>
        <div class="roles-permission-modal-checks" id="rolePermissionModalChecks"></div>
        <p class="roles-permission-modal-message" id="rolePermissionModalMessage"></p>
      </div>
    </div>
  `;
  employeeSection.insertAdjacentElement('afterend', section);
  const permissionModal = section.querySelector('#rolePermissionModal');
  const settingsModal = document.getElementById('settingsModal');
  if (permissionModal && settingsModal) settingsModal.appendChild(permissionModal);
  setupRolesPermissionsSearch();
  setupRolePermissionModalEvents();
  renderRolesPermissionsSettings();
  setupSettingsAccordions();
}

function setupRolesPermissionsSearch() {
  const input = document.getElementById('roleEmployeeSearch');
  const results = document.getElementById('roleEmployeeSearchResults');
  const roleSelect = document.getElementById('roleAssignmentSelect');
  if (!input || !results || !roleSelect || input.dataset.bound === 'true') return;
  input.dataset.bound = 'true';

  const renderResults = () => {
    const term = normalizeIdentityKey(input.value);
    results.innerHTML = '';
    if (!term) {
      results.classList.remove('visible');
      return;
    }
    const matches = employeesData
      .filter((employee) => {
        const normalized = normalizeEmployeeRecord(employee);
        const haystack = [
          employeeDisplayName(normalized),
          normalized.email,
          normalized.username,
          normalized.id,
          normalized.homePool,
        ].join(' ').toLowerCase();
        return haystack.includes(term);
      })
      .slice(0, 8);
    matches.forEach((employee) => {
      const normalized = normalizeEmployeeRecord(employee);
      const key = getEmployeeRoleKey(normalized);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'roles-search-option';
      button.textContent = `${employeeDisplayName(normalized)}${normalized.email ? ` - ${normalized.email}` : ''}`;
      button.addEventListener('click', async () => {
        const role = roleSelect.value || 'lifeguard';
        assignEmployeeToRole(key, role);
        await saveRolesPermissionsAndSyncEmployeeRole(key);
        renderRolesPermissionsSettings();
        input.value = '';
        results.innerHTML = '';
        results.classList.remove('visible');
      });
      results.appendChild(button);
    });
    results.classList.toggle('visible', matches.length > 0);
  };

  input.addEventListener('input', renderResults);
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.roles-search-field')) results.classList.remove('visible');
  });
}

function assignEmployeeToRole(memberKey, roleKey) {
  const normalizedMemberKey = normalizeIdentityKey(memberKey);
  const normalizedRoleKey = normalizeRoleKey(roleKey);
  if (!normalizedMemberKey || !normalizedRoleKey) return;
  if (!rolesPermissionsData.roles[normalizedRoleKey]) rolesPermissionsData.roles[normalizedRoleKey] = [];
  if (!rolesPermissionsData.roles[normalizedRoleKey].includes(normalizedMemberKey)) {
    rolesPermissionsData.roles[normalizedRoleKey].push(normalizedMemberKey);
  }
}

function removeEmployeeFromRole(memberKey, roleKey) {
  const normalizedMemberKey = normalizeIdentityKey(memberKey);
  const normalizedRoleKey = normalizeRoleKey(roleKey);
  if (!normalizedMemberKey || !normalizedRoleKey || !rolesPermissionsData.roles[normalizedRoleKey]) return;
  rolesPermissionsData.roles[normalizedRoleKey] = rolesPermissionsData.roles[normalizedRoleKey]
    .filter((existingKey) => normalizeIdentityKey(existingKey) !== normalizedMemberKey);
}

function syncEmployeeRoleFieldsForMember(memberKey) {
  const normalizedMemberKey = normalizeIdentityKey(memberKey);
  if (!normalizedMemberKey) return false;
  let changed = false;
  employeesData = employeesData.map((employee) => {
    const normalized = normalizeEmployeeRecord(employee);
    if (!getEmployeeIdentityKeys(normalized).includes(normalizedMemberKey)) return normalized;
    const nextRoles = getPermissionRoleKeysForEmployee(normalized);
    const next = normalizeEmployeeRecord({
      ...normalized,
      role: nextRoles[0] || '',
      roles: nextRoles,
    });
    const existingRoles = normalizeEmployeeRoleKeys(normalized).join('|');
    const syncedRoles = nextRoles.join('|');
    if (normalized.role !== next.role || existingRoles !== syncedRoles) changed = true;
    return next;
  });
  return changed;
}

async function syncLifeguardAccountRoleFieldsForMember(memberKey) {
  const normalizedMemberKey = normalizeIdentityKey(memberKey);
  if (!normalizedMemberKey || !Array.isArray(lifeguardAccountsData) || !lifeguardAccountsData.length) return false;
  let changed = false;
  const writes = [];

  lifeguardAccountsData = lifeguardAccountsData.map((account) => {
    const normalized = normalizeLifeguardAccountRecord(account, account.username || '');
    const matches = getLifeguardAccountIdentityKeys(normalized).includes(normalizedMemberKey);
    if (!matches) return normalized;

    const nextRoles = getPermissionRoleKeysForEmployee(normalized);
    const existingRoles = normalizeEmployeeRoleKeys(normalized).join('|');
    const syncedRoles = nextRoles.join('|');
    if (normalized.role !== (nextRoles[0] || '') || existingRoles !== syncedRoles) {
      changed = true;
      if (normalized.username) {
        writes.push(setDoc(doc(db, 'lifeguardAccounts', normalized.username), {
          role: nextRoles[0] || '',
          roles: nextRoles,
        }, { merge: true }));
      }
    }

    return normalizeLifeguardAccountRecord({
      ...normalized,
      role: nextRoles[0] || '',
      roles: nextRoles,
    }, normalized.username);
  });

  if (writes.length) await Promise.all(writes);
  return changed;
}

async function saveRolesPermissionsAndSyncEmployeeRole(memberKey) {
  await saveRolesPermissions();
  const employeeChanged = syncEmployeeRoleFieldsForMember(memberKey);
  const accountChanged = await syncLifeguardAccountRoleFieldsForMember(memberKey);
  if (employeeChanged) {
    await saveEmployees();
  }
  if (accountChanged) renderRolesPermissionsSettings();
  renderEmployeesTable();
  renderUnverifiedAccountsTable();
}

function getRoleDefaultPermission(roleKey, permissionKey) {
  return !!rolesPermissionsData.permissions?.[roleKey]?.[permissionKey];
}

function getIndividualPermissionOverride(memberKey, permissionKey) {
  const individual = rolesPermissionsData.individualPermissions?.[memberKey] || {};
  if (!Object.prototype.hasOwnProperty.call(individual, permissionKey)) return undefined;
  return !!individual[permissionKey];
}

function getPermissionStorageKeysForMember(memberKey) {
  const normalizedMemberKey = normalizeIdentityKey(memberKey);
  const keys = new Set([normalizedMemberKey]);
  const employee = findEmployeeByRoleKey(normalizedMemberKey);
  if (employee) getEmployeeIdentityKeys(employee).forEach((key) => keys.add(normalizeIdentityKey(key)));
  const account = lifeguardAccountsData.find((item) =>
    getLifeguardAccountIdentityKeys(normalizeLifeguardAccountRecord(item, item.username || '')).includes(normalizedMemberKey)
  );
  if (account) {
    getLifeguardAccountIdentityKeys(normalizeLifeguardAccountRecord(account, account.username || ''))
      .forEach((key) => keys.add(normalizeIdentityKey(key)));
  }
  return [...keys].filter(Boolean);
}

function getMergedIndividualPermissionOverride(memberKey, permissionKey) {
  const values = getPermissionStorageKeysForMember(memberKey)
    .map((key) => getIndividualPermissionOverride(key, permissionKey))
    .filter((value) => value !== undefined);
  if (values.includes(false)) return false;
  if (values.includes(true)) return true;
  return undefined;
}

function getMemberPermissionValue(roleKey, memberKey, permissionKey) {
  const override = getMergedIndividualPermissionOverride(memberKey, permissionKey);
  return override === undefined ? getRoleDefaultPermission(roleKey, permissionKey) : override;
}

function cleanupIndividualPermissionOverrides(memberKey) {
  const individual = rolesPermissionsData.individualPermissions?.[memberKey];
  if (!individual) return;
  PERMISSION_DEFINITIONS.forEach(({ key }) => {
    if (individual[key] === undefined) delete individual[key];
  });
  if (!Object.keys(individual).length) {
    delete rolesPermissionsData.individualPermissions[memberKey];
  }
}

function setupRolePermissionModalEvents() {
  const modal = document.getElementById('rolePermissionModal');
  if (!modal || modal.dataset.bound === 'true') return;
  modal.dataset.bound = 'true';
  const close = () => {
    modal.classList.remove('visible');
    modal.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => {
      if (!modal.classList.contains('visible')) {
        modal.classList.add('hidden');
      }
    }, 250);
  };
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });
  document.getElementById('rolePermissionModalClose')?.addEventListener('click', close);
}

function openRolePermissionModal(roleKey, memberKey) {
  const modal = document.getElementById('rolePermissionModal');
  const title = document.getElementById('rolePermissionModalTitle');
  const subtitle = document.getElementById('rolePermissionModalSubtitle');
  const checks = document.getElementById('rolePermissionModalChecks');
  const message = document.getElementById('rolePermissionModalMessage');
  const saveButton = document.getElementById('rolePermissionModalSave');
  if (!modal || !title || !subtitle || !checks) return;

  const employee = findEmployeeByRoleKey(memberKey);
  const roleLabel = ROLE_DEFINITIONS.find((role) => role.key === roleKey)?.label || 'Role';
  const displayName = employee ? employeeDisplayName(employee) : memberKey;
  title.textContent = `${displayName} Permissions`;
  subtitle.textContent = `Checked boxes inherit the ${roleLabel} defaults unless you change them here. Unchecking a default permission removes it for this person only.`;
  if (message) message.textContent = '';
  checks.innerHTML = '';
  const storageKeys = getPermissionStorageKeysForMember(memberKey);
  const draftOverrides = {};
  PERMISSION_DEFINITIONS.forEach(({ key }) => {
    const override = getMergedIndividualPermissionOverride(memberKey, key);
    if (override !== undefined) draftOverrides[key] = override;
  });

  PERMISSION_DEFINITIONS.forEach(({ key, label }) => {
    const roleDefault = getRoleDefaultPermission(roleKey, key);
    const override = Object.prototype.hasOwnProperty.call(draftOverrides, key) ? draftOverrides[key] : undefined;
    const row = document.createElement('label');
    row.className = 'roles-modal-check';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'market-filter-checkbox';
    checkbox.checked = override === undefined ? roleDefault : override;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked === roleDefault) {
        delete draftOverrides[key];
      } else {
        draftOverrides[key] = checkbox.checked;
      }
      if (message) message.textContent = 'Unsaved changes.';
    });

    const text = document.createElement('span');
    text.textContent = label;
    const inherited = document.createElement('small');
    inherited.textContent = roleDefault ? 'Role default: on' : 'Role default: off';
    row.appendChild(checkbox);
    row.appendChild(text);
    row.appendChild(inherited);
    checks.appendChild(row);
  });

  if (saveButton) {
    saveButton.disabled = false;
    saveButton.textContent = 'Save';
    saveButton.onclick = async () => {
      saveButton.disabled = true;
      saveButton.textContent = 'Saving...';
      try {
        storageKeys.forEach((identityKey) => {
          if (!identityKey) return;
          rolesPermissionsData.individualPermissions[identityKey] = { ...draftOverrides };
          cleanupIndividualPermissionOverrides(identityKey);
        });
        await saveRolesPermissionsAndSyncEmployeeRole(memberKey);
        if (message) message.textContent = 'Saved.';
      } catch (err) {
        console.error('[PoolPro] Unable to save individual permissions:', err);
        if (message) message.textContent = 'Unable to save. Try again.';
      } finally {
        saveButton.disabled = false;
        saveButton.textContent = 'Save';
      }
    };
  }

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => modal.classList.add('visible'));
}

function renderRoleMembers(roleKey, tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = '';
  const baseMembers = employeesData
    .filter((employee) => {
      const normalized = normalizeEmployeeRecord(employee);
      if (getPermissionRoleKeysForEmployee(normalized).length) return false;
      return normalizeEmployeeRoleKeys(normalized).includes(roleKey);
    })
    .map((employee) => getEmployeeRoleKey(employee))
    .filter(Boolean);
  const members = [...new Set(baseMembers.concat(rolesPermissionsData.roles[roleKey] || []))];
  const totalPages = Math.max(1, Math.ceil(members.length / ROLE_MEMBERS_PER_PAGE));
  if (!roleMemberPages[roleKey] || roleMemberPages[roleKey] > totalPages) roleMemberPages[roleKey] = totalPages;
  const pageStart = (roleMemberPages[roleKey] - 1) * ROLE_MEMBERS_PER_PAGE;
  const pageMembers = members.slice(pageStart, pageStart + ROLE_MEMBERS_PER_PAGE);
  if (!members.length) {
    tbody.innerHTML = '<tr><td colspan="4">No users assigned.</td></tr>';
    renderRolePagination(roleKey, tbody, totalPages);
    return;
  }
  pageMembers.forEach((memberKey) => {
    const employee = findEmployeeByRoleKey(memberKey);
    const displayName = employee ? employeeDisplayName(employee) : memberKey;
    const email = normalizeEmployeeRecord(employee || { email: memberKey }).email || memberKey;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(displayName)}</td>
      <td>${escapeHtml(email)}</td>
      <td class="roles-row-permissions"></td>
      <td class="actions-cell"></td>
    `;
    const permissionsCell = tr.querySelector('.roles-row-permissions');
    const permissionsButton = document.createElement('button');
    permissionsButton.type = 'button';
    permissionsButton.className = 'submit-btn roles-permissions-btn';
    permissionsButton.textContent = 'Permissions';
    permissionsButton.addEventListener('click', () => openRolePermissionModal(roleKey, memberKey));
    permissionsCell.appendChild(permissionsButton);
    const summary = document.createElement('div');
    summary.className = 'roles-permission-summary';
    PERMISSION_DEFINITIONS.forEach(({ key, label }) => {
      const status = document.createElement('span');
      const value = getMemberPermissionValue(roleKey, memberKey, key);
      status.className = `roles-permission-pill ${value ? 'enabled' : 'disabled'}`;
      status.textContent = `${label}: ${value ? 'On' : 'Off'}`;
      summary.appendChild(status);
    });
    permissionsCell.appendChild(summary);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'submit-btn roles-remove-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', async () => {
      removeEmployeeFromRole(memberKey, roleKey);
      await saveRolesPermissionsAndSyncEmployeeRole(memberKey);
      renderRolesPermissionsSettings();
    });
    tr.querySelector('.actions-cell').appendChild(removeBtn);
    tbody.appendChild(tr);
  });
  renderRolePagination(roleKey, tbody, totalPages);
}

function renderRolePagination(roleKey, tbody, totalPages) {
  const tableWrap = tbody?.closest('.table-scroll-wrap');
  if (!tableWrap) return;
  const insertAfter = tableWrap.parentElement?.classList.contains('table-scroll-shell')
    ? tableWrap.parentElement
    : tableWrap;
  insertAfter.parentElement?.querySelector(`[data-role-pagination="${roleKey}"]`)?.remove();
  if (totalPages <= 1) return;

  const container = document.createElement('div');
  container.className = 'emp-pagination-row roles-pagination-row';
  container.dataset.rolePagination = roleKey;

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'emp-pagination-arrow';
  backBtn.textContent = '←';
  if (roleMemberPages[roleKey] > 1) {
    backBtn.addEventListener('click', () => {
      roleMemberPages[roleKey] -= 1;
      renderRolesPermissionsSettings();
    });
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
    if (page === roleMemberPages[roleKey]) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    roleMemberPages[roleKey] = Number(select.value) || 1;
    renderRolesPermissionsSettings();
  });
  container.appendChild(select);

  const fwdBtn = document.createElement('button');
  fwdBtn.type = 'button';
  fwdBtn.className = 'emp-pagination-arrow';
  fwdBtn.textContent = '→';
  if (roleMemberPages[roleKey] < totalPages) {
    fwdBtn.addEventListener('click', () => {
      roleMemberPages[roleKey] += 1;
      renderRolesPermissionsSettings();
    });
  } else {
    fwdBtn.style.visibility = 'hidden';
    fwdBtn.disabled = true;
  }
  container.appendChild(fwdBtn);

  insertAfter.insertAdjacentElement('afterend', container);
}

function renderRolePermissionsTable() {
  const tbody = document.getElementById('rolePermissionsBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  ROLE_DEFINITIONS.forEach(({ key: roleKey, label }) => {
    const tr = document.createElement('tr');
    const roleTd = document.createElement('td');
    roleTd.textContent = label;
    tr.appendChild(roleTd);
    PERMISSION_DEFINITIONS.forEach(({ key: permissionKey }) => {
      const td = document.createElement('td');
      td.style.textAlign = 'center';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'market-filter-checkbox';
      checkbox.checked = !!rolesPermissionsData.permissions[roleKey]?.[permissionKey];
      checkbox.addEventListener('change', async () => {
        if (!rolesPermissionsData.permissions[roleKey]) rolesPermissionsData.permissions[roleKey] = {};
        rolesPermissionsData.permissions[roleKey][permissionKey] = checkbox.checked;
        await saveRolesPermissions();
      });
      td.appendChild(checkbox);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function renderRolesPermissionsSettings() {
  const section = document.getElementById('rolesPermissionsSettings');
  if (!section) return;
  const canManageRoles = isSupervisor() || isDeveloperUser();
  section.style.display = canManageRoles ? '' : 'none';
  if (!canManageRoles) return;
  renderRoleMembers('lifeguard', 'lifeguardRoleBody');
  renderRoleMembers('attendant', 'attendantRoleBody');
  renderRoleMembers('poolManager', 'poolManagerRoleBody');
  renderRoleMembers('supervisor', 'supervisorRoleBody');
  renderRolePermissionsTable();
  wrapResponsiveTables(section);
  section.querySelectorAll('.table-scroll-wrap').forEach(updateTableScrollShadow);
}

// ============================================================
// RESOURCES
// ============================================================

let resourcesData = [];
let resourceEditingId = '';
let resourceTableEditable = false;
let pendingResourceFile = null;
let resourceSourceType = 'file';
let resourcePageMarketFilter = 'all';
let resourcePagePoolFilter = 'all';
let resourceSettingsMarketFilter = 'all';
let resourceSettingsPoolFilter = 'all';
const resourceDataUrlMap = new Map();
const dutyPhotoDataUrlMap = new Map();
const chemControllerPhotoDataUrlMap = new Map();
const desInspectionPhotoDataUrlMap = new Map();
const RESOURCE_FILTER_ALL_VALUE = 'all';
const RESOURCE_ALL_FACILITIES_VALUE = 'All';
const RESOURCE_TYPE_FILE = 'file';
const RESOURCE_TYPE_LINK = 'link';
const RESOURCE_TYPE_ESIGN_PDF = 'esign-pdf';
const FIRESTORE_RESOURCE_STORAGE = 'firestoreChunks';
const FIRESTORE_DUTY_PHOTO_STORAGE = 'firestoreDutyPhoto';
const FIRESTORE_DES_PRE_INSPECTION_PHOTO_STORAGE = 'firestoreDesPreInspectionPhoto';
const EMPTY_INLINE_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=';
const RESOURCE_FIRESTORE_CHUNK_SIZE = 650000;
const RESOURCE_FIRESTORE_MAX_FILE_SIZE = 20 * 1024 * 1024;
const RESOURCE_STORAGE_UPLOAD_TIMEOUT_MS = 12000;
const RESOURCE_STORAGE_URL_TIMEOUT_MS = 10000;
const RESOURCE_STORAGE_BLOCKED_SESSION_KEY = 'poolproResourceStorageBlocked';
const PDFJS_VERSION = '3.11.174';
const PDFJS_SCRIPT_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
const PDFJS_WORKER_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;
let resourcePdfJsPromise = null;
let resourceESignRenderToken = 0;
let currentResourceESignObjectUrl = '';

function getResourceStorage() {
  return getStorage(getApp());
}

function ensureResourcesSettingsSection() {
  if (document.getElementById('resourceSettings')) return;
  const employeeSettings = document.getElementById('employeeSettings');
  if (!employeeSettings) return;

  const section = document.createElement('section');
  section.className = 'settings-section settings-group';
  section.id = 'resourceSettings';
  section.innerHTML = `
    <h3>Resources</h3>
    <div class="resource-section-header">
      <button type="button" id="resourceDeleteAllBtn" class="submit-btn danger-button resource-delete-all-btn">Delete All Resources</button>
    </div>
    <p class="section-subtitle">Upload and manage the documents, videos, and website links available on the Resources page.</p>
    <div class="settings-row resource-type-row" style="margin-top: 20px;">
      <label for="resourceSourceTypeSelect" class="settings-field-label">Resource Type</label>
      <select id="resourceSourceTypeSelect" class="training-filter-select" aria-label="Resource type">
        <option value="file">File Upload</option>
        <option value="esign-pdf">E-Sign PDF</option>
        <option value="link">Website Link</option>
      </select>
    </div>
    <div class="settings-row resource-file-row" style="margin-top: 20px;">
      <label for="resourceFileInput" class="settings-field-label" id="resourceFileLabel">Resource File</label>
      <input type="file" id="resourceFileInput" aria-label="Resource file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.ppt,.pptx,.jpg,.jpeg,.png,.mp4,.mov,.webm,.avi,.mkv,.m4v" />
      <input type="url" id="resourceLinkInput" class="resource-link-input hidden" aria-label="Resource link" placeholder="https://example.com/resource" />
    </div>
    <div class="settings-row resource-add-row">
      <div class="settings-field">
        <label for="resourceDocumentNameInput">Document Name</label>
        <input type="text" id="resourceDocumentNameInput" />
      </div>
      <div class="settings-field">
        <label for="resourceDescriptionInput">Description</label>
        <input type="text" id="resourceDescriptionInput" />
      </div>
      <div class="settings-field">
        <label for="resourcePoolInput">Facility</label>
        <select id="resourcePoolInput">
          <option value="">Select facility</option>
        </select>
      </div>
    </div>
    <div class="employee-add-btn-row">
      <button type="button" class="submit-btn button-shadow employee-action-btn" id="resourceAddBtn">Add</button>
      <button type="button" class="submit-btn button-shadow employee-action-btn hidden" id="resourceDeleteBtn">Delete</button>
    </div>
    <div class="training-filter-bar employee-filter-bar" id="resourceFilterBar" style="margin: 20px 0 4px;">
      <span class="filter-by-label">Filter By:</span>
      <select id="resourceMarketFilter" class="training-filter-select" aria-label="Filter resources by market">
        <option value="all">All Markets</option>
      </select>
      <select id="resourcePoolFilter" class="training-filter-select" aria-label="Filter resources by facility">
        <option value="all">All</option>
      </select>
    </div>
    <div id="resourceTableSection" class="sanitation-section overlay-disabled resource-table-section">
      <div class="table-scroll-shell resource-table-scroll-shell">
        <div class="table-scroll-wrap resource-table-scroll-wrap">
          <table class="employee-table resource-table resource-table-admin">
            <thead>
              <tr>
                <th>Document Name</th>
                <th>Upload Date</th>
                <th>Description</th>
                <th>Market</th>
                <th>Facility</th>
              </tr>
            </thead>
            <tbody id="resourceTableBody"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;
  employeeSettings.insertAdjacentElement('afterend', section);
  wrapResponsiveTables(section);
}

function ensureResourceSettingsUi() {
  const tableSection = document.getElementById('resourceTableSection');
  if (!tableSection) return;

  if (!document.getElementById('resourceControls')) {
    const controlsRow = document.createElement('div');
    controlsRow.className = 'toggle-btn employee-toggle-row';
    controlsRow.innerHTML = `
      <div id="resourceControls" class="sanitation-controls">
        <div class="sanitation-controls-thumb"></div>
        <button type="button" class="editAndSave" id="resourceEditBtn">Edit</button>
        <button type="button" class="editAndSave active" id="resourceSaveBtn" disabled>Save</button>
      </div>
    `;
    tableSection.parentElement?.insertBefore(controlsRow, tableSection);
  }

  const table = tableSection.querySelector('.resource-table');
  if (table && !table.closest('.table-scroll-wrap')) {
    const shell = document.createElement('div');
    shell.className = 'table-scroll-shell resource-table-scroll-shell';
    const wrap = document.createElement('div');
    wrap.className = 'table-scroll-wrap resource-table-scroll-wrap';
    wrap.style.setProperty('--table-min-width', '980px');
    tableSection.insertBefore(shell, table);
    shell.appendChild(wrap);
    wrap.appendChild(table);
  }

  const headerRow = tableSection.querySelector('.resource-table thead tr');
  while (headerRow && headerRow.children.length > 5) {
    headerRow.lastElementChild?.remove();
  }
}

function populateResourceForm(item) {
  const normalized = normalizeResourceRecord(item || {});
  resourceEditingId = normalized.id || '';
  pendingResourceFile = null;
  setResourceSourceType(isResourceESignPdf(normalized)
    ? RESOURCE_TYPE_ESIGN_PDF
    : normalized.resourceType === RESOURCE_TYPE_LINK
      ? RESOURCE_TYPE_LINK
      : RESOURCE_TYPE_FILE);
  const fileInput = document.getElementById('resourceFileInput');
  if (fileInput) fileInput.value = '';
  const linkInput = document.getElementById('resourceLinkInput');
  if (linkInput) linkInput.value = normalized.resourceType === RESOURCE_TYPE_LINK ? (normalized.fileUrl || '') : '';
  const nameInput = document.getElementById('resourceDocumentNameInput');
  const descriptionInput = document.getElementById('resourceDescriptionInput');
  const poolInput = document.getElementById('resourcePoolInput');
  if (nameInput) nameInput.value = normalized.documentName || '';
  if (descriptionInput) descriptionInput.value = normalized.description || '';
  populateResourcePoolOptions(poolInput, 'all', false);
  if (poolInput) poolInput.value = normalized.pool || '';
}

function syncResourceActionButtons() {
  ensureResourceSettingsUi();
  const addBtn = document.getElementById('resourceAddBtn');
  const deleteBtn = document.getElementById('resourceDeleteBtn');
  const hasSelectedRow = resourceTableEditable && !!resourceEditingId && resourcesData.some((item) => item.id === resourceEditingId);

  if (addBtn) addBtn.textContent = hasSelectedRow ? 'Save' : 'Add';
  if (deleteBtn) deleteBtn.classList.toggle('hidden', !hasSelectedRow);
}

function selectResourceRow(resourceId) {
  if (!resourceTableEditable || !resourceId) return;
  const resource = resourcesData.find((item) => item.id === resourceId);
  if (!resource) return;
  populateResourceForm(resource);
  syncResourceActionButtons();
  renderResourcesSettingsTable();
}

function setResourceTableEditable(editable) {
  ensureResourceSettingsUi();
  resourceTableEditable = !!editable;
  const editBtn = document.getElementById('resourceEditBtn');
  const saveBtn = document.getElementById('resourceSaveBtn');
  const controls = document.getElementById('resourceControls');
  const section = document.getElementById('resourceTableSection');

  if (section) section.classList.toggle('overlay-disabled', !resourceTableEditable);
  if (editBtn) {
    editBtn.classList.toggle('active', resourceTableEditable);
    editBtn.disabled = resourceTableEditable;
  }
  if (saveBtn) {
    saveBtn.classList.toggle('active', !resourceTableEditable);
    saveBtn.disabled = !resourceTableEditable;
  }
  setSegmentedToggleThumb(controls, resourceTableEditable ? 'edit' : 'save');

  if (!resourceTableEditable) {
    resourceEditingId = '';
    clearResourceForm();
  }

  syncResourceActionButtons();
  renderResourcesSettingsTable();
}

function setupResourceOverlay() {
  ensureResourceSettingsUi();
  const editBtn = document.getElementById('resourceEditBtn');
  const saveBtn = document.getElementById('resourceSaveBtn');
  if (!editBtn || !saveBtn) return;
  if (!editBtn.dataset.bound) {
    editBtn.dataset.bound = 'true';
    editBtn.addEventListener('click', () => setResourceTableEditable(true));
  }
  if (!saveBtn.dataset.bound) {
    saveBtn.dataset.bound = 'true';
    saveBtn.addEventListener('click', () => setResourceTableEditable(false));
  }
  if (!resourceTableEditable) {
    document.getElementById('resourceTableSection')?.classList.add('overlay-disabled');
  }
  setResourceTableEditable(resourceTableEditable);
}

function getPoolMarket(poolName) {
  if (isResourceAllFacilities(poolName)) return RESOURCE_ALL_FACILITIES_VALUE;
  const match = poolsCache.find((pool) => getPoolName(pool) === poolName);
  if (!match) return '';
  const markets = Array.isArray(match.markets) ? match.markets : (match.market ? [match.market] : []);
  return markets[0] || '';
}

function getResourceMarket(item) {
  if (isResourceAllFacilities(item?.pool)) return RESOURCE_ALL_FACILITIES_VALUE;
  return (item?.market || getPoolMarket(item?.pool || '') || '').toString().trim();
}

function isResourceAllFacilities(value) {
  const normalized = (value || '').toString().trim().toLowerCase();
  return normalized === 'all' || normalized === 'all facilities';
}

function normalizeResourcePoolValue(value) {
  const trimmed = (value || '').toString().trim();
  return isResourceAllFacilities(trimmed) ? RESOURCE_ALL_FACILITIES_VALUE : trimmed;
}

function isResourceESignPdf(item = {}) {
  return (item?.resourceType || item?.type || '').toString().trim() === RESOURCE_TYPE_ESIGN_PDF;
}

function isPdfResourceFile(fileLike = {}) {
  const type = (fileLike?.type || fileLike?.contentType || '').toString().toLowerCase();
  const name = (fileLike?.name || fileLike?.fileName || '').toString().toLowerCase();
  return type === 'application/pdf' || name.endsWith('.pdf');
}

function getAllMarkets() {
  return Array.from(new Set(
    poolsCache
      .flatMap((pool) => {
        const markets = Array.isArray(pool.markets) ? pool.markets : (pool.market ? [pool.market] : []);
        return markets.length ? markets : ['Other'];
      })
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b));
}

function normalizeResourceRecord(rawDoc, idOverride = '') {
  const docData = rawDoc || {};
  const uploadDate = (docData.uploadDate || '').toString().trim();
  const parsedDate = uploadDate ? new Date(`${uploadDate}T00:00:00`) : null;
  const fallbackDate = docData.uploadedAt?.toDate ? docData.uploadedAt.toDate() : null;
  const sortDate = Number.isFinite(docData.sortDate)
    ? docData.sortDate
    : parsedDate && !Number.isNaN(parsedDate.getTime())
      ? parsedDate.getTime()
      : fallbackDate
        ? fallbackDate.getTime()
        : 0;

  return {
    id: idOverride || docData.id || '',
    documentName: (docData.documentName || '').toString().trim(),
    uploadDate,
    description: (docData.description || '').toString().trim(),
    market: (docData.market || '').toString().trim(),
    pool: normalizeResourcePoolValue(docData.pool),
    fileUrl: (docData.fileUrl || '').toString().trim(),
    fileName: (docData.fileName || '').toString().trim(),
    storagePath: (docData.storagePath || '').toString().trim(),
    storageType: (docData.storageType || '').toString().trim(),
    contentType: (docData.contentType || '').toString().trim(),
    fileSize: Number(docData.fileSize || 0),
    chunkCount: Number(docData.chunkCount || 0),
    dataUrlPrefix: (docData.dataUrlPrefix || '').toString().trim(),
    resourceType: (docData.resourceType || docData.type || '').toString().trim() || 'file',
    sortDate,
    uploadedAt: docData.uploadedAt || null,
  };
}

function sortResourcesDescending(a, b) {
  if (b.sortDate !== a.sortDate) return b.sortDate - a.sortDate;
  return (a.documentName || '').localeCompare(b.documentName || '');
}

function formatResourceDate(uploadDate, uploadedAt) {
  if (uploadDate) {
    const parsed = new Date(`${uploadDate}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleDateString();
  }
  const fallback = uploadedAt?.toDate ? uploadedAt.toDate() : null;
  return fallback ? fallback.toLocaleDateString() : '—';
}

function getFilteredResources({ market = 'all', pool = 'all' } = {}) {
  return resourcesData
    .filter((item) => (market === RESOURCE_FILTER_ALL_VALUE ? true : getResourceMarket(item) === market || isResourceAllFacilities(item.pool)))
    .filter((item) => (pool === RESOURCE_FILTER_ALL_VALUE ? true : item.pool === pool || isResourceAllFacilities(item.pool)))
    .sort(sortResourcesDescending);
}

function populateResourcePoolOptions(selectEl, market = 'all', includeAll = false) {
  if (!selectEl) return;
  const current = selectEl.value;
  const defaultValue = includeAll ? RESOURCE_FILTER_ALL_VALUE : '';
  const defaultLabel = includeAll ? 'All' : 'Select facility';
  selectEl.innerHTML = `<option value="${defaultValue}">${defaultLabel}</option>`;

  if (!includeAll) {
    const allOption = document.createElement('option');
    allOption.value = RESOURCE_ALL_FACILITIES_VALUE;
    allOption.textContent = RESOURCE_ALL_FACILITIES_VALUE;
    selectEl.appendChild(allOption);
  }

  const pools = (market === 'all' || !market)
    ? [...poolsCache]
    : poolsCache.filter((pool) => {
      const markets = Array.isArray(pool.markets) ? pool.markets : (pool.market ? [pool.market] : []);
      return markets.includes(market);
    });

  const groups = {};
  pools.forEach((pool) => {
    const poolName = getPoolName(pool);
    if (!poolName) return;
    const markets = Array.isArray(pool.markets) ? pool.markets : (pool.market ? [pool.market] : []);
    const groupName = markets[0] || 'Other';
    if (!groups[groupName]) groups[groupName] = [];
    groups[groupName].push(poolName);
  });

  Object.keys(groups).sort((a, b) => a.localeCompare(b)).forEach((marketName) => {
    const group = document.createElement('optgroup');
    group.label = marketName;
    groups[marketName]
      .sort((a, b) => a.localeCompare(b))
      .forEach((poolName) => {
        const option = document.createElement('option');
        option.value = poolName;
        option.textContent = poolName;
        group.appendChild(option);
      });
    selectEl.appendChild(group);
  });

  if (current && Array.from(selectEl.options).some((option) => option.value === current)) {
    selectEl.value = current;
  }
}

function populateResourceMarketOptions(selectEl, includeAll = false) {
  if (!selectEl) return;
  const current = selectEl.value;
  const label = includeAll ? 'All Markets' : 'Select market';
  selectEl.innerHTML = `<option value="${includeAll ? 'all' : ''}">${label}</option>`;
  getAllMarkets().forEach((market) => {
    const option = document.createElement('option');
    option.value = market;
    option.textContent = market;
    selectEl.appendChild(option);
  });
  if (current && Array.from(selectEl.options).some((option) => option.value === current)) {
    selectEl.value = current;
  }
}

function refreshResourceControls() {
  populateResourceMarketOptions(document.getElementById('resourceMarketFilter'), true);
  populateResourceMarketOptions(document.getElementById('resourcesMarketFilter'), true);

  populateResourcePoolOptions(document.getElementById('resourcePoolInput'), 'all', false);
  populateResourcePoolOptions(document.getElementById('resourcePoolFilter'), document.getElementById('resourceMarketFilter')?.value || 'all', true);
  populateResourcePoolOptions(document.getElementById('resourcesPoolFilter'), document.getElementById('resourcesMarketFilter')?.value || 'all', true);
}

function normalizeResourceLink(rawValue) {
  const value = (rawValue || '').trim();
  if (!value) return '';
  try {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(withProtocol);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch (_) {
    return '';
  }
}

function setResourceSourceType(type) {
  resourceSourceType = type === RESOURCE_TYPE_LINK
    ? RESOURCE_TYPE_LINK
    : type === RESOURCE_TYPE_ESIGN_PDF
      ? RESOURCE_TYPE_ESIGN_PDF
      : RESOURCE_TYPE_FILE;
  const sourceSelect = document.getElementById('resourceSourceTypeSelect');
  const fileInput = document.getElementById('resourceFileInput');
  const linkInput = document.getElementById('resourceLinkInput');
  const fileLabel = document.getElementById('resourceFileLabel');

  if (sourceSelect) sourceSelect.value = resourceSourceType;
  if (fileLabel) {
    fileLabel.textContent = resourceSourceType === RESOURCE_TYPE_LINK
      ? 'Resource Link'
      : resourceSourceType === RESOURCE_TYPE_ESIGN_PDF
        ? 'E-Sign PDF'
        : 'Resource File';
  }
  if (fileInput) {
    fileInput.classList.toggle('hidden', resourceSourceType === RESOURCE_TYPE_LINK);
    fileInput.accept = resourceSourceType === RESOURCE_TYPE_ESIGN_PDF
      ? '.pdf,application/pdf'
      : '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.ppt,.pptx,.jpg,.jpeg,.png,.mp4,.mov,.webm,.avi,.mkv,.m4v';
  }
  linkInput?.classList.toggle('hidden', resourceSourceType !== RESOURCE_TYPE_LINK);
  if (resourceSourceType === RESOURCE_TYPE_LINK) {
    pendingResourceFile = null;
    if (fileInput) fileInput.value = '';
  } else if (linkInput) {
    linkInput.value = '';
  }
}

function isVideoUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.startsWith('data:video/')) return true;
  return /\.(mp4|mov|webm|avi|mkv|m4v)(\?|$)/i.test(lower);
}

function buildResourceRowCells(item, includeActions = false) {
  const nameText = item.documentName || item.fileName || 'Untitled document';
  let nameHtml;
  if (item.fileUrl) {
    if (isResourceESignPdf(item)) {
      resourceDataUrlMap.set(item.id, item.fileUrl);
      nameHtml = `<a href="#" class="resource-doc-link resource-esign-link" data-resource-key="${item.id}" rel="noopener">${nameText}</a>`;
    } else if (item.fileUrl.startsWith('data:')) {
      resourceDataUrlMap.set(item.id, item.fileUrl);
      nameHtml = `<a href="#" class="resource-doc-link" data-resource-key="${item.id}" rel="noopener">${nameText}</a>`;
    } else if (item.storageType === FIRESTORE_RESOURCE_STORAGE || item.fileUrl.startsWith(`${FIRESTORE_RESOURCE_STORAGE}:`)) {
      resourceDataUrlMap.set(item.id, item.fileUrl);
      nameHtml = `<a href="#" class="resource-doc-link" data-resource-key="${item.id}" rel="noopener">${nameText}</a>`;
    } else {
      nameHtml = `<a href="${item.fileUrl}" target="_blank" rel="noopener">${nameText}</a>`;
    }
  } else {
    nameHtml = nameText;
  }

  if (!includeActions) {
    return `
      <td>${nameHtml}</td>
      <td>${item.pool || '—'}</td>
      <td>${item.description || '—'}</td>
      <td>${formatResourceDate(item.uploadDate, item.uploadedAt)}</td>
    `;
  }

  return `
    <td>${nameHtml}</td>
    <td>${formatResourceDate(item.uploadDate, item.uploadedAt)}</td>
    <td>${item.description || '—'}</td>
    <td>${getResourceMarket(item) || '—'}</td>
    <td>${item.pool || '—'}</td>
  `;
}

function renderResourcesPageTable() {
  const tbody = document.getElementById('resourcesTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const rows = getFilteredResources({
    market: resourcePageMarketFilter,
    pool: resourcePagePoolFilter,
  });

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;font-style:italic;">No resources found.</td></tr>';
    return;
  }

  rows.forEach((item) => {
    const tr = document.createElement('tr');
    tr.innerHTML = buildResourceRowCells(item, false);
    tbody.appendChild(tr);
  });
}

function renderResourcesSettingsTable() {
  const tbody = document.getElementById('resourceTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const rows = getFilteredResources({
    market: resourceSettingsMarketFilter,
    pool: resourceSettingsPoolFilter,
  });

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;font-style:italic;">No resources found.</td></tr>';
    const wrapper = tbody.closest('.table-scroll-wrap');
    if (wrapper) requestAnimationFrame(() => updateTableScrollShadow(wrapper));
    syncResourceActionButtons();
    return;
  }

  rows.forEach((item) => {
    const tr = document.createElement('tr');
    tr.dataset.resourceId = item.id;
    if (resourceTableEditable) tr.classList.add('resource-row-clickable');
    if (resourceTableEditable && item.id === resourceEditingId) {
      tr.classList.add('resource-row-selected');
    }
    tr.innerHTML = buildResourceRowCells(item, true);
    tr.addEventListener('click', () => selectResourceRow(item.id));
    tbody.appendChild(tr);
  });

  const wrapper = tbody.closest('.table-scroll-wrap');
  if (wrapper) requestAnimationFrame(() => updateTableScrollShadow(wrapper));
  syncResourceActionButtons();
}

function clearResourceForm() {
  resourceEditingId = '';
  pendingResourceFile = null;
  const ids = ['resourceDocumentNameInput', 'resourceDescriptionInput'];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const fileInput = document.getElementById('resourceFileInput');
  if (fileInput) fileInput.value = '';
  const linkInput = document.getElementById('resourceLinkInput');
  if (linkInput) linkInput.value = '';
  setResourceSourceType('file');
  const poolInput = document.getElementById('resourcePoolInput');
  if (poolInput) poolInput.value = '';
  const actionBtn = document.getElementById('resourceAddBtn');
  if (actionBtn) actionBtn.textContent = 'Add';
  syncResourceActionButtons();
}

function timeoutAfter(ms, label) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
}

function openResourceDataUrl(dataUrl) {
  if (!dataUrl || !dataUrl.startsWith('data:')) throw new Error('Invalid resource data.');
  const blob = dataUrlToBlob(dataUrl);
  const blobUrl = URL.createObjectURL(blob);
  const win = window.open(blobUrl, '_blank');
  if (!win) URL.revokeObjectURL(blobUrl);
  else setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
}

function dataUrlToBlob(dataUrl) {
  const [header = '', b64 = ''] = String(dataUrl || '').split(',');
  const mime = header.split(':')[1]?.split(';')[0] || 'application/octet-stream';
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

async function getResourceBlob(resource, resolvedUrl) {
  const url = resolvedUrl || resource?.fileUrl || '';
  if (!url) throw new Error('Resource file was not found.');
  if (url.startsWith('data:')) return dataUrlToBlob(url);
  const response = await fetch(url);
  if (!response.ok) throw new Error('Resource file could not be downloaded.');
  return response.blob();
}

function loadResourcePdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (resourcePdfJsPromise) return resourcePdfJsPromise;

  resourcePdfJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PDFJS_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (!window.pdfjsLib) {
        reject(new Error('PDF viewer could not be initialized.'));
        return;
      }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error('PDF viewer could not be loaded.'));
    document.head.appendChild(script);
  });

  return resourcePdfJsPromise;
}

function getResourceESignModal() {
  let modal = document.getElementById('resourceESignModal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'resourceESignModal';
  modal.className = 'resource-esign-modal';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div class="resource-esign-dialog" role="dialog" aria-modal="true" aria-labelledby="resourceESignTitle">
      <div class="resource-esign-header">
        <div>
          <h2 id="resourceESignTitle">E-Sign PDF</h2>
          <p id="resourceESignSubtitle">Review the full document before signing.</p>
        </div>
        <button type="button" class="resource-esign-close" aria-label="Close">&times;</button>
      </div>
      <div class="resource-esign-body">
        <div class="resource-esign-pdf-scroll" id="resourceESignPdfScroll">
          <div class="resource-esign-pages" id="resourceESignPages"></div>
        </div>
        <form class="resource-esign-actions" id="resourceESignForm">
          <div class="resource-esign-field">
            <label for="resourceESignSignatureInput">Type your name as it appears on your account</label>
            <input id="resourceESignSignatureInput" type="text" autocomplete="name" />
            <div class="resource-esign-hint" id="resourceESignSignatureHint"></div>
          </div>
          <label class="resource-esign-checkbox">
            <input id="resourceESignCheckbox" type="checkbox" disabled />
            <span>I understand this policy.</span>
          </label>
          <div class="resource-esign-gate" id="resourceESignGateMessage">Scroll until the top of the last page is visible to enable acknowledgment.</div>
          <div class="resource-esign-button-row">
            <button type="button" class="agreement-btn" id="resourceESignDownloadBtn" disabled>Download PDF</button>
            <button type="button" class="agreement-btn" id="resourceESignCancelBtn">Cancel</button>
            <button type="submit" class="agreement-btn primary" id="resourceESignSubmitBtn" disabled>Sign Document</button>
          </div>
          <div class="resource-esign-message" id="resourceESignMessage" aria-live="polite"></div>
        </form>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeResourceESignModal();
  });
  modal.querySelector('.resource-esign-close')?.addEventListener('click', closeResourceESignModal);
  modal.querySelector('#resourceESignCancelBtn')?.addEventListener('click', closeResourceESignModal);
  modal.querySelector('#resourceESignForm')?.addEventListener('submit', handleResourceESignSubmit);
  modal.querySelector('#resourceESignSignatureInput')?.addEventListener('input', () => syncResourceESignSubmitState(modal));
  modal.querySelector('#resourceESignCheckbox')?.addEventListener('change', () => syncResourceESignSubmitState(modal));
  modal.querySelector('#resourceESignPdfScroll')?.addEventListener('scroll', () => requestAnimationFrame(() => updateResourceESignScrollGate(modal)));
  modal.querySelector('#resourceESignDownloadBtn')?.addEventListener('click', () => downloadCurrentResourceESignPdf());

  return modal;
}

function setResourceESignMessage(modal, text, isError = false) {
  const message = modal?.querySelector('#resourceESignMessage');
  if (!message) return;
  message.textContent = text || '';
  message.classList.toggle('success', !!text && !isError);
}

function getResourceESignContext() {
  const record = typeof window.getCurrentEmployeeRecord === 'function'
    ? window.getCurrentEmployeeRecord()
    : null;
  const normalized = normalizeEmployeeRecord(record || {});
  const agreementContext = getCurrentAgreementContext();
  const recordName = [normalized.firstName, normalized.lastName].filter(Boolean).join(' ').trim();
  const agreementName = !String(agreementContext?.displayName || '').includes('@')
    ? String(agreementContext?.displayName || '').trim()
    : '';
  const displayName = recordName || agreementName;
  const email = normalized.email || agreementContext?.email || auth.currentUser?.email || '';
  const username = normalized.username || agreementContext?.username || '';
  const employeeId = normalized.employeeId || normalized.id || agreementContext?.employeeId || email || username || '';

  return {
    firstName: normalized.firstName || agreementContext?.firstName || '',
    lastName: normalized.lastName || agreementContext?.lastName || '',
    displayName,
    email,
    username,
    employeeId,
    role: agreementContext?.role || '',
  };
}

function normalizeESignText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function getResourceESignSignatureId(context) {
  const raw = context.email || context.username || context.employeeId || 'unknown-user';
  return String(raw).trim().toLowerCase()
    .replace(/[\/\\#?[\]]/g, '_')
    .replace(/[^a-z0-9._@-]/g, '_')
    .slice(0, 140) || 'unknown-user';
}

function resetResourceESignModal(modal, resource) {
  const title = modal.querySelector('#resourceESignTitle');
  const subtitle = modal.querySelector('#resourceESignSubtitle');
  const pages = modal.querySelector('#resourceESignPages');
  const scroll = modal.querySelector('#resourceESignPdfScroll');
  const checkbox = modal.querySelector('#resourceESignCheckbox');
  const signatureInput = modal.querySelector('#resourceESignSignatureInput');
  const signatureHint = modal.querySelector('#resourceESignSignatureHint');
  const gate = modal.querySelector('#resourceESignGateMessage');
  const downloadBtn = modal.querySelector('#resourceESignDownloadBtn');
  const submitBtn = modal.querySelector('#resourceESignSubmitBtn');
  const context = getResourceESignContext();

  modal.dataset.resourceId = resource?.id || '';
  modal.dataset.scrollUnlocked = 'false';
  if (title) title.textContent = resource?.documentName || resource?.fileName || 'E-Sign PDF';
  if (subtitle) subtitle.textContent = 'Review the full document before signing.';
  if (pages) pages.innerHTML = '<div class="resource-esign-loading">Loading PDF...</div>';
  if (scroll) scroll.scrollTop = 0;
  if (checkbox) {
    checkbox.checked = false;
    checkbox.disabled = true;
  }
  if (signatureInput) signatureInput.value = '';
  if (signatureHint) {
    signatureHint.textContent = context.displayName
      ? `Signature must match the name on your account: ${context.displayName}`
      : 'Use your full account name as your electronic signature.';
  }
  if (gate) {
    gate.textContent = 'Scroll until the top of the last page is visible to enable acknowledgment.';
    gate.classList.remove('ready');
  }
  if (downloadBtn) downloadBtn.disabled = true;
  if (submitBtn) submitBtn.disabled = true;
  setResourceESignMessage(modal, '');
}

function syncResourceESignSubmitState(modal) {
  const checkbox = modal?.querySelector('#resourceESignCheckbox');
  const signatureInput = modal?.querySelector('#resourceESignSignatureInput');
  const submitBtn = modal?.querySelector('#resourceESignSubmitBtn');
  if (!submitBtn || !checkbox || !signatureInput) return;
  submitBtn.disabled = !(modal.dataset.scrollUnlocked === 'true' && checkbox.checked && signatureInput.value.trim());
}

function updateResourceESignScrollGate(modal) {
  if (!modal || modal.dataset.scrollUnlocked === 'true') return;
  const scroll = modal.querySelector('#resourceESignPdfScroll');
  const lastPage = modal.querySelector('.resource-esign-page[data-last-page="true"]');
  if (!scroll || !lastPage) return;
  const scrollRect = scroll.getBoundingClientRect();
  const lastRect = lastPage.getBoundingClientRect();
  const topBorderVisible = lastRect.top >= scrollRect.top && lastRect.top <= scrollRect.bottom;
  if (!topBorderVisible) return;

  modal.dataset.scrollUnlocked = 'true';
  const checkbox = modal.querySelector('#resourceESignCheckbox');
  const gate = modal.querySelector('#resourceESignGateMessage');
  if (checkbox) checkbox.disabled = false;
  if (gate) {
    gate.textContent = 'Acknowledgment enabled.';
    gate.classList.add('ready');
  }
  syncResourceESignSubmitState(modal);
}

async function renderResourceESignPdf(modal, blob, token) {
  const pages = modal.querySelector('#resourceESignPages');
  if (!pages) return;
  const pdfjsLib = await loadResourcePdfJs();
  const pdf = await pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
  if (token !== resourceESignRenderToken) return;
  pages.innerHTML = '';

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    if (token !== resourceESignRenderToken) return;
    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(280, (pages.clientWidth || 760) - 28);
    const scale = Math.min(2, availableWidth / baseViewport.width);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const pageWrap = document.createElement('div');
    pageWrap.className = 'resource-esign-page';
    pageWrap.dataset.pageNumber = String(pageNumber);
    if (pageNumber === pdf.numPages) pageWrap.dataset.lastPage = 'true';
    const pageLabel = document.createElement('div');
    pageLabel.className = 'resource-esign-page-label';
    pageLabel.textContent = `Page ${pageNumber} of ${pdf.numPages}`;
    pageWrap.append(pageLabel, canvas);
    pages.appendChild(pageWrap);

    await page.render({ canvasContext: context, viewport }).promise;
  }

  requestAnimationFrame(() => updateResourceESignScrollGate(modal));
}

function getResourceDownloadName(resource = {}) {
  const rawName = resource.fileName || resource.documentName || 'PoolPro_E-Sign_Document.pdf';
  return rawName.toLowerCase().endsWith('.pdf') ? rawName : `${rawName}.pdf`;
}

function downloadCurrentResourceESignPdf() {
  const modal = document.getElementById('resourceESignModal');
  const resource = resourcesData.find((item) => item.id === modal?.dataset.resourceId) || {};
  if (!currentResourceESignObjectUrl) return;
  const link = document.createElement('a');
  link.href = currentResourceESignObjectUrl;
  link.download = getResourceDownloadName(resource);
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function openResourceESignModal(resource, resolvedUrl) {
  const modal = getResourceESignModal();
  const token = resourceESignRenderToken + 1;
  resourceESignRenderToken = token;
  resetResourceESignModal(modal, resource);
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('resource-esign-open');
  requestAnimationFrame(() => modal.classList.add('visible'));

  if (currentResourceESignObjectUrl) {
    URL.revokeObjectURL(currentResourceESignObjectUrl);
    currentResourceESignObjectUrl = '';
  }

  try {
    const blob = await getResourceBlob(resource, resolvedUrl);
    const pdfBlob = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
    if (token !== resourceESignRenderToken) return;
    currentResourceESignObjectUrl = URL.createObjectURL(pdfBlob);
    const downloadBtn = modal.querySelector('#resourceESignDownloadBtn');
    if (downloadBtn) downloadBtn.disabled = false;
    await renderResourceESignPdf(modal, pdfBlob, token);
  } catch (err) {
    console.error('[PoolPro] Unable to render E-Sign PDF:', err);
    const pages = modal.querySelector('#resourceESignPages');
    if (pages) pages.innerHTML = '<div class="resource-esign-loading error">Unable to load this PDF for signing.</div>';
    setResourceESignMessage(modal, err?.message || 'Unable to load this PDF for signing.', true);
  }
}

function closeResourceESignModal() {
  const modal = document.getElementById('resourceESignModal');
  if (!modal) return;
  resourceESignRenderToken += 1;
  modal.classList.remove('visible');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('resource-esign-open');
  setTimeout(() => {
    if (!modal.classList.contains('visible')) modal.style.display = 'none';
  }, 220);
  if (currentResourceESignObjectUrl) {
    URL.revokeObjectURL(currentResourceESignObjectUrl);
    currentResourceESignObjectUrl = '';
  }
}

async function handleResourceESignSubmit(event) {
  event.preventDefault();
  const modal = document.getElementById('resourceESignModal');
  const resource = resourcesData.find((item) => item.id === modal?.dataset.resourceId);
  const checkbox = modal?.querySelector('#resourceESignCheckbox');
  const signatureInput = modal?.querySelector('#resourceESignSignatureInput');
  const signatureName = signatureInput?.value.trim() || '';
  const context = getResourceESignContext();
  if (!modal || !resource) return;
  if (modal.dataset.scrollUnlocked !== 'true') {
    setResourceESignMessage(modal, 'Scroll to the top of the last page before acknowledging this policy.', true);
    return;
  }
  if (!checkbox?.checked) {
    setResourceESignMessage(modal, 'Check the acknowledgment box to sign this document.', true);
    return;
  }
  if (!signatureName) {
    setResourceESignMessage(modal, 'Type your account name to sign this document.', true);
    return;
  }
  if (context.displayName && normalizeESignText(signatureName) !== normalizeESignText(context.displayName)) {
    setResourceESignMessage(modal, `Your signature must match "${context.displayName}".`, true);
    return;
  }

  const submitBtn = modal.querySelector('#resourceESignSubmitBtn');
  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving...';
    }
    setResourceESignMessage(modal, 'Saving your signed acknowledgment...');
    await setDoc(doc(db, 'resourcesDocuments', resource.id, 'eSignatures', getResourceESignSignatureId(context)), {
      resourceId: resource.id,
      resourceName: resource.documentName || resource.fileName || '',
      resourceFileName: resource.fileName || '',
      resourceUploadDate: resource.uploadDate || '',
      signatureName,
      displayName: context.displayName || '',
      firstName: context.firstName || '',
      lastName: context.lastName || '',
      email: context.email || '',
      username: context.username || '',
      employeeId: context.employeeId || '',
      role: context.role || '',
      acceptanceMethod: 'typed-signature-checkbox',
      acknowledged: true,
      signedAt: serverTimestamp(),
      signedAtIso: new Date().toISOString(),
      signedPath: window.location.pathname,
      signedUrl: window.location.href,
      userAgent: navigator.userAgent,
    }, { merge: true });
    setResourceESignMessage(modal, 'Signed acknowledgment saved.', false);
    setTimeout(closeResourceESignModal, 650);
  } catch (err) {
    console.error('[PoolPro] Unable to save E-Sign signature:', err);
    setResourceESignMessage(modal, err?.message || 'Unable to save your signature. Please try again.', true);
  } finally {
    if (submitBtn) {
      submitBtn.textContent = 'Sign Document';
      syncResourceESignSubmitState(modal);
    }
  }
}

function isFirebaseStorageCorsError(err) {
  const message = `${err?.code || ''} ${err?.message || ''}`.toLowerCase();
  return message.includes('cors')
    || message.includes('xmlhttprequest')
    || message.includes('preflight')
    || message.includes('net::err_failed')
    || message.includes('firebase storage upload timed out');
}

function isResourceStorageMarkedBlocked() {
  try {
    return sessionStorage.getItem(RESOURCE_STORAGE_BLOCKED_SESSION_KEY) === 'true';
  } catch (err) {
    return false;
  }
}

function markResourceStorageBlocked() {
  try {
    sessionStorage.setItem(RESOURCE_STORAGE_BLOCKED_SESSION_KEY, 'true');
  } catch (err) {
    // Non-critical: uploads can still fall back for this request.
  }
}

async function deleteResourceFileChunks(resourceId) {
  if (!resourceId) return;
  const chunksSnap = await getDocs(collection(db, 'resourcesDocuments', resourceId, 'fileChunks'));
  const chunkRefs = chunksSnap.docs.map((docSnap) => docSnap.ref);
  for (let i = 0; i < chunkRefs.length; i += 400) {
    const batch = writeBatch(db);
    chunkRefs.slice(i, i + 400).forEach((chunkRef) => batch.delete(chunkRef));
    await batch.commit();
  }
}

async function storeResourceFileInFirestoreChunks(file, resourceId, safeName) {
  if (!resourceId) throw new Error('Resource upload could not be prepared. Try again.');
  if (file.size > RESOURCE_FIRESTORE_MAX_FILE_SIZE) {
    throw new Error('This file is too large for the temporary Firestore upload fallback. Use a website link, or apply Firebase Storage CORS and try again.');
  }

  const dataUrl = await readFileAsDataURL(file);
  const [prefix, encoded = ''] = dataUrl.split(',');
  const chunks = [];
  for (let i = 0; i < encoded.length; i += RESOURCE_FIRESTORE_CHUNK_SIZE) {
    chunks.push(encoded.slice(i, i + RESOURCE_FIRESTORE_CHUNK_SIZE));
  }

  await deleteResourceFileChunks(resourceId);
  for (let i = 0; i < chunks.length; i += 400) {
    const batch = writeBatch(db);
    chunks.slice(i, i + 400).forEach((chunk, offset) => {
      const index = i + offset;
      const chunkId = String(index).padStart(4, '0');
      batch.set(doc(db, 'resourcesDocuments', resourceId, 'fileChunks', chunkId), {
        index,
        data: chunk,
      });
    });
    await batch.commit();
  }

  return {
    storagePath: '',
    fileUrl: `${FIRESTORE_RESOURCE_STORAGE}:${resourceId}`,
    fileName: file.name || safeName,
    storageType: FIRESTORE_RESOURCE_STORAGE,
    contentType: file.type || 'application/octet-stream',
    fileSize: file.size || 0,
    chunkCount: chunks.length,
    dataUrlPrefix: prefix,
  };
}

async function getFirestoreResourceDataUrl(resourceId) {
  const resource = resourcesData.find((item) => item.id === resourceId);
  if (!resource) throw new Error('Resource metadata was not found.');
  const chunksSnap = await getDocs(collection(db, 'resourcesDocuments', resourceId, 'fileChunks'));
  const chunks = chunksSnap.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
    .sort((a, b) => Number(a.index ?? a.id) - Number(b.index ?? b.id))
    .map((chunk) => chunk.data || '');
  if (!chunks.length) throw new Error('Resource file chunks were not found.');
  const prefix = resource.dataUrlPrefix || `data:${resource.contentType || 'application/octet-stream'};base64`;
  return `${prefix},${chunks.join('')}`;
}

async function uploadResourceFile(file, resourceId) {
  const safeName = `${Date.now()}_${String(file.name || 'resource').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  if (isResourceStorageMarkedBlocked()) {
    return storeResourceFileInFirestoreChunks(file, resourceId, safeName);
  }

  const path = `resources/${safeName}`;
  const storage = getResourceStorage();
  const refObj = storageRef(storage, path);
  try {
    await Promise.race([
      uploadBytes(refObj, file, { contentType: file.type || 'application/octet-stream' }),
      timeoutAfter(RESOURCE_STORAGE_UPLOAD_TIMEOUT_MS, 'Firebase Storage upload'),
    ]);
    const fileUrl = await Promise.race([
      getDownloadURL(refObj),
      timeoutAfter(RESOURCE_STORAGE_URL_TIMEOUT_MS, 'Firebase Storage download URL'),
    ]);
    return {
      storagePath: path,
      fileUrl,
      fileName: file.name || safeName,
      storageType: 'storage',
      contentType: file.type || 'application/octet-stream',
      fileSize: file.size || 0,
      chunkCount: 0,
      dataUrlPrefix: '',
    };
  } catch (err) {
    console.warn('[PoolPro] Storage upload failed for resource.', err);
    const isCorsBlocked = isFirebaseStorageCorsError(err);
    if (isCorsBlocked) markResourceStorageBlocked();
    const corsHint = isCorsBlocked
      ? ' Storage CORS is still blocked, so PoolPro saved this file through its Firestore fallback.'
      : ' Firebase Storage failed, so PoolPro saved this file through its Firestore fallback.';
    console.warn(`[PoolPro]${corsHint}`);
    return storeResourceFileInFirestoreChunks(file, resourceId, safeName);
  }
}

async function deleteResourceRecord(item) {
  try {
    await deleteResourceBackingFile(item);
    await deleteDoc(doc(db, 'resourcesDocuments', item.id));
    await loadResourcesDocuments();
    if (resourceEditingId === item.id) clearResourceForm();
  } catch (err) {
    console.error('[PoolPro] Unable to remove resource:', err);
    alert('Unable to remove this document right now.');
  }
}

async function deleteResourceBackingFile(item) {
  if (!item) return;
  if (item.storagePath) {
    await deleteObject(storageRef(getResourceStorage(), item.storagePath)).catch(() => {});
  }
  if (item.storageType === FIRESTORE_RESOURCE_STORAGE || item.fileUrl?.startsWith(`${FIRESTORE_RESOURCE_STORAGE}:`)) {
    await deleteResourceFileChunks(item.id).catch(() => {});
  }
}

async function loadResourcesDocuments() {
  try {
    const snap = await getDocs(collection(db, 'resourcesDocuments'));
    resourcesData = snap.docs.map((docSnap) => normalizeResourceRecord(docSnap.data(), docSnap.id));
  } catch (err) {
    console.error('[PoolPro] Error loading resources:', err);
    resourcesData = [];
  }
  renderResourcesPageTable();
  renderResourcesSettingsTable();
}

function setupResourcesPageFilters() {
  const marketFilter = document.getElementById('resourcesMarketFilter');
  const poolFilter = document.getElementById('resourcesPoolFilter');
  if (!marketFilter || !poolFilter) return;

  marketFilter.value = 'all';
  poolFilter.value = 'all';
  resourcePageMarketFilter = 'all';
  resourcePagePoolFilter = 'all';

  marketFilter.addEventListener('change', () => {
    resourcePageMarketFilter = marketFilter.value || 'all';
    resourcePagePoolFilter = 'all';
    populateResourcePoolOptions(poolFilter, resourcePageMarketFilter, true);
    poolFilter.value = 'all';
    renderResourcesPageTable();
  });

  poolFilter.addEventListener('change', () => {
    resourcePagePoolFilter = poolFilter.value || 'all';
    renderResourcesPageTable();
  });
}

function setupResourcesSettingsUI() {
  ensureResourceSettingsUi();
  const sourceSelect = document.getElementById('resourceSourceTypeSelect');
  const fileInput = document.getElementById('resourceFileInput');
  const linkInput = document.getElementById('resourceLinkInput');
  const poolInput = document.getElementById('resourcePoolInput');
  const addBtn = document.getElementById('resourceAddBtn');
  const deleteBtn = document.getElementById('resourceDeleteBtn');
  const marketFilter = document.getElementById('resourceMarketFilter');
  const poolFilter = document.getElementById('resourcePoolFilter');
  const deleteAllBtn = document.getElementById('resourceDeleteAllBtn');

  if (!sourceSelect || !fileInput || !linkInput || !poolInput || !addBtn || !deleteBtn || !marketFilter || !poolFilter || !deleteAllBtn) return;
  if (addBtn.dataset.bound === 'true') return;
  addBtn.dataset.bound = 'true';

  setResourceSourceType(resourceSourceType);
  sourceSelect.addEventListener('change', () => {
    setResourceSourceType(sourceSelect.value);
  });

  fileInput.addEventListener('change', () => {
    pendingResourceFile = fileInput.files?.[0] || null;
  });

  marketFilter.value = 'all';
  poolFilter.value = 'all';

  marketFilter.addEventListener('change', () => {
    resourceSettingsMarketFilter = marketFilter.value || 'all';
    resourceSettingsPoolFilter = 'all';
    populateResourcePoolOptions(poolFilter, resourceSettingsMarketFilter, true);
    poolFilter.value = 'all';
    renderResourcesSettingsTable();
  });

  poolFilter.addEventListener('change', () => {
    resourceSettingsPoolFilter = poolFilter.value || 'all';
    renderResourcesSettingsTable();
  });

  setupResourceOverlay();

  addBtn.addEventListener('click', async () => {
    const documentName = document.getElementById('resourceDocumentNameInput')?.value.trim() || '';
    const description = document.getElementById('resourceDescriptionInput')?.value.trim() || '';
    const pool = poolInput.value || '';
    const market = getPoolMarket(pool);
    const mode = sourceSelect.value === RESOURCE_TYPE_LINK
      ? RESOURCE_TYPE_LINK
      : sourceSelect.value === RESOURCE_TYPE_ESIGN_PDF
        ? RESOURCE_TYPE_ESIGN_PDF
        : RESOURCE_TYPE_FILE;
    const normalizedLink = normalizeResourceLink(linkInput.value);

    if (!documentName || !description || !pool) {
      alert('Document Name, Description, and Facility are required.');
      return;
    }

    const existing = resourceEditingId
      ? resourcesData.find((item) => item.id === resourceEditingId)
      : null;
    const switchingLinkToFile = existing?.resourceType === RESOURCE_TYPE_LINK && mode !== RESOURCE_TYPE_LINK;
    const existingIsCompatibleESignPdf = mode === RESOURCE_TYPE_ESIGN_PDF && existing && isPdfResourceFile(existing);
    if (mode !== RESOURCE_TYPE_LINK && (!existing || switchingLinkToFile) && !pendingResourceFile) {
      alert('Choose a file before adding a resource.');
      return;
    }
    if (mode === RESOURCE_TYPE_LINK && !normalizedLink) {
      alert('Enter a valid website link before adding a resource.');
      return;
    }
    if (mode === RESOURCE_TYPE_ESIGN_PDF && pendingResourceFile && !isPdfResourceFile(pendingResourceFile)) {
      alert('E-Sign PDF resources must use a PDF file.');
      return;
    }
    if (mode === RESOURCE_TYPE_ESIGN_PDF && !pendingResourceFile && !existingIsCompatibleESignPdf) {
      alert('Choose a PDF file before saving an E-Sign PDF resource.');
      return;
    }

    try {
      addBtn.disabled = true;
      addBtn.textContent = resourceEditingId ? 'Saving...' : 'Adding...';
      const targetRef = resourceEditingId
        ? doc(db, 'resourcesDocuments', resourceEditingId)
        : doc(collection(db, 'resourcesDocuments'));
      const targetId = targetRef.id;
      let fileMeta = existing ? {
        fileUrl: existing.fileUrl,
        fileName: existing.fileName,
        storagePath: existing.storagePath,
        storageType: existing.storageType,
        contentType: existing.contentType,
        fileSize: existing.fileSize,
        chunkCount: existing.chunkCount,
        dataUrlPrefix: existing.dataUrlPrefix,
      } : null;

      if (mode === RESOURCE_TYPE_LINK) {
        if (existing) await deleteResourceBackingFile(existing);
        fileMeta = {
          fileUrl: normalizedLink,
          fileName: '',
          storagePath: '',
          storageType: 'link',
          contentType: '',
          fileSize: 0,
          chunkCount: 0,
          dataUrlPrefix: '',
        };
      } else if (pendingResourceFile) {
        const oldStoragePath = existing?.storagePath || '';
        const hadChunkedFile = !!existing
          && (existing.storageType === FIRESTORE_RESOURCE_STORAGE
            || existing.fileUrl?.startsWith(`${FIRESTORE_RESOURCE_STORAGE}:`));
        if (hadChunkedFile) {
          await deleteResourceFileChunks(existing.id).catch(() => {});
        }
        fileMeta = await uploadResourceFile(pendingResourceFile, targetId);
        if (oldStoragePath && oldStoragePath !== fileMeta.storagePath) {
          await deleteObject(storageRef(getResourceStorage(), oldStoragePath)).catch(() => {});
        }
      }

      const uploadTimestampMs = Date.now();
      const isNewResourceValue = mode === RESOURCE_TYPE_LINK
        ? normalizedLink !== existing?.fileUrl
        : !!pendingResourceFile || !existing;
      const uploadDate = isNewResourceValue
        ? new Date(uploadTimestampMs).toISOString().slice(0, 10)
        : existing?.uploadDate
          || (existing?.uploadedAt?.toDate ? existing.uploadedAt.toDate().toISOString().slice(0, 10) : '')
          || new Date(uploadTimestampMs).toISOString().slice(0, 10);
      const sortDate = isNewResourceValue
        ? uploadTimestampMs
        : existing?.sortDate || uploadTimestampMs;

      const payload = normalizeResourceRecord({
        documentName,
        uploadDate,
        description,
        market,
        pool,
        fileUrl: fileMeta?.fileUrl || '',
        fileName: fileMeta?.fileName || '',
        storagePath: fileMeta?.storagePath || '',
        storageType: fileMeta?.storageType || '',
        contentType: fileMeta?.contentType || '',
        fileSize: fileMeta?.fileSize || 0,
        chunkCount: fileMeta?.chunkCount || 0,
        dataUrlPrefix: fileMeta?.dataUrlPrefix || '',
        resourceType: mode,
        sortDate,
        uploadedAt: isNewResourceValue ? null : existing?.uploadedAt || null,
      }, resourceEditingId);

      await setDoc(targetRef, {
        documentName: payload.documentName,
        description: payload.description,
        market: payload.market,
        pool: payload.pool,
        fileUrl: payload.fileUrl,
        fileName: payload.fileName,
        storagePath: payload.storagePath,
        storageType: payload.storageType,
        contentType: payload.contentType,
        fileSize: payload.fileSize,
        chunkCount: payload.chunkCount,
        dataUrlPrefix: payload.dataUrlPrefix,
        resourceType: payload.resourceType,
        sortDate: payload.sortDate,
        uploadDate: payload.uploadDate,
        uploadedAt: isNewResourceValue ? serverTimestamp() : existing?.uploadedAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });

      await loadResourcesDocuments();
      if (resourceTableEditable && resourceEditingId) {
        const savedId = targetId;
        resourceEditingId = savedId;
        const savedResource = resourcesData.find((item) => item.id === savedId);
        if (savedResource) populateResourceForm(savedResource);
      } else {
        clearResourceForm();
      }
    } catch (err) {
      console.error('[PoolPro] Unable to save resource:', err);
      alert(err?.message || 'Unable to save this document right now.');
    } finally {
      addBtn.disabled = false;
      syncResourceActionButtons();
    }
  });

  deleteBtn.addEventListener('click', async () => {
    if (!resourceEditingId) return;
    const selected = resourcesData.find((item) => item.id === resourceEditingId);
    if (!selected) return;
    if (!confirm(`Remove "${selected.documentName || selected.fileName || 'this document'}"?`)) return;
    await deleteResourceRecord(selected);
    clearResourceForm();
  });

  deleteAllBtn.addEventListener('click', async () => {
    if (!resourcesData.length) {
      alert('There are no files to delete.');
      return;
    }
    if (!confirm('Delete all uploaded files and resource records? This cannot be undone.')) return;

    try {
      const removals = resourcesData.map(async (item) => {
        await deleteResourceBackingFile(item);
        await deleteDoc(doc(db, 'resourcesDocuments', item.id));
      });
      await Promise.all(removals);
      clearResourceForm();
      await loadResourcesDocuments();
    } catch (err) {
      console.error('[PoolPro] Unable to delete all resource files:', err);
      alert('Unable to delete all files right now.');
    }
  });
}

function setupSettingsAccordions() {
  normalizeNestedSettingsSections();
  const sections = Array.from(document.querySelectorAll('#settingsModal .settings-section'));

  sections.forEach((section) => {
    const title = section.querySelector(':scope > h3, :scope > #sanitationMethodsSection > h3');
    if (!title || section.dataset.accordionReady === 'true') return;
    const titleContainer = title.parentElement === section ? section : title.parentElement;

    const content = document.createElement('div');
    content.className = 'settings-section-body';
    const contentInner = document.createElement('div');
    contentInner.className = 'settings-section-body-inner';

    Array.from(titleContainer.children).forEach((child) => {
      if (child !== title) contentInner.appendChild(child);
    });

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'settings-section-toggle';
    button.innerHTML = `<span class="settings-section-title">${title.textContent}</span><span class="settings-section-caret">▾</span>`;

    title.replaceWith(button);
    content.appendChild(contentInner);
    titleContainer.appendChild(content);
    section.classList.add('collapsed');
    section.dataset.accordionReady = 'true';

    button.addEventListener('click', () => {
      const isCollapsed = section.classList.contains('collapsed');
      section.classList.toggle('collapsed', !isCollapsed);
    });
  });
}

function normalizeNestedSettingsSections() {
  const modalContent = document.querySelector('#settingsModal .settings-modal-content');
  if (!modalContent) return;

  let moved = true;
  while (moved) {
    moved = false;
    const nestedSections = Array.from(modalContent.querySelectorAll('.settings-section .settings-section'));
    nestedSections.reverse().forEach((nested) => {
      const parent = nested.parentElement?.closest('.settings-section');
      if (!parent) return;
      parent.insertAdjacentElement('afterend', nested);
      moved = true;
    });
  }
}

// ============================================================
// SANITATION METHODS
// ============================================================

// Saved selections: poolId → 'bleach' | 'granular'
let sanitationData = {};

async function loadSanitationMethods() {
  const container = document.getElementById('sanitationTablesContainer');
  if (!container) return;

  if (!poolsCache.length) {
    setTimeout(loadSanitationMethods, 300);
    return;
  }

  try {
    const snap = await getDoc(doc(db, 'settings', 'sanitation'));
    sanitationData = snap.exists() ? (snap.data().pools || {}) : {};
  } catch (err) {
    console.error('[ChemLog] Error loading sanitation methods:', err);
    sanitationData = {};
  }

  renderSanitationTables(container);
}

function renderSanitationTables(container) {
  container.innerHTML = '';
  const groups = groupPoolsByMarket(poolsCache);
  if (!groups.length) {
    container.innerHTML = '<p style="color:#888;font-size:0.9rem;">No pools configured yet. Add pools in the Site Editor.</p>';
    return;
  }

  const rows = groups.flatMap(({ market, pools: mPools }) =>
    mPools.map((pool) => ({ market, pool }))
  );

  const filterBar = document.createElement('div');
  filterBar.className = 'training-filter-bar sanitation-filter-bar';
  filterBar.innerHTML = `
    <span class="filter-by-label">Filter By:</span>
    <select id="sanitationMarketFilter" class="training-filter-select">
      <option value="all">All Markets</option>
      ${groups.map(({ market }) => `<option value="${market}">${market}</option>`).join('')}
    </select>
  `;
  container.appendChild(filterBar);

  const marketFilter = filterBar.querySelector('#sanitationMarketFilter');
  marketFilter.value = sanitationMarketFilter;
  marketFilter.addEventListener('change', () => {
    sanitationMarketFilter = marketFilter.value || 'all';
    renderSanitationTables(container);
  });

  const controlsWrap = document.createElement('div');
  controlsWrap.className = 'toggle-btn sanitation-market-controls';
  controlsWrap.innerHTML = `
    <div class="sanitation-controls">
      <div class="sanitation-controls-thumb" style="transform:${sanitationEditing ? 'translateX(0%)' : 'translateX(100%)'}"></div>
      <button type="button" class="editAndSave${sanitationEditing ? ' active' : ''}" ${sanitationEditing ? 'disabled' : ''}>Edit</button>
      <button type="button" class="editAndSave${sanitationEditing ? '' : ' active'}" ${sanitationEditing ? '' : 'disabled'}>Save</button>
    </div>
  `;
  container.appendChild(controlsWrap);

  const tableWrap = document.createElement('div');
  tableWrap.className = 'sanitation-market-table-wrap sanitation-section';
  if (!sanitationEditing) tableWrap.classList.add('overlay-disabled');

  const table = document.createElement('table');
  table.className = 'sanitation-table sanitation-table--settings';
  table.innerHTML = '<thead><tr><th>Facility</th><th>Pool</th><th>Bleach</th><th>Granular</th><th>Tablet</th><th>No Changes</th></tr></thead>';
  const tbody = document.createElement('tbody');

  const filteredRows = rows.filter(({ market }) => sanitationMarketFilter === 'all' || market === sanitationMarketFilter);

  filteredRows.forEach(({ market, pool }) => {
    const numPools = Math.max(1, Number(pool.numPools || pool.poolCount || 1));
    const poolLabels = Array.from({ length: numPools }, (_, i) =>
      i === 0 ? 'Pool 1 (Main)' : i === 1 ? 'Pool 2' : `Pool ${i + 1}`
    );

    poolLabels.forEach((poolLabel, poolIdx) => {
      const key = `${pool.id}::${poolIdx}`;
      const saved = sanitationData[key] || sanitationData[pool.id] || 'bleach';
      const tr = document.createElement('tr');

      if (poolIdx === 0) {
        const facilityTd = document.createElement('td');
        facilityTd.textContent = pool.name || pool.id;
        if (numPools > 1) facilityTd.rowSpan = numPools;
        tr.appendChild(facilityTd);
      }

      const poolTd = document.createElement('td');
      poolTd.textContent = poolLabel;
      tr.appendChild(poolTd);

      const methods = ['bleach', 'granular', 'tablet', 'off'];
      const cbs = methods.map((method) => {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'market-filter-checkbox';
        cb.checked = saved === method;
        cb.disabled = !sanitationEditing;
        return cb;
      });

      const updateSelection = (method) => {
        sanitationData[key] = method;
        cbs.forEach((cb, i) => { cb.checked = methods[i] === method; });
      };

      cbs.forEach((cb, i) => {
        cb.addEventListener('change', () => { if (cb.checked) updateSelection(methods[i]); });
        const td = document.createElement('td');
        td.style.textAlign = 'center';
        td.appendChild(cb);
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });
  });

  table.appendChild(tbody);
  tableWrap.appendChild(table);
  container.appendChild(tableWrap);
  wrapResponsiveTables(container);
  table.closest('.table-scroll-wrap')?.classList.add('sanitation-settings-scroll');

  const [editBtn, saveBtn] = controlsWrap.querySelectorAll('.editAndSave');
  editBtn?.addEventListener('click', () => {
    sanitationEditing = true;
    renderSanitationTables(container);
  });
  saveBtn?.addEventListener('click', async () => {
    try {
      await setDoc(doc(db, 'settings', 'sanitation'), { pools: sanitationData }, { merge: true });
    } catch (err) {
      console.error('[ChemLog] Error saving sanitation methods:', err);
    }
    sanitationEditing = false;
    renderSanitationTables(container);
  });
}

// Legacy stub — no longer needed but kept to avoid reference errors
function setupSanitationControls() {}

// ============================================================
// ============================================================
// EMPLOYEE TABLE — Section-level overlay with Edit/Save toggle
// ============================================================

function setupEmployeeOverlay() {
  ensureEmployeeSettingsUi();
  const editBtn = document.getElementById('employeeEditBtn');
  const saveBtn = document.getElementById('employeeSaveBtn');
  if (!editBtn || !saveBtn) return;
  if (!editBtn.dataset.bound) {
    editBtn.dataset.bound = 'true';
    editBtn.addEventListener('click', () => setEmployeeTableEditable(true));
  }
  if (!saveBtn.dataset.bound) {
    saveBtn.dataset.bound = 'true';
    saveBtn.addEventListener('click', () => setEmployeeTableEditable(false));
  }
  if (!employeeTableEditable) {
    const section = document.getElementById('employeeTableSection');
    section?.classList.add('overlay-disabled');
  }
  setEmployeeTableEditable(employeeTableEditable);
}

function setSegmentedToggleThumb(container, activeSide) {
  if (!container) return;
  let thumb = container.querySelector('.sanitation-controls-thumb');
  if (!thumb) {
    thumb = document.createElement('div');
    thumb.className = 'sanitation-controls-thumb';
    container.prepend(thumb);
  }
  thumb.style.transform = activeSide === 'edit' ? 'translateX(0%)' : 'translateX(100%)';
}

// MARKET SECTION — Edit/Save toggle with overlay
// ============================================================

function setupMarketEditSave() {
  const editBtn = document.getElementById('marketEditBtn');
  const saveBtn = document.getElementById('marketSaveBtn');
  const section = document.getElementById('marketSection');
  if (!editBtn || !saveBtn || !section) return;
  const controls = editBtn.closest('.sanitation-controls');

  // Start in read-only mode
  section.classList.add('overlay-disabled');
  editBtn.classList.remove('active');
  saveBtn.classList.add('active');
  editBtn.disabled = false;
  saveBtn.disabled = true;
  setSegmentedToggleThumb(controls, 'save');

  editBtn.addEventListener('click', () => {
    section.classList.remove('overlay-disabled');
    editBtn.classList.add('active');
    saveBtn.classList.remove('active');
    editBtn.disabled = true;
    saveBtn.disabled = false;
    setSegmentedToggleThumb(controls, 'edit');
    section.querySelectorAll('.market-filter-checkbox').forEach(cb => { cb.disabled = false; });
  });

  saveBtn.addEventListener('click', () => {
    const selected = Array.from(section.querySelectorAll('.market-filter-checkbox:checked')).map(c => c.value);
    localStorage.setItem('chemlogMarkets', JSON.stringify(selected));
    section.classList.add('overlay-disabled');
    saveBtn.classList.add('active');
    editBtn.classList.remove('active');
    saveBtn.disabled = true;
    editBtn.disabled = false;
    setSegmentedToggleThumb(controls, 'save');
    section.querySelectorAll('.market-filter-checkbox').forEach(cb => { cb.disabled = true; });
  });

  // Disable checkboxes initially
  section.querySelectorAll('.market-filter-checkbox').forEach(cb => { cb.disabled = true; });
}

// ============================================================
// DATA STORAGE — category export/delete
// ============================================================

const DATA_STORAGE_CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'poolChemistry', label: 'Pool Chemistry Dashboard' },
  { key: 'operationalStatus', label: 'Operational Status' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'cleanlinessReports', label: 'Cleanliness Reports' },
  { key: 'inspectionReports', label: 'Inspection Reports' },
  { key: 'setPerformance', label: 'SET Performance' },
  { key: 'auditingForms', label: 'Auditing Forms' },
  { key: 'trainingSchedule', label: 'Training Schedule' },
  { key: 'trainingCompletion', label: 'Training Completion' },
  { key: 'employees', label: 'Employees' },
  { key: 'resources', label: 'Resources' },
];

function populateDataStorageSelectors() {
  const options = DATA_STORAGE_CATEGORIES
    .map((category) => `<option value="${category.key}">${escapeHtml(category.label)}</option>`)
    .join('');
  ['dataExportCategorySelect', 'dataDeleteCategorySelect'].forEach((id) => {
    const select = document.getElementById(id);
    if (select && select.dataset.populated !== 'true') {
      select.innerHTML = options;
      select.dataset.populated = 'true';
    }
  });
}

function getDataStorageCategory(key) {
  return DATA_STORAGE_CATEGORIES.find((category) => category.key === key) || DATA_STORAGE_CATEGORIES[0];
}

function exportDateString(value) {
  const date = toDateObject(value);
  return date ? date.toISOString() : '';
}

function sanitizeExportValue(value) {
  if (value === undefined || value === null) return '';
  const date = toDateObject(value);
  if (date && (value instanceof Date || typeof value?.toDate === 'function')) return date.toISOString();
  if (Array.isArray(value)) return value.map(sanitizeNestedExportValue);
  if (typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, sanitizeNestedExportValue(nested)])
  );
  return value;
}

function sanitizeNestedExportValue(value) {
  if (value === undefined || value === null) return '';
  const date = toDateObject(value);
  if (date && (value instanceof Date || typeof value?.toDate === 'function')) return date.toISOString();
  if (Array.isArray(value)) return value.map(sanitizeNestedExportValue);
  if (typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, sanitizeNestedExportValue(nested)])
  );
  return value;
}

function normalizeExportRecord(data = {}, id = '') {
  const record = id ? { id } : {};
  Object.entries(data || {}).forEach(([key, value]) => {
    if (key === 'id' && record.id) return;
    const safeValue = sanitizeExportValue(value);
    record[key] = (Array.isArray(safeValue) || (safeValue && typeof safeValue === 'object'))
      ? JSON.stringify(safeValue)
      : safeValue;
  });
  return record;
}

function summarizeReportRecord(data = {}, id = '') {
  return {
    id,
    timestamp: exportDateString(data.timestamp || data.submittedAtIso || data.createdAt),
    facility: data.pool || data.facilityName || data.poolName || data.poolLocation || '',
    respondent: getSubmissionRespondentName(data),
    email: getSubmissionRespondentEmail(data) || data.employeeId || '',
    type: data.type || data.formType || '',
  };
}

async function getCollectionExportRows(collectionName, projector = normalizeExportRecord) {
  const snap = await getDocs(collection(db, collectionName));
  return snap.docs
    .map((docSnap) => projector(docSnap.data() || {}, docSnap.id))
    .sort((a, b) => String(b.timestamp || b.signedUpAt || '').localeCompare(String(a.timestamp || a.signedUpAt || '')));
}

async function getSettingsArrayExportRows(docId, fieldName) {
  const snap = await getDoc(doc(db, 'settings', docId));
  if (!snap.exists()) return [];
  const rows = snap.data()?.[fieldName];
  if (!Array.isArray(rows)) return [];
  return rows.map((row, index) => normalizeExportRecord({ rowNumber: index + 1, ...(row || {}) }));
}

async function getSettingsDocExportRows(docId) {
  const snap = await getDoc(doc(db, 'settings', docId));
  return snap.exists() ? [normalizeExportRecord(snap.data() || {}, docId)] : [];
}

async function getDataStorageExportSheets(categoryKey) {
  const selectedKeys = categoryKey === 'all'
    ? DATA_STORAGE_CATEGORIES.filter((category) => category.key !== 'all').map((category) => category.key)
    : [categoryKey];
  const sheets = [];

  for (const key of selectedKeys) {
    if (key === 'poolChemistry') {
      sheets.push({ name: 'Pool Chemistry', rows: await getCollectionExportRows('poolSubmissions') });
    } else if (key === 'operationalStatus') {
      sheets.push({ name: 'Operational Status', rows: await getCollectionExportRows('operationalStatusLogs') });
    } else if (key === 'inventory') {
      sheets.push({ name: 'Inventory', rows: await getCollectionExportRows('inventorySubmissions') });
    } else if (key === 'cleanlinessReports') {
      sheets.push({ name: 'Cleanliness Reports', rows: await getCollectionExportRows('dutySubmissions', summarizeReportRecord) });
    } else if (key === 'inspectionReports') {
      sheets.push({ name: 'Managerial Reports', rows: await getCollectionExportRows('managerialReports', summarizeReportRecord) });
      sheets.push({ name: 'DES Pre-Inspections', rows: await getCollectionExportRows('desPreInspections', summarizeReportRecord) });
    } else if (key === 'setPerformance') {
      sheets.push({ name: 'SET Performance', rows: await getSettingsDocExportRows('employeePerformance') });
    } else if (key === 'auditingForms') {
      sheets.push({ name: 'Auditing Forms', rows: await getCollectionExportRows('testingResults') });
    } else if (key === 'trainingSchedule') {
      sheets.push({ name: 'Training Schedule', rows: await getSettingsArrayExportRows('trainingSchedule', 'sessions') });
    } else if (key === 'trainingCompletion') {
      sheets.push({ name: 'Training Completion', rows: await getCollectionExportRows('trainingSignups') });
    } else if (key === 'employees') {
      sheets.push({ name: 'Employees', rows: await getSettingsArrayExportRows('employees', 'employees') });
    } else if (key === 'resources') {
      sheets.push({ name: 'Resources', rows: await getCollectionExportRows('resourcesDocuments', (data, id) => normalizeExportRecord({
        documentName: data.documentName,
        uploadDate: data.uploadDate,
        description: data.description,
        market: data.market,
        pool: data.pool,
        resourceType: data.resourceType,
        fileName: data.fileName,
        fileUrl: data.resourceType === 'link' ? data.fileUrl : '',
      }, id)) });
    }
  }

  return sheets;
}

function getSheetColumns(rows) {
  const columns = [];
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      if (!columns.includes(key)) columns.push(key);
    });
  });
  return columns.length ? columns : ['No Data'];
}

function safeExcelSheetName(name, used = new Set()) {
  let base = (name || 'Sheet').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    const suffix = ` ${index}`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function buildExcelWorkbook(sheets) {
  const usedNames = new Set();
  const prepared = sheets.map((sheet) => ({
    name: safeExcelSheetName(sheet.name, usedNames),
    rows: Array.isArray(sheet.rows) ? sheet.rows : [],
  }));
  const worksheets = prepared.map((sheet) => {
    const columns = getSheetColumns(sheet.rows);
    const bodyRows = sheet.rows.length ? sheet.rows : [{ 'No Data': 'No records found' }];
    const header = columns.map((column) => `<Cell><Data ss:Type="String">${escapeHtml(column)}</Data></Cell>`).join('');
    const body = bodyRows.map((row) => {
      const cells = columns.map((column) => `<Cell><Data ss:Type="String">${escapeHtml(row[column] ?? '')}</Data></Cell>`).join('');
      return `<Row>${cells}</Row>`;
    }).join('');
    return `
      <Worksheet ss:Name="${escapeHtml(sheet.name)}">
        <Table>
          <Row>${header}</Row>
          ${body}
        </Table>
      </Worksheet>
    `;
  }).join('');

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  ${worksheets}
</Workbook>`;
}

function downloadDataWorkbook(sheets, categoryKey) {
  const workbook = buildExcelWorkbook(sheets);
  const blob = new Blob([workbook], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `poolpro_${categoryKey}_${new Date().toISOString().slice(0, 10)}.xls`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function deleteCollectionDocs(collectionName, beforeDeleteDoc) {
  const snap = await getDocs(collection(db, collectionName));
  for (const docSnap of snap.docs) {
    if (typeof beforeDeleteDoc === 'function') {
      await beforeDeleteDoc(docSnap).catch((err) => console.warn(`[PoolPro] Could not clean related data for ${collectionName}/${docSnap.id}`, err));
    }
  }
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = writeBatch(db);
    snap.docs.slice(i, i + 400).forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
  }
}

async function deleteDataStorageCategory(categoryKey) {
  if (categoryKey === 'all') {
    for (const category of DATA_STORAGE_CATEGORIES.filter((item) => item.key !== 'all')) {
      await deleteDataStorageCategory(category.key);
    }
    return;
  }
  if (categoryKey === 'poolChemistry') await deleteCollectionDocs('poolSubmissions');
  else if (categoryKey === 'operationalStatus') await deleteCollectionDocs('operationalStatusLogs');
  else if (categoryKey === 'inventory') await deleteCollectionDocs('inventorySubmissions');
  else if (categoryKey === 'cleanlinessReports') await deleteCollectionDocs('dutySubmissions');
  else if (categoryKey === 'inspectionReports') {
    await deleteCollectionDocs('managerialReports');
    await deleteCollectionDocs('desPreInspections');
  } else if (categoryKey === 'setPerformance') await deleteDoc(doc(db, 'settings', 'employeePerformance'));
  else if (categoryKey === 'auditingForms') await deleteCollectionDocs('testingResults');
  else if (categoryKey === 'trainingSchedule') await setDoc(doc(db, 'settings', 'trainingSchedule'), { sessions: [] }, { merge: false });
  else if (categoryKey === 'trainingCompletion') await deleteCollectionDocs('trainingSignups');
  else if (categoryKey === 'employees') await setDoc(doc(db, 'settings', 'employees'), { employees: [] }, { merge: false });
  else if (categoryKey === 'resources') {
    await deleteCollectionDocs('resourcesDocuments', async (docSnap) => {
      await deleteResourceBackingFile({ id: docSnap.id, ...(docSnap.data() || {}) });
    });
  }
}

async function refreshAfterDataStorageDelete(categoryKey) {
  const affected = new Set(categoryKey === 'all'
    ? DATA_STORAGE_CATEGORIES.map((item) => item.key)
    : [categoryKey]);
  if (affected.has('employees') || affected.has('all')) await loadEmployees();
  if (affected.has('resources') || affected.has('all')) await loadResourcesDocuments();
  if (affected.has('operationalStatus') || affected.has('all')) operationalStatusLogs = [];
  if (affected.has('poolChemistry') || affected.has('all')) allLogs = [];
  if (affected.has('cleanlinessReports') || affected.has('all')) allDutyReports = [];
  if (affected.has('inspectionReports') || affected.has('all')) {
    allManagerialReports = [];
    allDesPreInspections = [];
  }
  if (affected.has('inventory') || affected.has('all')) allInventoryReports = [];
  if (document.getElementById('supervisorDashboard')?.classList.contains('show')) {
    dashboardDataLoaded = false;
    await loadDashboardData();
  }
  loadPublicTrainingSessions();
}

function setupDataExport() {
  populateDataStorageSelectors();
  const exportBtn = document.getElementById('exportCsvBtn');
  if (!exportBtn || exportBtn.dataset.bound === 'true') return;
  exportBtn.dataset.bound = 'true';
  exportBtn.addEventListener('click', async () => {
    const categoryKey = document.getElementById('dataExportCategorySelect')?.value || 'all';
    const category = getDataStorageCategory(categoryKey);
    try {
      exportBtn.disabled = true;
      exportBtn.textContent = 'Exporting...';
      const sheets = await getDataStorageExportSheets(categoryKey);
      const hasRows = sheets.some((sheet) => Array.isArray(sheet.rows) && sheet.rows.length);
      if (!hasRows) {
        alert(`No ${category.label} data to export.`);
        return;
      }
      downloadDataWorkbook(sheets, categoryKey);
    } catch (err) {
      console.error('[PoolPro] Error exporting data:', err);
      alert('Error exporting data. Please try again.');
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = 'Export Selected Data';
    }
  });
}

function setupClearData() {
  populateDataStorageSelectors();
  const clearBtn = document.getElementById('clearAllData');
  if (!clearBtn || clearBtn.dataset.bound === 'true') return;
  clearBtn.dataset.bound = 'true';
  clearBtn.addEventListener('click', async () => {
    const categoryKey = document.getElementById('dataDeleteCategorySelect')?.value || 'all';
    const category = getDataStorageCategory(categoryKey);
    const label = categoryKey === 'all' ? 'ALL exported PoolPro table data' : `${category.label} data`;
    if (!confirm(`Delete ${label}? This cannot be undone.`)) return;
    try {
      clearBtn.disabled = true;
      clearBtn.textContent = 'Deleting...';
      await deleteDataStorageCategory(categoryKey);
      await refreshAfterDataStorageDelete(categoryKey);
      alert(`${category.label} data has been deleted.`);
    } catch (err) {
      console.error('[PoolPro] Error deleting data:', err);
      alert('Error deleting data. Please try again.');
    } finally {
      clearBtn.disabled = false;
      clearBtn.textContent = 'Delete Selected Data';
    }
  });
}

// ============================================================
// DARK MODE
// ============================================================

function setupDarkMode() {
  document.body.classList.add('dark-mode');
  localStorage.setItem('chemlogDarkMode', 'true');
  setTimeout(() => document.body.classList.add('dark-mode-transition'), 50);
}

// ============================================================
// MARKET FILTER CHECKBOXES (settings modal)
// ============================================================

function setupMarketFilters() {
  const checkboxes = document.querySelectorAll('.market-filter-checkbox');
  if (!checkboxes.length) return;
  try {
    const saved = JSON.parse(localStorage.getItem('chemlogMarkets') || '[]');
    if (saved.length) {
      checkboxes.forEach(cb => { cb.checked = saved.includes(cb.value); });
    } else {
      // Default: all selected
      checkboxes.forEach(cb => { cb.checked = true; });
    }
  } catch (_) { /* ignore */ }
  checkboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      const selected = Array.from(checkboxes).filter(c => c.checked).map(c => c.value);
      localStorage.setItem('chemlogMarkets', JSON.stringify(selected));
    });
  });
}

// ============================================================
// TRAINING SESSIONS — public tables (fetched from Firestore)
// ============================================================

function getMonthKey(dateStr) {
  if (!dateStr) return null;
  // Add T12:00:00 to avoid timezone shifting the date
  const d = new Date(dateStr + 'T12:00:00');
  const m = d.getMonth(); // 0-based
  if (m === 4) return 'may';
  if (m === 5) return 'june';
  if (m === 6) return 'july';
  return null;
}

function formatDateNice(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function loadPublicTrainingSessions() {
  const mayBody = document.getElementById('publicTrainingSessionsMayBody');
  const juneBody = document.getElementById('publicTrainingSessionsJuneBody');
  const julyBody = document.getElementById('publicTrainingSessionsJulyBody');
  if (!mayBody && !juneBody && !julyBody) return; // Not on training page

  try {
    // Sessions are stored in the settings collection at settings/trainingSchedule
    const snap = await getDoc(doc(db, 'settings', 'trainingSchedule'));
    const sessions = snap.exists() ?
      (Array.isArray(snap.data().sessions) ? snap.data().sessions : []) :
      [];

    // Clear existing rows
    [mayBody, juneBody, julyBody].filter(Boolean).forEach(tb => { tb.innerHTML = ''; });

    sessions.forEach(session => {
      const monthKey = getMonthKey(session.date);
      let tbody = null;
      if (monthKey === 'may') tbody = mayBody;
      else if (monthKey === 'june') tbody = juneBody;
      else if (monthKey === 'july') tbody = julyBody;
      if (!tbody) return;

      const taken = Array.isArray(session.attendees) ? session.attendees.length : 0;
      const capacity = session.capacity || 0;
      const spotsText = capacity ? `${taken} / ${capacity}` : `${taken} signed up`;

      const locationLines = [session.pool, session.address].filter(Boolean).join('<br>');
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${session.trainingType || ''}</td>
        <td>${formatDateNice(session.date)}<br>${session.time || ''}</td>
        <td>${locationLines}</td>
        <td>${session.notes || ''}</td>
        <td>${spotsText}</td>
      `;
      tbody.appendChild(tr);
    });

    // Show empty-state row if no sessions for a month
    [mayBody, juneBody, julyBody].filter(Boolean).forEach(tbody => {
      if (!tbody.querySelector('tr')) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="5" style="text-align:center;color:grey;padding:12px;">No sessions scheduled yet.</td>';
        tbody.appendChild(tr);
      }
    });

  } catch (err) {
    console.error('[ChemLog] Error loading training sessions:', err);
    [mayBody, juneBody, julyBody].filter(Boolean).forEach(tbody => {
      tbody.innerHTML = '<tr><td colspan="5" style="color:red;padding:8px;">Error loading sessions. Check console.</td></tr>';
    });
  }
}

// Called by training.js when a lifeguard submits the signup form
// Writes to the trainingSignups collection (allow read, write: if true)
window.loadTrainingSessionsFromFirestore = async function () {
  try {
    const snap = await getDoc(doc(db, 'settings', 'trainingSchedule'));
    if (snap.exists()) {
      const data = snap.data();
      if (Array.isArray(data.sessions)) return data.sessions;
    }
  } catch (err) {
    console.error('[ChemLog] Error loading training sessions from Firestore:', err);
  }
  return null;
};

window.syncTrainingSessionsToFirestore = async function (sessions) {
  if (!Array.isArray(sessions)) return;
  try {
    await setDoc(doc(db, 'settings', 'trainingSchedule'), { sessions }, { merge: false });
  } catch (err) {
    console.error('[ChemLog] Error syncing training sessions to Firestore:', err);
  }
};

// Expose employee lookup so training.js can resolve phone numbers by employee ID or email
window.getEmployeeByID = function (idOrEmail) {
  if (!idOrEmail) return null;
  const val = String(idOrEmail).toLowerCase();
  return employeesData.find(e =>
    String(e.email || '').toLowerCase() === val ||
    String(e.id || '').toLowerCase() === val ||
    String(e.username || '').toLowerCase() === val
  ) || null;
};
window.getEmployeeByEmail = window.getEmployeeByID;

window.getCurrentEmployeeRecord = function () {
  let tokenIdentity = {};
  try {
    tokenIdentity = JSON.parse(localStorage.getItem('loginToken') || 'null') || {};
  } catch (_) {
    tokenIdentity = {};
  }
  const sessionEmail = (sessionStorage.getItem('chemlogEmployeeEmail') || '').trim().toLowerCase();
  const sessionId = (sessionStorage.getItem('chemlogEmployeeId') || '').trim().toLowerCase();
  const sessionUsername = (sessionStorage.getItem('chemlogEmployeeUsername') || tokenIdentity.username || '').trim().toLowerCase();
  const tokenEmail = String(tokenIdentity.email || (String(tokenIdentity.username || '').includes('@') ? tokenIdentity.username : '') || '').trim().toLowerCase();
  const supervisorEmail = (auth.currentUser?.email || getStoredSupervisorEmail() || tokenEmail || '').trim().toLowerCase();
  const keys = [sessionEmail, sessionId, sessionUsername, supervisorEmail].filter(Boolean);
  const matched = employeesData
    .map(normalizeEmployeeRecord)
    .find((employee) => keys.some((key) =>
      employee.email === key ||
      String(employee.id || '').toLowerCase() === key ||
      employee.username === key
    ));
  const fallback = normalizeEmployeeRecord({
    email: sessionEmail || supervisorEmail || '',
    id: sessionId || sessionEmail || supervisorEmail || '',
    username: sessionUsername || '',
    firstName: sessionStorage.getItem('chemlogEmployeeFirstName') || tokenIdentity.firstName || '',
    lastName: sessionStorage.getItem('chemlogEmployeeLastName') || tokenIdentity.lastName || '',
    homePool: sessionStorage.getItem('chemlogEmployeeHomePool') || '',
    phone: sessionStorage.getItem('chemlogEmployeePhone') || '',
  });
  return matched ? normalizeEmployeeRecord({ ...fallback, ...matched }) : fallback;
};

window.getPoolMarketByName = function (poolName) {
  return getPoolMarket(poolName || '');
};

window.addTrainingSignupToSchedule = async function ({ sessionId, firstName, lastName, homePool, email, employeeId, username, phone }) {
  if (!sessionId) return;
  try {
    await addDoc(collection(db, 'trainingSignups'), {
      sessionId,
      firstName: firstName || '',
      lastName: lastName || '',
      homePool: homePool || '',
      email: email || '',
      employeeId: employeeId || email || '',
      username: username || '',
      phone: phone || '',
      signedUpAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('[ChemLog] Error saving training signup to Firestore:', err);
  }
};

window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href]');
  if (!link) return;
  const navKey = link.dataset.nav || '';
  const navPermission = NAV_PERMISSION_MAP[navKey];
  if (navPermission && !canAccessPage(navPermission)) {
    event.preventDefault();
    closeDropdownMenus();
    alert(`You do not have permission to view ${pageTitleForPermission(navPermission)}.`);
    return;
  }
  const href = link.getAttribute('href') || '';
  if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
  if (link.target && link.target !== '_self') return;
  if (link.hasAttribute('download')) return;
  try {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return;
    event.preventDefault();
    url.searchParams.set('_reload', String(Date.now()));
    closeDropdownMenus();
    document.body.classList.add('page-exiting');
    showPageLoadingOverlay();
    setTimeout(() => {
      window.location.href = url.pathname + url.search + url.hash;
    }, 140);
  } catch (_) {
    // Ignore malformed URLs
  }
}, true);

// ============================================================
// SUPERVISOR DASHBOARD ANCHOR — handle #supervisorDashboard
// in the URL when redirecting from training.html
// ============================================================

function checkDashboardAnchor(options = {}) {
  if (window.location.hash === '#supervisorDashboard') {
    const dashboard = document.getElementById('supervisorDashboard');
    if (dashboard) {
      if (!canAccessPoolChemistryDashboard()) {
        document.documentElement.classList.remove('dashboard-hash-pending');
        return;
      }
      const mainForm = document.getElementById('mainForm');
      if (mainForm) mainForm.style.display = 'none';
      dashboard.classList.add('show');
      document.documentElement.classList.remove('dashboard-hash-pending');
      applyDashboardAccessMode();
      if (options.loadData !== false) loadDashboardData();
    }
  }
}

// ============================================================
// BOOT — wire everything up on DOMContentLoaded
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  restoreLifeguardSessionFromLocalStorage();
  checkDashboardAnchor({ loadData: false });
  await loadRolesPermissions();
  mountUnifiedFooter();
  normalizeSharedHeaderCopy();
  injectOperationalStatusMenuLinks();
  injectManagerialReportMenuLinks();
  injectDesLogbooksMenuLinks();
  injectResourcesMenuLinks();
  injectInventoryMenuLinks();
  injectTodoMenuLinks();
  injectDesPreInspectionMenuLinks();
  injectLifeguardSettingsMenuLinks();
  window.setupDropdownVisibility();
  ensureStandardSettingsSections();
  ensureDataStorageSettingsSection();
  ensureResourcesSettingsSection();
  ensureAlertsRemindersSettingsSection();
  ensureSettingsModalScrollBody();
  resetOrphanedSharedModalOverlay();
  setupAccountManagement();
  setupSettingsAccordions();
  wrapResponsiveTables();
  observeResponsiveTables();
  const feedbackModal = document.getElementById('feedbackModal');
  if (feedbackModal) {
    feedbackModal.addEventListener('click', (event) => {
      if (event.target === feedbackModal) {
        window.closeModal();
      }
    });
  }
  // Firebase Auth state listener — keeps localStorage flags in sync and updates nav
  onAuthStateChanged(auth, async (user) => {
    if (accountDeletionInProgress) return;
    const role = hasFreshSupervisorToken()
      ? 'supervisor'
      : (sessionStorage.getItem('chemlogRole') || localStorage.getItem('chemlogRole'));
    if (user) {
      if (role === 'lifeguard') {
        await user.reload().catch(() => {});
        if (!auth.currentUser?.emailVerified) {
          signOut(auth).catch(() => {});
          window.setupDropdownVisibility();
          return;
        }
        localStorage.removeItem('loginToken');
        localStorage.removeItem('ChemLogSupervisor');
        localStorage.removeItem('trainingSupervisorLoggedIn');
        localStorage.removeItem('training_supervisor_logged_in_v1');
        localStorage.removeItem('chemlogTrainingSupervisorLoggedIn');
        window.setupDropdownVisibility();
        return;
      }
      // Enforce fresh email auth every 6 hours.
      const stillFresh = hasFreshSupervisorToken();
      if (!stillFresh) {
        signOut(auth).catch(() => {});
        localStorage.removeItem('loginToken');
        localStorage.removeItem('ChemLogSupervisor');
        localStorage.removeItem('trainingSupervisorLoggedIn');
        localStorage.removeItem('training_supervisor_logged_in_v1');
        localStorage.removeItem('chemlogTrainingSupervisorLoggedIn');
      } else {
        localStorage.setItem('ChemLogSupervisor', 'true');
        localStorage.setItem('chemlogTrainingSupervisorLoggedIn', 'true');
        await enforceAgreementForCurrentUser();
      }
    } else {
      // Signed out: clear supervisor flags (but don't redirect — may be lifeguard session)
      if (!hasFreshSupervisorToken()) clearSupervisorLoginState();
    }
    window.setupDropdownVisibility();
    enforceDesPreInspectionAccess();
    maybeShowActiveAlertRemindersOnPageLoad();
  });

  normalizeSharedHeaderCopy();
  setupFloatingHeaders();
  removeSiteAppearanceSections();

  // Show/hide supervisor-only dropdown items (initial render before auth resolves)
  window.setupDropdownVisibility();

  // Dark mode (toggle state sync — already applied before load)
  setupDarkMode();

  // Market filter checkboxes in settings
  setupMarketFilters();
  setupResourcesPageFilters();
  setupResourcesSettingsUI();

  // Load pools from Firestore and populate all dropdowns
  listenPools(populatePoolSelects);
  setupOperationalStatusLog();

  // Chemistry form submission
  setupChemForm();

  // Employee management
  await loadSecuritySettings();
  await loadAlertsRemindersSettings();
  await loadEmployees();
  maybeShowCurrentPageLoginModal();
  ensureRolesPermissionsSettingsSection();
  await loadResourcesDocuments();
  setupEmployeeManagement();
  setupEmployeeOverlay();
  await enforceAgreementForCurrentUser();
  setupDeleteAllEmployees();
  setupEmployeeFilters();
  setupSecuritySettingsUI();
  applySecuritySessionTimeout();
  maybeShowActiveAlertRemindersOnPageLoad();

  // Market section edit/save toggle
  setupMarketEditSave();

  // Sanitation methods
  loadSanitationMethods();

  // Data export + clear data
  setupDataExport();
  setupClearData();

  // Training session public tables
  loadPublicTrainingSessions();

  // Handle #supervisorDashboard anchor (redirect from training page)
  checkDashboardAnchor();

  // Load dashboard data if already on the dashboard and supervisor
  const dashboard = document.getElementById('supervisorDashboard');
  if (dashboard && dashboard.classList.contains('show') && canAccessPoolChemistryDashboard()) {
    loadDashboardData();
  }

  // Supervisor Dashboard tab switching
  const dashTabs = document.querySelectorAll('[data-dash-tab]');
  dashTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      if (!isSupervisor() && tab.dataset.dashTab !== 'chemistry') return;
      activateDashboardTab(tab.dataset.dashTab);
    });
  });
});

// ============================================================
// DASHBOARD REPORTS + METRICS
// ============================================================

function getDashboardPoolDocByName(poolName) {
  return poolsCache.find((pool) => getPoolName(pool) === poolName) || null;
}

function getPrimaryMarketName(poolDoc) {
  const markets = Array.isArray(poolDoc?.markets) ? poolDoc.markets
    : (poolDoc?.market ? [poolDoc.market] : []);
  return String(markets[0] || 'Other').trim() || 'Other';
}

function getDashboardReportPage(kind) {
  return kind === 'managerial' ? dashboardManagerialPage : dashboardJobPage;
}

function setDashboardReportPage(kind, value) {
  if (kind === 'managerial') dashboardManagerialPage = value;
  else dashboardJobPage = value;
}

function getDutyReportTitle(sub) {
  return sub?.reportType === 'managerial' ? 'Managerial Report' : 'Cleanliness Report';
}

function getDashboardCleanlinessShift(sub) {
  const raw = String(sub?.shift || sub?.shiftKey || sub?.reportShift || sub?.shiftLabel || '').trim().toLowerCase();
  if (raw.includes('closing')) return 'closing';
  if (raw.includes('opening')) return 'opening';
  return 'opening';
}

function renderDashboardCleanlinessShiftTabs(container, rerender) {
  const tabBar = document.createElement('div');
  tabBar.className = 'dashboard-tab-bar dashboard-report-shift-tabs';
  tabBar.setAttribute('role', 'tablist');
  tabBar.setAttribute('aria-label', 'Cleanliness report shift');

  [
    { key: 'opening', label: 'Opening' },
    { key: 'closing', label: 'Closing' },
  ].forEach(({ key, label }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `dashboard-tab-btn${dashboardCleanlinessShiftFilter === key ? ' active' : ''}`;
    button.dataset.cleanlinessShift = key;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', dashboardCleanlinessShiftFilter === key ? 'true' : 'false');
    button.textContent = label;
    button.addEventListener('click', () => {
      if (dashboardCleanlinessShiftFilter === key) return;
      dashboardCleanlinessShiftFilter = key;
      dashboardJobPage = 1;
      rerender();
    });
    tabBar.appendChild(button);
  });

  container.appendChild(tabBar);
}

function createDutyFormLink(sub, label = getDutyReportTitle(sub)) {
  const formLink = document.createElement('a');
  formLink.href = '#';
  formLink.className = 'dashboard-form-link';
  formLink.textContent = label;
  formLink.addEventListener('click', (event) => {
    event.preventDefault();
    openDutyFormModal(sub);
  });
  return formLink;
}

function renderReportSubmissions(submissions, container, {
  kind = 'cleanliness',
  emptyMessage = 'No reports match the selected filters.',
} = {}) {
  container.innerHTML = '';

  renderDashboardFilterBar(container, () => renderReportSubmissions(submissions, container, { kind, emptyMessage }));
  if (kind === 'cleanliness') {
    renderDashboardCleanlinessShiftTabs(
      container,
      () => renderReportSubmissions(submissions, container, { kind, emptyMessage })
    );
  }

  const reportLabel = kind === 'managerial' ? 'Managerial Report' : 'Cleanliness Report';
  const marketMap = getDashboardMarketMap({ docs: false });
  const marketsToShow = getVisibleDashboardMarkets(marketMap);
  let submissionsForDate = submissions.filter((sub) => isDashboardDate(sub.timestamp, dashboardDateFilter));
  if (kind === 'cleanliness') {
    submissionsForDate = submissionsForDate.filter((sub) => getDashboardCleanlinessShift(sub) === dashboardCleanlinessShiftFilter);
  }

  if (!marketsToShow.length) {
    container.insertAdjacentHTML('beforeend', '<p style="padding:16px;color:#666;">No markets selected. Enable markets in Settings.</p>');
    return;
  }

  if (dashboardPoolFilter !== 'all') {
    const poolSubs = submissionsForDate.filter((sub) => sub.pool === dashboardPoolFilter);
    const totalPages = Math.max(1, Math.ceil(poolSubs.length / DASHBOARD_PAGE_SIZE));
    const currentPage = Math.min(Math.max(1, getDashboardReportPage(kind)), totalPages);
    const pageSubs = poolSubs.slice((currentPage - 1) * DASHBOARD_PAGE_SIZE, currentPage * DASHBOARD_PAGE_SIZE);

    const section = document.createElement('div');
    section.className = 'dashboard-market-section dashboard-single-pool-section';
    const heading = document.createElement('h2');
    heading.className = 'dashboard-market-heading';
    heading.textContent = dashboardPoolFilter;
    section.appendChild(heading);

    const table = document.createElement('table');
    table.className = 'data-table dashboard-pool-table dashboard-detail-table dashboard-cleanliness-table';
    table.innerHTML = '<thead><tr><th>Form</th><th>Facility Name</th><th>Respondent</th><th>Timestamp</th></tr></thead>';
    const tbody = document.createElement('tbody');

    if (!pageSubs.length) {
      tbody.innerHTML = `<tr><td colspan="4">${escapeHtml(emptyMessage)}</td></tr>`;
    } else {
      pageSubs.forEach((sub) => {
        const ts = toDateObject(sub.timestamp);
        const tr = document.createElement('tr');
        const formCell = document.createElement('td');
        formCell.appendChild(createDutyFormLink(sub, reportLabel));
        tr.appendChild(formCell);
        tr.insertAdjacentHTML('beforeend', `
          <td>${escapeHtml(sub.pool || '—')}</td>
          <td>${escapeHtml(getSubmissionRespondentName(sub))}</td>
          <td>${ts ? ts.toLocaleString() : '—'}</td>
        `);
        tbody.appendChild(tr);
      });
    }

    table.appendChild(tbody);
    section.appendChild(table);
    renderDashboardPagination(section, {
      page: currentPage,
      totalRows: poolSubs.length,
      onPageChange: (nextPage) => {
        setDashboardReportPage(kind, nextPage);
        renderReportSubmissions(submissions, container, { kind, emptyMessage });
      },
    });
    container.appendChild(section);
    wrapResponsiveTables(container);
    return;
  }

  let renderedAny = false;
  marketsToShow.forEach((market) => {
    const poolNames = marketMap[market] || [];
    if (!poolNames.length) return;

    const section = document.createElement('div');
    section.className = 'dashboard-market-section';
    const heading = document.createElement('h2');
    heading.className = 'dashboard-market-heading';
    heading.textContent = market;
    section.appendChild(heading);

    const table = document.createElement('table');
    table.className = 'data-table dashboard-pool-table dashboard-cleanliness-table';
    table.innerHTML = '<thead><tr><th>Facility Name</th><th>Form</th><th>Respondent</th><th>Timestamp</th></tr></thead>';
    const tbody = document.createElement('tbody');

    poolNames.forEach((poolName) => {
      const mostRecent = submissionsForDate.find((sub) => sub.pool === poolName);
      const ts = toDateObject(mostRecent?.timestamp);
      const tr = document.createElement('tr');
      const facilityCell = document.createElement('td');
      facilityCell.textContent = poolName;
      const formCell = document.createElement('td');
      if (mostRecent) formCell.appendChild(createDutyFormLink(mostRecent, reportLabel));
      else formCell.textContent = 'No report';

      tr.appendChild(facilityCell);
      tr.appendChild(formCell);
      tr.insertAdjacentHTML('beforeend', `
        <td>${escapeHtml(mostRecent ? getSubmissionRespondentName(mostRecent) : '—')}</td>
        <td>${ts ? ts.toLocaleString() : '—'}</td>
      `);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    section.appendChild(table);
    container.appendChild(section);
    renderedAny = true;
  });

  if (!renderedAny) {
    container.insertAdjacentHTML('beforeend', `<p style="padding:8px 0;color:#666;">${escapeHtml(emptyMessage)}</p>`);
  }

  wrapResponsiveTables(container);
}

function loadJobFormSubmissions() {
  const container = document.getElementById('jobFormsContent');
  if (!container) return;
  if (!isSupervisor()) {
    container.innerHTML = '<p style="padding:16px;color:#c0392b;">You do not have permission to view cleanliness report submissions.</p>';
    return;
  }
  renderReportSubmissions(allDutyReports, container, {
    kind: 'cleanliness',
    emptyMessage: 'No cleanliness reports match the selected filters.',
  });
}

function getReportMetaRows(sub) {
  return [
    ['Facility', sub?.pool || '—'],
    ['Respondent', getSubmissionRespondentName(sub)],
    ['Submitted', formatTimestampDisplay(sub?.timestamp)],
  ];
}

function openInspectionMetaPopup(sub, title) {
  let modal = document.getElementById('inspectionMetaModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'inspectionMetaModal';
    modal.className = 'dashboard-info-modal';
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeInspectionMetaPopup();
    });
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="dashboard-info-card">
      <button type="button" class="dashboard-info-close" aria-label="Close">&times;</button>
      <h3>${escapeHtml(title)}</h3>
      ${getReportMetaRows(sub).map(([label, value]) => `
        <div class="dashboard-info-row"><strong>${escapeHtml(label)}:</strong><span>${escapeHtml(value)}</span></div>
      `).join('')}
    </div>
  `;
  modal.querySelector('.dashboard-info-close')?.addEventListener('click', closeInspectionMetaPopup);
  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('visible'));
}

function closeInspectionMetaPopup() {
  const modal = document.getElementById('inspectionMetaModal');
  if (!modal) return;
  modal.classList.remove('visible');
  setTimeout(() => {
    if (!modal.classList.contains('visible')) modal.style.display = 'none';
  }, 200);
}

function createInspectionInfoFlag(sub, title) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dashboard-cell-flag dashboard-info-flag';
  button.title = 'Submission details';
  button.setAttribute('aria-label', 'Submission details');
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openInspectionMetaPopup(sub, title);
  });
  return button;
}

function createInspectionReportCell(sub, type) {
  const cell = document.createElement('td');
  cell.className = 'dashboard-report-cell';
  if (!sub) {
    cell.textContent = 'No report';
    return cell;
  }
  if (type === 'des') {
    const link = document.createElement('a');
    link.href = '#';
    link.className = 'dashboard-form-link';
    link.textContent = 'DES Pre-Inspection';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      openDesPreInspectionModal(sub);
    });
    cell.appendChild(link);
    cell.appendChild(createInspectionInfoFlag(sub, 'DES Pre-Inspection Details'));
    return cell;
  }
  cell.appendChild(createDutyFormLink(sub, 'Managerial Report'));
  cell.appendChild(createInspectionInfoFlag(sub, 'Managerial Report Details'));
  return cell;
}

function getCurrentManagerialInspectionPeriod(now = new Date()) {
  const start = new Date(now);
  const daysSinceFriday = (start.getDay() - 5 + 7) % 7;
  start.setDate(start.getDate() - daysSinceFriday);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  end.setMilliseconds(end.getMilliseconds() - 1);
  return { start, end };
}

function getCurrentDesInspectionPeriod(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 24, 0, 0, 0, 0);
  if (now.getDate() < 24) start.setMonth(start.getMonth() - 1);
  const end = new Date(start);
  end.setMonth(start.getMonth() + 1);
  end.setMilliseconds(end.getMilliseconds() - 1);
  return { start, end };
}

function formatInspectionPeriodDate(date) {
  return date.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: 'numeric' });
}

function getInspectionAnchorDate() {
  return parseDateOnly(dashboardInspectionDateFilter) || new Date();
}

function shiftInspectionDate(days) {
  const anchor = getInspectionAnchorDate();
  anchor.setDate(anchor.getDate() + days);
  dashboardInspectionDateFilter = formatDateInputValue(anchor);
  dashboardManagerialPage = 1;
  renderInspectionReports();
}

function isReportInPeriod(report, period) {
  const date = toDateObject(report?.timestamp);
  return !!date && date >= period.start && date <= period.end;
}

function renderInspectionDateFilter(container, managerialPeriod, desPeriod) {
  const filter = document.createElement('div');
  filter.className = 'dashboard-date-filter dashboard-inspection-date-filter';

  const label = document.createElement('span');
  label.className = 'filter-by-label';
  label.textContent = 'Date Filter:';

  const prevButton = document.createElement('button');
  prevButton.type = 'button';
  prevButton.className = 'emp-pagination-arrow dashboard-inspection-date-arrow';
  prevButton.textContent = '←';
  prevButton.title = 'Previous week';
  prevButton.setAttribute('aria-label', 'Previous inspection week');
  prevButton.addEventListener('click', () => shiftInspectionDate(-7));

  const dateField = document.createElement('label');
  dateField.className = 'dashboard-filter-field dashboard-inspection-date-field';
  const dateText = document.createElement('span');
  dateText.textContent = 'Date';
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'training-filter-select dashboard-date-input';
  dateInput.value = dashboardInspectionDateFilter || getTodayDateValue();
  dateInput.setAttribute('aria-label', 'Inspection report date');
  dateInput.addEventListener('change', () => {
    dashboardInspectionDateFilter = dateInput.value || getTodayDateValue();
    dashboardManagerialPage = 1;
    renderInspectionReports();
  });
  dateField.appendChild(dateText);
  dateField.appendChild(dateInput);

  const nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.className = 'emp-pagination-arrow dashboard-inspection-date-arrow';
  nextButton.textContent = '→';
  nextButton.title = 'Next week';
  nextButton.setAttribute('aria-label', 'Next inspection week');
  nextButton.addEventListener('click', () => shiftInspectionDate(7));

  const managerialChip = document.createElement('span');
  managerialChip.className = 'dashboard-date-filter-chip';
  managerialChip.textContent = `Managerial: ${formatInspectionPeriodDate(managerialPeriod.start)} - ${formatInspectionPeriodDate(managerialPeriod.end)}`;

  const desChip = document.createElement('span');
  desChip.className = 'dashboard-date-filter-chip';
  desChip.textContent = `DES: ${formatInspectionPeriodDate(desPeriod.start)} - ${formatInspectionPeriodDate(desPeriod.end)}`;

  filter.appendChild(label);
  filter.appendChild(prevButton);
  filter.appendChild(dateField);
  filter.appendChild(nextButton);
  filter.appendChild(managerialChip);
  filter.appendChild(desChip);
  container.appendChild(filter);
}

function findLatestReportForPool(submissions, poolName, period = null) {
  return submissions
    .filter((sub) => sub.pool === poolName && (!period || isReportInPeriod(sub, period)))
    .sort((a, b) => (toDateObject(b.timestamp)?.getTime?.() || 0) - (toDateObject(a.timestamp)?.getTime?.() || 0))[0] || null;
}

function isInspectionReportRowStale(...reports) {
  const latestTime = reports
    .map((report) => toDateObject(report?.timestamp)?.getTime?.() || 0)
    .filter(Boolean)
    .sort((a, b) => b - a)[0] || 0;
  if (!latestTime) return true;
  return Date.now() - latestTime > 7 * 24 * 60 * 60 * 1000;
}

function renderInspectionReports() {
  const container = document.getElementById('managerialFormsContent');
  if (!container) return;
  container.innerHTML = '';

  renderDashboardFilterBar(container, renderInspectionReports, { includeDate: false });
  const selectedDate = getInspectionAnchorDate();
  const managerialPeriod = getCurrentManagerialInspectionPeriod(selectedDate);
  const desPeriod = getCurrentDesInspectionPeriod(selectedDate);

  const marketMap = getDashboardMarketMap({ docs: false });
  const marketsToShow = getVisibleDashboardMarkets(marketMap);
  if (!marketsToShow.length) {
    container.insertAdjacentHTML('beforeend', '<p style="padding:16px;color:#666;">No markets selected. Enable markets in Settings.</p>');
    return;
  }

  const renderRowsForPools = (poolNames, tbody) => {
    poolNames.forEach((poolName) => {
      const managerial = findLatestReportForPool(allManagerialReports, poolName, managerialPeriod);
      const des = findLatestReportForPool(allDesPreInspections, poolName, desPeriod);
      const tr = document.createElement('tr');
      tr.classList.toggle('dashboard-stale-report-row', isInspectionReportRowStale(managerial, des));
      const facilityCell = document.createElement('td');
      facilityCell.textContent = poolName;
      tr.appendChild(facilityCell);
      tr.appendChild(createInspectionReportCell(managerial, 'managerial'));
      tr.appendChild(createInspectionReportCell(des, 'des'));
      tbody.appendChild(tr);
    });
  };

  if (dashboardPoolFilter !== 'all') {
    const section = document.createElement('div');
    section.className = 'dashboard-market-section dashboard-single-pool-section';
    const heading = document.createElement('h2');
    heading.className = 'dashboard-market-heading';
    heading.textContent = dashboardPoolFilter;
    section.appendChild(heading);
    const table = document.createElement('table');
    table.className = 'data-table dashboard-pool-table dashboard-detail-table dashboard-cleanliness-table dashboard-inspection-table';
    table.innerHTML = '<thead><tr><th>Facility Name</th><th>Managerial Report</th><th>DES Pre-Inspection</th></tr></thead>';
    const tbody = document.createElement('tbody');
    renderRowsForPools([dashboardPoolFilter], tbody);
    table.appendChild(tbody);
    section.appendChild(table);
    renderInspectionDateFilter(section, managerialPeriod, desPeriod);
    container.appendChild(section);
    wrapResponsiveTables(container);
    return;
  }

  let renderedAny = false;
  marketsToShow.forEach((market) => {
    const poolNames = marketMap[market] || [];
    if (!poolNames.length) return;

    const section = document.createElement('div');
    section.className = 'dashboard-market-section';
    const heading = document.createElement('h2');
    heading.className = 'dashboard-market-heading';
    heading.textContent = market;
    section.appendChild(heading);

    const table = document.createElement('table');
    table.className = 'data-table dashboard-pool-table dashboard-cleanliness-table dashboard-inspection-table';
    table.innerHTML = '<thead><tr><th>Facility Name</th><th>Managerial Report</th><th>DES Pre-Inspection</th></tr></thead>';
    const tbody = document.createElement('tbody');
    renderRowsForPools(poolNames, tbody);
    table.appendChild(tbody);
    section.appendChild(table);
    renderInspectionDateFilter(section, managerialPeriod, desPeriod);
    container.appendChild(section);
    renderedAny = true;
  });

  if (!renderedAny) {
    container.insertAdjacentHTML('beforeend', '<p style="padding:8px 0;color:#666;">No inspection reports match the selected filters.</p>');
  }

  wrapResponsiveTables(container);
}

function loadManagerialFormSubmissions() {
  const container = document.getElementById('managerialFormsContent');
  if (!container) return;
  if (!isSupervisor()) {
    container.innerHTML = '<p style="padding:16px;color:#c0392b;">You do not have permission to view inspection reports.</p>';
    return;
  }
  renderInspectionReports();
}

function getAllSupplyItems() {
  return SUPPLY_SECTIONS.flatMap((section) =>
    section.items.map((item) => ({ ...item, section: section.label }))
  );
}

function getSupplySettingForPool(poolDoc, itemId) {
  const setting = poolDoc?.supplyInfo?.[itemId] || {};
  return {
    enabled: setting.enabled !== false,
    type: (setting.type || '').toString().trim(),
  };
}

function getSupplyNeedKey(row) {
  return [row.facilityId || row.facilityName, row.itemId].map((value) => String(value || '').trim()).join('::');
}

function getSupplyNeedGroupKey(row) {
  return [
    row.itemId || row.item,
    row.item,
  ].map((value) => String(value || '').trim().toLowerCase()).join('::');
}

function getSupplyNeedGroupStatus(rows) {
  const statuses = [...new Set(rows.map((row) => row.status).filter(Boolean))]
    .sort((a, b) => (SUPPLY_STATUS_PRIORITY[a] ?? 99) - (SUPPLY_STATUS_PRIORITY[b] ?? 99));
  return statuses.join(', ');
}

function getSupplyNeedGroupPriority(rows) {
  return Math.min(...rows.map((row) => SUPPLY_STATUS_PRIORITY[row.status] ?? 99));
}

function getSupplyNeedGroupType(rows) {
  const types = [...new Set(rows.map((row) => String(row.type || '').trim()).filter(Boolean))];
  if (!types.length) return '—';
  return types.join(', ');
}

function getGroupedNeededSupplyRows(rows) {
  const groups = new Map();
  rows
    .filter((row) => SUPPLY_NEED_STATUSES.has(row.status) && !supplyResolvedItems[getSupplyNeedKey(row)])
    .forEach((row) => {
      const key = getSupplyNeedGroupKey(row);
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          item: row.item,
          rows: [],
        });
      }
      groups.get(key).rows.push(row);
    });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      keys: group.rows.map(getSupplyNeedKey),
      type: getSupplyNeedGroupType(group.rows),
      status: getSupplyNeedGroupStatus(group.rows),
      priority: getSupplyNeedGroupPriority(group.rows),
    }))
    .sort((a, b) =>
      a.priority - b.priority
      || a.item.localeCompare(b.item)
      || a.rows[0].facilityName.localeCompare(b.rows[0].facilityName)
    );
}

function getLatestInventoryRows() {
  const latest = new Map();
  allInventoryReports.forEach((report) => {
    const timestamp = toDateObject(report.timestamp) || toDateObject(report.submittedAtIso) || new Date(0);
    (Array.isArray(report.items) ? report.items : []).forEach((item) => {
      const key = `${report.facilityId || report.facilityName || report.pool || ''}::${item.id || item.item || ''}`;
      if (!key.includes('::') || latest.has(key)) return;
      latest.set(key, {
        report,
        facilityId: report.facilityId || report.facilityName || report.pool || '',
        facilityName: report.facilityName || report.pool || '—',
        market: report.market || getPrimaryMarketName(getDashboardPoolDocByName(report.facilityName || report.pool)),
        itemId: item.id || item.item || '',
        item: item.item || item.label || item.id || '—',
        section: item.section || '',
        type: item.type || '',
        status: item.status || '',
        timestamp,
      });
    });
  });
  return Array.from(latest.values());
}

function renderSupplyNeedActions(container) {
  const row = document.createElement('div');
  row.className = 'supply-dashboard-actions';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = `editAndSave${supplyNeededEditMode ? ' active' : ''}`;
  edit.textContent = 'Edit';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = `editAndSave${!supplyNeededEditMode ? ' active' : ''}`;
  save.textContent = 'Save';
  const undo = document.createElement('button');
  undo.type = 'button';
  undo.className = 'editAndSave';
  undo.textContent = 'Undo';
  undo.disabled = !supplyUndoItem;
  edit.addEventListener('click', () => {
    supplyNeededEditMode = true;
    renderSuppliesDashboard();
  });
  save.addEventListener('click', () => {
    supplyNeededEditMode = false;
    renderSuppliesDashboard();
  });
  undo.addEventListener('click', async () => {
    if (!supplyUndoItem) return;
    const undoKeys = Array.isArray(supplyUndoItem) ? supplyUndoItem : [supplyUndoItem];
    undoKeys.forEach((key) => { delete supplyResolvedItems[key]; });
    supplyUndoItem = null;
    await setDoc(doc(db, 'settings', 'resolvedSupplyNeeds'), { items: supplyResolvedItems }, { merge: true }).catch(() => {});
    renderSuppliesDashboard();
  });
  row.append(edit, save, undo);
  container.appendChild(row);
}

function renderNeededSuppliesSection(container, rows) {
  const section = document.createElement('div');
  section.className = 'dashboard-market-section supply-dashboard-section';
  section.innerHTML = '<h2 class="dashboard-market-heading">Needed Supplies</h2>';
  renderSupplyNeedActions(section);

  const tableWrap = document.createElement('div');
  tableWrap.className = `supply-needed-table-wrap${supplyNeededEditMode ? '' : ' overlay-disabled'}`;
  const table = document.createElement('table');
  table.className = 'data-table dashboard-pool-table dashboard-supplies-table';
  table.innerHTML = '<thead><tr><th>Resolve By Pool</th><th>Item</th><th>Type</th><th>Status</th></tr></thead>';
  const tbody = document.createElement('tbody');
  const neededGroups = getGroupedNeededSupplyRows(rows);

  if (!neededGroups.length) {
    tbody.innerHTML = '<tr><td colspan="4">No needed supplies are currently listed.</td></tr>';
  } else {
    neededGroups.forEach((group) => {
      const tr = document.createElement('tr');
      const checkCell = document.createElement('td');
      const facilityList = document.createElement('div');
      facilityList.className = 'supply-needed-facility-checklist';
      const showFacilityStatuses = new Set(group.rows.map((row) => row.status)).size > 1;
      group.rows
        .sort((a, b) => a.facilityName.localeCompare(b.facilityName))
        .forEach((row) => {
          const rowKey = getSupplyNeedKey(row);
          const facilityItem = document.createElement('div');
          facilityItem.className = 'supply-needed-facility-check';
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'market-filter-checkbox';
          checkbox.disabled = !supplyNeededEditMode;
          checkbox.addEventListener('change', () => {
            if (!checkbox.checked) return;
            facilityItem.classList.add('supply-row-fading');
            window.setTimeout(async () => {
              supplyResolvedItems[rowKey] = true;
              supplyUndoItem = rowKey;
              await setDoc(doc(db, 'settings', 'resolvedSupplyNeeds'), { items: supplyResolvedItems }, { merge: true }).catch(() => {});
              renderSuppliesDashboard();
            }, 3000);
          });
          const facilityBtn = document.createElement('button');
          facilityBtn.type = 'button';
          facilityBtn.className = 'dashboard-link-button supply-needed-facility-button';
          facilityBtn.textContent = showFacilityStatuses
            ? `${row.facilityName || '—'} (${row.status})`
            : (row.facilityName || '—');
          facilityBtn.addEventListener('click', () => openInspectionMetaPopup({
            ...row.report,
            pool: row.facilityName,
            respondentName: getSubmissionRespondentName(row.report),
            submitterEmail: getSubmissionRespondentEmail(row.report),
            timestamp: row.report?.timestamp || row.report?.submittedAtIso,
          }, 'Inventory Details'));
          facilityItem.append(checkbox, facilityBtn);
          facilityList.appendChild(facilityItem);
        });
      checkCell.appendChild(facilityList);
      tr.appendChild(checkCell);
      tr.insertAdjacentHTML('beforeend', `
        <td>${escapeHtml(group.item)}</td>
        <td>${escapeHtml(group.type || '—')}</td>
        <td>${escapeHtml(group.status)}</td>
      `);
      tbody.appendChild(tr);
    });
  }

  table.appendChild(tbody);
  tableWrap.appendChild(table);
  section.appendChild(tableWrap);
  container.appendChild(section);
}

function renderSupplyFilterBar(container, onChange) {
  const filterBar = document.createElement('div');
  filterBar.className = 'training-filter-bar dashboard-filter-bar supply-filter-bar';
  filterBar.innerHTML = '<span class="filter-by-label">Filter By:</span>';
  const marketSelect = document.createElement('select');
  marketSelect.className = 'training-filter-select';
  marketSelect.innerHTML = '<option value="all">All Markets</option>';
  const poolSelect = document.createElement('select');
  poolSelect.className = 'training-filter-select';
  poolSelect.innerHTML = '<option value="all">All Pools</option>';

  const groups = getDashboardPoolOptions();
  groups.forEach(({ market }) => {
    const option = document.createElement('option');
    option.value = market;
    option.textContent = market;
    marketSelect.appendChild(option);
  });

  const poolsForFilter = dashboardSupplyFilters.market === 'all'
    ? groups
    : groups.filter(({ market }) => market === dashboardSupplyFilters.market);
  poolsForFilter.forEach(({ market, pools }) => {
    const group = document.createElement('optgroup');
    group.label = market;
    pools.forEach((poolName) => {
      const option = document.createElement('option');
      option.value = poolName;
      option.textContent = poolName;
      group.appendChild(option);
    });
    poolSelect.appendChild(group);
  });

  marketSelect.value = dashboardSupplyFilters.market;
  poolSelect.value = dashboardSupplyFilters.pool;
  if (poolSelect.value !== dashboardSupplyFilters.pool) {
    dashboardSupplyFilters.pool = 'all';
    poolSelect.value = 'all';
  }
  marketSelect.addEventListener('change', () => {
    dashboardSupplyFilters.market = marketSelect.value || 'all';
    dashboardSupplyFilters.pool = 'all';
    onChange();
  });
  poolSelect.addEventListener('change', () => {
    dashboardSupplyFilters.pool = poolSelect.value || 'all';
    onChange();
  });
  filterBar.append(marketSelect, poolSelect);
  container.appendChild(filterBar);
}

function getLatestReportForFacility(rows, facilityName) {
  return rows
    .filter((row) => row.facilityName === facilityName)
    .sort((a, b) => (b.timestamp?.getTime?.() || 0) - (a.timestamp?.getTime?.() || 0))[0]?.report || null;
}

function renderFullInventorySection(container, rows) {
  const section = document.createElement('div');
  section.className = 'dashboard-market-section supply-dashboard-section';
  section.innerHTML = '<h2 class="dashboard-market-heading">Full Inventory</h2>';
  renderSupplyFilterBar(section, renderSuppliesDashboard);

  const filteredRows = rows.filter((row) => {
    if (dashboardSupplyFilters.market !== 'all' && row.market !== dashboardSupplyFilters.market) return false;
    if (dashboardSupplyFilters.pool !== 'all' && row.facilityName !== dashboardSupplyFilters.pool) return false;
    return true;
  });
  const byFacility = new Map();
  filteredRows.forEach((row) => {
    if (!byFacility.has(row.facilityName)) byFacility.set(row.facilityName, []);
    byFacility.get(row.facilityName).push(row);
  });

  const table = document.createElement('table');
  table.className = 'data-table dashboard-pool-table dashboard-supplies-table dashboard-full-inventory-table';
  table.innerHTML = '<thead><tr><th>Facility</th><th>Items</th></tr></thead>';
  const tbody = document.createElement('tbody');
  if (!byFacility.size) {
    tbody.innerHTML = '<tr><td colspan="2">No inventory reports match the selected filters.</td></tr>';
  } else {
    Array.from(byFacility.entries()).sort(([a], [b]) => a.localeCompare(b)).forEach(([facilityName, facilityRows]) => {
      const tr = document.createElement('tr');
      tr.className = 'supply-facility-row';
      const detailId = `supply-detail-${facilityName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
      const latestReport = getLatestReportForFacility(facilityRows, facilityName) || {};
      tr.innerHTML = `
        <td>
          <button type="button" class="supply-expand-btn" aria-expanded="false" aria-controls="${escapeHtml(detailId)}">▸</button>
          <button type="button" class="dashboard-link-button supply-facility-meta-btn">${escapeHtml(facilityName)}</button>
        </td>
        <td>${facilityRows.length} item${facilityRows.length === 1 ? '' : 's'}</td>
      `;
      const detail = document.createElement('tr');
      detail.className = 'supply-facility-detail hidden';
      detail.id = detailId;
      detail.innerHTML = `<td colspan="2"><div class="supply-detail-grid">${
        facilityRows
          .sort((a, b) => (SUPPLY_STATUS_PRIORITY[a.status] ?? 99) - (SUPPLY_STATUS_PRIORITY[b.status] ?? 99) || a.item.localeCompare(b.item))
          .map((row) => `<div><strong>${escapeHtml(row.item)}</strong>${row.type ? ` (${escapeHtml(row.type)})` : ''}: ${escapeHtml(row.status || '—')}</div>`)
          .join('')
      }</div></td>`;
      tr.querySelector('.supply-facility-meta-btn')?.addEventListener('click', () => openInspectionMetaPopup({
        ...latestReport,
        pool: facilityName,
        respondentName: getSubmissionRespondentName(latestReport),
        submitterEmail: getSubmissionRespondentEmail(latestReport),
        timestamp: latestReport.timestamp || latestReport.submittedAtIso,
      }, 'Inventory Submission Details'));
      tr.querySelector('.supply-expand-btn')?.addEventListener('click', (event) => {
        const expanded = event.currentTarget.getAttribute('aria-expanded') === 'true';
        event.currentTarget.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        event.currentTarget.textContent = expanded ? '▸' : '▾';
        detail.classList.toggle('hidden', expanded);
      });
      tbody.append(tr, detail);
    });
  }

  table.appendChild(tbody);
  section.appendChild(table);
  container.appendChild(section);
}

function renderSuppliesDashboard() {
  const container = document.getElementById('dashboardSuppliesContent');
  if (!container) return;
  if (!isSupervisor()) {
    container.innerHTML = '<p style="padding:16px;color:#c0392b;">You do not have permission to view supply reports.</p>';
    return;
  }

  container.innerHTML = '';
  const latestRows = getLatestInventoryRows();
  renderNeededSuppliesSection(container, latestRows);
  renderFullInventorySection(container, latestRows);
  wrapResponsiveTables(container);
}

function getOperationalLogsForPoolOnDate(facilityName, poolIdx) {
  return operationalStatusLogs.filter((log) =>
    log.facilityName === facilityName
    && Number(log.poolIndex || 0) === Number(poolIdx || 0)
    && isDashboardDate(log.timestamp, dashboardDateFilter));
}

function renderOperationalDashboard() {
  const container = document.getElementById('operationalDashboardContent');
  if (!container) return;
  if (!isSupervisor()) {
    container.innerHTML = '<p style="padding:16px;color:#c0392b;">You do not have permission to view operational status reports.</p>';
    return;
  }

  container.innerHTML = '';
  renderDashboardFilterBar(container, () => renderOperationalDashboard());

  const marketMap = getDashboardMarketMap({ docs: true });
  const marketsToShow = getVisibleDashboardMarkets(marketMap);
  if (!marketsToShow.length) {
    container.insertAdjacentHTML('beforeend', '<p style="padding:16px;color:#666;">No markets selected. Enable markets in Settings.</p>');
    return;
  }

  if (dashboardPoolFilter !== 'all') {
    const selectedPoolDoc = getDashboardPoolDocByName(dashboardPoolFilter);
    const poolCount = Math.max(1, Number(selectedPoolDoc?.numPools || selectedPoolDoc?.poolCount || 1));
    const section = document.createElement('div');
    section.className = 'dashboard-market-section dashboard-single-pool-section';
    const heading = document.createElement('h2');
    heading.className = 'dashboard-market-heading';
    heading.textContent = dashboardPoolFilter;
    section.appendChild(heading);

    const tabBar = document.createElement('div');
    tabBar.className = 'dashboard-tab-bar';
    const tabPanels = [];

    for (let poolIdx = 0; poolIdx < poolCount; poolIdx += 1) {
      const tabBtn = document.createElement('button');
      tabBtn.type = 'button';
      tabBtn.className = 'dashboard-tab-btn' + (poolIdx === 0 ? ' active' : '');
      tabBtn.textContent = selectedPoolDoc ? getFacilityPoolLabel(selectedPoolDoc, poolIdx) : `Pool ${poolIdx + 1}`;
      tabBtn.dataset.tabIdx = String(poolIdx);
      tabBar.appendChild(tabBtn);

      const panel = document.createElement('div');
      panel.className = 'dashboard-tab-panel' + (poolIdx === 0 ? ' active' : '');
      panel.dataset.tabIdx = String(poolIdx);

      const table = document.createElement('table');
      table.className = 'data-table dashboard-pool-table dashboard-detail-table dashboard-operational-table';
      table.innerHTML = '<thead><tr><th>Facility Name</th><th>Pool</th><th>Fill Line/Hose</th><th>Bleach Feeder Rate</th><th>Weekly Backwash</th><th>Facility Open/Closed</th><th>Respondent</th><th>Timestamp</th></tr></thead>';
      const tbody = document.createElement('tbody');
      const rows = getOperationalLogsForPoolOnDate(dashboardPoolFilter, poolIdx);

      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="8">No operational status entries match the selected filters.</td></tr>';
      } else {
        rows.forEach((log) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${escapeHtml(log.facilityName || '—')}</td>
            <td>${escapeHtml(log.poolLabel || `Pool ${Number(log.poolIndex || 0) + 1}`)}</td>
            <td>${escapeHtml(log.fillStatus || '—')}</td>
            <td>${escapeHtml(log.bleachStatus || '—')}</td>
            <td>${escapeHtml(log.weeklyBackwashStatus ? formatWeeklyBackwashStatus(log.weeklyBackwashStatus) : '—')}</td>
            <td>${escapeHtml((log.closureStatus || log.closureReason) ? getOperationalClosureSummary(log) : '—')}</td>
            <td>${escapeHtml(getLogRespondentName(log))}</td>
            <td>${escapeHtml(formatTimestampDisplay(log.timestamp))}</td>
          `;
          tbody.appendChild(tr);
        });
      }

      table.appendChild(tbody);
      panel.appendChild(table);
      tabPanels.push(panel);
    }

    tabBar.addEventListener('click', (event) => {
      const btn = event.target.closest('.dashboard-tab-btn');
      if (!btn) return;
      const idx = btn.dataset.tabIdx;
      tabBar.querySelectorAll('.dashboard-tab-btn').forEach((tab) => tab.classList.toggle('active', tab === btn));
      tabPanels.forEach((panel) => panel.classList.toggle('active', panel.dataset.tabIdx === idx));
    });

    section.appendChild(tabBar);
    tabPanels.forEach((panel) => section.appendChild(panel));
    container.appendChild(section);
    wrapResponsiveTables(container);
    return;
  }

  let renderedAny = false;
  marketsToShow.forEach((market) => {
    const marketPools = marketMap[market] || [];
    if (!marketPools.length) return;

    const maxPools = Math.max(...marketPools.map((poolDoc) => Number(poolDoc?.numPools || poolDoc?.poolCount || 1)));
    const section = document.createElement('div');
    section.className = 'dashboard-market-section';
    const heading = document.createElement('h2');
    heading.className = 'dashboard-market-heading';
    heading.textContent = market;
    section.appendChild(heading);

    const tabBar = document.createElement('div');
    tabBar.className = 'dashboard-tab-bar';
    const tabPanels = [];

    for (let poolIdx = 0; poolIdx < maxPools; poolIdx += 1) {
      const tabBtn = document.createElement('button');
      tabBtn.type = 'button';
      tabBtn.className = 'dashboard-tab-btn' + (poolIdx === 0 ? ' active' : '');
      tabBtn.textContent = `Pool ${poolIdx + 1}`;
      tabBtn.dataset.tabIdx = String(poolIdx);
      tabBar.appendChild(tabBtn);

      const panel = document.createElement('div');
      panel.className = 'dashboard-tab-panel' + (poolIdx === 0 ? ' active' : '');
      panel.dataset.tabIdx = String(poolIdx);

      const table = document.createElement('table');
      table.className = 'data-table dashboard-pool-table dashboard-operational-table';
      table.innerHTML = '<thead><tr><th>Facility Name</th><th>Pool</th><th>Fill Line/Hose</th><th>Bleach Feeder Rate</th><th>Weekly Backwash</th><th>Facility Open/Closed</th><th>Respondent</th><th>Timestamp</th></tr></thead>';
      const tbody = document.createElement('tbody');
      let renderedRows = 0;

      marketPools.forEach((poolDoc) => {
        const facilityName = getPoolName(poolDoc);
        const poolCount = Math.max(1, Number(poolDoc?.numPools || poolDoc?.poolCount || 1));
        if (poolIdx >= poolCount) return;
        const poolLogs = getOperationalLogsForPoolOnDate(facilityName, poolIdx);
        const latestFillLog = poolLogs.find((log) => log.fillStatus);
        const latestBleachLog = poolLogs.find((log) => log.bleachStatus);
        const latestBackwashLog = poolLogs.find((log) => log.weeklyBackwashStatus);
        const latestClosureLog = poolLogs.find((log) => log.closureStatus || log.closureReason);
        const latestLog = poolLogs[0] || null;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(facilityName)}</td>
          <td>${escapeHtml(getFacilityPoolLabel(poolDoc, poolIdx))}</td>
          <td>${escapeHtml(latestFillLog?.fillStatus || '—')}</td>
          <td>${escapeHtml(latestBleachLog?.bleachStatus || '—')}</td>
          <td>${escapeHtml(latestBackwashLog?.weeklyBackwashStatus ? formatWeeklyBackwashStatus(latestBackwashLog.weeklyBackwashStatus) : '—')}</td>
          <td>${escapeHtml(latestClosureLog ? getOperationalClosureSummary(latestClosureLog) : '—')}</td>
          <td>${escapeHtml(latestLog ? getLogRespondentName(latestLog) : '—')}</td>
          <td>${escapeHtml(latestLog ? formatTimestampDisplay(latestLog.timestamp) : '—')}</td>
        `;
        tbody.appendChild(tr);
        renderedRows += 1;
        renderedAny = true;
      });

      if (!renderedRows) {
        tbody.innerHTML = '<tr><td colspan="8">No facilities have this pool.</td></tr>';
      }

      table.appendChild(tbody);
      panel.appendChild(table);
      tabPanels.push(panel);
    }

    tabBar.addEventListener('click', (event) => {
      const btn = event.target.closest('.dashboard-tab-btn');
      if (!btn) return;
      const idx = btn.dataset.tabIdx;
      tabBar.querySelectorAll('.dashboard-tab-btn').forEach((tab) => tab.classList.toggle('active', tab === btn));
      tabPanels.forEach((panel) => panel.classList.toggle('active', panel.dataset.tabIdx === idx));
    });

    section.appendChild(tabBar);
    tabPanels.forEach((panel) => section.appendChild(panel));
    container.appendChild(section);
  });

  if (!renderedAny) {
    container.insertAdjacentHTML('beforeend', '<p style="padding:8px 0;color:#666;">No operational status entries match the selected filters.</p>');
  }

  wrapResponsiveTables(container);
}

function formatMetricsDate(date) {
  const d = toDateObject(date);
  if (!d) return '';
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

function metricsWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function metricsWeekLabel(date) {
  const start = metricsWeekStart(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${formatMetricsDate(start)} - ${formatMetricsDate(end)}`;
}

function filterDashboardRecordsByTime(records, timeLabel) {
  const now = new Date();
  const start = new Date(now);
  if (timeLabel === 'Past Week') start.setDate(now.getDate() - 7);
  else if (timeLabel === 'Past 2 Weeks') start.setDate(now.getDate() - 14);
  else if (timeLabel === 'Past Month') start.setMonth(now.getMonth() - 1);
  else if (timeLabel === 'Past 3 Months') start.setMonth(now.getMonth() - 3);
  else if (timeLabel === 'This Calendar Year') start.setMonth(0, 1);
  else return records;
  start.setHours(0, 0, 0, 0);
  return records.filter((record) => {
    const date = toDateObject(record.timestamp);
    return date && date >= start && date <= now;
  });
}

function dashboardMetricsBucketMode() {
  if (dashboardMetricsFilters.time === 'Past Week' || dashboardMetricsFilters.time === 'Past 2 Weeks') return 'day';
  if (dashboardMetricsFilters.time === 'Past Month' || dashboardMetricsFilters.time === 'Past 3 Months') return 'week';
  return 'month';
}

function dashboardMetricsBucketStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const mode = dashboardMetricsBucketMode();
  if (mode === 'week') return metricsWeekStart(d);
  if (mode === 'month') return new Date(d.getFullYear(), d.getMonth(), 1);
  return d;
}

function dashboardMetricsBucketLabel(date) {
  const mode = dashboardMetricsBucketMode();
  if (mode === 'day') return formatMetricsDate(date);
  if (mode === 'week') return metricsWeekLabel(date);
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

function parseChemMetricValue(type, rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;
  if (type === 'ph') {
    if (raw === '< 7.0') return 6.9;
    if (raw === '> 8.0') return 8.1;
  }
  if (type === 'cl' && raw === '> 10') return 10.5;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function getVisibleMetricsMarketsSet() {
  const marketMap = Object.fromEntries(groupPoolsByMarket(poolsCache).map(({ market, pools }) => [market, pools]));
  return new Set(getVisibleDashboardMarkets(marketMap));
}

function metricsRecordMatchesFilters(record) {
  const visibleMarkets = getVisibleMetricsMarketsSet();
  if (!visibleMarkets.has(record.market)) return false;
  if (dashboardMetricsFilters.market !== 'all' && record.market !== dashboardMetricsFilters.market) return false;
  if (dashboardMetricsFilters.pool !== 'all' && record.facilityName !== dashboardMetricsFilters.pool) return false;
  return true;
}

function buildChemMetricSamples(metricType) {
  const samples = [];
  allLogs.forEach((log) => {
    const facilityName = String(log.poolLocation || '').trim();
    if (!facilityName) return;
    const poolDoc = getDashboardPoolDocByName(facilityName);
    if (!poolDoc) return;
    const market = getPrimaryMarketName(poolDoc);
    const poolCount = Math.max(1, Number(poolDoc?.numPools || poolDoc?.poolCount || 1));
    for (let poolIdx = 0; poolIdx < poolCount; poolIdx += 1) {
      const fields = poolFieldNames(poolIdx);
      const rawValue = metricType === 'ph' ? log?.[fields.ph] : log?.[fields.cl];
      const value = parseChemMetricValue(metricType, rawValue);
      if (value === null) continue;
      samples.push({
        market,
        facilityName,
        poolIdx,
        poolLabel: getFacilityPoolLabel(poolDoc, poolIdx),
        value,
        timestamp: log.timestamp,
      });
    }
  });
  return filterDashboardRecordsByTime(samples, dashboardMetricsFilters.time).filter(metricsRecordMatchesFilters);
}

function buildCyaMetricSamples() {
  const samples = [];
  allManagerialReports.forEach((report) => {
    const facilityName = String(report.pool || '').trim();
    if (!facilityName || !report.cyaReadings) return;
    const poolDoc = getDashboardPoolDocByName(facilityName);
    if (!poolDoc) return;
    const market = getPrimaryMarketName(poolDoc);
    Object.entries(report.cyaReadings || {}).forEach(([key, rawValue]) => {
      const poolIdx = Math.max(0, Number(String(key).replace('pool', '')) - 1);
      const value = Number(rawValue);
      if (!Number.isFinite(value)) return;
      samples.push({
        market,
        facilityName,
        poolIdx,
        poolLabel: getFacilityPoolLabel(poolDoc, poolIdx),
        value,
        timestamp: report.timestamp,
      });
    });
  });
  return filterDashboardRecordsByTime(samples, dashboardMetricsFilters.time).filter(metricsRecordMatchesFilters);
}

function buildAverageMetricSeries(records) {
  const grouped = new Map();
  records.forEach((record) => {
    const date = toDateObject(record.timestamp);
    if (!date) return;
    const start = dashboardMetricsBucketStart(date);
    const key = start.toISOString();
    if (!grouped.has(key)) grouped.set(key, {
      date: start,
      total: 0,
      count: 0,
    });
    const bucket = grouped.get(key);
    bucket.total += record.value;
    bucket.count += 1;
  });

  return [...grouped.values()]
    .filter((bucket) => bucket.count > 0)
    .sort((a, b) => a.date - b.date)
    .map((bucket) => ({
      label: dashboardMetricsBucketLabel(bucket.date),
      value: bucket.total / bucket.count,
      count: bucket.count,
    }));
}

function buildDailyClVarianceVsCyaPoints() {
  const clRecords = buildChemMetricSamples('cl');
  const cyaRecords = buildCyaMetricSamples();

  const clByDay = new Map();
  clRecords.forEach((record) => {
    const date = toDateObject(record.timestamp);
    if (!date) return;
    const dayKey = formatDateInputValue(date);
    const key = `${record.facilityName}::${record.poolIdx}::${dayKey}`;
    if (!clByDay.has(key)) {
      clByDay.set(key, {
        facilityName: record.facilityName,
        poolIdx: record.poolIdx,
        poolLabel: record.poolLabel,
        date,
        values: [],
      });
    }
    clByDay.get(key).values.push(record.value);
  });

  const cyaByDay = new Map();
  cyaRecords.forEach((record) => {
    const date = toDateObject(record.timestamp);
    if (!date) return;
    const dayKey = formatDateInputValue(date);
    const key = `${record.facilityName}::${record.poolIdx}::${dayKey}`;
    if (!cyaByDay.has(key)) {
      cyaByDay.set(key, {
        total: 0,
        count: 0,
      });
    }
    const bucket = cyaByDay.get(key);
    bucket.total += record.value;
    bucket.count += 1;
  });

  return [...clByDay.entries()].map(([key, entry]) => {
    const cyaEntry = cyaByDay.get(key);
    if (!cyaEntry || !entry.values.length) return null;
    const clAverage = entry.values.reduce((sum, value) => sum + value, 0) / entry.values.length;
    const variance = entry.values.reduce((sum, value) => sum + ((value - clAverage) ** 2), 0) / entry.values.length;
    return {
      x: cyaEntry.total / cyaEntry.count,
      y: variance,
      label: `${formatMetricsDate(entry.date)} • ${entry.facilityName} • ${entry.poolLabel}`,
    };
  }).filter(Boolean);
}

function getGraphDomain(values, { includeZero = false, minSpan = 1 } = {}) {
  if (!values.length) return { min: 0, max: 1 };
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (includeZero) min = Math.min(0, min);
  if (min === max) {
    const half = minSpan / 2;
    return { min: min - half, max: max + half };
  }
  const span = Math.max(max - min, minSpan);
  const padding = span * 0.12;
  return {
    min: min - padding,
    max: max + padding,
  };
}

function buildBestFitPath(points, xAccessor, yAccessor, toX, toY) {
  const n = points.length;
  if (n < 2) return '';
  const sumX = points.reduce((sum, point) => sum + xAccessor(point), 0);
  const sumY = points.reduce((sum, point) => sum + yAccessor(point), 0);
  const sumXY = points.reduce((sum, point) => sum + xAccessor(point) * yAccessor(point), 0);
  const sumXX = points.reduce((sum, point) => sum + xAccessor(point) * xAccessor(point), 0);
  const denom = (n * sumXX - sumX * sumX) || 1;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const startX = xAccessor(points[0]);
  const endX = xAccessor(points[n - 1]);
  const startY = slope * startX + intercept;
  const endY = slope * endX + intercept;
  return `M ${toX(startX)} ${toY(startY)} L ${toX(endX)} ${toY(endY)}`;
}

function renderMetricsLineChart(container, {
  title,
  emptyMessage,
  series,
  yLabel,
  valueFormatter = (value) => value.toFixed(2),
  includeZero = false,
  minSpan = 1,
} = {}) {
  const card = document.createElement('section');
  card.className = 'dashboard-metrics-chart-card';
  card.innerHTML = `<h3>${escapeHtml(title || '')}</h3>`;

  if (!series.length) {
    card.insertAdjacentHTML('beforeend', `<p class="dashboard-metrics-empty">${escapeHtml(emptyMessage || 'No data available for the selected filters.')}</p>`);
    container.appendChild(card);
    return;
  }

  const width = 1040;
  const height = 360;
  const margin = { top: 22, right: 88, bottom: 92, left: 70 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const xStep = series.length > 1 ? innerW / (series.length - 1) : 0;
  const domain = getGraphDomain(series.map((point) => point.value), { includeZero, minSpan });
  const toX = (idx) => margin.left + idx * xStep;
  const toY = (value) => margin.top + (domain.max - value) * (innerH / (domain.max - domain.min || 1));
  const points = series.map((point, idx) => ({ ...point, idx, x: toX(idx), y: toY(point.value) }));
  const linePath = points.map((point, idx) => `${idx === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const bestFitPath = buildBestFitPath(points, (point) => point.idx, (point) => point.value, toX, toY);
  const tickValues = Array.from({ length: 5 }, (_, idx) => domain.min + ((domain.max - domain.min) * idx) / 4);

  const yTicks = tickValues.map((value) => {
    const y = toY(value);
    return `
      <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" class="emp-graph-grid"/>
      <text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" class="emp-graph-axis-text">${escapeHtml(valueFormatter(value))}</text>
    `;
  }).join('');

  const xTicks = points.map((point) => `
    <line x1="${point.x}" y1="${height - margin.bottom}" x2="${point.x}" y2="${height - margin.bottom + 6}" class="emp-graph-axis"/>
    <text x="${point.x}" y="${height - margin.bottom + 22}" text-anchor="end" transform="rotate(-60 ${point.x} ${height - margin.bottom + 22})" class="emp-graph-axis-text emp-graph-xlabel">${escapeHtml(point.label)}</text>
  `).join('');

  const circles = points.map((point) => `
    <circle cx="${point.x}" cy="${point.y}" r="4.8" fill="#69140e">
      <title>${escapeHtml(`${point.label}: ${valueFormatter(point.value)}`)}</title>
    </circle>
  `).join('');

  card.insertAdjacentHTML('beforeend', `
    <div class="dashboard-metrics-scroll-shell">
      <div class="emp-graph-wrap">
        <svg viewBox="0 0 ${width} ${height}" class="emp-line-graph" role="img" aria-label="${escapeHtml(title || 'Metrics graph')}">
          ${yTicks}
          <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" class="emp-graph-axis"/>
          <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" class="emp-graph-axis"/>
          <path d="${linePath}" class="emp-graph-line"/>
          ${bestFitPath ? `<path d="${bestFitPath}" class="emp-graph-bestfit"/>` : ''}
          ${circles}
          ${xTicks}
          <text x="${width / 2}" y="${height - 8}" text-anchor="middle" class="emp-graph-label">Time</text>
          <text x="18" y="${height / 2}" text-anchor="middle" transform="rotate(-90 18 ${height / 2})" class="emp-graph-label">${escapeHtml(yLabel || '')}</text>
        </svg>
      </div>
    </div>
  `);
  container.appendChild(card);
  bindHorizontalScrollShadow(card.querySelector('.emp-graph-wrap'));
}

function renderMetricsScatterChart(container, {
  title,
  emptyMessage,
  points,
  xLabel,
  yLabel,
  xFormatter = (value) => value.toFixed(1),
  yFormatter = (value) => value.toFixed(2),
} = {}) {
  const card = document.createElement('section');
  card.className = 'dashboard-metrics-chart-card';
  card.innerHTML = `<h3>${escapeHtml(title || '')}</h3>`;

  if (!points.length) {
    card.insertAdjacentHTML('beforeend', `<p class="dashboard-metrics-empty">${escapeHtml(emptyMessage || 'No data available for the selected filters.')}</p>`);
    container.appendChild(card);
    return;
  }

  const width = 1040;
  const height = 360;
  const margin = { top: 24, right: 54, bottom: 72, left: 70 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const xDomain = getGraphDomain(points.map((point) => point.x), { includeZero: true, minSpan: 1 });
  const yDomain = getGraphDomain(points.map((point) => point.y), { includeZero: true, minSpan: 0.2 });
  const toX = (value) => margin.left + ((value - xDomain.min) / (xDomain.max - xDomain.min || 1)) * innerW;
  const toY = (value) => margin.top + ((yDomain.max - value) / (yDomain.max - yDomain.min || 1)) * innerH;
  const circles = points.map((point) => `
    <circle cx="${toX(point.x)}" cy="${toY(point.y)}" r="5.2" class="emp-graph-point emp-graph-point--scatter">
      <title>${escapeHtml(`${point.label}: CYA ${xFormatter(point.x)}, Cl variance ${yFormatter(point.y)}`)}</title>
    </circle>
  `).join('');

  const xTicks = Array.from({ length: 5 }, (_, idx) => xDomain.min + ((xDomain.max - xDomain.min) * idx) / 4)
    .map((value) => `
      <line x1="${toX(value)}" y1="${height - margin.bottom}" x2="${toX(value)}" y2="${height - margin.bottom + 6}" class="emp-graph-axis"/>
      <text x="${toX(value)}" y="${height - margin.bottom + 22}" text-anchor="middle" class="emp-graph-axis-text">${escapeHtml(xFormatter(value))}</text>
    `).join('');

  const yTicks = Array.from({ length: 5 }, (_, idx) => yDomain.min + ((yDomain.max - yDomain.min) * idx) / 4)
    .map((value) => `
      <line x1="${margin.left}" y1="${toY(value)}" x2="${width - margin.right}" y2="${toY(value)}" class="emp-graph-grid"/>
      <text x="${margin.left - 10}" y="${toY(value) + 4}" text-anchor="end" class="emp-graph-axis-text">${escapeHtml(yFormatter(value))}</text>
    `).join('');

  card.insertAdjacentHTML('beforeend', `
    <div class="dashboard-metrics-scroll-shell">
      <div class="emp-graph-wrap">
        <svg viewBox="0 0 ${width} ${height}" class="emp-line-graph" role="img" aria-label="${escapeHtml(title || 'Metrics scatter graph')}">
          ${yTicks}
          <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" class="emp-graph-axis"/>
          <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" class="emp-graph-axis"/>
          ${circles}
          ${xTicks}
          <text x="${width / 2}" y="${height - 8}" text-anchor="middle" class="emp-graph-label">${escapeHtml(xLabel || '')}</text>
          <text x="18" y="${height / 2}" text-anchor="middle" transform="rotate(-90 18 ${height / 2})" class="emp-graph-label">${escapeHtml(yLabel || '')}</text>
        </svg>
      </div>
    </div>
  `);
  container.appendChild(card);
  bindHorizontalScrollShadow(card.querySelector('.emp-graph-wrap'));
}

function renderDashboardMetrics() {
  const container = document.getElementById('dashboardMetricsContent');
  if (!container) return;
  if (!isSupervisor()) {
    container.innerHTML = '<p style="padding:16px;color:#c0392b;">You do not have permission to view dashboard metrics.</p>';
    return;
  }

  const groupedMarkets = groupPoolsByMarket(poolsCache);
  const visibleMarkets = getVisibleDashboardMarkets(
    Object.fromEntries(groupedMarkets.map(({ market, pools }) => [market, pools]))
  );
  if (!visibleMarkets.length) {
    container.innerHTML = '<p style="padding:16px;color:#666;">No markets selected. Enable markets in Settings.</p>';
    return;
  }
  if (dashboardMetricsFilters.market !== 'all' && !visibleMarkets.includes(dashboardMetricsFilters.market)) {
    dashboardMetricsFilters.market = 'all';
  }
  if (dashboardMetricsFilters.pool !== 'all') {
    const selectedPool = getDashboardPoolDocByName(dashboardMetricsFilters.pool);
    const selectedPoolMarket = selectedPool ? getPrimaryMarketName(selectedPool) : null;
    if (!selectedPool || (dashboardMetricsFilters.market !== 'all' && selectedPoolMarket !== dashboardMetricsFilters.market)) {
      dashboardMetricsFilters.pool = 'all';
    }
  }

  container.innerHTML = '';
  const filterBar = document.createElement('div');
  filterBar.className = 'emp-global-filter-bar dashboard-metrics-filter-bar';
  filterBar.innerHTML = `
    <span class="filter-by-label">Filter By:</span>
    <select id="dashboardMetricsMarketFilter" class="training-filter-select">
      <option value="all">All Markets</option>
    </select>
    <select id="dashboardMetricsPoolFilter" class="training-filter-select">
      <option value="all">All Pools</option>
    </select>
    <select id="dashboardMetricsTimeFilter" class="training-filter-select">
      <option value="All Time">All Time</option>
      <option value="Past Week">Past Week</option>
      <option value="Past 2 Weeks">Past 2 Weeks</option>
      <option value="Past Month">Past Month</option>
      <option value="Past 3 Months">Past 3 Months</option>
      <option value="This Calendar Year">This Calendar Year</option>
    </select>
  `;
  container.appendChild(filterBar);

  const marketSelect = filterBar.querySelector('#dashboardMetricsMarketFilter');
  const poolSelect = filterBar.querySelector('#dashboardMetricsPoolFilter');
  const timeSelect = filterBar.querySelector('#dashboardMetricsTimeFilter');

  visibleMarkets.forEach((market) => {
    const option = document.createElement('option');
    option.value = market;
    option.textContent = market;
    marketSelect.appendChild(option);
  });
  marketSelect.value = dashboardMetricsFilters.market;
  if (marketSelect.value !== dashboardMetricsFilters.market) {
    dashboardMetricsFilters.market = 'all';
    marketSelect.value = 'all';
  }

  const visibleMarketSet = new Set(visibleMarkets);
  const eligiblePools = groupedMarkets
    .filter(({ market }) => visibleMarketSet.has(market) && (dashboardMetricsFilters.market === 'all' || market === dashboardMetricsFilters.market))
    .flatMap(({ market, pools }) => pools.map((pool) => ({ market, pool })));
  eligiblePools.forEach(({ market, pool }) => {
    const option = document.createElement('option');
    option.value = getPoolName(pool);
    option.textContent = getPoolName(pool);
    option.dataset.market = market;
    poolSelect.appendChild(option);
  });
  poolSelect.value = dashboardMetricsFilters.pool;
  if (poolSelect.value !== dashboardMetricsFilters.pool) {
    dashboardMetricsFilters.pool = 'all';
    poolSelect.value = 'all';
  }

  timeSelect.value = dashboardMetricsFilters.time;

  marketSelect.addEventListener('change', () => {
    dashboardMetricsFilters.market = marketSelect.value || 'all';
    dashboardMetricsFilters.pool = 'all';
    renderDashboardMetrics();
  });
  poolSelect.addEventListener('change', () => {
    dashboardMetricsFilters.pool = poolSelect.value || 'all';
    renderDashboardMetrics();
  });
  timeSelect.addEventListener('change', () => {
    dashboardMetricsFilters.time = timeSelect.value || 'All Time';
    renderDashboardMetrics();
  });

  const grid = document.createElement('div');
  grid.className = 'dashboard-metrics-grid';
  container.appendChild(grid);

  const phSeries = buildAverageMetricSeries(buildChemMetricSamples('ph'));
  const clSeries = buildAverageMetricSeries(buildChemMetricSamples('cl'));
  const cyaSeries = buildAverageMetricSeries(buildCyaMetricSamples());
  const clVariancePoints = buildDailyClVarianceVsCyaPoints();

  renderMetricsLineChart(grid, {
    title: 'pH vs Time',
    emptyMessage: 'No pH readings match the selected filters.',
    series: phSeries,
    yLabel: 'Average pH',
    valueFormatter: (value) => value.toFixed(2),
    minSpan: 0.2,
  });
  renderMetricsLineChart(grid, {
    title: 'Cl Level vs Time',
    emptyMessage: 'No chlorine readings match the selected filters.',
    series: clSeries,
    yLabel: 'Average Cl',
    valueFormatter: (value) => value.toFixed(2),
    includeZero: true,
    minSpan: 1,
  });
  renderMetricsLineChart(grid, {
    title: 'CYA Level vs Time',
    emptyMessage: 'No CYA readings match the selected filters.',
    series: cyaSeries,
    yLabel: 'Average CYA',
    valueFormatter: (value) => value.toFixed(1),
    includeZero: true,
    minSpan: 5,
  });
  renderMetricsScatterChart(grid, {
    title: 'Daily Cl Variance vs CYA Level',
    emptyMessage: 'You need same-day Cl and CYA readings to draw this graph.',
    points: clVariancePoints,
    xLabel: 'Average CYA',
    yLabel: 'Daily Cl Variance',
    xFormatter: (value) => value.toFixed(1),
    yFormatter: (value) => value.toFixed(2),
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

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseScaleNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mixColor(startHex, endHex, amount) {
  const parse = (hex) => {
    const clean = hex.replace('#', '');
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  };
  const [sr, sg, sb] = parse(startHex);
  const [er, eg, eb] = parse(endHex);
  const t = clampNumber(amount, 0, 1);
  const toHex = (n) => Math.round(n).toString(16).padStart(2, '0');
  return `#${toHex(sr + (er - sr) * t)}${toHex(sg + (eg - sg) * t)}${toHex(sb + (eb - sb) * t)}`;
}

function colorFromStops(value, stops) {
  const v = clampNumber(value, stops[0].value, stops[stops.length - 1].value);
  for (let i = 0; i < stops.length - 1; i++) {
    const current = stops[i];
    const next = stops[i + 1];
    if (v >= current.value && v <= next.value) {
      const span = next.value - current.value || 1;
      return mixColor(current.color, next.color, (v - current.value) / span);
    }
  }
  return stops[stops.length - 1].color;
}

const DUTY_SCALE_RED = '#a40000';
const DUTY_SCALE_YELLOW = '#d4a900';
const DUTY_SCALE_GREEN = '#18873b';

function getDutyScaleConfig(type, rawValue) {
  const value = parseScaleNumber(rawValue);
  if (value === null) return null;

  if (type === 'cya') {
    return {
      percent: clampNumber(value, 0, 100),
      color: colorFromStops(value, [
        { value: 0, color: DUTY_SCALE_RED },
        { value: 10, color: DUTY_SCALE_RED },
        { value: 30, color: DUTY_SCALE_YELLOW },
        { value: 50, color: DUTY_SCALE_GREEN },
        { value: 60, color: DUTY_SCALE_YELLOW },
        { value: 70, color: DUTY_SCALE_RED },
        { value: 100, color: DUTY_SCALE_RED },
      ]),
      trackClass: 'duty-scale-track-cya',
    };
  }

  if (type === 'acid') {
    return {
      percent: clampNumber((value / 30) * 100, 0, 100),
      color: colorFromStops(value, [
        { value: 0, color: DUTY_SCALE_RED },
        { value: 15, color: DUTY_SCALE_YELLOW },
        { value: 30, color: DUTY_SCALE_GREEN },
      ]),
      trackClass: 'duty-scale-track-acid',
    };
  }

  return {
    percent: clampNumber(value, 0, 100),
    color: colorFromStops(value, [
      { value: 0, color: DUTY_SCALE_RED },
      { value: 50, color: DUTY_SCALE_YELLOW },
      { value: 100, color: DUTY_SCALE_GREEN },
    ]),
    trackClass: 'duty-scale-track-linear',
  };
}

function dutyScaleHtml(label, value, unit, type) {
  const config = getDutyScaleConfig(type, value);
  if (!config) return '';
  const displayValue = `${escapeHtml(value)}${escapeHtml(unit || '')}`;
  return `
    <div class="duty-scale-row">
      <div class="duty-scale-label-row">
        <span>${escapeHtml(label)}</span>
        <strong>${displayValue}</strong>
      </div>
      <div class="duty-scale-track ${config.trackClass}">
        <span class="duty-scale-marker" style="left:${config.percent}%;background:${config.color};"></span>
      </div>
    </div>
  `;
}

function isFirestoreDutyPhoto(photo) {
  const url = String(photo?.url || '');
  return photo?.source === FIRESTORE_DUTY_PHOTO_STORAGE || url.startsWith(`${FIRESTORE_DUTY_PHOTO_STORAGE}:`);
}

function getDutyPhotoCacheKey(photo) {
  const url = String(photo?.url || '');
  if (url.startsWith(`${FIRESTORE_DUTY_PHOTO_STORAGE}:`)) return url;
  if (photo?.submissionId && photo?.photoId) {
    return `${FIRESTORE_DUTY_PHOTO_STORAGE}:${photo.submissionId}:${photo.photoId}`;
  }
  return url || `${photo?.submissionId || ''}:${photo?.photoId || ''}`;
}

async function getFirestoreDutyPhotoDataUrl(photo) {
  const cacheKey = getDutyPhotoCacheKey(photo);
  if (dutyPhotoDataUrlMap.has(cacheKey)) return dutyPhotoDataUrlMap.get(cacheKey);

  let submissionId = String(photo?.submissionId || '');
  let photoId = String(photo?.photoId || '');
  if ((!submissionId || !photoId) && cacheKey.startsWith(`${FIRESTORE_DUTY_PHOTO_STORAGE}:`)) {
    const parts = cacheKey.split(':');
    submissionId = submissionId || parts[1] || '';
    photoId = photoId || parts[2] || '';
  }
  if (!submissionId || !photoId) throw new Error('Duty photo reference is incomplete.');

  const chunksSnap = await getDocs(collection(db, 'dutySubmissionMedia', submissionId, 'photos', photoId, 'chunks'));
  const chunks = chunksSnap.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
    .sort((a, b) => Number(a.index ?? a.id) - Number(b.index ?? b.id))
    .map((chunk) => chunk.data || '');

  if (!chunks.length) throw new Error('Duty photo chunks were not found.');

  const prefix = photo.dataUrlPrefix || `data:${photo.contentType || 'image/jpeg'};base64`;
  const dataUrl = `${prefix},${chunks.join('')}`;
  dutyPhotoDataUrlMap.set(cacheKey, dataUrl);
  return dataUrl;
}

function getDesInspectionPhotoCacheKey(photo) {
  const url = String(photo?.url || '');
  if (url.startsWith(`${FIRESTORE_DES_PRE_INSPECTION_PHOTO_STORAGE}:`)) return url;
  if (photo?.submissionId && photo?.photoId) {
    return `${FIRESTORE_DES_PRE_INSPECTION_PHOTO_STORAGE}:${photo.submissionId}:${photo.photoId}`;
  }
  return url || `${photo?.submissionId || ''}:${photo?.photoId || ''}`;
}

async function getFirestoreDesInspectionPhotoDataUrl(photo) {
  const cacheKey = getDesInspectionPhotoCacheKey(photo);
  if (desInspectionPhotoDataUrlMap.has(cacheKey)) return desInspectionPhotoDataUrlMap.get(cacheKey);

  let submissionId = String(photo?.submissionId || '');
  let photoId = String(photo?.photoId || '');
  if ((!submissionId || !photoId) && cacheKey.startsWith(`${FIRESTORE_DES_PRE_INSPECTION_PHOTO_STORAGE}:`)) {
    const parts = cacheKey.split(':');
    submissionId = submissionId || parts[1] || '';
    photoId = photoId || parts[2] || '';
  }
  if (!submissionId || !photoId) throw new Error('DES pre-inspection photo reference is incomplete.');

  const chunksSnap = await getDocs(collection(db, 'desPreInspectionMedia', submissionId, 'photos', photoId, 'chunks'));
  const chunks = chunksSnap.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
    .sort((a, b) => Number(a.index ?? a.id) - Number(b.index ?? b.id))
    .map((chunk) => chunk.data || '');
  if (!chunks.length) throw new Error('DES pre-inspection photo chunks were not found.');

  const prefix = photo.dataUrlPrefix || `data:${photo.contentType || 'image/jpeg'};base64`;
  const dataUrl = `${prefix},${chunks.join('')}`;
  desInspectionPhotoDataUrlMap.set(cacheKey, dataUrl);
  return dataUrl;
}

function getDesInspectionItems(sub) {
  if (Array.isArray(sub?.inspectionItems)) return sub.inspectionItems;
  if (sub?.answers && typeof sub.answers === 'object') {
    return Object.entries(sub.answers).map(([id, item]) => ({
      id,
      label: item?.label || id,
      answer: item?.answer || '',
      notes: item?.notes || '',
      photos: item?.photos || [],
    }));
  }
  return [];
}

async function hydrateDesInspectionPhotos(root) {
  const images = Array.from(root.querySelectorAll('[data-des-photo-meta]'));
  await Promise.all(images.map(async (img) => {
    try {
      const meta = JSON.parse(decodeURIComponent(img.dataset.desPhotoMeta || ''));
      const fullUrl = await getFirestoreDesInspectionPhotoDataUrl(meta);
      img.src = fullUrl;
      img.dataset.fullUrl = fullUrl;
      img.classList.remove('duty-report-photo--loading');
      img.addEventListener('click', () => window.openPhotoModal(fullUrl, images.map((node) => node.dataset.fullUrl).filter(Boolean)));
    } catch (err) {
      console.error('[DES] Could not load submitted photo:', err);
      img.classList.remove('duty-report-photo--loading');
      img.classList.add('duty-report-photo--error');
    }
  }));
}

function openDesPreInspectionModal(sub) {
  let modal = document.getElementById('desInspectionModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'desInspectionModal';
    modal.className = 'duty-report-modal des-inspection-modal';
    modal.addEventListener('click', (event) => {
      if (event.target === modal) window.closeDesPreInspectionModal();
    });
    document.body.appendChild(modal);
  }

  const esc = escapeHtml;
  const ts = toDateObject(sub.timestamp);
  const photoHtml = (photos) => {
    if (!Array.isArray(photos) || !photos.length) return '';
    return `<div class="duty-report-photo-grid des-inspection-photo-grid">
      ${photos.map((photo) => {
        const meta = encodeURIComponent(JSON.stringify(photo || {}));
        return `<img src="${EMPTY_INLINE_IMAGE}" alt="${esc(photo?.name || 'DES photo')}" class="duty-report-photo duty-report-photo--loading" data-des-photo-meta="${meta}">`;
      }).join('')}
    </div>`;
  };
  const items = getDesInspectionItems(sub);
  modal.innerHTML = `
    <div class="duty-report-modal-card des-inspection-modal-card">
      <div class="modal-header duty-report-modal-header">
        <h2>DES Pre-Inspection</h2>
        <button type="button" class="close" onclick="window.closeDesPreInspectionModal()">&times;</button>
      </div>
      <div class="duty-report-modal-scroll">
        <div class="duty-report-meta">
          <p><strong>Pool:</strong> ${esc(sub.pool || '—')}</p>
          <p><strong>Respondent:</strong> ${esc(getSubmissionRespondentName(sub))}</p>
          <p><strong>Submitted:</strong> ${ts ? ts.toLocaleString() : '—'}</p>
        </div>
        <section class="des-inspection-item-list">
          ${items.length ? items.map((item) => `
            <article class="des-inspection-review-item">
              <h3>${esc(item.label || item.id || 'Inspection item')}</h3>
              <p><strong>Answer:</strong> ${esc(item.answer || '—')}</p>
              ${item.notes ? `<div class="duty-report-notes"><strong>Notes:</strong><span>${esc(item.notes)}</span></div>` : ''}
              ${photoHtml(item.photos)}
            </article>
          `).join('') : '<p>No inspection item details were recorded.</p>'}
        </section>
      </div>
    </div>`;

  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('visible'));
  hydrateDesInspectionPhotos(modal).catch((err) => {
    console.error('[DES] Could not hydrate submitted photos:', err);
  });
}

window.closeDesPreInspectionModal = function closeDesPreInspectionModal() {
  const modal = document.getElementById('desInspectionModal');
  if (!modal) return;
  modal.classList.remove('visible');
  window.setTimeout(() => {
    if (!modal.classList.contains('visible')) modal.style.display = 'none';
  }, 250);
};

async function hydrateDutyReportPhotos(root) {
  if (!root) return;
  const images = Array.from(root.querySelectorAll('[data-duty-photo-meta]'));
  await Promise.all(images.map(async (img) => {
    try {
      const meta = JSON.parse(decodeURIComponent(img.dataset.dutyPhotoMeta || ''));
      const fullUrl = isFirestoreDutyPhoto(meta)
        ? await getFirestoreDutyPhotoDataUrl(meta)
        : (meta.url || img.getAttribute('src') || '');
      if (!fullUrl) throw new Error('Duty photo URL is missing.');
      img.src = fullUrl;
      img.dataset.fullUrl = fullUrl;
      img.title = meta.name || 'photo';
      img.classList.remove('duty-report-photo--loading', 'duty-report-photo--error');
      img.onclick = () => window.openPhotoModal(
        fullUrl,
        images.map((node) => node.dataset.fullUrl).filter(Boolean)
      );
    } catch (err) {
      console.error('[Duties] Could not load submitted photo:', err);
      img.classList.remove('duty-report-photo--loading');
      img.classList.add('duty-report-photo--error');
      img.removeAttribute('onclick');
      img.title = 'Unable to load photo';
    }
  }));
}

function openDutyFormModal(sub) {
  let modal = document.getElementById('dutyFormModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'dutyFormModal';
    modal.addEventListener('click', (e) => { if (e.target === modal) window.closeDutyFormModal(); });
    document.body.appendChild(modal);
  }
  modal.className = 'duty-report-modal';
  modal.style.cssText = '';

  const ts = toDateObject(sub.timestamp);
  const esc = escapeHtml;
  const reportTitle = getDutyReportTitle(sub);
  const managerPanelTitle = sub?.reportType === 'managerial' ? 'Managerial Report Details' : 'Managers Only';

  const photoSectionHtml = (label, photos) => {
    if (!photos?.length) return '';
    const imgs = photos.map((p) => {
      const meta = encodeURIComponent(JSON.stringify({
        url: p.url || '',
        name: p.name || '',
        source: p.source || '',
        contentType: p.contentType || '',
        dataUrlPrefix: p.dataUrlPrefix || '',
        photoId: p.photoId || '',
        submissionId: p.submissionId || sub.id || '',
      }));
      const initialSrc = isFirestoreDutyPhoto(p) ? EMPTY_INLINE_IMAGE : esc(p.url || EMPTY_INLINE_IMAGE);
      const loadingClass = isFirestoreDutyPhoto(p) ? ' duty-report-photo--loading' : '';
      return `<img src="${initialSrc}" alt="photo" class="duty-report-photo${loadingClass}"
           data-duty-photo-meta="${meta}" />`;
    }).join('');
    return `<section class="duty-report-photo-section">
      <h4>${esc(label)}</h4>
      <div class="duty-report-photo-grid">${imgs}</div>
    </section>`;
  };

  const photos = sub.photos || {};
  const hasValue = (value) => value !== null && value !== undefined && value !== '';
  const hasManagerData = hasValue(sub.bleachVolume) || hasValue(sub.muriaticAcid) ||
    hasValue(sub.shockGranular) || (sub.cyaReadings && Object.keys(sub.cyaReadings).length > 0) ||
    photos.bleach?.length;

  let cyaHtml = '';
  if (sub.cyaReadings && Object.keys(sub.cyaReadings).length) {
    const rows = Object.entries(sub.cyaReadings).map(([k, v]) => {
      const label = k.replace('pool', 'Pool ');
      return dutyScaleHtml(`${label} CYA`, v, '', 'cya');
    }).join('');
    cyaHtml = `<div class="duty-scale-group"><h4>CYA Levels</h4>${rows}</div>`;
  }

  modal.innerHTML = `
    <div class="duty-report-modal-card">
      <div class="modal-header duty-report-modal-header">
        <h2>${esc(reportTitle)}</h2>
        <button type="button" class="close" onclick="window.closeDutyFormModal()">&times;</button>
      </div>
      <div class="duty-report-modal-scroll">
        <div class="duty-report-meta">
          <p><strong>Pool:</strong> ${esc(sub.pool)}</p>
          <p><strong>Submitted by:</strong> ${esc(getSubmissionRespondentName(sub))}</p>
          <p><strong>Submitted:</strong> ${ts ? ts.toLocaleString() : '—'}</p>
        </div>

        ${photoSectionHtml('Deck', photos.deck)}
        ${photoSectionHtml('Pool', photos.pool)}
        ${photoSectionHtml('Skimmers', photos.skimmers)}
        ${photoSectionHtml('Bathrooms', photos.bathrooms)}
        ${photoSectionHtml('Damaged Equipment', photos.damaged)}
        ${photoSectionHtml('Bleach Feeders', photos.bleachFeeders)}
        ${photoSectionHtml('DES Logbooks', photos.desLogbooks)}
        ${photoSectionHtml('Fill Lines', photos.fillLines)}

        ${sub.damagedNotes ? `<div class="duty-report-notes"><strong>Damaged Equipment Notes:</strong><span>${esc(sub.damagedNotes)}</span></div>` : ''}
        ${sub.otherNotes ? `<div class="duty-report-notes"><strong>Other Notes:</strong><span>${esc(sub.otherNotes)}</span></div>` : ''}

        ${hasManagerData ? `
        <section class="duty-report-manager-panel">
          <h3>${esc(managerPanelTitle)}</h3>
          ${photoSectionHtml('Bleach Barrels', photos.bleach)}
          ${dutyScaleHtml('Bleach Volume', sub.bleachVolume, '%', 'linear')}
          ${dutyScaleHtml('Muriatic Acid', sub.muriaticAcid, ' gal', 'acid')}
          ${dutyScaleHtml('Shock / Granular', sub.shockGranular, '%', 'linear')}
          ${cyaHtml}
        </section>` : ''}
      </div>
    </div>`;

  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('visible'));
  hydrateDutyReportPhotos(modal).catch((err) => {
    console.error('[Duties] Could not hydrate submitted photos:', err);
  });
}

window.closeDutyFormModal = function closeDutyFormModal() {
  const modal = document.getElementById('dutyFormModal');
  if (!modal) return;
  modal.classList.remove('visible');
  window.setTimeout(() => {
    if (!modal.classList.contains('visible')) {
      modal.style.display = 'none';
    }
  }, 250);
};

// Photo modal for submitted report images
window.openPhotoModal = function(url, gallery = []) {
  const urls = Array.isArray(gallery) && gallery.length ? gallery.filter(Boolean) : [url].filter(Boolean);
  let currentIndex = Math.max(0, urls.indexOf(url));
  let overlay = document.getElementById('photoViewOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'photoViewOverlay';
    overlay.className = 'photo-view-overlay';
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) overlay.style.display = 'none';
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'photo-view-close';
    close.setAttribute('aria-label', 'Close photo');
    close.textContent = '×';
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      overlay.style.display = 'none';
    });
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'photo-view-nav photo-view-nav--prev';
    prev.setAttribute('aria-label', 'Previous photo');
    prev.textContent = '‹';
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'photo-view-nav photo-view-nav--next';
    next.setAttribute('aria-label', 'Next photo');
    next.textContent = '›';
    const img = document.createElement('img');
    img.id = 'photoViewImg';
    img.className = 'photo-view-img';
    [prev, next].forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        const activeUrls = overlay._poolProPhotoGallery || [];
        if (activeUrls.length <= 1) return;
        const delta = btn === prev ? -1 : 1;
        const nextIndex = (Number(overlay.dataset.index || 0) + delta + activeUrls.length) % activeUrls.length;
        overlay.dataset.index = String(nextIndex);
        img.src = activeUrls[nextIndex];
      });
    });
    overlay.appendChild(close);
    overlay.appendChild(prev);
    overlay.appendChild(img);
    overlay.appendChild(next);
    document.body.appendChild(overlay);
  }
  overlay._poolProPhotoGallery = urls;
  overlay.dataset.index = String(currentIndex);
  const img = document.getElementById('photoViewImg');
  if (img) img.src = urls[currentIndex] || url;
  overlay.querySelectorAll('.photo-view-nav').forEach((btn) => {
    btn.hidden = urls.length <= 1;
  });
  overlay.style.display = 'flex';
};
