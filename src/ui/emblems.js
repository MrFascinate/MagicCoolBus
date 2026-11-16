/**
 * Emblem drawings for the stamp passport, the stamp card and Badge Builder's
 * flat badge picture. Each one is a top view of the matching printed piece in
 * printer.glb (emblem_cell, _gear, _drone, _spark, _planet, _wave), so the
 * stamps and the printed badge read as one set. 35 mm piece = 28 units here.
 */
const s = (b) => `<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${b}</svg>`;
export const EMBLEMS = {
  // cell: membrane, nucleus, three organelles
  cell: s('<circle cx="16" cy="16" r="13.5"/><circle cx="18.4" cy="14.4" r="4.6"/><ellipse cx="9.8" cy="19.4" rx="3" ry="1.7" transform="rotate(-30 9.8 19.4)"/><ellipse cx="19.4" cy="23.4" rx="3" ry="1.7" transform="rotate(20 19.4 23.4)"/><ellipse cx="12.4" cy="8.8" rx="3" ry="1.7" transform="rotate(-70 12.4 8.8)"/>'),
  // gear: ten square teeth and a centre hole
  gear: s('<path stroke-width="2" d="M26.8 16L30 14.9L29.6 12.7L26.3 12.7L24.7 9.7L26.7 6.9L25.1 5.3L22.3 7.3L19.3 5.7L19.3 2.4L17.1 2L16 5.2L12.7 5.7L10.7 3L8.6 4.1L9.7 7.3L7.3 9.7L4.1 8.6L3 10.7L5.7 12.7L5.2 16L2 17.1L2.4 19.3L5.7 19.3L7.3 22.3L5.3 25.1L6.9 26.7L9.7 24.7L12.7 26.3L12.7 29.6L14.9 30L16 26.8L19.3 26.3L21.3 29L23.4 27.9L22.3 24.7L24.7 22.3L27.9 23.4L29 21.3L26.3 19.3Z"/><circle cx="16" cy="16" r="4"/>'),
  // drone: crossed arms, square body, four guarded rotors
  drone: s('<path d="M10.3 10.3l2.4 2.4M21.7 10.3l-2.4 2.4M10.3 21.7l2.4-2.4M21.7 21.7l-2.4-2.4"/><rect x="12" y="12" width="8" height="8" rx="2"/><circle cx="7" cy="7" r="4.6"/><circle cx="25" cy="7" r="4.6"/><circle cx="7" cy="25" r="4.6"/><circle cx="25" cy="25" r="4.6"/>'),
  // spark: a starburst with a lightning bolt on top
  spark: s('<path stroke-width="1.6" d="M29.7 13.3L23 11.3L23.8 4.4L17.6 7.8L13.3 2.3L11.3 9L4.4 8.2L7.8 14.4L2.3 18.7L9 20.7L8.2 27.6L14.4 24.2L18.7 29.7L20.7 23L27.6 23.8L24.2 17.6Z"/><path fill="currentColor" stroke-width="1.4" d="M18.3 5.7L11.1 17.1L15.6 17.1L13 26.3L21.2 14.1L16.6 14.1L20.4 5.7Z"/>'),
  // planet: a ball with a tilted ring
  planet: s('<circle cx="16" cy="16" r="7.6"/><ellipse cx="16" cy="16" rx="14" ry="5" transform="rotate(-20 16 16)"/>'),
  // wave: sound bars on a line, like the printed piece
  wave: s('<path stroke-width="1.4" d="M2.5 16h27"/><path stroke-width="2.4" d="M3.5 13.6v4.8M6.6 11.2v9.6M9.8 8v16M12.9 4.8v22.4M16 2.8v26.4M19.1 6.4v19.2M22.2 9.6v12.8M25.4 12v8M28.5 14v4"/>'),
  badge: s('<path d="M16 3l11 5v8c0 7-5 11-11 13C10 27 5 23 5 16V8z"/><path d="M11 16l3 3 7-7"/>'),
};
