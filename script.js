// ═══════════════════════════════════════
// FundMyCampus — Medical education loan checker
// Decision logic lives in engine.js (LoanEngine); data in medical-data.js.
// ═══════════════════════════════════════
var API_URL = 'https://api.fundmycampus.com';
var WA_NUMBER = '917827225354';
var CONSENT_VERSION = 'FMC-CONSENT-2026-10-14';
var PRODUCT_RULE_VERSION = '2026-10-14-v2';

// ─── Helpers ───
function escHtml(str) {
  var d = document.createElement('div');
  d.appendChild(document.createTextNode(str == null ? '' : String(str)));
  return d.innerHTML;
}

function $(id) { return document.getElementById(id); }

function money(n) { return LoanEngine.money(n); }

function norm(str) {
  return String(str || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Common abbreviations students type. Expands the search query only — it never
// selects or merges an institution; the student still picks the exact campus.
var SEARCH_ALIASES = {
  aiims: 'all india institute of medical sciences',
  kmc: 'kasturba medical college',
  cmc: 'christian medical college',
  mamc: 'maulana azad medical college',
  afmc: 'armed forces medical college',
  jipmer: 'jawaharlal institute of postgraduate medical education',
  gmc: 'government medical college',
  gdc: 'government dental college',
  bhu: 'banaras hindu university',
  amu: 'aligarh muslim university',
  pgimer: 'post graduate institute of medical education',
  kgmu: 'king george s medical university',
  lhmc: 'lady hardinge medical college',
  ucms: 'university college of medical sciences'
};

function searchTokens(q) {
  return norm(q).split(' ').reduce(function (out, t) {
    return out.concat(SEARCH_ALIASES[t] ? SEARCH_ALIASES[t].split(' ') : t ? [t] : []);
  }, []);
}

function track(event, params) {
  // Category-level events only — never names, phone, scores or income.
  try {
    if (window.dataLayer && typeof window.dataLayer.push === 'function') {
      var payload = { event: event };
      for (var k in params) payload[k] = params[k];
      window.dataLayer.push(payload);
    }
  } catch (e) { /* analytics must never break the page */ }
}

function store(kind, key, value) {
  try {
    var s = kind === 'local' ? window.localStorage : window.sessionStorage;
    if (value === undefined) return s.getItem(key);
    s.setItem(key, value);
  } catch (e) { return null; }
}

// ─── Institution data ───
var INST = typeof MED_INSTITUTIONS !== 'undefined' ? MED_INSTITUTIONS : [];
var INST_BY_ID = {};
INST.forEach(function (r) {
  INST_BY_ID[r.i] = r;
  r.key = norm(r.n + ' ' + r.s + ' ' + (r.a || ''));
  r.nkey = norm(r.n);
});
var MAP_COLLEGES = INST.filter(function (r) { return r.d !== 'Q'; });

var DIR_LABEL = { M: 'Medical (NMC)', D: 'Dental (DCI)', Q: 'QHEI list' };

function qheiStatus(r) { return r.a ? 'listed' : 'not_verified'; }

function evidenceText(r) {
  if (r.x) return 'Owner-confirmed QHEI addition (AISHE ' + r.a + ') — exact campus and course must be checked';
  if (r.a) return 'Found in QHEI snapshot (AISHE ' + r.a + ') — current bank confirmation required';
  return 'QHEI coverage not confirmed in our snapshot — this is not a loan rejection';
}

function coursesText(r) {
  if (r.d === 'M') return r.mb && r.pg ? 'MBBS + PG' : r.mb ? 'MBBS' : 'PG only';
  if (r.d === 'D') return 'BDS';
  return 'General listing';
}

function metaText(r) {
  var bits = [r.s, DIR_LABEL[r.d]];
  if (r.d === 'M') bits.push(coursesText(r));
  if (r.d === 'D' && r.st) bits.push(r.st + ' BDS seats (2025–26)');
  if (r.m) bits.push(r.m);
  return bits.join(' · ');
}

// ═══════════════════════════════════════
// 1. ELIGIBILITY CHECKER
// ═══════════════════════════════════════
var Checker = (function () {
  var form = $('checker-form');
  if (!form || typeof LoanEngine === 'undefined') return null;

  var COURSES = {
    Bachelors: ['MBBS', 'BDS', 'Other'],
    Masters: ['MD', 'MS', 'MDS', 'DNB', 'Other']
  };
  var RELATIONSHIPS = [['parent', 'Parent (mother / father)'], ['guardian', 'Guardian'], ['spouse', 'Spouse'], ['other', 'Other']];
  var CIBIL_STATUS = [['', 'CIBIL status'], ['known', 'Known score'], ['unknown', "Don't know"], ['no_history', 'No history (NH / NA)']];

  var selected = null;       // institution record from INST
  var manualMode = false;
  var coapps = [];
  var lastResult = null;
  var lastDoability = null;
  var lastProfile = null;
  var started = false;
  var completedOnce = false;
  var timer;

  var courseSel = $('course');
  var searchInput = $('college-search');
  var listEl = $('college-list');
  var stateFilter = $('state-filter');
  var dirFilter = $('directory-filter');
  var chip = $('college-selected');
  var resultBody = $('result-body');
  var actions = $('result-actions');

  // ─── Field helpers ───
  function radio(name) {
    var el = form.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : '';
  }
  function setRadio(name, value) {
    form.querySelectorAll('input[name="' + name + '"]').forEach(function (el) { el.checked = el.value === value; });
  }
  // Blank → null, non-numeric → NaN, else number
  function num(el) {
    var v = (typeof el === 'string' ? el : el.value).trim();
    if (v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  function inRange(n, lo, hi) { return n !== null && !Number.isNaN(n) && n >= lo && n <= hi; }

  // ─── Course options ───
  function renderCourses() {
    var level = radio('level');
    var current = courseSel.value;
    courseSel.innerHTML = '<option value="">Select course</option>' + COURSES[level].map(function (c) {
      return '<option value="' + c + '">' + (c === 'Other' ? 'Other medical / allied course' : c) + '</option>';
    }).join('');
    courseSel.value = COURSES[level].indexOf(current) >= 0 ? current : '';
  }

  // ─── Co-applicants ───
  function newCoapp() { return { relationship: '', cibilStatus: '', cibil: '', income: '' }; }

  function renderCoapps() {
    var noIncome = $('income-profile').value === 'none';
    var html = coapps.map(function (c, i) {
      var opt = function (list, val) {
        return list.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === val ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
      };
      return '<div class="coapp" data-i="' + i + '">' +
        '<div class="coapp-head"><span>Co-applicant ' + (i + 1) + '</span>' +
        (coapps.length > 1 ? '<button type="button" class="coapp-remove" data-remove="' + i + '" aria-label="Remove co-applicant ' + (i + 1) + '">Remove</button>' : '') +
        '</div>' +
        '<div class="coapp-grid">' +
        '<div class="field"><label for="ca-rel-' + i + '">Relationship</label><select id="ca-rel-' + i + '" data-k="relationship"><option value="">Select</option>' + opt(RELATIONSHIPS, c.relationship) + '</select></div>' +
        '<div class="field"><label for="ca-cs-' + i + '">CIBIL</label><select id="ca-cs-' + i + '" data-k="cibilStatus">' + opt(CIBIL_STATUS, c.cibilStatus) + '</select></div>' +
        '<div class="field"' + (c.cibilStatus === 'known' ? '' : ' hidden') + '><label for="ca-sc-' + i + '">Score</label><input type="number" id="ca-sc-' + i + '" data-k="cibil" inputmode="numeric" min="300" max="900" step="1" placeholder="300–900" value="' + escHtml(c.cibil) + '"></div>' +
        '<div class="field"><label for="ca-inc-' + i + '">Monthly net income (₹)</label><input type="number" id="ca-inc-' + i + '" data-k="income" inputmode="numeric" min="0" step="1000" placeholder="' + (noIncome ? 'Not counted' : 'e.g. 100000') + '" value="' + (noIncome ? '' : escHtml(c.income)) + '"' + (noIncome ? ' disabled' : '') + '></div>' +
        '</div></div>';
    }).join('');
    $('coapps').innerHTML = html;
    $('add-coapp').hidden = coapps.length >= 4;
  }

  $('coapps').addEventListener('input', onCoappEdit);
  $('coapps').addEventListener('change', onCoappEdit);
  function onCoappEdit(e) {
    var row = e.target.closest('.coapp');
    var k = e.target.getAttribute('data-k');
    if (!row || !k) return;
    var i = +row.getAttribute('data-i');
    coapps[i][k] = e.target.value;
    if (k === 'cibilStatus') {
      if (e.target.value !== 'known') coapps[i].cibil = '';
      renderCoapps();
      var next = $(e.target.value === 'known' ? 'ca-sc-' + i : 'ca-cs-' + i);
      if (next) next.focus();
    }
    schedule();
  }
  $('coapps').addEventListener('click', function (e) {
    var idx = e.target.getAttribute('data-remove');
    if (idx === null) return;
    coapps.splice(+idx, 1);
    renderCoapps();
    $('add-coapp').focus();
    schedule();
  });
  $('add-coapp').addEventListener('click', function () {
    if (coapps.length >= 4) return;
    coapps.push(newCoapp());
    renderCoapps();
    var el = $('ca-rel-' + (coapps.length - 1));
    if (el) el.focus();
    schedule();
  });

  // ─── Institution combobox ───
  var activeIdx = -1;
  var matches = [];

  (function fillStates() {
    var states = {};
    INST.forEach(function (r) { states[r.s] = 1; });
    Object.keys(states).sort().forEach(function (s) {
      var o = document.createElement('option');
      o.value = s; o.textContent = s;
      stateFilter.appendChild(o);
    });
  })();

  function search() {
    var q = norm(searchInput.value);
    var st = stateFilter.value, dir = dirFilter.value;
    if (q.length < 2) { matches = []; return; }
    var tokens = searchTokens(q);
    var starts = [], rest = [];
    for (var i = 0; i < INST.length; i++) {
      var r = INST[i];
      if (st && r.s !== st) continue;
      if (dir && r.d !== dir) continue;
      var ok = true;
      for (var t = 0; t < tokens.length; t++) {
        if (r.key.indexOf(tokens[t]) < 0) { ok = false; break; }
      }
      if (!ok) continue;
      (r.nkey.indexOf(q) === 0 || (r.a && norm(r.a) === q) ? starts : rest).push(r);
    }
    matches = starts.concat(rest).slice(0, 30);
  }

  function renderList() {
    search();
    activeIdx = -1;
    searchInput.removeAttribute('aria-activedescendant');
    if (norm(searchInput.value).length < 2) { closeList(); return; }
    if (!matches.length) {
      listEl.innerHTML = '<li class="combo-empty" role="option" aria-disabled="true">No match in the loaded records. Check spelling or use "My college isn\'t listed".</li>';
    } else {
      listEl.innerHTML = matches.map(function (r, i) {
        return '<li role="option" id="opt-' + i + '" data-i="' + i + '" aria-selected="false">' +
          '<span class="opt-name">' + escHtml(r.n) + '</span>' +
          '<span class="opt-meta">' + escHtml(metaText(r)) + (r.a ? ' <b class="opt-q">QHEI</b>' : '') + '</span></li>';
      }).join('');
    }
    listEl.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
  }

  function closeList() {
    listEl.hidden = true;
    searchInput.setAttribute('aria-expanded', 'false');
    searchInput.removeAttribute('aria-activedescendant');
  }

  function moveActive(delta) {
    if (listEl.hidden || !matches.length) return;
    activeIdx = (activeIdx + delta + matches.length) % matches.length;
    listEl.querySelectorAll('[role="option"]').forEach(function (li, i) {
      li.setAttribute('aria-selected', i === activeIdx ? 'true' : 'false');
      li.classList.toggle('active', i === activeIdx);
      if (i === activeIdx) li.scrollIntoView({ block: 'nearest' });
    });
    searchInput.setAttribute('aria-activedescendant', 'opt-' + activeIdx);
  }

  var searchTimer;
  searchInput.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderList, 150);
  });
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (listEl.hidden) renderList(); moveActive(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
    else if (e.key === 'Enter') {
      if (!listEl.hidden && activeIdx >= 0) { e.preventDefault(); selectInstitution(matches[activeIdx]); }
    } else if (e.key === 'Escape') { closeList(); }
  });
  listEl.addEventListener('mousedown', function (e) {
    var li = e.target.closest('[data-i]');
    if (!li) return;
    e.preventDefault();
    selectInstitution(matches[+li.getAttribute('data-i')]);
  });
  searchInput.addEventListener('blur', function () { setTimeout(closeList, 120); });

  function onFilterChange() {
    // A filter that excludes the selected institution clears it
    if (selected && ((stateFilter.value && selected.s !== stateFilter.value) || (dirFilter.value && selected.d !== dirFilter.value))) {
      clearInstitution();
    }
    if (norm(searchInput.value).length >= 2) renderList();
    schedule();
  }
  stateFilter.addEventListener('change', onFilterChange);
  dirFilter.addEventListener('change', onFilterChange);

  function selectInstitution(r) {
    if (!r) return;
    selected = r;
    manualMode = false;
    $('manual-wrap').hidden = true;
    $('manual-college').value = '';
    $('manual-toggle').textContent = "My college isn't listed";
    setRadio('campus', '');           // never carry campus confirmation across colleges
    searchInput.value = '';
    closeList();
    renderChip();
    syncVisibility();
    track('institution_selected', { institution_id: r.i, category: r.a ? 'qhei_listed' : 'not_confirmed' });
    schedule();
  }

  function clearInstitution() {
    selected = null;
    setRadio('campus', '');
    renderChip();
  }

  function renderChip() {
    if (!selected) { chip.hidden = true; chip.innerHTML = ''; return; }
    chip.innerHTML =
      '<div class="chip-main"><strong>' + escHtml(selected.n) + '</strong>' +
      '<span>' + escHtml(metaText(selected)) + '</span>' +
      '<span class="chip-ev ' + (selected.a ? 'ev-listed' : 'ev-none') + '">' + escHtml(evidenceText(selected)) + '</span></div>' +
      '<button type="button" class="chip-clear" aria-label="Clear selected college">&times;</button>';
    chip.hidden = false;
    chip.querySelector('.chip-clear').addEventListener('click', function () {
      clearInstitution();
      searchInput.focus();
      schedule();
    });
  }

  $('manual-toggle').addEventListener('click', function () {
    manualMode = !manualMode;
    $('manual-wrap').hidden = !manualMode;
    this.textContent = manualMode ? 'Search the list instead' : "My college isn't listed";
    if (manualMode) { clearInstitution(); $('manual-college').focus(); }
    else $('manual-college').value = '';
    setRadio('campus', '');
    schedule();
  });

  // ─── Visibility rules ───
  function syncVisibility() {
    var india = radio('destination') === 'India';
    var pg = radio('level') === 'Masters';
    $('india-fields').hidden = !india;
    $('abroad-fields').hidden = india;
    $('benefit-step').hidden = !india;
    $('application-date-wrap').hidden = !india;
    $('stipend-wrap').hidden = !(india && pg);
    $('collateral-value-wrap').hidden = radio('collateral') !== 'yes';
    $('student-cibil-wrap').hidden = $('student-cibil-status').value !== 'known';
    $('family-income-wrap').hidden = $('family-income-status').value !== 'known';
    var campusNeeded = india && ((selected && selected.a) || (manualMode && $('manual-college').value.trim().length >= 3));
    $('campus-wrap').hidden = !campusNeeded;
    // Number the visible steps
    var n = 0;
    form.querySelectorAll('.checker-step').forEach(function (step) {
      if (!step.hidden) step.querySelector('.step-num').textContent = ++n;
    });
  }

  // ─── Gather + validate ───
  function gather() {
    var need = [];   // { id, text }
    var checks = 0;  // required checks evaluated — drives the progress meter
    function req(missing, id, text) {
      checks++;
      if (missing) need.push({ id: id, text: text });
    }
    var india = radio('destination') === 'India';
    var level = radio('level');
    var course = courseSel.value;
    req(!course, 'course', 'Choose your course');

    var college = null;
    if (india) {
      if (selected) {
        college = { id: selected.i, name: selected.n, state: selected.s, directory: selected.d, aishe: selected.a || null,
          qheiStatus: qheiStatus(selected), rateFormula: selected.r || null,
          evidenceStatus: selected.x ? 'owner_confirmed_addition' : selected.a ? 'listed_snapshot_exact' : 'not_confirmed' };
      } else if (manualMode) {
        var mn = $('manual-college').value.trim();
        if (mn.length >= 3) college = { id: null, name: mn, manual: true, qheiStatus: 'pending', evidenceStatus: 'not_confirmed' };
        req(mn.length < 3, 'manual-college', 'Enter your college name and city');
      } else req(true, 'college-search', 'Search and select your college');
      if (selected) checks++;
      req(!$('admission').value, 'admission', 'Select your admission route');
      if (!$('campus-wrap').hidden) req(!radio('campus'), 'campus-wrap', 'Confirm whether this is your exact campus');
    } else {
      req(!$('country').value, 'country', 'Select a country');
      var fc = $('foreign-college').value.trim();
      req(fc.length < 3, 'foreign-college', 'Enter your university name');
    }

    var amount = num($('amount'));
    req(!inRange(amount, 1, 500), 'amount', 'Enter a loan amount between ₹1 lakh and ₹500 lakh');
    var collateral = radio('collateral');
    req(!collateral, 'collateral', 'Tell us whether you can offer collateral');
    var value = num($('collateral-value'));
    if (collateral === 'yes') req(!inRange(value, 0, 5000), 'collateral-value', 'Enter the approximate collateral value (₹ lakh)');

    var stipend = 0;
    if (india && level === 'Masters') {
      stipend = num($('stipend'));
      req(!inRange(stipend, 0, 1000000), 'stipend', 'Enter your monthly stipend (0 if none)');
    }

    var scs = $('student-cibil-status').value;
    var sc = num($('student-cibil'));
    req(!scs, 'student-cibil-status', "Select the student's CIBIL status");
    if (scs === 'known') req(!(Number.isInteger(sc) && sc >= 300 && sc <= 900), 'student-cibil', 'Enter the student CIBIL as a whole number from 300 to 900');

    var profile = $('income-profile').value;
    req(!profile, 'income-profile', 'Select the co-applicant income type');
    var people = coapps.map(function (c, i) {
      var label = 'co-applicant ' + (i + 1);
      req(!c.relationship, 'ca-rel-' + i, 'Select the relationship of ' + label);
      req(!c.cibilStatus, 'ca-cs-' + i, 'Select the CIBIL status of ' + label);
      var score = c.cibilStatus === 'known' ? num(c.cibil) : null;
      if (c.cibilStatus === 'known') req(!(Number.isInteger(score) && score >= 300 && score <= 900), 'ca-sc-' + i, 'Enter the CIBIL of ' + label + ' as a whole number from 300 to 900');
      var inc = profile === 'none' ? 0 : num(c.income);
      if (profile !== 'none') req(!inRange(inc, 0, 10000000), 'ca-inc-' + i, 'Enter the monthly net income of ' + label + ' (0 if none)');
      return { relationship: c.relationship, cibilStatus: c.cibilStatus, cibil: score, income: inc || 0 };
    });

    var existing = num($('existing-emi'));
    req(!inRange(existing, 0, 10000000), 'existing-emi', 'Enter existing monthly EMIs (0 if none)');
    var rate = num($('rate')), foir = num($('foir'));
    // Illustration settings have defaults — validated but not counted in progress
    if (!inRange(rate, 1, 30)) need.push({ id: 'rate', text: 'Illustrative rate must be between 1% and 30%' });
    if (!inRange(foir, 20, 80)) need.push({ id: 'foir', text: 'FOIR assumption must be between 20% and 80%' });

    var fis = $('family-income-status').value;
    var fi = num($('family-income'));

    var profileObj = {
      destination: india ? 'India' : 'Abroad',
      level: level,
      course: course,
      country: india ? '' : $('country').value,
      foreignCollege: india ? '' : $('foreign-college').value.trim(),
      college: college,
      admission: india ? $('admission').value : '',
      campus: india ? radio('campus') : '',
      amount: amount,
      collateral: collateral,
      value: collateral === 'yes' ? value : 0,
      stipend: stipend || 0,
      profile: profile,
      incomes: people.map(function (p) { return profile === 'none' ? 0 : p.income; }),
      existing: existing || 0,
      rate: rate,
      tenure: +$('tenure').value,
      foir: foir,
      studentCibilStatus: scs,
      studentCibil: scs === 'known' ? sc : null,
      coApplicants: people.map(function (p) { return { relationship: p.relationship, cibilStatus: p.cibilStatus, cibil: p.cibil }; }),
      familyIncomeStatus: india ? fis : '',
      familyIncome: fis === 'known' && fi !== null && !Number.isNaN(fi) ? fi : NaN,
      otherBenefit: india ? $('other-benefit').value : '',
      applicationDate: india ? $('application-date').value : ''
    };
    return { need: need, checks: checks, profile: profileObj };
  }

  // Course vs institution consistency (spec §4.13) — warnings, not verdicts
  function consistencyWarnings(p) {
    var w = [];
    var r = selected;
    if (!r || p.destination !== 'India') return w;
    var c = p.course;
    if (r.d === 'M') {
      if (c === 'BDS' || c === 'MDS') w.push('This is a medical (NMC) record. ' + c + ' is not listed for it — check you selected the right college.');
      if (c === 'MBBS' && !r.mb) w.push('The NMC snapshot has no MBBS record for this institution (PG only).');
      if ((c === 'MD' || c === 'MS' || c === 'DNB') && !r.pg) w.push('The NMC snapshot has no PG record for this institution.');
    } else if (r.d === 'D') {
      if (c === 'MBBS' || c === 'MD' || c === 'MS' || c === 'DNB') w.push('This is a dental (DCI) record. ' + c + ' is not offered here — check you selected the right college.');
      if (c === 'MDS') w.push('The dental directory covers BDS. MDS availability at this college is not confirmed.');
    } else if (r.d === 'Q') {
      w.push('This is a general QHEI listing, not a medical or dental college record. Confirm that this institution teaches your course.');
    }
    if (r.x) w.push('Owner-confirmed addition: medical / dental course evidence for this institution has not been supplied.');
    return w;
  }

  // ─── Render ───
  function payText(r) {
    if (r.payment === 0) return '₹0 required';
    if (r.payment == null) return 'To be confirmed';
    return money(r.payment) + ' / month';
  }

  function renderNeed(need) {
    actions.hidden = true;
    $('lead-panel').hidden = true;
    resultBody.innerHTML =
      '<p class="result-empty">' + (need.length > 6 ? 'Answer a few questions to see your loan routes. Next up:' : 'Almost there — still needed:') + '</p>' +
      '<ul class="need-list">' + need.slice(0, 5).map(function (n) {
        return '<li><button type="button" data-focus="' + n.id + '">' + escHtml(n.text) + '</button></li>';
      }).join('') + '</ul>' +
      (need.length > 5 ? '<p class="result-note">+' + (need.length - 5) + ' more after these</p>' : '');
  }

  resultBody.addEventListener('click', function (e) {
    var connect = e.target.closest('.lt-connect');
    if (connect) {
      leadInterest = connect.getAttribute('data-type');
      var panel = $('lead-panel');
      panel.hidden = false;
      panel.querySelector('h3').textContent = 'Talk to a counsellor about ' + TYPE_META[leadInterest].name;
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(function () { $('lead-name').focus(); }, 300);
      track('counsellor_connect_clicked', { lender_type: leadInterest });
      return;
    }
    var id = e.target.getAttribute('data-focus');
    if (!id) return;
    var el = $(id);
    if (!el) return;
    if (el.hidden && el.closest('details')) el.closest('details').open = true;
    var focusable = el.matches('input, select, textarea') ? el : el.querySelector('input, select, textarea');
    (focusable || el).focus();
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // ─── Plain-language result ───
  // Each engine route gets a student-friendly name, a one-line meaning and an
  // everyday reason. The technical cards stay available under "See full details".
  var PLAIN = {
    pmv: { name: 'Government scheme loan (PM-Vidyalaxmi)', line: '₹0 to pay while studying, and no property needed.' },
    verify: { name: 'Government scheme loan — needs a check', line: 'Your college may qualify for the PM-Vidyalaxmi scheme.' },
    si: { name: 'Interest-only loan', line: 'Pay only the interest while you study; the full EMI starts after.' },
    pg: { name: 'PG stipend-friendly loan', line: 'A small fixed monthly payment during PG, set by your loan size.' },
    emi: { name: 'Regular EMI loan', line: 'The full EMI starts from the first disbursement.' },
    public: { name: 'Bank loan against property', line: 'A bank loan secured by family property.' },
    country: { name: 'Study-abroad loan — country check', line: 'We match lenders that fund your country and university.' },
    credit_review: { name: 'Credit score check first', line: 'A counsellor needs to look at the CIBIL scores before suggesting a loan.' }
  };
  var PLAIN_STATUS = { match: 'Looks possible', review: 'Needs a quick check', gap: 'Not a fit yet' };
  var ROUTE_ORDER = ['pmv', 'si', 'pg', 'verify', 'emi', 'country', 'public', 'credit_review'];
  var STATUS_ORDER = { match: 0, review: 1, gap: 2 };

  function lakh(n) { return '₹' + (Math.round(n * 100) / 100) + ' lakh'; }

  // One plain sentence explaining this route's status for this student
  function plainReason(r, res, p) {
    var inc = res.income;
    var incomeGap = function (need) {
      return inc > 0
        ? 'Needs family income of about ' + money(need) + '/month — you entered ' + money(inc) + '.'
        : 'Needs an earning parent or co-applicant with about ' + money(need) + '/month income.';
    };
    if (r.status === 'match') return PLAIN[r.id] ? PLAIN[r.id].line : r.reason;
    if (r.status === 'gap') {
      if (r.id === 'si') return incomeGap(r.requiredIncome) + ' A student stipend can\'t be counted here.';
      if (r.id === 'emi') {
        if (r.security === 'Collateral required' && !res.secured) return 'Needs property worth at least ' + lakh(p.amount) + ' as collateral.';
        return incomeGap(r.requiredIncome);
      }
      if (r.id === 'public') return 'Needs family property worth about ' + lakh(p.amount) + '.';
      if (r.id === 'pg') return 'Stipend + family income should be at least ' + money(r.requiredIncome) + '/month — you have ' + money(inc + (p.stipend || 0)) + '.';
      return r.reason;
    }
    // review
    if (r.id === 'si') return 'Possible — the lender needs to check self-employed or business income.';
    if (r.id === 'pg') return r.requiredIncome == null
      ? 'Possible — the lender checks your stipend and family income.'
      : 'Possible — your stipend + family income meets the usual level; the lender confirms it.';
    if (r.id === 'verify') return p.college && p.college.qheiStatus === 'pending'
      ? 'We need to confirm whether your college is on the scheme list.'
      : 'Your college is on the scheme list — we need to confirm your exact campus and NEET merit admission.';
    if (r.id === 'emi') return 'Possible, but at least one parent with CIBIL 701 or more is needed — a counsellor will check.';
    if (r.id === 'public') return 'Your property value covers the loan — the bank will do its own valuation.';
    if (r.id === 'country') return 'We\'ll check which lenders fund your country and university.';
    if (r.id === 'credit_review') return res.credit.student === null
      ? 'The student\'s CIBIL score is unknown or has no history. A counsellor can check it with you.'
      : 'At least one parent needs a CIBIL score of 701 or more. A counsellor can check the options.';
    return r.reason;
  }

  function afterStudy(r) {
    if (r.id === 'si' && r.futureEmi) return money(r.futureEmi) + '/month';
    if (r.id === 'emi' && r.payment) return money(r.payment) + '/month';
    if (r.id === 'pmv') return 'Bank\'s EMI, up to 15 yrs';
    if (r.id === 'pg') return 'Full EMI after PG';
    return 'Bank decides';
  }

  function propertyNeeded(r, res) {
    if (r.id === 'pmv') return 'No';
    if (r.id === 'public') return 'Yes';
    if (r.id === 'emi') return r.security === 'Collateral required' ? 'Yes' : 'Not always';
    if (r.id === 'si' || r.id === 'pg') return res.secured ? 'Yes (you offered it)' : 'No';
    return 'To be confirmed';
  }

  function shortRate(r) {
    if (!r.rate) return '';
    if (r.id === 'si') return r.rate.replace(' campaign rate, subject to confirmation', '') + ' (offer till 15 Nov 2026)';
    if (r.id === 'pmv') return 'Linked to the bank\'s rate (' + r.rate + ')';
    return r.rate;
  }

  function plainFee(fee) {
    if (/^Nil/.test(fee)) return 'No processing fee';
    return 'Processing fee ' + fee.replace('applicable GST', 'GST');
  }

  function plainBenefit(b) {
    return {
      csis_review: 'Your family income may qualify for full interest support while studying, on up to ₹10 lakh of the loan.',
      pmv_3: 'Your family income may qualify for 3% interest support while studying, on up to ₹10 lakh of the loan.',
      excluded: 'Another government scholarship or benefit may rule out interest support — a counsellor will check.',
      review: 'Tip: add your family income in step 4 to see if you also get interest support.'
    }[b.kind] || '';
  }

  function nextSteps(res, p) {
    var steps = [];
    var gaps = res.routes.filter(function (r) { return r.status === 'gap'; });
    var has = function (id, st) { return res.routes.some(function (r) { return r.id === id && (!st || r.status === st); }); };
    if (res.credit.mode === 'blocked') steps.push('Get the student\'s CIBIL report and share it with a counsellor.');
    if (res.credit.mode === 'review' && res.credit.student === null) steps.push('Check the student\'s CIBIL score (free at cibil.com), or ask a counsellor to help.');
    if (res.credit.mode === 'direct_only') steps.push('A student CIBIL above 700 opens more loan types, including ₹0-during-study options.');
    if (has('verify')) steps.push('Confirm your exact campus and that your seat came through NEET merit counselling.');
    var noFit = !res.routes.some(function (r) { return r.status === 'match'; });
    if (noFit && gaps.some(function (r) { return Number.isFinite(r.requiredIncome); }) && p.coApplicants.length < 4) steps.push('Add another earning co-applicant (for example, the second parent) to raise family income.');
    if (noFit && gaps.some(function (r) { return r.id === 'public' || r.security === 'Collateral required'; }) && p.collateral !== 'yes') steps.push('If your family owns property, choose "Yes" for collateral to see secured options.');
    if (res.routes.some(function (r) { return r.status === 'match'; })) steps.push('Keep your admission letter and fee schedule ready, and let a counsellor confirm the lender and rate.');
    if (!steps.length) steps.push('Share this result with a counsellor — they can suggest what to change.');
    return steps.slice(0, 3);
  }

  // ─── Loan doability by lender type (doability.js) ───
  var TYPE_META = {
    psu: { name: 'Government banks', partners: 'e.g. PNB, Union Bank',
      icon: '<path d="M4 10L16 4l12 6z" fill="#99F6E4" stroke="#0A2334" stroke-width="1.6" stroke-linejoin="round"/><g fill="#fff" stroke="#0A2334" stroke-width="1.6"><rect x="7" y="11" width="3" height="10"/><rect x="14.5" y="11" width="3" height="10"/><rect x="22" y="11" width="3" height="10"/></g><rect x="4" y="21" width="24" height="4" rx="1" fill="#0D9488" stroke="#0A2334" stroke-width="1.6"/>',
      facts: { 'Interest': 'About 7.15%–10.15%', 'Property': 'Not needed up to ₹7.5 lakh; full cover above', 'While studying': 'Nothing to pay (course + 1 year)', 'Decision time': 'Slower, branch-based' },
      pmvFacts: { 'Interest': 'About 7.15%–8.65% (PM-Vidyalaxmi)', 'Property': 'Not needed', 'While studying': 'Nothing to pay (course + 1 year)', 'Decision time': 'Slower, branch-based' } },
    pvt: { name: 'Private banks', partners: 'e.g. ICICI Bank, Axis Bank, IDFC First, Yes Bank',
      icon: '<rect x="4" y="8" width="24" height="17" rx="3" fill="#CCFBF1" stroke="#0A2334" stroke-width="1.6"/><rect x="4" y="12" width="24" height="3" fill="#0D9488"/><rect x="8" y="19" width="8" height="2.5" rx="1" fill="#0A2334"/>',
      facts: { 'Interest': 'About 8.75%–14%', 'Property': 'Not needed at their select colleges; otherwise yes', 'While studying': 'Often interest or part-interest', 'Decision time': 'About 1–2 weeks' } },
    nbfc: { name: 'NBFCs', partners: 'e.g. Credila, Avanse, Tata Capital, Auxilo, Poonawalla',
      icon: '<circle cx="16" cy="16" r="11" fill="#FBBF24" stroke="#0A2334" stroke-width="1.6"/><path d="M17.5 8l-6 9h5l-2 7 6-9h-5z" fill="#0A2334"/>',
      facts: { 'Interest': 'About 9.5%–14%', 'Property': 'Often not needed (₹50 lakh+ unsecured advertised)', 'While studying': 'Usually interest or part-payment', 'Decision time': 'Fastest — a few days' } }
  };
  var leadInterest = null;

  function doabilityHtml(d) {
    var types = ['psu', 'pvt', 'nbfc'];
    var html = '';
    if (d.best) {
      var b = d[d.best];
      html += '<div class="verdict verdict-' + (b.level >= 3 ? 'good' : 'warn') + '"><span class="verdict-icon">' + (b.level >= 3 ? '&#10003;' : '!') + '</span><div><h3>Best chance: ' + TYPE_META[d.best].name + '</h3><p>Loan doability <strong>' + b.label + '</strong>. Ratings update as you change any answer.</p></div></div>';
    } else {
      html += '<div class="verdict verdict-bad"><span class="verdict-icon">&times;</span><div><h3>No lender type fits right now</h3><p>A counsellor can look at your case and suggest what to change.</p></div></div>';
    }
    if (d.partial) html += '<p class="dz-partial">Estimate so far — add CIBIL scores and income in step 3 for a sharper rating.</p>';
    html += '<div class="lt-list">' + types.map(function (t) {
      var r = d[t], m = TYPE_META[t], facts = r.pmv && m.pmvFacts ? m.pmvFacts : m.facts;
      var meter = '';
      for (var i = 1; i <= 4; i++) meter += '<span' + (i <= r.level ? ' class="on"' : '') + '></span>';
      return '<article class="lt-card lt-' + r.band + (d.best === t ? ' lt-best' : '') + '">' +
        (d.best === t ? '<div class="lt-flag">Best chance</div>' : '') +
        '<div class="lt-top"><svg class="lt-icon" viewBox="0 0 32 32" aria-hidden="true">' + m.icon + '</svg><div><h4>' + m.name + '</h4><small>' + m.partners + '</small></div></div>' +
        '<div class="lt-rating"><span class="lt-label">Loan doability</span><strong class="lt-band">' + r.label + '</strong></div>' +
        '<div class="lt-meter" role="img" aria-label="Loan doability ' + r.label + '">' + meter + '</div>' +
        '<ul class="lt-reasons">' + r.reasons.map(function (x) { return '<li class="lr-' + x.tone + '">' + escHtml(x.text) + '</li>'; }).join('') + '</ul>' +
        '<dl class="lt-facts">' + Object.keys(facts).map(function (k) { return '<div><dt>' + k + '</dt><dd>' + escHtml(facts[k]) + '</dd></div>'; }).join('') + '</dl>' +
        '<button type="button" class="lt-connect" data-type="' + t + '">Connect with a counsellor &rarr;</button>' +
        '</article>';
    }).join('') + '</div>';
    html += '<p class="dz-method">Ratings are FundMyCampus estimates from each lender type\'s published rules (Oct 2026) and your answers — not an approval. The lender decides.</p>';
    return html;
  }

  // Exact engine routes, shown under the lender-type ratings once the profile is complete
  function routesSection(res, p) {
    var credit = res.credit;
    var html = '';

    if (res.incomplete) {
      return '<div class="warn-box">' + escHtml(res.message) + '</div>';
    }

    var routes = res.routes.slice().sort(function (a, b) {
      return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || ROUTE_ORDER.indexOf(a.id) - ROUTE_ORDER.indexOf(b.id);
    });
    var matches = routes.filter(function (r) { return r.status === 'match'; });
    var best = routes[0];

    // Notes that change the answer (wrong college/course pairing, quota exclusion)
    consistencyWarnings(p).concat((res.exclusions || []).map(function () {
      return 'Management / NRI quota seats can\'t use the government scheme loan. Other loans below can still work.';
    })).forEach(function (w) { html += '<div class="warn-box">' + escHtml(w) + '</div>'; });

    // What to do next (visible), then the exact routes (collapsible)
    html += '<div class="next-steps"><div class="others-title">What to do next</div><ol>' +
      nextSteps(res, p).map(function (s) { return '<li>' + escHtml(s) + '</li>'; }).join('') + '</ol></div>';
    var routesHtml = '';
    if (best && credit.mode !== 'blocked') {
      var rate = shortRate(best);
      routesHtml += '<article class="best-card best-' + best.status + '">' +
        '<div class="best-label">' + (best.status === 'match' ? 'Best option for you' : 'Closest option') + '</div>' +
        '<div class="best-head"><h4>' + escHtml(PLAIN[best.id].name) + '</h4><span class="route-status st-' + best.status + '">' + PLAIN_STATUS[best.status] + '</span></div>' +
        (best.status !== 'match' ? '<p class="best-why">' + escHtml(plainReason(best, res, p)) + '</p>' : '') +
        '<div class="kpis">' +
        '<div><span>While studying</span><strong>' + escHtml(best.payment === 0 ? '₹0' : best.payment == null ? 'Bank decides' : money(best.payment) + '/month') + '</strong></div>' +
        '<div><span>After studies</span><strong>' + escHtml(afterStudy(best)) + '</strong></div>' +
        '<div><span>Property needed?</span><strong>' + escHtml(propertyNeeded(best, res)) + '</strong></div>' +
        '</div>' +
        (rate ? '<p class="best-rate">Interest: ' + escHtml(rate) + (best.fee ? ' · ' + escHtml(plainFee(best.fee)) : '') + '</p>' : '') +
        (res.benefit && best.id === 'pmv' && plainBenefit(res.benefit) ? '<p class="best-benefit">' + escHtml(plainBenefit(res.benefit)) + '</p>' : '') +
        '</article>';
    }

    // 3. Other options, one plain line each
    var others = routes.slice(credit.mode === 'blocked' ? 0 : 1);
    if (others.length) {
      routesHtml += '<div class="others"><div class="others-title">Other options we checked</div>' + others.map(function (r) {
        return '<div class="opt-row"><div class="opt-top"><strong>' + escHtml(PLAIN[r.id].name) + '</strong><span class="route-status st-' + r.status + '">' + PLAIN_STATUS[r.status] + '</span></div>' +
          '<p>' + escHtml(plainReason(r, res, p)) + '</p></div>';
      }).join('') + '</div>';
    }

    if (routesHtml) html += '<details class="result-more"><summary>Exact loan types we checked</summary>' + routesHtml + '</details>';

    // 5. Everything technical, for counsellors and curious parents
    var cls = { normal: 'cg-normal', direct_only: 'cg-warn', review: 'cg-warn', blocked: 'cg-block' }[credit.mode] || 'cg-warn';
    var details = '<div class="credit-gate ' + cls + '"><strong>Credit check</strong><p>' + escHtml(credit.message) + '</p></div>';
    res.routes.forEach(function (r) {
      details += '<article class="route route-' + r.status + '">' +
        '<div class="route-head"><h3>' + escHtml(PLAIN[r.id].name) + '</h3><span class="route-status st-' + r.status + '">' + PLAIN_STATUS[r.status] + '</span></div>' +
        '<dl class="route-facts">' +
        '<div><dt>During study</dt><dd>' + escHtml(payText(r)) + '</dd></div>' +
        '<div><dt>Repayment</dt><dd>' + escHtml(r.repayment) + '</dd></div>' +
        '<div><dt>Security</dt><dd>' + escHtml(r.security) + '</dd></div>' +
        (r.rate ? '<div><dt>Rate</dt><dd>' + escHtml(r.rate) + '</dd></div>' : '') +
        (r.fee ? '<div><dt>Processing fee</dt><dd>' + escHtml(r.fee) + '</dd></div>' : '') +
        (r.margin ? '<div><dt>Margin</dt><dd>' + escHtml(r.margin) + '</dd></div>' : '') +
        (r.futureEmi ? '<div><dt>Later full EMI</dt><dd>' + money(r.futureEmi) + ' / month</dd></div>' : '') +
        (Number.isFinite(r.requiredIncome) ? '<div><dt>Income needed</dt><dd>' + money(r.requiredIncome) + ' / month</dd></div>' : '') +
        '</dl><p class="route-reason">' + escHtml(r.reason) + '</p></article>';
    });
    if (res.benefit) details += '<div class="benefit-box"><strong>Interest support</strong><p>' + escHtml(res.benefit.message) + '</p></div>';
    details += '<p class="result-note">Example only: a regular EMI loan of ₹' + p.amount + ' lakh at ' + p.rate + '% over ' + p.tenure + ' years would be about ' + money(res.monthly) + '/month and need about ' + money(res.need) + '/month of family income (' + p.foir + '% of income towards EMIs). You can change these assumptions under "Illustration settings".</p>';
    details += '<ul class="notes-list">' + res.notes.map(function (n) { return '<li>' + escHtml(n) + '</li>'; }).join('') + '</ul>';

    html += '<details class="result-more"><summary>Technical details for counsellors</summary>' + details + '</details>';
    html += '<details class="result-more"><summary>Documents to keep ready</summary><ul>' +
      res.docs.map(function (d) { return '<li>' + escHtml(d) + '</li>'; }).join('') + '</ul></details>';
    return html;
  }

  function todayText() {
    return new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  }

  // ─── Progress meter + route preview (keeps the result column useful before completion) ───
  function renderProgress(g) {
    var done = Math.max(0, g.checks - g.need.length);
    var pct = g.need.length ? Math.round(done / Math.max(g.checks, 1) * 100) : 100;
    $('progress-fill').style.width = pct + '%';
    $('progress-text').textContent = g.need.length ? pct + '% complete' : 'Profile complete';
    $('result-preview').hidden = !g.need.length ? true : false;
  }

  // ─── Recompute ───
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(recompute, 200);
  }

  function basicsReady(p) {
    if (!p.course || !inRange(p.amount, 1, 500)) return false;
    return p.destination === 'India' ? !!(p.college && p.admission) : !!p.country;
  }

  function recompute() {
    syncVisibility();
    var g = gather();
    var p = g.profile;
    lastProfile = p;
    renderProgress(g);
    if (!basicsReady(p) || typeof Doability === 'undefined') {
      lastResult = null; lastDoability = null;
      $('result-preview').hidden = false;
      renderNeed(g.need);
      updateJump();
      return;
    }
    $('result-preview').hidden = true;
    var gate = p.studentCibilStatus === 'known' && Number.isInteger(p.studentCibil) && p.studentCibil >= 300 && p.studentCibil <= 900
      ? LoanEngine.creditGate(p) : null;
    var d = Doability.assess(Object.assign({}, p, { creditGate: gate }));
    lastDoability = d;
    var res = g.need.length ? null : LoanEngine.assess(p);
    lastResult = res;

    var html = doabilityHtml(d);
    if (res) html += routesSection(res, p);
    else html += '<div class="next-steps"><div class="others-title">Fill these to see exact loan types</div><ul class="need-list">' +
      g.need.slice(0, 4).map(function (n) { return '<li><button type="button" data-focus="' + n.id + '">' + escHtml(n.text) + '</button></li>'; }).join('') + '</ul></div>';
    html += '<p class="result-version">Indicative only — the lender decides the final loan. Checked ' + todayText() + '.</p>';
    resultBody.innerHTML = html;
    $('open-lead').textContent = 'Get my loan options reviewed';
    actions.hidden = false;
    $('wa-share').href = waLink();
    updateJump();
    track('doability_shown', { psu: d.psu.band, pvt: d.pvt.band, nbfc: d.nbfc.band });
    if (res && !res.incomplete) {
      var routes = res.routes.map(function (r) { return r.id + ':' + r.status; }).join(',');
      if (!completedOnce) {
        completedOnce = true;
        track('assessment_completed', { rule_version: res.credit.ruleVersion, routes: routes, course: g.profile.course, destination: g.profile.destination });
      }
      res.routes.forEach(function (r) { if (r.status === 'gap') track('result_gap_shown', { gap: r.id }); });
    }
  }

  form.addEventListener('input', function (e) {
    if (!started) { started = true; track('checker_started', { destination: radio('destination'), course: courseSel.value }); }
    if (e.target.id === 'amount') syncSlider();
    if (e.target.id === 'amount-range') { $('amount').value = e.target.value; amountWords(); }
    if (e.target.id === 'manual-college') syncVisibility();
    if (e.target.id === 'college-search') return; // search text alone never selects
    schedule();
  });
  form.addEventListener('change', function (e) {
    var t = e.target;
    if (t.name === 'level') renderCourses();
    if (t.name === 'destination') { closeList(); }
    if (t.id === 'income-profile') renderCoapps();
    if (t.id === 'student-cibil-status' && t.value !== 'known') $('student-cibil').value = '';
    if (t.id === 'collateral' || t.name === 'collateral') { if (radio('collateral') !== 'yes') $('collateral-value').value = ''; }
    schedule();
  });

  function syncSlider() {
    var v = num($('amount'));
    if (inRange(v, 1, 500)) $('amount-range').value = Math.min(v, 200);
    amountWords();
  }
  function amountWords() {
    var v = num($('amount'));
    $('amount-words').textContent = inRange(v, 1, 500) ? money(v * 100000) : '';
  }

  // ─── Summary (copy / WhatsApp / print / lead) ───
  function summaryText() {
    var p = lastProfile, res = lastResult, d = lastDoability;
    if (!p || !d) return '';
    var lines = ['FundMyCampus medical loan check — ' + todayText()];
    lines.push('Course: ' + p.course + ' (' + (p.level === 'Masters' ? 'PG' : 'UG') + '), ' + p.destination + (p.country ? ' — ' + p.country : ''));
    if (p.destination === 'India' && p.college) {
      lines.push('College: ' + p.college.name + (p.college.state ? ', ' + p.college.state : '') + (p.college.aishe ? ' (AISHE ' + p.college.aishe + ')' : '') + ' — ' + (p.college.manual ? 'entered manually, not verified' : p.college.aishe ? 'found in QHEI snapshot' : 'QHEI not confirmed'));
      lines.push('Admission: ' + ({ merit: 'Merit / counselling', management: 'Management / NRI quota', pending: 'Pending' })[p.admission]);
    }
    if (p.foreignCollege) lines.push('University: ' + p.foreignCollege);
    lines.push('Loan needed: ₹' + p.amount + ' lakh; collateral: ' + p.collateral + (p.collateral === 'yes' ? ' (~₹' + p.value + ' lakh, unverified)' : ''));
    if (p.destination === 'India' && p.level === 'Masters') lines.push('PG stipend: ' + money(p.stipend) + '/month');
    lines.push('Student CIBIL (self-reported): ' + (p.studentCibilStatus === 'known' ? p.studentCibil : (p.studentCibilStatus || 'not given').replace('_', ' ')));
    p.coApplicants.forEach(function (c, i) {
      lines.push('Co-applicant ' + (i + 1) + ': ' + (c.relationship || 'not given') + ', CIBIL ' + (c.cibilStatus === 'known' ? c.cibil : (c.cibilStatus || 'not given').replace('_', ' ')) + ' (self-reported), income ' + (p.profile === 'none' ? 'not documented' : money(p.incomes[i]) + '/month'));
    });
    lines.push('Loan doability: Government banks ' + d.psu.label + ' · Private banks ' + d.pvt.label + ' · NBFCs ' + d.nbfc.label);
    if (leadInterest) lines.push('Interested in: ' + TYPE_META[leadInterest].name);
    if (res && !res.incomplete) {
      lines.push('Credit screen: ' + res.credit.mode);
      (res.exclusions || []).forEach(function (x) { lines.push('Excluded: ' + x); });
      lines.push('Loan types:');
      if (!res.routes.length) lines.push('- None offered under current screening rules');
      res.routes.forEach(function (r) { lines.push('- ' + PLAIN[r.id].name + ': ' + PLAIN_STATUS[r.status] + ' (while studying: ' + payText(r) + ')'); });
      lines.push('Rules: ' + res.credit.ruleVersion + ', products ' + PRODUCT_RULE_VERSION + ', data ' + MED_META.dataVersion);
    }
    lines.push('Indicative screening only — not a lender decision.');
    return lines.join('\n');
  }

  function waLink() {
    return 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent('Hi FundMyCampus, please review my medical loan check:\n\n' + summaryText());
  }

  $('wa-share').addEventListener('click', function () {
    this.href = waLink();
    track('whatsapp_clicked', { origin: 'result' });
  });
  $('copy-summary').addEventListener('click', function () {
    var btn = this, text = summaryText();
    var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy summary'; }, 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    else { fallbackCopy(text); done(); }
  });
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
  }
  $('print-summary').addEventListener('click', function () {
    resultBody.querySelectorAll('details').forEach(function (d) { d.open = true; });
    window.print();
  });

  // ─── Reset ───
  $('reset-btn').addEventListener('click', function () {
    form.reset();
    setRadio('destination', 'India');
    setRadio('level', 'Bachelors');
    setRadio('collateral', '');
    setRadio('campus', '');
    renderCourses();
    courseSel.value = 'MBBS';
    clearInstitution();
    manualMode = false;
    $('manual-wrap').hidden = true;
    $('manual-toggle').textContent = "My college isn't listed";
    stateFilter.value = '';
    dirFilter.value = '';
    $('existing-emi').value = '0';
    coapps = [newCoapp()];
    renderCoapps();
    amountWords();
    Lead.reset();
    lastResult = null;
    completedOnce = false;
    recompute();
    form.querySelector('input[name="destination"]').focus();
  });

  // ─── Mobile: jump to result ───
  var jump = $('jump-result');
  var resultVisible = false;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      resultVisible = entries[0].isIntersecting;
      updateJump();
    }).observe($('result'));
  }
  function updateJump() {
    jump.hidden = !(lastResult && !lastResult.incomplete && !resultVisible && window.innerWidth < 900);
  }
  window.addEventListener('resize', updateJump);

  // ─── Init (with optional ?course= / ?institution= prefill) ───
  renderCourses();
  coapps = [newCoapp()];
  renderCoapps();
  amountWords();
  var params = new URLSearchParams(window.location.search);
  var preCourse = (params.get('course') || 'MBBS').toUpperCase();
  if (COURSES.Masters.indexOf(preCourse) >= 0 && preCourse !== 'OTHER') { setRadio('level', 'Masters'); renderCourses(); }
  courseSel.value = COURSES[radio('level')].indexOf(preCourse) >= 0 ? preCourse : '';
  var preInst = params.get('institution');
  if (preInst && INST_BY_ID[preInst]) selectInstitution(INST_BY_ID[preInst]);
  recompute();
  track('medical_checker_view', { course_prefill: courseSel.value });

  return {
    selectInstitution: function (r) {
      setRadio('destination', 'India');
      selectInstitution(r);
      syncVisibility();
      $('checker').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    profile: function () { return lastProfile; },
    result: function () { return lastResult; },
    doability: function () { return lastDoability; },
    interest: function () { return leadInterest; },
    clearInterest: function () { leadInterest = null; },
    summary: summaryText,
    waLink: waLink
  };
})();

