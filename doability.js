/* FundMyCampus — loan doability by lender type (Government banks / Private banks / NBFCs).
 *
 * Two layers, per reports/Medical loan rules by lender type.md (research, Oct 2026):
 *  1. Hard rules from official sources and the owner's credit screen → "Not possible" or a cap.
 *  2. Weighted factors (FundMyCampus estimates, not lender policy) → score out of 100 → band.
 * Indicative only. Lenders decide; this never claims an approval.
 */
(function (root) {
  'use strict';

  var TYPES = ['psu', 'pvt', 'nbfc'];
  // Weights per factor: [Government banks, Private banks, NBFCs]
  var W = { seat: [30, 25, 15], coll: [30, 25, 15], credit: [20, 20, 20], income: [5, 15, 30], dest: [10, 10, 10], speed: [5, 5, 10] };
  // The income test uses the same EMI the repayment plan shows (same rates, tenure and study-period interest)
  var Repayment = root.Repayment || (typeof require === 'function' ? require('./repayment.js') : null);
  var BANDS = ['not_possible', 'low', 'medium', 'high', 'very_high'];
  var LABEL = { very_high: 'Very high', high: 'High', medium: 'Medium', low: 'Low', not_possible: 'Not possible' };

  var DEST = {
    Georgia: 0.6, Kazakhstan: 0.6, Kyrgyzstan: 0.6, Philippines: 0.6, Nepal: 0.6, Bangladesh: 0.6, Italy: 0.6,
    Russia: 0.5, Uzbekistan: 0.4, China: 0.4, Egypt: 0.5, UK: 0.6, USA: 0.6, Australia: 0.6, Other: 0.4
  };

  function inr(n) { return '₹' + Math.round(n).toLocaleString('en-IN'); }
  function band(score) { return score >= 80 ? 'very_high' : score >= 65 ? 'high' : score >= 45 ? 'medium' : score >= 25 ? 'low' : 'not_possible'; }
  function capBand(b, max) { return BANDS.indexOf(b) > BANDS.indexOf(max) ? max : b; }
  function validScore(v) { return typeof v === 'number' && Number.isInteger(v) && v >= 300 && v <= 900; }

  // f: { s: [psu, pvt, nbfc] scores 0..1, why: [text per type] or text, tone per type }
  function factor(s, why) { return { s: s, why: Array.isArray(why) ? why : [why, why, why] }; }

  function assess(p) {
    var india = p.destination === 'India';
    var A = p.amount;                                  // lakh
    var college = p.college || null;
    var listed = !!(college && college.qheiStatus === 'listed');
    var merit = p.admission === 'merit';
    var mgmt = p.admission === 'management';
    var pmv = india && merit && listed && p.campus === 'yes';
    var secured = p.collateral === 'yes' && p.value > 0;
    var ratio = secured ? p.value / A : 0;
    var people = p.coApplicants || [];
    var incomes = p.incomes || [];
    var incomeKnown = p.profile === 'none' || incomes.some(function (x) { return x > 0; }) || p.incomeEntered;
    var famIncome = p.profile === 'none' ? 0 : incomes.reduce(function (a, b) { return a + (b || 0); }, 0);
    var pgIndia = india && p.level === 'Masters';
    var f = {};

    // 1. Seat & institution fit
    if (!india) f.seat = factor([0.6, 0.6, 0.6], 'Foreign university must meet NMC rules (54-month English course with internship).');
    else if (mgmt) f.seat = factor([0.15, 0.3, 0.7], [
      'Management / NRI quota — government banks rarely fund it without property.',
      'Management / NRI quota — private banks prefer merit seats.',
      'NBFCs do fund management-quota seats.']);
    else if (pmv) f.seat = factor([1, 0.9, 1], ['NEET merit seat at a PM-Vidyalaxmi-listed college.', 'NEET merit seat — sanction doesn\'t depend on the college.', 'NEET merit seat — sanction doesn\'t depend on the college.']);
    else if (merit && listed) f.seat = factor([0.7, 0.9, 0.9], ['College is on the PM-Vidyalaxmi list — confirm your exact campus to unlock it.', 'NEET merit seat — sanction doesn\'t depend on the college.', 'NEET merit seat — sanction doesn\'t depend on the college.']);
    else if (merit) f.seat = factor([0.6, 0.9, 0.9], ['NEET merit seat, but the college isn\'t on the PM-Vidyalaxmi list.', 'NEET merit seat — sanction doesn\'t depend on the college.', 'NEET merit seat — sanction doesn\'t depend on the college.']);
    else f.seat = factor([0.5, 0.5, 0.8], 'Admission not confirmed yet.');

    // 2. Collateral
    var bankColl, bankWhy;
    if (A <= 7.5) { bankColl = 1; bankWhy = 'Up to ₹7.5 lakh, banks don\'t need property.'; }
    else if (secured && ratio >= 1.25) { bankColl = 1; bankWhy = 'Your property comfortably covers the loan.'; }
    else if (secured && ratio >= 1) { bankColl = 0.6; bankWhy = 'Property just covers the loan — banks usually like about 1.25×.'; }
    else if (secured) { bankColl = 0.3; bankWhy = 'Property covers only part of the loan.'; }
    else { bankColl = null; }
    var psuColl = pmv ? 1 : bankColl, psuWhy = pmv ? 'No property needed under PM-Vidyalaxmi.' : bankWhy;
    // Private banks: no PM-Vidyalaxmi; unsecured lending is college-independent but smaller than NBFCs'
    var pvtColl = bankColl !== null ? bankColl : A <= 50 ? 0.6 : A <= 100 ? 0.4 : 0.2;
    // NBFC unsecured ceilings are advertised at ₹50 lakh–₹2 crore; larger unsecured amounts are harder
    var nbfcColl = A <= 7.5 || (secured && ratio >= 1) ? 1 : secured ? 0.8 : A <= 50 ? 0.7 : A <= 100 ? 0.5 : 0.3;
    f.coll = factor(
      [psuColl === null ? 0 : psuColl, pvtColl, nbfcColl],
      [psuColl === null ? 'Above ₹7.5 lakh, government banks need property worth the full loan.' : psuWhy,
        bankColl === null ? 'Private banks can lend without property.' : bankWhy,
        secured ? 'Property offered — better rate and limit.' : A <= 7.5 ? 'Small loan — no property needed.'
          : A <= 50 ? 'NBFCs lend this amount without property, at higher rates.'
            : 'Over ₹50 lakh without property is a big ask even for NBFCs.']);

    // 3. Co-applicant CIBIL (best known score among co-applicants)
    var known = people.filter(function (c) { return c.cibilStatus === 'known' && validScore(c.cibil); }).map(function (c) { return c.cibil; });
    var best = known.length ? Math.max.apply(null, known) : null;
    if (best === null) f.credit = factor([0.5, 0.5, 0.5], 'Add the co-applicant\'s CIBIL score for a sharper estimate.');
    else if (best >= 750) f.credit = factor([1, 1, 1], 'Co-applicant CIBIL ' + best + ' is strong.');
    else if (best > 700) f.credit = factor([0.8, 0.7, 0.85], 'Co-applicant CIBIL ' + best + ' is acceptable.');
    else if (best >= 650) f.credit = factor([0.35, 0.3, 0.55], 'Co-applicant CIBIL ' + best + ' is below what most banks like (above 700).');
    else f.credit = factor([0, 0, 0.2], 'Co-applicant CIBIL ' + best + ' is low for most lenders.');

    // 4. Co-applicant income vs estimated EMI (stipend counts only for NBFC PG loans in India)
    f.income = { s: [], why: [] };
    TYPES.forEach(function (t, i) {
      var inc = famIncome + (t === 'nbfc' && pgIndia ? (p.stipend || 0) : 0);
      if (!incomeKnown) { f.income.s[i] = 0.5; f.income.why[i] = 'Add co-applicant income for a sharper estimate.'; return; }
      var need = Repayment.schedule({ type: t, amount: A, course: p.course, destination: p.destination, tenure: p.tenure || 10,
        pmv: t === 'psu' && pmv, directEmi: p.creditGate && p.creditGate.mode === 'direct_only' }).emi + (p.existing || 0);
      var r = inc > 0 ? need / inc : Infinity;
      f.income.s[i] = r <= 0.4 ? 1 : r <= 0.6 ? 0.5 : 0;
      f.income.why[i] = inc <= 0
        ? 'No documented family income to repay the loan.'
        : r <= 0.4 ? 'Family income comfortably covers the future EMI (about ' + inr(need) + '/month).'
          : r <= 0.6 ? 'Family income is stretched by the future EMI (about ' + inr(need) + '/month).'
            : 'Future EMI of about ' + inr(need) + '/month is high for the family income of ' + inr(inc) + '.';
    });

    // 5. Destination
    var d = india ? 1 : (DEST[p.country] != null ? DEST[p.country] : 0.4);
    f.dest = factor([d, d, d], india ? 'Studying in India.' :
      p.country === 'Russia' ? 'Russia: paying fees there is harder right now — lenders check case by case.' :
        p.country === 'Uzbekistan' ? 'Uzbekistan: NMC has warned about some universities — check yours.' :
          'Study abroad in ' + (p.country || 'your country') + ': lenders check the university case by case.');

    // 6. Speed (typical sanction time)
    f.speed = factor([0.5, 0.8, 1], 'Light-speed sanction within 24 hrs.');

    var out = {};
    TYPES.forEach(function (t, i) {
      var score = 0, items = [];
      Object.keys(W).forEach(function (k) {
        var w = W[k][i], s = f[k].s[i];
        score += w * s;
        if (k !== 'speed') items.push({ k: k, w: w, s: s, text: f[k].why[i] });
      });
      var b = band(score), notes = [], cap = null;

      // ── Hard rules and caps ──
      var gate = p.creditGate;
      if (gate && gate.mode === 'blocked') { b = 'not_possible'; notes.push('Student CIBIL is below 670 — no loan route under current screening rules.'); }
      else if (gate && gate.mode === 'direct_only') { cap = 'medium'; notes.push('Student CIBIL 670–700: only regular-EMI loans, no ₹0-during-study options.'); }
      if (t !== 'psu' && famIncome <= 0 && incomeKnown && !secured && !(pgIndia && p.stipend > 0)) { cap = cap ? capBand(cap, 'low') : 'low'; notes.push('An earning co-applicant in India is needed.'); }
      if (p.course === 'Other') { cap = cap ? capBand(cap, 'medium') : 'medium'; notes.push('Course coverage needs a lender check.'); }
      if (t === 'psu' && india && mgmt && !secured && A > 7.5) { cap = cap ? capBand(cap, 'low') : 'low'; }
      // Until CIBIL and income are in, never promise the top band
      if (!incomeKnown || best === null) cap = cap ? capBand(cap, 'high') : 'high';
      if (cap) b = capBand(b, cap);
      if (t === 'nbfc' && pmv) notes.push('Costs more than the government scheme you qualify for.');
      if (t === 'psu' && india && merit && listed && !pmv && A > 7.5 && !secured) notes.push('Confirm your exact campus — the PM-Vidyalaxmi scheme would remove the property requirement.');

      // Reasons: biggest drags first, then biggest helps
      var bad = items.filter(function (x) { return x.s < 0.6; }).sort(function (a, c) { return c.w * (1 - c.s) - a.w * (1 - a.s); });
      var good = items.filter(function (x) { return x.s >= 0.8 && x.k !== 'dest'; }).sort(function (a, c) { return c.w * c.s - a.w * a.s; });
      var reasons = notes.map(function (n) { return { tone: 'bad', text: n }; })
        .concat(bad.slice(0, 2).map(function (x) { return { tone: x.s === 0.5 && /Add /.test(x.text) ? 'info' : 'bad', text: x.text }; }))
        .concat(good.slice(0, 2).map(function (x) { return { tone: 'good', text: x.text }; }));
      var seen = {};
      // Owner rule (19 Oct 2026): students see only helpful lines — negative reasons never leave this module
      reasons = reasons.filter(function (r) { if (r.tone === 'bad' || seen[r.text]) return false; seen[r.text] = 1; return true; }).slice(0, 4);

      if (b === 'not_possible') score = 0;
      out[t] = { score: Math.round(score), band: b, label: LABEL[b], level: BANDS.indexOf(b), reasons: reasons, pmv: t === 'psu' && pmv };
    });

    var order = TYPES.slice().sort(function (a, c) { return out[c].level - out[a].level || out[c].score - out[a].score; });
    out.best = out[order[0]].level > 0 ? order[0] : null;
    out.partial = !incomeKnown || best === null;
    return out;
  }

  var api = { assess: assess, LABEL: LABEL, BANDS: BANDS };
  if (typeof module !== 'undefined') module.exports = api; else root.Doability = api;
})(typeof window !== 'undefined' ? window : globalThis);
