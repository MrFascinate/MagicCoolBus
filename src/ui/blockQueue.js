import { h, clear, announce } from './dom.js';
import { icon } from './icons.js';

/**
 * Shared block-queue panel (Drone Dash now, Robot Relay later).
 * Tap a block in the palette to add it to the program. Each program block
 * has a Remove button. A Repeat block holds other blocks: while "Adding
 * inside Repeat" is on, new blocks go into it. Keyboard, touch and mouse
 * all use the same buttons; there is no dragging.
 */

/**
 * @typedef {Object} BlockDef
 * @property {string} type
 * @property {string} label
 * @property {string} [icon]
 * @property {boolean} [container]  true for Repeat
 */
/**
 * @typedef {Object} QueueBlock
 * @property {string} id
 * @property {string} type
 * @property {number} [count]
 * @property {QueueBlock[]} [body]
 */

let nextId = 1;
const newId = () => `blk${nextId++}`;

/**
 * @param {{ palette: BlockDef[], limit: number, repeatMin?: number, repeatMax?: number,
 *           maxBlocks?: number, onChange?: (program: QueueBlock[]) => void }} opts
 */
export function createBlockQueue(opts) {
  const repeatMin = opts.repeatMin ?? 2;
  const repeatMax = opts.repeatMax ?? 5;
  const maxBlocks = opts.maxBlocks ?? 16;
  const defs = new Map(opts.palette.map((d) => [d.type, d]));
  /** @type {QueueBlock[]} */
  let program = [];
  /** @type {string|null} */ let insideRepeat = null;
  /** @type {string|null} */ let currentId = null;
  /** @type {string|null} */ let errorId = null;
  let locked = false;

  const count = (list) => list.reduce((n, b) => n + 1 + (b.body ? count(b.body) : 0), 0);
  const find = (id, list = program) => {
    for (const b of list) {
      if (b.id === id) return { block: b, list };
      if (b.body) { const r = find(id, b.body); if (r) return r; }
    }
    return null;
  };

  const counter = h('p.bq-count', { 'aria-live': 'polite' });
  const paletteEl = h('div.bq-palette', { role: 'group', 'aria-label': 'Blocks you can add' });
  const listEl = h('ol.bq-program', { 'aria-label': 'Your program' });
  const emptyEl = h('p.bq-empty', { text: 'Your program is empty. Tap a block above to add it.' });
  const el = h('div.bq',
    null,
    h('h3.bq-heading', { text: 'Blocks' }),
    paletteEl,
    h('div.bq-program-head', null, h('h3.bq-heading', { text: 'Your program' }), counter),
    emptyEl,
    listEl,
  );

  for (const d of opts.palette) {
    paletteEl.append(
      h(`button.block.block-${d.type}`, { type: 'button', 'data-type': d.type, onclick: () => add(d.type) },
        icon(d.icon || d.type), h('span.block-label', { text: d.label })),
    );
  }

  function add(type) {
    if (locked) return;
    if (count(program) >= maxBlocks) { announce('The program is full. Remove a block first.'); return; }
    const d = defs.get(type);
    /** @type {QueueBlock} */
    const b = { id: newId(), type };
    if (d?.container) { b.count = repeatMin; b.body = []; }
    const target = insideRepeat ? find(insideRepeat)?.block.body : null;
    if (target && !d?.container) target.push(b);
    else {
      program.push(b);
      insideRepeat = d?.container ? b.id : null;
    }
    errorId = null;
    render();
    announce(`Added ${d?.label || type}${target && !d?.container ? ' inside Repeat' : ''}.`);
    changed();
  }

  function remove(id) {
    if (locked) return;
    const f = find(id);
    if (!f) return;
    const idx = f.list.indexOf(f.block);
    f.list.splice(idx, 1);
    if (insideRepeat === id) insideRepeat = null;
    errorId = null;
    render();
    // Keep keyboard focus nearby.
    const btns = listEl.querySelectorAll('.bq-remove');
    const next = btns[Math.min(idx, btns.length - 1)];
    (next || paletteEl.querySelector('button'))?.focus();
    announce(`Removed ${defs.get(f.block.type)?.label || f.block.type}.`);
    changed();
  }

  function setCount(id, delta) {
    if (locked) return;
    const f = find(id);
    if (!f) return;
    f.block.count = Math.max(repeatMin, Math.min(repeatMax, (f.block.count || repeatMin) + delta));
    render();
    listEl.querySelector(`[data-id="${id}"] .bq-count-value`)?.parentElement?.querySelector(delta > 0 ? '.bq-plus' : '.bq-minus')?.focus();
    announce(`Repeat ${f.block.count} times.`);
    changed();
  }

  function toggleInside(id) {
    if (locked) return;
    insideRepeat = insideRepeat === id ? null : id;
    render();
    listEl.querySelector(`[data-id="${id}"] .bq-inside`)?.focus();
    announce(insideRepeat ? 'New blocks now go inside Repeat.' : 'New blocks now go at the end of the program.');
  }

  function row(b, depth) {
    const d = defs.get(b.type);
    const classes = ['bq-row', `block-${b.type}`];
    if (b.id === currentId) classes.push('is-now');
    if (b.id === errorId) classes.push('is-error');
    const li = h('li', { class: classes.join(' '), 'data-id': b.id });
    const tag = b.id === currentId
      ? h('span.bq-tag.now', null, icon('now'), h('span', { text: 'Now' }))
      : b.id === errorId ? h('span.bq-tag.err', null, icon('warn'), h('span', { text: 'Went wrong here' })) : null;
    const main = h('div.bq-main', null, icon(d?.icon || b.type), h('span.block-label', { text: d?.label || b.type }));
    if (d?.container) {
      main.append(
        h('span.bq-repeat', null,
          h('button.bq-minus', { type: 'button', 'aria-label': 'Repeat fewer times', disabled: locked || b.count <= repeatMin, onclick: () => setCount(b.id, -1) }, '−'),
          h('span.bq-count-value', { text: `${b.count} times` }),
          h('button.bq-plus', { type: 'button', 'aria-label': 'Repeat more times', disabled: locked || b.count >= repeatMax, onclick: () => setCount(b.id, 1) }, '+'),
        ),
      );
    }
    main.append(h('button.bq-remove', { type: 'button', 'aria-label': `Remove ${d?.label || b.type}`, disabled: locked, onclick: () => remove(b.id) }, icon('remove')));
    li.append(main);
    if (tag) li.append(tag);
    if (d?.container) {
      const inner = h('ol.bq-inner', { 'aria-label': 'Blocks inside Repeat' });
      for (const c of b.body || []) inner.append(row(c, depth + 1));
      if (!b.body?.length) inner.append(h('li.bq-hint', { text: 'Empty. Turn on "Add inside" and tap blocks.' }));
      li.append(inner);
      const on = insideRepeat === b.id;
      li.append(h('button.bq-inside', { type: 'button', 'aria-pressed': on ? 'true' : 'false', disabled: locked, onclick: () => toggleInside(b.id) },
        h('span.bq-inside-box', { 'aria-hidden': 'true', text: on ? '✓' : '' }),
        h('span', { text: on ? 'Adding inside Repeat' : 'Add inside Repeat' })));
    }
    return li;
  }

  function render() {
    clear(listEl);
    for (const b of program) listEl.append(row(b, 0));
    emptyEl.hidden = program.length > 0;
    const n = count(program);
    counter.textContent = `Blocks used: ${n}. Limit: ${opts.limit}.`;
    counter.classList.toggle('over', n > opts.limit);
    for (const b of paletteEl.querySelectorAll('button')) b.disabled = locked;
  }

  function changed() { opts.onChange?.(program); }

  render();
  return {
    el,
    getProgram: () => program,
    setProgram(p) { program = p; insideRepeat = null; render(); changed(); },
    count: () => count(program),
    /** Highlight the block that is running now. */
    setCurrent(id) {
      if (id === currentId) return;
      currentId = id;
      render();
      if (id) listEl.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
    },
    /** Mark the block where the run went wrong. */
    setError(id) { errorId = id; render(); if (id) listEl.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' }); },
    setLocked(v) { locked = v; render(); },
    clear() { program = []; insideRepeat = null; errorId = null; currentId = null; render(); changed(); },
  };
}