// ═══════════════════════════════════════
// 2. LEAD CAPTURE
// ═══════════════════════════════════════
var Lead = (function () {
  var panel = $('lead-panel');
  var form = $('lead-form');
  var errEl = $('lead-error');
  var submitBtn = $('lead-submit');
  var ref = null;   // reused across retries as the idempotency key
  var startedForm = false;

  // First-touch attribution for this session
  if (!store('session', 'fmc_landing_url')) store('session', 'fmc_landing_url', window.location.href);
  if (!store('session', 'fmc_referrer')) store('session', 'fmc_referrer', document.referrer || '');

  function attribution() {
    var params = new URLSearchParams(window.location.search);
    return {
      landing_url: store('session', 'fmc_landing_url'), page_url: window.location.href, referrer: store('session', 'fmc_referrer'),
      utm_source: params.get('utm_source'), utm_medium: params.get('utm_medium'), utm_campaign: params.get('utm_campaign'),
      utm_term: params.get('utm_term'), utm_content: params.get('utm_content')
    };
  }

  function post(body) {
    return fetch(API_URL + '/api/landing-leads', {
      method: 'POST',
      // Only Content-Type: the API's CORS allow-list doesn't include custom headers
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res;
    });
  }

  // Shared contact validation; returns an error message or ''
  function validateContact(name, phone, email, consent) {
    if (name.length < 2) return 'Please enter your full name.';
    if (!/^[6-9]\d{9}$/.test(phone)) return 'Please enter a valid 10-digit Indian mobile number.';
    // The leads API requires a valid email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Please enter a valid email address.';
    if (!consent) return 'Please agree to be contacted so a counsellor can call you.';
    return '';
  }

  if (!form) return { reset: function () {} };

  $('open-lead').addEventListener('click', function () {
    Checker.clearInterest();
    panel.querySelector('h3').textContent = 'Get a counsellor to review this';
    panel.hidden = false;
    $('lead-name').focus();
  });
  form.addEventListener('input', function () {
    if (!startedForm) { startedForm = true; track('lead_form_started', { page_type: 'medical_hub' }); }
  });

  function showError(msg) {
    errEl.innerHTML = msg;
    errEl.hidden = false;
  }

  function newRef() {
    return 'FMC-MED-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  function assessmentPayload() {
    var p = Checker.profile(), res = Checker.result(), d = Checker.doability();
    if (!p || !d) return null;
    var done = res && !res.incomplete;
    return {
      doability: { government_banks: d.psu.band, private_banks: d.pvt.band, nbfcs: d.nbfc.band, best: d.best },
      lender_type_interest: Checker.interest(),
      destination: p.destination, country: p.country || null, level: p.level, course: p.course,
      institution: p.college ? { id: p.college.id, name: p.college.name, state: p.college.state || null, aishe: p.college.aishe || null, evidence_status: p.college.evidenceStatus } : null,
      foreign_university: p.foreignCollege || null,
      admission: p.admission || null, campus_confirmation: p.campus || null,
      loan_amount_inr: Math.round(p.amount * 100000),
      collateral: p.collateral, collateral_value_inr: p.collateral === 'yes' ? Math.round(p.value * 100000) : null,
      stipend_monthly_inr: p.stipend,
      income_profile: p.profile, coapplicant_income_monthly_inr: p.incomes.reduce(function (a, b) { return a + (b || 0); }, 0), existing_emi_monthly_inr: p.existing,
      student_cibil_status: p.studentCibilStatus, student_cibil_self_reported: p.studentCibil,
      coapplicants: p.coApplicants.map(function (c, i) { return { relationship: c.relationship, cibil_status: c.cibilStatus, cibil_self_reported: c.cibil, income_monthly_inr: p.incomes[i] }; }),
      credit_gate: done ? res.credit.mode : null, parent_qualifies: done ? res.credit.parentQualifies : null, credit_rule_version: done ? res.credit.ruleVersion : null,
      exclusions: done ? res.exclusions || [] : [],
      routes: done ? res.routes.map(function (r) { return { id: r.id, status: r.status }; }) : [],
      product_rule_version: PRODUCT_RULE_VERSION, data_version: MED_META.dataVersion,
      summary: Checker.summary()
    };
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errEl.hidden = true;
    if (form.querySelector('[name="company"]').value) return; // honeypot filled → bot
    var name = $('lead-name').value.trim();
    var phone = $('lead-phone').value.replace(/\D/g, '');
    var email = $('lead-email').value.trim();
    var problem = validateContact(name, phone, email, $('lead-consent').checked);
    if (problem) { showError(problem); return; }

    ref = ref || newRef();
    var body = {
      name: name, email: email, phone: '+91' + phone,
      loan_status: 'need_loan',
      consent: true, consent_text_version: CONSENT_VERSION, consent_at: new Date().toISOString(),
      marketing_consent: $('lead-marketing').checked,
      source: 'medical_loan_checker',
      enquiry_ref: ref, idempotency_key: ref,
      assessment: assessmentPayload(),
      attribution: attribution()
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';
    post(body)
      .then(function () {
        form.hidden = true;
        panel.querySelector('h3').hidden = true;
        panel.querySelector('.lead-sub').hidden = true;
        $('lead-ref').textContent = ref;
        $('lead-wa').href = Checker.waLink();
        $('lead-success').hidden = false;
        track('lead_submitted', { form_version: CONSENT_VERSION });
      })
      .catch(function () {
        // Only confirm after the server accepts it; keep everything entered so the user can retry.
        submitBtn.disabled = false;
        submitBtn.textContent = 'Try again';
        showError('We couldn\'t confirm your enquiry was received. Please try again, or <a href="' + escHtml(Checker.waLink()) + '" target="_blank" rel="noopener noreferrer">send it to us on WhatsApp</a>.');
      });
  });

  $('lead-wa').addEventListener('click', function () { track('whatsapp_clicked', { origin: 'lead_success' }); });

  return {
    newRef: newRef,
    post: post,
    attribution: attribution,
    validateContact: validateContact,
    assessment: assessmentPayload,
    reset: function () {
      form.reset();
      form.hidden = false;
      panel.hidden = true;
      panel.querySelector('h3').hidden = false;
      panel.querySelector('.lead-sub').hidden = false;
      $('lead-success').hidden = true;
      errEl.hidden = true;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send for review';
      ref = null;
    }
  };
})();

