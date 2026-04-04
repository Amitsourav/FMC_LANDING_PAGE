/**
 * india-map.js
 * Renders an interactive SVG map of India by loading a real geographic SVG file
 * and adding clickable state paths with hover/selection interactivity.
 *
 * Usage:
 *   renderIndiaMap('your-container-id', function(stateName, colleges) { ... });
 *
 * The callback receives the state name and (optionally) a filtered list of
 * colleges if you pass the global COLLEGES array as the third argument.
 */

(function (global) {
  'use strict';

  // ── States with college data (interactive) ───────────────────────────────
  var ACTIVE_STATES = new Set([
    'Andhra Pradesh', 'Bihar', 'Chandigarh', 'Chhattisgarh', 'Delhi',
    'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
    'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra',
    'Meghalaya', 'Odisha', 'Punjab', 'Rajasthan', 'Tamil Nadu',
    'Telangana', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'
  ]);

  // ── Inject CSS once ───────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('india-map-styles')) return;
    var style = document.createElement('style');
    style.id = 'india-map-styles';
    style.textContent = [
      '#india-map-svg {',
      '  width: 100%;',
      '  height: auto;',
      '  display: block;',
      '  overflow: visible;',
      '}',

      /* All paths */
      '#india-map-svg path {',
      '  fill: #D1D5DB;',
      '  stroke: #9CA3AF;',
      '  stroke-width: 0.5;',
      '  stroke-linejoin: round;',
      '  transition: fill 0.18s ease, filter 0.18s ease;',
      '}',

      /* Non-interactive states */
      '#india-map-svg path.state-inactive {',
      '  fill: #C0C5CC;',
      '  stroke: #D5D8DC;',
      '  cursor: default;',
      '}',

      /* Interactive states */
      '#india-map-svg path.state-active {',
      '  cursor: pointer;',
      '}',
      '#india-map-svg path.state-active:hover {',
      '  fill: #CCFBF1;',
      '  filter: drop-shadow(0 1px 3px rgba(13,148,136,.25));',
      '}',

      /* Selected state */
      '#india-map-svg path.state-selected {',
      '  fill: #0D9488 !important;',
      '  stroke: #0F766E;',
      '  stroke-width: 0.8;',
      '  filter: drop-shadow(0 2px 4px rgba(13,148,136,.4));',
      '}',

      /* Tooltip */
      '#india-map-tooltip {',
      '  position: fixed;',
      '  pointer-events: none;',
      '  background: rgba(15,23,42,.88);',
      '  color: #f1f5f9;',
      '  font-family: Inter, system-ui, sans-serif;',
      '  font-size: 12px;',
      '  font-weight: 500;',
      '  padding: 5px 10px;',
      '  border-radius: 6px;',
      '  white-space: nowrap;',
      '  z-index: 9999;',
      '  opacity: 0;',
      '  transition: opacity .12s ease;',
      '  box-shadow: 0 4px 12px rgba(0,0,0,.25);',
      '}',
      '#india-map-tooltip.visible { opacity: 1; }'
    ].join('\n');
    document.head.appendChild(style);
  }

  // ── Build tooltip element (singleton) ────────────────────────────────────
  function getTooltip() {
    var tip = document.getElementById('india-map-tooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'india-map-tooltip';
      document.body.appendChild(tip);
    }
    return tip;
  }

  // ── Main render function ──────────────────────────────────────────────────
  /**
   * @param {string}   containerId    - ID of the DOM element to inject the map into
   * @param {Function} [onStateClick] - callback(stateName, collegeList|null)
   * @param {Array}    [colleges]     - optional COLLEGES array for college counts
   */
  function renderIndiaMap(containerId, onStateClick, colleges) {
    injectStyles();

    var container = document.getElementById(containerId);
    if (!container) {
      console.error('renderIndiaMap: container #' + containerId + ' not found');
      return;
    }

    // Show a loading state
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:300px;color:#94a3b8;font-family:Inter,system-ui,sans-serif;font-size:14px;">Loading map...</div>';

    // Build a state->colleges lookup if data was provided
    var stateCollegeMap = {};
    if (Array.isArray(colleges)) {
      colleges.forEach(function (c) {
        var s = c.state;
        if (!s || s === 'Multiple') return;
        if (!stateCollegeMap[s]) stateCollegeMap[s] = [];
        stateCollegeMap[s].push(c);
      });
    }

    // Fetch the real SVG map file
    fetch('india-map.svg')
      .then(function (response) {
        if (!response.ok) throw new Error('Failed to load india-map.svg: ' + response.status);
        return response.text();
      })
      .then(function (svgText) {
        // Parse the SVG and inject it
        var parser = new DOMParser();
        var doc = parser.parseFromString(svgText, 'image/svg+xml');
        var svg = doc.querySelector('svg');

        if (!svg) {
          console.error('renderIndiaMap: no <svg> element found in india-map.svg');
          return;
        }

        // Set SVG attributes for display
        svg.setAttribute('id', 'india-map-svg');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', 'Interactive map of India');
        // Remove any inline styles that might conflict
        svg.removeAttribute('style');
        svg.removeAttribute('width');
        svg.removeAttribute('height');

        var tooltip = getTooltip();
        var selectedPath = null;

        // Find all <path> elements and add interactivity
        var paths = svg.querySelectorAll('path');
        paths.forEach(function (path) {
          // The SVG uses the "name" attribute for full state names
          var stateName = path.getAttribute('name');
          if (!stateName) return;

          // Set data-state attribute for consistent API
          path.setAttribute('data-state', stateName);

          var isInteractive = ACTIVE_STATES.has(stateName);
          path.classList.add(isInteractive ? 'state-active' : 'state-inactive');

          // Remove any existing inline fill/stroke from the SVG file
          path.removeAttribute('fill');
          path.removeAttribute('stroke');
          path.style.fill = '';
          path.style.stroke = '';

          var count = stateCollegeMap[stateName] ? stateCollegeMap[stateName].length : 0;

          // Tooltip on hover for all states
          path.addEventListener('mouseenter', function (e) {
            var label = stateName;
            if (isInteractive) {
              label += count > 0
                ? ' \u2014 ' + count + (count === 1 ? ' college' : ' colleges')
                : ' \u2014 No data yet';
            }
            tooltip.textContent = label;
            tooltip.classList.add('visible');
          });

          path.addEventListener('mousemove', function (e) {
            tooltip.style.left = (e.clientX + 14) + 'px';
            tooltip.style.top  = (e.clientY - 28) + 'px';
          });

          path.addEventListener('mouseleave', function () {
            tooltip.classList.remove('visible');
          });

          // Click handler for interactive states
          if (isInteractive) {
            path.addEventListener('click', function () {
              // Deselect previous
              if (selectedPath && selectedPath !== path) {
                selectedPath.classList.remove('state-selected');
              }

              var alreadySelected = path.classList.contains('state-selected');
              path.classList.toggle('state-selected');
              selectedPath = alreadySelected ? null : path;

              if (typeof onStateClick === 'function') {
                var collegeList = stateCollegeMap[stateName] || [];
                onStateClick(
                  alreadySelected ? null : stateName,
                  alreadySelected ? [] : collegeList
                );
              }
            });

            // Keyboard accessibility
            path.setAttribute('tabindex', '0');
            path.setAttribute('role', 'button');
            path.setAttribute('aria-label', stateName + (count > 0 ? ' \u2014 ' + count + ' colleges' : ''));
            path.addEventListener('keydown', function (e) {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                path.dispatchEvent(new MouseEvent('click'));
              }
            });
          }
        });

        // Inject SVG into container
        container.innerHTML = '';
        container.appendChild(svg);

        // ── Public API on the container ──────────────────────────────────
        container.indiaMap = {
          /**
           * Programmatically select a state by name.
           * Pass null to deselect all.
           */
          selectState: function (stateName) {
            if (selectedPath) {
              selectedPath.classList.remove('state-selected');
              selectedPath = null;
            }
            if (!stateName) return;
            var target = svg.querySelector('[data-state="' + stateName + '"]');
            if (target && target.classList.contains('state-active')) {
              target.classList.add('state-selected');
              selectedPath = target;
            }
          },
          /**
           * Highlight states that have data (e.g. after async load).
           * Accepts a Set or array of state name strings.
           */
          highlightStates: function (stateNames) {
            var nameSet = new Set(Array.isArray(stateNames) ? stateNames : Array.from(stateNames));
            svg.querySelectorAll('path.state-active').forEach(function (p) {
              var s = p.getAttribute('data-state');
              p.style.fill = nameSet.has(s) ? '' : '#F9FAFB';
            });
          },
          /** Reset all highlights and selection */
          reset: function () {
            svg.querySelectorAll('path').forEach(function (p) {
              p.classList.remove('state-selected');
              p.style.fill = '';
            });
            selectedPath = null;
          }
        };
      })
      .catch(function (err) {
        console.error('renderIndiaMap:', err);
        container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:300px;color:#ef4444;font-family:Inter,system-ui,sans-serif;font-size:14px;">Failed to load map</div>';
      });
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  global.renderIndiaMap = renderIndiaMap;

}(typeof window !== 'undefined' ? window : this));
