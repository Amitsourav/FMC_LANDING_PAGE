/* Year-by-year repayment illustration per lender type.
   Month-by-month simulation, summed into loan years:
   - fees are disbursed in equal yearly instalments at the start of each fee-paying year
   - study period = course + 1 year
   - Government banks: nothing to pay while studying; simple interest builds up and is added to the loan when EMIs start
   - Private banks / NBFCs: simple interest is paid every month while studying
   - then a regular EMI over the chosen tenure
   Rates are the middle of the ranges shown on the lender cards. Illustration only. */
(function (root) {
  'use strict';

  var RATE = { psu: 8.65, pvt: 10.5, nbfc: 12 };
  // PM-Vidyalaxmi: fixed 8.85% for every institution on the list of 1,441 QHEIs as on 05.10.2026
  // (owner decision, 19 Oct 2026). Government banks, under the scheme only. Update here if it changes.
  var PMV = { rate: 8.85, list: '05.10.2026' };
  // [course years, fee-paying years]
  var COURSE = {
    MBBS: [5.5, 5], MBBS_abroad: [6, 6], BDS: [5, 4],
    MD: [3, 3], MS: [3, 3], MDS: [3, 3], DNB: [3, 3], Other: [4, 4]
  };

  function emi(p, r, months) { var m = r / 1200; return p * m * Math.pow(1 + m, months) / (Math.pow(1 + m, months) - 1); }

  function stage(y, s) { if (y.stage.indexOf(s) < 0) y.stage = y.stage ? y.stage + ' → ' + s : s; }

  function courseYears(course, destination) {
    var key = course === 'MBBS' && destination !== 'India' ? 'MBBS_abroad' : course;
    return COURSE[key] || COURSE.Other;
  }

  // opts: { type: 'psu'|'pvt'|'nbfc', amount (lakh), course, destination, tenure (years), pmv (PM-Vidyalaxmi applies),
  //         rate (optional % override), moratoriumMonths (optional override; default course + 1 year),
  //         directEmi: true when only a regular EMI from the first disbursement is allowed (student CIBIL 670–700) }
  function schedule(o) {
    var cy = courseYears(o.course, o.destination);
    var schemeRate = o.type === 'psu' && o.pmv ? PMV.rate : null;
    var defaultRate = schemeRate || RATE[o.type];
    var rate = o.rate > 0 ? o.rate : defaultRate;
    var direct = !!o.directEmi, capitalise = o.type === 'psu' && !direct;
    var total = Math.round(o.amount * 100000), part = Math.round(total / cy[1]);
    // Equal yearly payouts in whole rupees; the last one takes the remainder
    var trancheFor = function (k) { return k < cy[1] - 1 ? part : total - part * (cy[1] - 1); };
    var defaultMor = Math.round((cy[0] + 1) * 12), tenureMonths = Math.round(o.tenure * 12);
    var mor = direct ? 0 : (o.moratoriumMonths >= 0 ? Math.round(o.moratoriumMonths) : defaultMor);
    // Direct EMI keeps the default end date; otherwise EMIs run for the tenure after the moratorium
    var end = direct ? defaultMor + tenureMonths : mor + tenureMonths;
    // The loan must run past the last fee payout; if not, stretch it to one year after that payout
    var minEnd = cy[1] * 12, extended = end < minEnd;
    if (extended) end = minEnd;
    var monthlyRate = rate / 1200, courseMonths = cy[0] * 12;

    var disbursed = 0, accrued = 0, balance = 0, monthlyEmi = 0, studyMonthly = 0;
    var years = [], cur = null;
    for (var m = 0; m < end; m++) {
      if (m % 12 === 0) {
        cur = { year: m / 12 + 1, stage: '', disbursed: 0, paid: 0, interest: 0, principal: 0, balance: 0 };
        years.push(cur);
      }
      if (m === mor) balance = disbursed + accrued;
      var payout = m % 12 === 0 && m / 12 < cy[1] ? trancheFor(m / 12) : 0;
      if (payout) { disbursed += payout; cur.disbursed += payout; if (m >= mor) balance += payout; }
      if (m < mor) {
        // Moratorium: simple interest on what has been paid out
        var si = disbursed * monthlyRate;
        cur.interest += si;
        if (capitalise) accrued += si;
        else { cur.paid += si; studyMonthly = Math.max(studyMonthly, si); }
        stage(cur, m < courseMonths ? 'Studying' : 'Grace period');
        cur.balance = disbursed + accrued;
      } else {
        // EMI on the outstanding amount, re-set at each new payout so the loan still ends on time
        if (m === mor || payout) monthlyEmi = emi(balance, rate, end - m);
        var int = balance * monthlyRate, pay = Math.min(monthlyEmi, balance + int);
        balance = Math.max(0, balance + int - pay);
        cur.interest += int; cur.paid += pay; cur.principal += pay - int;
        stage(cur, m < courseMonths ? 'Studying + EMI' : 'EMI');
        cur.balance = balance;
      }
    }
    // Round each year to the rupee and add up the rounded rows, so the table and its totals always agree
    // (running totals are rounded, so each column adds up to its rounded total with no drift)
    var cum = { disbursed: 0, paid: 0, interest: 0, principal: 0 };
    years.forEach(function (y) {
      Object.keys(cum).forEach(function (k) { var prev = Math.round(cum[k]); cum[k] += y[k]; y[k] = Math.round(cum[k]) - prev; });
      y.balance = Math.round(y.balance);
    });
    var paid = years.reduce(function (a, y) { return a + y.paid; }, 0);
    return {
      type: o.type, rate: rate, defaultRate: defaultRate, schemeRate: !!schemeRate, courseYears: cy[0], feeYears: cy[1],
      moratoriumMonths: mor, defaultMoratoriumMonths: defaultMor, studyMonths: mor, tenure: o.tenure,
      amount: total, emi: monthlyEmi, studyMonthly: capitalise || direct ? 0 : studyMonthly, directEmi: direct, endsMonth: end, extended: extended,
      addedInterest: accrued, totalPaid: paid, totalInterest: years.reduce(function (a, y) { return a + y.interest; }, 0), years: years
    };
  }

  var api = { schedule: schedule, RATE: RATE, courseYears: courseYears, PMV: PMV };
  if (typeof module !== 'undefined') module.exports = api; else root.Repayment = api;
})(typeof window !== 'undefined' ? window : globalThis);
