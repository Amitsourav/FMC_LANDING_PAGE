const assert = require('node:assert/strict');
const D = require('../doability.js');
const E = require('../engine.js');
const base = { destination: 'India', level: 'Bachelors', course: 'MBBS', country: '', college: { qheiStatus: 'listed' }, admission: 'merit', campus: 'yes',
  amount: 12, collateral: 'no', value: 0, stipend: 0, profile: 'salaried', incomes: [150000], existing: 0,
  coApplicants: [{ relationship: 'parent', cibilStatus: 'known', cibil: 760 }], studentCibilStatus: 'known', studentCibil: 750 };
const run = (o) => { const p = { ...base, ...o }; p.creditGate = E.creditGate(p); return D.assess(p); };
const show = (n, r) => console.log(n.padEnd(46), ['psu', 'pvt', 'nbfc'].map(t => t + ':' + r[t].label + '(' + r[t].score + ')').join('  '));
let n = 0; const test = (name, fn) => { fn(); n++; };

// Report worked example 1: merit QHEI, ₹12L, parent 760 → PSU very high
let r = run({}); show('A merit QHEI 12L parent 760', r);
test('A: PSU very high', () => assert.equal(r.psu.band, 'very_high'));
test('A: PSU flagged PMV', () => assert.equal(r.psu.pmv, true));

// Example 2: management quota, ₹1.1 Cr, salaried 780, no property → PSU low, NBFC best
r = run({ admission: 'management', college: { qheiStatus: 'not_verified' }, amount: 110, incomes: [700000], coApplicants: [{ relationship: 'parent', cibilStatus: 'known', cibil: 780 }] });
show('B mgmt 1.1Cr 780 no property', r);
test('B: PSU low or worse', () => assert(r.psu.level <= 1));
test('B: NBFC is best', () => assert.equal(r.best, 'nbfc'));

// Example 3: Kyrgyzstan, ₹35L, parent 720, property ₹50L
r = run({ destination: 'Abroad', country: 'Kyrgyzstan', college: null, admission: '', campus: '', amount: 35, collateral: 'yes', value: 50, incomes: [120000], coApplicants: [{ relationship: 'parent', cibilStatus: 'known', cibil: 720 }] });
show('C Kyrgyzstan 35L 720 property 50L', r);
test('C: banks at least medium', () => assert(r.psu.level >= 2 && r.pvt.level >= 2));

// Owner credit screen
r = run({ studentCibil: 669 }); show('D student 669', r);
test('D: all not possible', () => assert(['psu', 'pvt', 'nbfc'].every(t => r[t].band === 'not_possible')));
r = run({ studentCibil: 690 }); show('E student 690', r);
test('E: capped at medium', () => assert(['psu', 'pvt', 'nbfc'].every(t => r[t].level <= 2)));

// NBFC needs an earning co-applicant
r = run({ admission: 'management', college: { qheiStatus: 'not_verified' }, amount: 60, profile: 'none', incomes: [0] }); show('F mgmt 60L no income no property', r);
test('F: NBFC low at most', () => assert(r.nbfc.level <= 1));

// PG stipend counts for NBFC only
r = run({ level: 'Masters', course: 'MD', college: { qheiStatus: 'not_verified' }, amount: 40, profile: 'none', incomes: [0], stipend: 120000 }); show('G MD 40L stipend 1.2L only', r);
test('G: NBFC beats banks', () => assert(r.nbfc.score > r.pvt.score));

// Partial profile still scores, flagged partial
r = run({ coApplicants: [{ relationship: '', cibilStatus: '', cibil: null }], incomes: [0], profile: '', studentCibilStatus: '' }); show('H partial (no CIBIL/income yet)', r);
test('H: partial flag', () => assert.equal(r.partial, true));

// Russia lower than Georgia
const ru = run({ destination: 'Abroad', country: 'Russia', college: null, admission: '', amount: 30, collateral: 'yes', value: 45 });
const ge = run({ destination: 'Abroad', country: 'Georgia', college: null, admission: '', amount: 30, collateral: 'yes', value: 45 });
test('I: Russia scores below Georgia', () => assert(ru.psu.score < ge.psu.score));

console.log(n + ' doability checks passed');