// ═══════════════════════════════════════
// 2a. CAMPAIGN EXPIRY — static copy follows the same IST cut-off as the engine
// ═══════════════════════════════════════
(function () {
  if (typeof LoanEngine === 'undefined' || LoanEngine.campaign({}).active) return;
  document.querySelectorAll('.campaign-only').forEach(function (el) { el.hidden = true; });
  document.querySelectorAll('.campaign-expired').forEach(function (el) { el.hidden = false; });
})();

// ═══════════════════════════════════════
// 2b. HERO CALLBACK FORM — quick lead, no checker needed
// ═══════════════════════════════════════
(function () {
  var form = $('hero-lead-form');
  if (!form || !Lead.post) return;
  var errEl = $('hl-error');
  var btn = $('hl-submit');
  var ref = null;
  var startedForm = false;

  form.addEventListener('input', function () {
    if (!startedForm) { startedForm = true; track('lead_form_started', { page_type: 'medical_hub_hero' }); }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errEl.hidden = true;
    if (form.querySelector('[name="company"]').value) return; // honeypot filled → bot
    var name = $('hl-name').value.trim();
    var phone = $('hl-phone').value.replace(/\D/g, '');
    var email = $('hl-email').value.trim();
    var course = $('hl-course').value;
    var status = $('hl-status').value;
    var problem = Lead.validateContact(name, phone, email, $('hl-consent').checked);
    if (!problem && !course) problem = 'Please select your course.';
    if (!problem && !status) problem = 'Please select your admission status.';
    if (problem) { errEl.innerHTML = problem; errEl.hidden = false; return; }

    ref = ref || Lead.newRef();
    var body = {
      name: name, email: email, phone: '+91' + phone,
      loan_status: status, course: course,
      consent: true, consent_text_version: CONSENT_VERSION, consent_at: new Date().toISOString(),
      marketing_consent: false,
      source: 'medical_landing_hero',
      enquiry_ref: ref, idempotency_key: ref,
      assessment: Lead.assessment(),   // included only if the checker was completed first
      attribution: Lead.attribution()
    };

    btn.disabled = true;
    btn.textContent = 'Submitting...';
    Lead.post(body)
      .then(function () {
        form.hidden = true;
        form.parentNode.querySelector('.form-header').hidden = true;
        $('hl-ref').textContent = ref;
        $('hl-success').hidden = false;
        track('lead_submitted', { form_version: CONSENT_VERSION, origin: 'hero' });
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = 'Try again';
        errEl.innerHTML = 'We couldn\'t confirm your request was received. Please try again, or <a href="https://wa.me/' + WA_NUMBER + '" target="_blank" rel="noopener noreferrer">message us on WhatsApp</a>.';
        errEl.hidden = false;
      });
  });
})();

