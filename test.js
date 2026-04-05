// test.js — ChemLog structural verification tests
// Run: node test.js

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

const root = __dirname;
const chemHtml = readFile(path.join(root, 'chem/chem.html'));
const trainingHtml = readFile(path.join(root, 'training/training.html'));
const scriptJs = readFile(path.join(root, 'script.js'));
const trainingCss = readFile(path.join(root, 'training/training.css'));
const trainingJs = readFile(path.join(root, 'training/training.js'));
const firebaseJs = readFile(path.join(root, 'firebase.js'));

// ── PROBLEM 1: script.js exists and is referenced correctly ──
console.log('\nProblem 1 — script.js exists and is loaded:');
assert(scriptJs !== null, 'script.js exists at project root');
assert(chemHtml && chemHtml.includes('../script.js'), 'chem.html references ../script.js');
assert(trainingHtml && trainingHtml.includes('../script.js'), 'training.html references ../script.js');
assert(chemHtml && chemHtml.includes('</body>') &&
  chemHtml.indexOf('../script.js') < chemHtml.indexOf('</body>'),
  'script.js tag is before </body> in chem.html');
assert(trainingHtml && trainingHtml.includes('</body>') &&
  trainingHtml.indexOf('../script.js') < trainingHtml.indexOf('</body>'),
  'script.js tag is before </body> in training.html');

// ── PROBLEM 2: Menu and settings modal ──
console.log('\nProblem 2 — Menu dropdown and settings modal:');
assert(scriptJs && scriptJs.includes('window.toggleMenu'), 'script.js defines window.toggleMenu');
assert(scriptJs && scriptJs.includes('window.openSettings'), 'script.js defines window.openSettings');
assert(scriptJs && scriptJs.includes('window.closeSettings'), 'script.js defines window.closeSettings');
assert(scriptJs && scriptJs.includes("classList.contains('show')"), 'toggleMenu checks .show class');
assert(trainingCss && trainingCss.includes('#settingsModal'), 'training.css has #settingsModal rule');
assert(trainingCss && /\#settingsModal\s*\{[^}]*display\s*:\s*none/.test(trainingCss),
  'training.css hides #settingsModal by default (display: none)');

// ── PROBLEM 3: toggleMenu is globally accessible ──
console.log('\nProblem 3 — toggleMenu is globally accessible:');
assert(scriptJs && scriptJs.includes('window.toggleMenu = function'), 'toggleMenu is assigned to window');
assert(trainingHtml && trainingHtml.includes('onclick="toggleMenu(this)"'),
  'training.html uses onclick="toggleMenu(this)"');
assert(!(/toggleMenu\s*=\s*function/.test(trainingJs) || /function toggleMenu/.test(trainingJs)),
  'toggleMenu is NOT defined in training.js (no conflict)');

// ── PROBLEM 4: Training sessions fetched from Firestore ──
console.log('\nProblem 4 — Training sessions from Firestore:');
assert(scriptJs && scriptJs.includes('trainingSchedule'), 'script.js queries trainingSchedule collection');
assert(scriptJs && scriptJs.includes('publicTrainingSessionsMayBody'), 'script.js populates May public table');
assert(scriptJs && scriptJs.includes('publicTrainingSessionsJuneBody'), 'script.js populates June public table');
assert(scriptJs && scriptJs.includes('publicTrainingSessionsJulyBody'), 'script.js populates July public table');
assert(scriptJs && scriptJs.includes('window.addTrainingSignupToSchedule'), 'window.addTrainingSignupToSchedule defined');
assert(scriptJs && scriptJs.includes("getDocs(q)"), 'script.js calls getDocs to fetch sessions');
assert(scriptJs && (
    scriptJs.includes("settings', 'trainingSchedule'") ||
    scriptJs.includes('settings/trainingSchedule')
  ),
  'Training sessions read from settings/trainingSchedule (not hardcoded)');

// ── Additional: Firebase import ──
console.log('\nAdditional checks:');
assert(scriptJs && scriptJs.includes("from './firebase.js'"), 'script.js imports from ./firebase.js');
assert(firebaseJs !== null, 'firebase.js exists at project root');
assert(scriptJs && scriptJs.includes('window.filterData'), 'filterData is globally accessible');
assert(scriptJs && scriptJs.includes('window.goToDashboard'), 'goToDashboard is globally accessible');
assert(scriptJs && scriptJs.includes('window.logout'), 'logout is globally accessible');

// ── Summary ──
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('All tests passed! ✓');
} else {
  console.error(`${failed} test(s) failed.`);
  process.exit(1);
}
