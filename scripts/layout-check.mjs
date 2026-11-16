// In-page layout checks shared by the phone audit and the mobile smoke.
// Runs inside the page (page.evaluate(layoutProblems)), so it must not use
// anything from this module's scope.

/** @returns {string[]} problems a person would notice on a phone */
export function layoutProblems() {
  const out = [];
  const vw = window.innerWidth, vh = window.innerHeight;
  const de = document.documentElement;
  if (de.scrollWidth > vw + 1) out.push(`page scrolls sideways (${de.scrollWidth} > ${vw})`);
  if (de.scrollHeight > vh + 1 && getComputedStyle(document.body).overflow !== 'hidden') out.push(`page scrolls (${de.scrollHeight} > ${vh})`);
  const ui = document.getElementById('ui');
  if (!ui) return out;
  const shown = (el) => {
    if (el.closest('[hidden]') || el.closest('.sr-only')) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  /** the part of el that is not clipped away by scrolling ancestors */
  const visibleRect = (el) => {
    const r = el.getBoundingClientRect();
    let l = r.left, t = r.top, rr = r.right, b = r.bottom;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden)/.test(cs.overflowX + cs.overflowY)) {
        const q = p.getBoundingClientRect();
        l = Math.max(l, q.left); t = Math.max(t, q.top); rr = Math.min(rr, q.right); b = Math.min(b, q.bottom);
      }
    }
    return { left: l, top: t, right: rr, bottom: b, width: rr - l, height: b - t };
  };
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== ui && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowX + cs.overflowY)) return true;
    }
    return false;
  };
  const name = (el) => {
    const t = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28);
    return `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}"${t}"`;
  };
  const overlay = document.querySelector('.overlay:not([hidden])');
  const scope = overlay || ui;
  // 1. nothing outside the screen (unless it sits in a scroll box)
  for (const el of scope.querySelectorAll('*')) {
    if (el.closest('svg') && el.tagName !== 'svg') continue;
    if (!shown(el) || clipped(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) {
      if (el.matches('.bb-ghost, .fade, .drive-hud, .sky-stage, .mm-stage, .cy-stage')) continue;
      out.push(`off screen: ${name(el)} [${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}]`);
    }
  }
  // 2. tap targets: 44 px, not covered by something else, not overlapping
  const btns = [...scope.querySelectorAll('button, select, input, [role="button"], .sky-canvas')].filter((b) => shown(b) && !b.disabled);
  const vis = btns.map((b) => [b, visibleRect(b)]).filter(([, r]) => r.width > 4 && r.height > 4 && r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh);
  for (const [b] of vis) {
    const r = b.getBoundingClientRect();
    if (r.width < 43.5 || r.height < 43.5) out.push(`small target ${Math.round(r.width)}x${Math.round(r.height)}: ${name(b)}`);
  }
  // a sticky footer (Start on the character screen) lets the list scroll under it on purpose
  const sticky = (el) => { for (let p = el; p && p !== ui; p = p.parentElement) if (getComputedStyle(p).position === 'sticky') return p; return null; };
  const scroller = (el) => { for (let p = el.parentElement; p && p !== ui; p = p.parentElement) { const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowX + cs.overflowY)) return p; } return null; };
  const scrollsUnder = (a, b) => (sticky(a) || sticky(b)) && scroller(a) && scroller(a) === scroller(b);
  for (const [b, r] of vis) {
    const x = (Math.max(r.left, 0) + Math.min(r.right, vw)) / 2, y = (Math.max(r.top, 0) + Math.min(r.bottom, vh)) / 2;
    const top = document.elementFromPoint(x, y);
    if (top && !b.contains(top) && !top.contains(b) && !scrollsUnder(b, top)) out.push(`covered: ${name(b)} under ${name(top)}`);
  }
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
    const [a, ra] = vis[i], [b, rb] = vis[j];
    if (a.contains(b) || b.contains(a) || scrollsUnder(a, b)) continue;
    // the telescope's arrow buttons sit on the sky on purpose
    if (a.matches('canvas') || b.matches('canvas')) continue;
    const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
    const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (ox > 1 && oy > 1) out.push(`overlap: ${name(a)} and ${name(b)}`);
  }
  // 3. body text 16 px or more
  const small = new Set();
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || !n.textContent.trim() || el.closest('svg') || !shown(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 15.5) small.add(`${Math.round(fs)}px: ${name(el)}`);
  }
  for (const t of small) out.push(`small text ${t}`);
  return out;
}