// ═══════════════════════════════════════
// 3. INTERACTIVE INDIA MAP
// ═══════════════════════════════════════
(function () {
  var mapContainer = document.getElementById('india-map-container');
  var stateListEl = document.getElementById('state-list');
  var stateListWrap = document.getElementById('state-list-wrap');
  var collegesWrap = document.getElementById('state-colleges-wrap');
  var backBtn = document.getElementById('back-to-states');
  var selectedStateName = document.getElementById('selected-state-name');
  var selectedStateCount = document.getElementById('selected-state-count');
  var collegesList = document.getElementById('state-colleges-list');
  var stateListTotal = document.getElementById('state-list-total');

  if (!mapContainer || !stateListEl) return;

  // Build state → colleges map (medical + dental records)
  var stateMap = {};
  MAP_COLLEGES.forEach(function (c) {
    if (!stateMap[c.s]) stateMap[c.s] = [];
    stateMap[c.s].push(c);
  });

  var stateNames = Object.keys(stateMap).sort();
  stateListTotal.textContent = MAP_COLLEGES.length.toLocaleString('en-IN') + ' colleges';

  // Render state list on the left
  stateNames.forEach(function (state) {
    var btn = document.createElement('button');
    btn.className = 'state-list-item';
    btn.setAttribute('data-state', state);
    btn.innerHTML =
      '<span class="state-item-name">' + escHtml(state) + '</span>' +
      '<span class="state-item-count">' + stateMap[state].length + '</span>';
    btn.addEventListener('click', function () {
      selectState(state);
    });
    stateListEl.appendChild(btn);
  });

  backBtn.addEventListener('click', function () {
    deselectState();
  });

  function selectState(stateName) {
    var colleges = stateMap[stateName];
    if (!colleges) return;

    document.querySelectorAll('.state-list-item').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-state') === stateName);
    });

    var medical = colleges.filter(function (c) { return c.d === 'M'; }).length;
    selectedStateName.textContent = stateName;
    selectedStateCount.textContent = medical + ' medical · ' + (colleges.length - medical) + ' dental';

    // QHEI-listed first, then medical before dental, then by name
    var sortedColleges = colleges.slice().sort(function (a, b) {
      return (b.a ? 1 : 0) - (a.a ? 1 : 0) || a.d.localeCompare(b.d) || a.n.localeCompare(b.n);
    });

    collegesList.innerHTML = sortedColleges
      .map(function (c, idx) {
        return '<div class="sidebar-college" data-pin-id="pin-' + idx + '">' +
          '<div><div class="sidebar-college-name">' + escHtml(c.n) + '</div>' +
          '<div class="sidebar-college-city">' + escHtml(DIR_LABEL[c.d]) + ' &middot; ' + escHtml(c.d === 'D' ? (c.m || 'BDS') : coursesText(c)) + '</div>' +
          '<button type="button" class="sidebar-check" data-id="' + escHtml(c.i) + '">Check loan routes &rarr;</button></div>' +
          '<div class="sidebar-college-rate ' + (c.a ? 'q-listed' : 'q-none') + '">' + (c.a ? 'QHEI' : '&mdash;') + '</div>' +
          '</div>';
      }).join('');

    stateListWrap.hidden = true;
    collegesWrap.hidden = false;

    if (mapContainer.indiaMap) {
      mapContainer.indiaMap.selectState(stateName);
    }
    zoomToState(stateName);
    addCollegePins(stateName, sortedColleges);

    collegesList.querySelectorAll('.sidebar-college').forEach(function (item) {
      item.addEventListener('click', function (e) {
        var check = e.target.closest('.sidebar-check');
        if (check) {
          if (Checker) Checker.selectInstitution(INST_BY_ID[check.getAttribute('data-id')]);
          return;
        }
        var pinId = this.getAttribute('data-pin-id');
        highlightPin(pinId);
        collegesList.querySelectorAll('.sidebar-college').forEach(function (el) {
          el.classList.remove('college-active');
        });
        this.classList.add('college-active');
      });
    });
  }

  function deselectState() {
    stateListWrap.hidden = false;
    collegesWrap.hidden = true;
    document.querySelectorAll('.state-list-item').forEach(function (b) {
      b.classList.remove('active');
    });
    if (mapContainer.indiaMap) {
      mapContainer.indiaMap.reset();
    }
    resetMapZoom();
    removeCollegePins();
  }

  function zoomToState(stateName) {
    var svg = mapContainer.querySelector('svg');
    if (!svg) return;
    var statePath = svg.querySelector('[data-state="' + stateName + '"]');
    if (!statePath) return;

    var bbox = statePath.getBBox();
    var cx = bbox.x + bbox.width / 2;
    var cy = bbox.y + bbox.height / 2;
    var stateSize = Math.max(bbox.width, bbox.height);
    var scale = Math.min(3.5, Math.max(1.8, 200 / stateSize));

    svg.style.transformOrigin = cx + 'px ' + cy + 'px';
    svg.style.transform = 'scale(' + scale + ')';
  }

  function resetMapZoom() {
    var svg = mapContainer.querySelector('svg');
    if (!svg) return;
    svg.style.transform = 'scale(1)';
    svg.style.transformOrigin = 'center center';
  }

  function isPointInsidePath(svgEl, path, x, y) {
    var pt = svgEl.createSVGPoint();
    pt.x = x;
    pt.y = y;
    return path.isPointInFill(pt);
  }

  function findPointInside(svgEl, path, bbox, maxAttempts) {
    for (var a = 0; a < maxAttempts; a++) {
      var x = bbox.x + Math.random() * bbox.width;
      var y = bbox.y + Math.random() * bbox.height;
      if (isPointInsidePath(svgEl, path, x, y)) {
        return { x: x, y: y };
      }
    }
    return { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
  }

  // Pins are spread inside the state shape — positions are illustrative, not geocoded
  function addCollegePins(stateName, colleges) {
    removeCollegePins();
    var svg = mapContainer.querySelector('svg');
    if (!svg) return;
    var statePath = svg.querySelector('[data-state="' + stateName + '"]');
    if (!statePath) return;

    var bbox = statePath.getBBox();
    var ns = 'http://www.w3.org/2000/svg';
    var pinGroup = document.createElementNS(ns, 'g');
    pinGroup.setAttribute('id', 'college-pins');

    var placedPoints = [];
    var minDist = Math.min(bbox.width, bbox.height) * 0.08;

    colleges.forEach(function (c, idx) {
      var point = null;
      var best = null;
      for (var attempt = 0; attempt < 80; attempt++) {
        var candidate = findPointInside(svg, statePath, bbox, 1);
        if (!candidate || !isPointInsidePath(svg, statePath, candidate.x, candidate.y)) continue;
        var tooClose = false;
        for (var p = 0; p < placedPoints.length; p++) {
          var dx = candidate.x - placedPoints[p].x;
          var dy = candidate.y - placedPoints[p].y;
          if (Math.sqrt(dx * dx + dy * dy) < minDist) {
            tooClose = true;
            break;
          }
        }
        if (!tooClose) {
          point = candidate;
          break;
        }
        if (!best) best = candidate;
      }
      if (!point) point = best || findPointInside(svg, statePath, bbox, 50);
      placedPoints.push(point);

      var tag = c.a ? 'QHEI listed' : 'QHEI not confirmed';
      var color = c.a ? '#0D9488' : '#9CA3AF';

      var pin = document.createElementNS(ns, 'g');
      pin.setAttribute('class', 'college-pin');
      pin.setAttribute('id', 'pin-' + idx);
      pin.setAttribute('data-college-name', c.n);
      pin.setAttribute('data-color', color);
      pin.setAttribute('transform', 'translate(' + point.x + ',' + point.y + ')');

      var circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('r', '3');
      circle.setAttribute('fill', '#FFFFFF');
      circle.setAttribute('stroke', color);
      circle.setAttribute('stroke-width', '1.5');
      circle.setAttribute('class', 'pin-dot');

      var label = document.createElementNS(ns, 'g');
      label.setAttribute('class', 'pin-label');
      label.setAttribute('style', 'display:none');

      var bg = document.createElementNS(ns, 'rect');
      bg.setAttribute('x', '8');
      bg.setAttribute('y', '-14');
      bg.setAttribute('rx', '5');
      bg.setAttribute('fill', '#000000');

      var text = document.createElementNS(ns, 'text');
      text.setAttribute('x', '14');
      text.setAttribute('y', '4');
      text.setAttribute('fill', '#FFFFFF');
      text.setAttribute('font-size', '12');
      text.setAttribute('font-weight', '700');
      text.setAttribute('font-family', 'Inter, sans-serif');
      text.textContent = tag;

      setTimeout(function () {
        var tBox = text.getBBox();
        bg.setAttribute('width', tBox.width + 12);
        bg.setAttribute('height', tBox.height + 8);
        bg.setAttribute('y', tBox.y - 4);
      }, 50);

      label.appendChild(bg);
      label.appendChild(text);

      var title = document.createElementNS(ns, 'title');
      title.textContent = c.n + ' — ' + tag;

      pin.appendChild(circle);
      pin.appendChild(label);
      pin.appendChild(title);

      pin.style.pointerEvents = 'auto';
      pin.style.cursor = 'pointer';
      pin.addEventListener('click', function (e) {
        e.stopPropagation();
        highlightPin('pin-' + idx);
        var listItem = collegesList.querySelector('[data-pin-id="pin-' + idx + '"]');
        if (listItem) {
          collegesList.querySelectorAll('.sidebar-college').forEach(function (el) {
            el.classList.remove('college-active');
          });
          listItem.classList.add('college-active');
          listItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });

      pinGroup.appendChild(pin);
    });

    svg.appendChild(pinGroup);
  }

  function highlightPin(pinId) {
    document.querySelectorAll('#college-pins .college-pin').forEach(function (p) {
      var dot = p.querySelector('.pin-dot');
      var lbl = p.querySelector('.pin-label');
      if (dot) {
        dot.setAttribute('r', '3');
        dot.setAttribute('fill', '#FFFFFF');
        dot.setAttribute('stroke', p.getAttribute('data-color'));
        dot.setAttribute('stroke-width', '1.5');
      }
      if (lbl) lbl.setAttribute('style', 'display:none');
    });

    var target = document.getElementById(pinId);
    if (target) {
      var dot = target.querySelector('.pin-dot');
      var lbl = target.querySelector('.pin-label');
      if (dot) {
        dot.setAttribute('r', '5');
        dot.setAttribute('fill', target.getAttribute('data-color'));
        dot.setAttribute('stroke', '#FFFFFF');
        dot.setAttribute('stroke-width', '2');
      }
      if (lbl) lbl.setAttribute('style', 'display:block');
    }
  }

  function removeCollegePins() {
    var existing = document.getElementById('college-pins');
    if (existing) existing.remove();
  }

  if (typeof renderIndiaMap === 'function') {
    renderIndiaMap('india-map-container', function (stateName) {
      if (stateMap[stateName]) {
        selectState(stateName);
      } else {
        deselectState();
      }
    }, MAP_COLLEGES);
  }
})();

