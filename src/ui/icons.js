/** Inline SVG icons. Shapes carry meaning together with text labels. */
const svg = (body, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" width="24" height="24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  takeoff: svg('<path d="M4 20h16"/><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/>'),
  forward: svg('<path d="M12 20V4"/><path d="M6 10l6-6 6 6"/>'),
  left: svg('<path d="M18 20v-8a4 4 0 0 0-4-4H5"/><path d="M9 4L5 8l4 4"/>'),
  right: svg('<path d="M6 20v-8a4 4 0 0 1 4-4h9"/><path d="M15 4l4 4-4 4"/>'),
  land: svg('<path d="M4 20h16"/><path d="M12 4v12"/><path d="M7 11l5 5 5-5"/>'),
  repeat: svg('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>'),
  remove: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  check: svg('<path d="M4 12l5 5L20 6"/>'),
  dash: svg('<path d="M6 12h12"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  star: svg('<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/>'),
  pause: svg('<path d="M9 5v14M15 5v14"/>'),
  soundOn: svg('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9a4 4 0 0 1 0 6"/>'),
  soundOff: svg('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l4 6M21 9l-4 6"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  warn: svg('<path d="M12 3l10 18H2z"/><path d="M12 10v5"/><path d="M12 18v.5"/>'),
  play: svg('<path d="M7 4l13 8-13 8z"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12"/>'),
  now: svg('<path d="M5 12h12"/><path d="M12 6l6 6-6 6"/>'),
  rotL: svg('<path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M7 2v4H3"/>'),
  rotR: svg('<path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M17 2v4h4"/>'),
  reach: svg('<path d="M12 3v11"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>'),
  grip: svg('<path d="M12 3v5"/><path d="M7 8h10"/><path d="M8 8v6l3 4"/><path d="M16 8v6l-3 4"/>'),
  release: svg('<path d="M12 3v5"/><path d="M7 8h10"/><path d="M8 8l-3 8"/><path d="M16 8l3 8"/><path d="M12 15v6"/><path d="M9.5 18.5L12 21l2.5-2.5"/>'),
  run: svg('<circle cx="14" cy="4.5" r="2"/><path d="M6 21l4-6 3 2v5"/><path d="M8 12l2-5h4l3 4h3"/><path d="M10 7l3 8"/>'),
  stamp: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>'),
};

/** @param {string} name */
export function icon(name) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = ICONS[name] || '';
  return span;
}

/** Three stars as filled or outlined shapes, plus a text count. */
export function starRow(stars, max = 3) {
  const wrap = document.createElement('span');
  wrap.className = 'stars';
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', `${stars} of ${max} stars`);
  for (let i = 0; i < max; i++) {
    const s = icon('star');
    s.classList.add(i < stars ? 'on' : 'off');
    wrap.append(s);
  }
  const t = document.createElement('span');
  t.className = 'stars-text';
  t.textContent = `${stars} of ${max}`;
  t.setAttribute('aria-hidden', 'true');
  wrap.append(t);
  return wrap;
}
