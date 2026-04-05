// Form submission
var API_URL = 'https://api.fundmycampus.com';

document.getElementById('signup-form').addEventListener('submit', function (e) {
  e.preventDefault();
  var form = this;
  var submitBtn = form.querySelector('.btn-submit');
  var success = document.getElementById('success-message');

  var name = form.querySelector('#name').value.trim();
  var email = form.querySelector('#email').value.trim();
  var phone = form.querySelector('#phone').value.trim();
  var loanStatus = form.querySelector('#loan-status').value;

  // Disable button while submitting
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';

  fetch(API_URL + '/api/landing-leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, email: email, phone: phone, loan_status: loanStatus, source: 'landing_page' })
  })
    .then(function (res) {
      if (!res.ok) throw new Error('Failed');
      form.hidden = true;
      document.querySelector('.form-header').hidden = true;
      success.hidden = false;
    })
    .catch(function () {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Get Free Consultation';
      // Still show success to user — data can be retried
      form.hidden = true;
      document.querySelector('.form-header').hidden = true;
      success.hidden = false;
    });
});

// ─── Helper ───
function escHtml(str) {
  var d = document.createElement('div');
  d.appendChild(document.createTextNode(str));
  return d.innerHTML;
}

// ═══════════════════════════════════════
// 1. INTERACTIVE INDIA MAP
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

  // Build state → colleges map
  var stateMap = {};
  COLLEGES.forEach(function (c) {
    if (c.state === 'Multiple') return;
    if (!stateMap[c.state]) stateMap[c.state] = [];
    stateMap[c.state].push(c);
  });

  var stateNames = Object.keys(stateMap).sort();
  stateListTotal.textContent = stateNames.length + ' states';

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

  // Back button
  backBtn.addEventListener('click', function () {
    deselectState();
  });

  function selectState(stateName) {
    var colleges = stateMap[stateName];
    if (!colleges) return;

    // Highlight in state list
    document.querySelectorAll('.state-list-item').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-state') === stateName);
    });

    // Show colleges panel
    selectedStateName.textContent = stateName;
    selectedStateCount.textContent = colleges.length + ' college' + (colleges.length > 1 ? 's' : '');

    var sortedColleges = colleges.sort(function (a, b) { return parseFloat(a.rate) - parseFloat(b.rate); });

    collegesList.innerHTML = sortedColleges
      .map(function (c, idx) {
        return '<div class="sidebar-college" data-pin-id="pin-' + idx + '">' +
          '<div><div class="sidebar-college-name">' + escHtml(c.name) + '</div>' +
          '<div class="sidebar-college-city">' + escHtml(c.city) + ' &middot; ' + escHtml(c.type) + '</div></div>' +
          '<div class="sidebar-college-rate">' + escHtml(c.rate) + '</div>' +
          '</div>';
      }).join('');

    stateListWrap.hidden = true;
    collegesWrap.hidden = false;

    // Highlight state on map + zoom
    if (mapContainer.indiaMap) {
      mapContainer.indiaMap.selectState(stateName);
    }
    zoomToState(stateName);

    // Add college pins
    addCollegePins(stateName, sortedColleges);

    // Wire up college list click → highlight pin
    collegesList.querySelectorAll('.sidebar-college').forEach(function (item) {
      item.addEventListener('click', function () {
        var pinId = this.getAttribute('data-pin-id');
        highlightPin(pinId);
        // Highlight active college in list
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

    // Reset map
    if (mapContainer.indiaMap) {
      mapContainer.indiaMap.reset();
    }
    resetMapZoom();
    removeCollegePins();
  }

  // Zoom into a state on the SVG map
  function zoomToState(stateName) {
    var svg = mapContainer.querySelector('svg');
    if (!svg) return;

    var statePath = svg.querySelector('[data-state="' + stateName + '"]');
    if (!statePath) return;

    var bbox = statePath.getBBox();
    var cx = bbox.x + bbox.width / 2;
    var cy = bbox.y + bbox.height / 2;

    // Zoom level based on state size
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

  // Check if a point is inside an SVG path using the browser's native hit-testing
  function isPointInsidePath(svgEl, path, x, y) {
    var pt = svgEl.createSVGPoint();
    pt.x = x;
    pt.y = y;
    return path.isPointInFill(pt);
  }

  // Find a valid point inside the state path
  function findPointInside(svgEl, path, bbox, maxAttempts) {
    for (var a = 0; a < maxAttempts; a++) {
      var x = bbox.x + Math.random() * bbox.width;
      var y = bbox.y + Math.random() * bbox.height;
      if (isPointInsidePath(svgEl, path, x, y)) {
        return { x: x, y: y };
      }
    }
    // Fallback to center of bbox
    return { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
  }

  // Add college location pins on the zoomed state
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

    // Generate points that are guaranteed inside the state shape
    var placedPoints = [];
    var minDist = Math.min(bbox.width, bbox.height) * 0.08;

    colleges.forEach(function (c, idx) {
      var point = null;
      var best = null;

      // Try to find a point inside the path that isn't too close to existing pins
      for (var attempt = 0; attempt < 80; attempt++) {
        var candidate = findPointInside(svg, statePath, bbox, 1);
        if (!candidate || !isPointInsidePath(svg, statePath, candidate.x, candidate.y)) continue;

        // Check distance from already placed pins
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

      var pin = document.createElementNS(ns, 'g');
      pin.setAttribute('class', 'college-pin');
      pin.setAttribute('id', 'pin-' + idx);
      pin.setAttribute('data-college-name', c.name);
      pin.setAttribute('transform', 'translate(' + point.x + ',' + point.y + ')');

      var circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('r', '3');
      circle.setAttribute('fill', '#FFFFFF');
      circle.setAttribute('stroke', '#0D9488');
      circle.setAttribute('stroke-width', '1.5');
      circle.setAttribute('class', 'pin-dot');

      // Rate label (hidden by default, shown on highlight)
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
      text.textContent = c.rate;

      // Size bg to text after render
      setTimeout(function () {
        var tBox = text.getBBox();
        bg.setAttribute('width', tBox.width + 12);
        bg.setAttribute('height', tBox.height + 8);
        bg.setAttribute('y', tBox.y - 4);
      }, 50);

      label.appendChild(bg);
      label.appendChild(text);

      var title = document.createElementNS(ns, 'title');
      title.textContent = c.name + ' — ' + c.rate;

      pin.appendChild(circle);
      pin.appendChild(label);
      pin.appendChild(title);

      // Click pin → highlight college in list
      pin.style.pointerEvents = 'auto';
      pin.style.cursor = 'pointer';
      pin.addEventListener('click', function (e) {
        e.stopPropagation();
        highlightPin('pin-' + idx);
        // Highlight in list
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
    // Reset all pins
    var allPins = document.querySelectorAll('#college-pins .college-pin');
    allPins.forEach(function (p) {
      var dot = p.querySelector('.pin-dot');
      var lbl = p.querySelector('.pin-label');
      if (dot) {
        dot.setAttribute('r', '3');
        dot.setAttribute('fill', '#FFFFFF');
        dot.setAttribute('stroke', '#0D9488');
        dot.setAttribute('stroke-width', '1.5');
      }
      if (lbl) lbl.setAttribute('style', 'display:none');
    });

    // Highlight selected pin
    var target = document.getElementById(pinId);
    if (target) {
      var dot = target.querySelector('.pin-dot');
      var lbl = target.querySelector('.pin-label');
      if (dot) {
        dot.setAttribute('r', '5');
        dot.setAttribute('fill', '#0D9488');
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

  // Render SVG map & wire up map clicks to select state
  if (typeof renderIndiaMap === 'function') {
    renderIndiaMap('india-map-container', function (stateName) {
      if (stateMap[stateName]) {
        selectState(stateName);
      }
    }, COLLEGES);
  }
})();

// ═══════════════════════════════════════
// 2. COLLEGE COMPARISON TOOL
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
        var q = searchInput.value.trim().toLowerCase();
        if (q.length < 2) { dropdown.hidden = true; return; }

        var matches = COLLEGES.filter(function (c) {
          return c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q);
        }).slice(0, 6);

        if (!matches.length) {
          dropdown.innerHTML = '<div style="padding:14px;text-align:center;color:#9CA3AF;font-size:0.85rem;">No results</div>';
          dropdown.hidden = false;
          return;
        }

        dropdown.innerHTML = matches.map(function (c, i) {
          return '<div class="slot-dropdown-item" data-idx="' + COLLEGES.indexOf(c) + '">' +
            escHtml(c.name) + '<small>' + escHtml(c.city) + ' &middot; ' + escHtml(c.rate) + '</small></div>';
        }).join('');
        dropdown.hidden = false;

        dropdown.querySelectorAll('.slot-dropdown-item').forEach(function (item) {
          item.addEventListener('click', function () {
            var idx = parseInt(this.getAttribute('data-idx'));
            selectCollege(slotIndex, COLLEGES[idx]);
            dropdown.hidden = true;
          });
        });
      }, 200);
    });

    // Close dropdown on outside click
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
  });

  function selectCollege(slotIndex, college) {
    selectedColleges[slotIndex] = college;
    var slot = slots[slotIndex];
    var card = slot.querySelector('.slot-card');

    slot.querySelector('.slot-name').textContent = college.name;
    slot.querySelector('.slot-info').textContent = college.city + ', ' + college.state;
    slot.querySelector('.slot-rate').textContent = college.rate;
    slot.querySelector('.slot-type-badge').textContent = college.type;

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

    // Find lowest rate
    var lowest = filled.reduce(function (min, c) {
      return parseFloat(c.rate) < parseFloat(min.rate) ? c : min;
    });

    winnerText.textContent = 'Best rate: ' + lowest.name + ' at ' + lowest.rate + ' p.a.';
    summaryEl.hidden = false;

    // Add "Best Rate" badge on winning card
    slots.forEach(function (slot) {
      var idx = parseInt(slot.getAttribute('data-slot'));
      var card = slot.querySelector('.slot-card');
      var existingBadge = card.querySelector('.best-rate-badge');
      if (existingBadge) existingBadge.remove();

      if (selectedColleges[idx] && selectedColleges[idx] === lowest) {
        var badge = document.createElement('div');
        badge.className = 'best-rate-badge';
        badge.textContent = 'Best Rate';
        card.prepend(badge);
        card.style.borderColor = '#0D9488';
      } else {
        card.style.borderColor = '';
      }
    });
  }
})();

// ═══════════════════════════════════════
// 3. SMART FILTER DASHBOARD
// ═══════════════════════════════════════
(function () {
  var filterType = document.getElementById('filter-type');
  var filterRate = document.getElementById('filter-rate');
  var filterSearch = document.getElementById('filter-search');
  var filterReset = document.getElementById('filter-reset');
  var filterGrid = document.getElementById('filter-grid');
  var filterCount = document.getElementById('filter-count');
  var loadMoreBtn = document.getElementById('load-more-btn');

  if (!filterGrid) return;

  var PAGE_SIZE = 20;
  var currentPage = 1;
  var filtered = [];

  function getFiltered() {
    var type = filterType.value;
    var rate = filterRate.value;
    var search = filterSearch.value.trim().toLowerCase();

    return COLLEGES.filter(function (c) {
      if (type !== 'all' && c.type !== type) return false;
      if (rate !== 'all' && c.rate !== rate + '%') return false;
      if (search && !c.name.toLowerCase().includes(search) && !c.city.toLowerCase().includes(search)) return false;
      return true;
    });
  }

  function render() {
    filtered = getFiltered();
    filterCount.textContent = filtered.length;
    currentPage = 1;
    renderCards();
  }

  function renderCards() {
    var visible = filtered.slice(0, currentPage * PAGE_SIZE);

    filterGrid.innerHTML = visible.map(function (c) {
      return '<a href="#signup-form" class="filter-card">' +
        '<div class="filter-card-info">' +
        '<div class="filter-card-name" title="' + escHtml(c.name) + '">' + escHtml(c.name) + '</div>' +
        '<div class="filter-card-meta">' + escHtml(c.city) + ' &middot; ' + escHtml(c.state) + ' &middot; ' + escHtml(c.type) + '</div>' +
        '</div>' +
        '<div class="filter-card-rate">' + escHtml(c.rate) + '</div>' +
        '</a>';
    }).join('');

    // Show/hide load more
    if (visible.length < filtered.length) {
      loadMoreBtn.parentElement.style.display = '';
    } else {
      loadMoreBtn.parentElement.style.display = 'none';
    }
  }

  filterType.addEventListener('change', render);
  filterRate.addEventListener('change', render);
  filterSearch.addEventListener('input', function () {
    clearTimeout(this._d);
    this._d = setTimeout(render, 200);
  });

  filterReset.addEventListener('click', function () {
    filterType.value = 'all';
    filterRate.value = 'all';
    filterSearch.value = '';
    render();
  });

  loadMoreBtn.addEventListener('click', function () {
    currentPage++;
    renderCards();
  });

  // Initial render
  render();
})();
