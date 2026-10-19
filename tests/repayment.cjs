// Repayment schedule checks — run `node tests/repayment.cjs`
const assert = require('assert');
const R = require('../repayment.js');
let n = 0;
const near = (a, b, tol, msg) => { assert(Math.abs(a - b) <= tol, msg + ': ' + a + ' vs ' + b); n++; };

for (const type of ['psu', 'pvt', 'nbfc']) {
  for (const [course, destination] of [['MBBS', 'India'], ['MBBS', 'Abroad'], ['BDS', 'India'], ['MD', 'India']]) {
    const s = R.schedule({ type, amount: 40, course, destination, tenure: 10 });
    near(s.years.at(-1).balance, 0, 1, `${type} ${course} ${destination} ends at zero`);
    near(s.years.reduce((a, y) => a + y.disbursed, 0), 4000000, 1, `${type} ${course} disburses full amount`);
    near(s.totalPaid - s.totalInterest, 4000000, 1, `${type} ${course} paid = principal + interest`);
    const studyPaid = s.years.filter(y => !/EMI/.test(y.stage)).reduce((a, y) => a + y.paid, 0);
    if (type === 'psu') near(studyPaid, 0, 0, 'Government banks: nothing to pay while studying');
    else assert(studyPaid > 0 && s.addedInterest === 0, `${type}: interest paid while studying`), n++;
  }
}
// MBBS India: 5.5 years + 1 grace, then 10-year EMI
const m = R.schedule({ type: 'psu', amount: 50, course: 'MBBS', destination: 'India', tenure: 10 });
assert.strictEqual(m.studyMonths, 78); n++;
near(m.emi, 86682, 1, 'Government bank EMI for ₹50L MBBS at 8.65%');
// Student CIBIL 670–700: EMI from the first payout, nothing deferred
for (const type of ['psu', 'pvt', 'nbfc']) {
  const s = R.schedule({ type, amount: 50, course: 'MBBS', destination: 'India', tenure: 10, directEmi: true });
  assert(s.years[0].paid > 0 && s.addedInterest === 0 && s.studyMonthly === 0, type + ' direct EMI starts in year 1'); n++;
  near(s.years.at(-1).balance, 0, 0, type + ' direct EMI ends at zero');
}
// Table rows always add up to the totals shown
for (const amount of [7, 23.4, 66.66, 137]) {
  const s = R.schedule({ type: 'nbfc', amount, course: 'MBBS', destination: 'Abroad', tenure: 7 });
  near(s.years.reduce((a, y) => a + y.paid, 0), s.totalPaid, 0, 'rows add up to total paid');
  near(s.years.reduce((a, y) => a + y.disbursed, 0), Math.round(amount * 100000), 0, 'payouts add up to the loan');
}
// Any moratorium / tenure: every rupee is paid out, repaid, and totals match the rows
for (const type of ['psu', 'pvt', 'nbfc']) for (const mor of [0, 24, 78, 120]) for (const tenure of [1, 5, 15]) for (const directEmi of [false, true]) {
  const s = R.schedule({ type, amount: 66.66, course: 'MBBS', destination: 'Abroad', moratoriumMonths: mor, tenure, rate: 9.3, directEmi });
  near(s.years.reduce((a, y) => a + y.disbursed, 0), s.amount, 0, `${type} mor ${mor} tenure ${tenure} pays out everything`);
  near(s.totalPaid - s.amount, s.totalInterest, 0, `${type} mor ${mor} tenure ${tenure} paid = loan + interest`);
  near(s.years.reduce((a, y) => a + y.interest, 0), s.totalInterest, 0, 'interest rows add up');
  near(s.years.at(-1).balance, 0, 0, `${type} mor ${mor} tenure ${tenure} ends at zero`);
}
// PM-Vidyalaxmi: fixed 8.85% (list as on 05.10.2026), Government banks under the scheme only
const opts = { amount: 20, course: 'MBBS', destination: 'India', tenure: 10 };
assert.strictEqual(R.schedule({ ...opts, type: 'psu', pmv: true }).rate, 8.85); n++;
assert.strictEqual(R.schedule({ ...opts, type: 'psu', pmv: false }).rate, 8.65, 'no scheme, no scheme rate'); n++;
assert.strictEqual(R.schedule({ ...opts, type: 'pvt', pmv: true }).rate, 10.5, 'private banks have no PM-Vidyalaxmi'); n++;
assert.strictEqual(R.schedule({ ...opts, type: 'nbfc', pmv: true }).rate, 12); n++;
console.log(n + ' repayment checks passed');