// ═══════════════════════════════════════
// 4. COLLEGE COMPARISON TOOL
// ═══════════════════════════════════════
(function () {
  var slots = document.querySelectorAll('.compare-slot');
  var selectedColleges = [null, null, null];

  if (!slots.length) return;

  slots.forEach(function (slot) {
    var slotIndex = parseInt(slot.getAttribute('data-slot'));
    var searchInput = slot.querySelector('.slot-search');
    var dropdown = slot.querySelector('.slot-dropdown');
    var card = slot.querySelector('.slot-card');
    var removeBtn = slot.querySelector('.slot-remove');
    var debounce;

    searchInput.addEventListener('input', function () {
      clearTimeout(debounce);
      debounce = setTimeout(function () {
        var q = norm(searchInput.value);
        if (q.length < 2) { dropdown.hidden = true; return; }
        var tokens = searchTokens(q);

        var matches = MAP_COLLEGES.filter(function (c) {
          return tokens.every(function (t) { return c.key.indexOf(t) >= 0; });
        }).slice(0, 8);

        if (!matches.length) {
          dropdown.innerHTML = '<div style="padding:14px;text-align:center;color:#9CA3AF;font-size:0.85rem;">No results</div>';
          dropdown.hidden = false;
          return;
        }

        dropdown.innerHTML = matches.map(function (c) {
          return '<div class="slot-dropdown-item" data-id="' + escHtml(c.i) + '">' +
            escHtml(c.n) + '<small>' + escHtml(c.s) + ' &middot; ' + escHtml(DIR_LABEL[c.d]) + (c.a ? ' &middot; QHEI' : '') + '</small></div>';
        }).join('');
        dropdown.hidden = false;

        dropdown.querySelectorAll('.slot-dropdown-item').forEach(function (item) {
          item.addEventListener('click', function () {
            selectCollege(slotIndex, INST_BY_ID[this.getAttribute('data-id')]);
            dropdown.hidden = true;
          });
        });
      }, 200);
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.compare-slot[data-slot="' + slotIndex + '"]')) {
        dropdown.hidden = true;
      }
    });

    removeBtn.addEventListener('click', function () {
      selectedColleges[slotIndex] = null;
      card.hidden = true;
      slot.querySelector('.slot-search-wrap').style.display = '';
      searchInput.value = '';
      updateSummary();
    });

    slot.querySelector('.slot-check').addEventListener('click', function () {
      if (Checker && selectedColleges[slotIndex]) Checker.selectInstitution(selectedColleges[slotIndex]);
    });
  });

  // Quick picks: a few scheme-listed colleges plus one unconfirmed, so the contrast is visible
  var picksEl = document.getElementById('compare-picks');
  if (picksEl) {
    var listed = MAP_COLLEGES.filter(function (c) { return c.a && c.d === 'M'; }).slice(0, 3);
    var dental = MAP_COLLEGES.filter(function (c) { return c.a && c.d === 'D'; }).slice(0, 1);
    var unlisted = MAP_COLLEGES.filter(function (c) { return /maulana azad medical/i.test(c.n); }).slice(0, 1);
    listed.concat(dental, unlisted).forEach(function (c) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = c.n.replace(/\s*\(.*?\)/g, '');
      btn.addEventListener('click', function () {
        var free = selectedColleges.indexOf(null);
        selectCollege(free < 0 ? 2 : free, c);
      });
      picksEl.appendChild(btn);
    });
  }

  function selectCollege(slotIndex, college) {
    selectedColleges[slotIndex] = college;
    var slot = slots[slotIndex];
    var card = slot.querySelector('.slot-card');

    slot.querySelector('.slot-name').textContent = college.n;
    slot.querySelector('.slot-info').textContent = college.s + ' · ' + DIR_LABEL[college.d] +
      (college.d === 'M' && college.u ? ' · ' + college.u : '') +
      (college.d === 'D' && college.m ? ' · ' + college.m : '');
    slot.querySelector('.slot-rate').textContent = college.d === 'D' ? 'BDS' + (college.st ? ' · ' + college.st + ' seats' : '') : coursesText(college);
    var badge = slot.querySelector('.slot-type-badge');
    badge.textContent = college.a ? 'QHEI snapshot · AISHE ' + college.a : 'QHEI not confirmed';
    badge.classList.toggle('badge-muted', !college.a);
    card.title = evidenceText(college);

    slot.querySelector('.slot-search-wrap').style.display = 'none';
    card.hidden = false;
    updateSummary();
  }

  function updateSummary() {
    var filled = selectedColleges.filter(function (c) { return c !== null; });
    var summaryEl = document.getElementById('compare-summary');
    var winnerText = document.getElementById('winner-text');

    if (filled.length < 2) {
      summaryEl.hidden = true;
      return;
    }

    var listed = filled.filter(function (c) { return c.a; });
    winnerText.textContent = listed.length
      ? listed.length + ' of ' + filled.length + ' found in the QHEI snapshot (' + listed.map(function (c) { return c.n; }).join(', ') + ') — scheme route possible for merit admissions at the exact campus.'
      : 'None of these is confirmed in the QHEI snapshot. Simple-interest, PG and direct-EMI routes can still apply.';
    summaryEl.hidden = false;

    slots.forEach(function (slot) {
      var idx = parseInt(slot.getAttribute('data-slot'));
      var card = slot.querySelector('.slot-card');
      var existingBadge = card.querySelector('.best-rate-badge');
      if (existingBadge) existingBadge.remove();

      if (selectedColleges[idx] && selectedColleges[idx].a) {
        var badge = document.createElement('div');
        badge.className = 'best-rate-badge';
        badge.textContent = 'Scheme listed';
        card.prepend(badge);
        card.style.borderColor = '#0D9488';
      } else {
        card.style.borderColor = '';
      }
    });
  }
})();
