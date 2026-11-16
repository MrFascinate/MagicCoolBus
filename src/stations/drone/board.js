import * as THREE from 'three';
import { GRID, PADS } from './levels.js';

/**
 * The 5 x 5 board laid over the cage floor, drawn on a canvas texture.
 * Redrawn only when something changes (a step, a miss), never per frame.
 */

export const CELL = 0.5; // metres
const PX = 160;          // canvas pixels per cell
const SIZE = PX * GRID;

/**
 * @param {THREE.Vector3} center  world centre of the cage floor
 */
export function createBoard(center) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CELL * GRID, CELL * GRID), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(center.x, center.y + 0.03, center.z);
  mesh.name = 'drone_board';
  mesh.renderOrder = 1;

  /** World position of a cell centre at a height. */
  const cellToWorld = (c, r, y, out = new THREE.Vector3()) =>
    out.set(center.x + (c - (GRID - 1) / 2) * CELL, center.y + y, center.z + (r - (GRID - 1) / 2) * CELL);

  const cx = (c) => (c + 0.5) * PX;

  function shape(kind, x, y, r) {
    g.beginPath();
    if (kind === 'circle') g.arc(x, y, r, 0, Math.PI * 2);
    else if (kind === 'square') g.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8);
    else { g.moveTo(x, y - r); g.lineTo(x + r * 1.0, y + r * 0.8); g.lineTo(x - r * 1.0, y + r * 0.8); g.closePath(); }
  }

  function label(text, x, y, size, color = '#ffffff') {
    g.font = `bold ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = size / 5;
    g.strokeStyle = 'rgba(10,18,40,0.9)';
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
  }

  /**
   * @param {{ level: import('./levels.js').DroneLevel,
   *           path: {c:number,r:number}[], fail?: {c:number,r:number,dir:number,kind:string}|null }} s
   */
  function draw(s) {
    const { level } = s;
    g.fillStyle = '#17233f';
    g.fillRect(0, 0, SIZE, SIZE);
    // checker tint so rows and columns read clearly
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
      if ((r + c) % 2) { g.fillStyle = '#1d2c4f'; g.fillRect(c * PX, r * PX, PX, PX); }
    }
    g.strokeStyle = '#8fa6d6';
    g.lineWidth = 4;
    for (let i = 0; i <= GRID; i++) {
      g.beginPath(); g.moveTo(i * PX, 0); g.lineTo(i * PX, SIZE); g.stroke();
      g.beginPath(); g.moveTo(0, i * PX); g.lineTo(SIZE, i * PX); g.stroke();
    }
    g.strokeStyle = '#ffffff'; g.lineWidth = 10; g.strokeRect(5, 5, SIZE - 10, SIZE - 10);

    // start cell
    const sx = cx(level.start.c), sy = cx(level.start.r);
    g.setLineDash([14, 10]); g.strokeStyle = '#ffffff'; g.lineWidth = 6;
    g.strokeRect(level.start.c * PX + 14, level.start.r * PX + 14, PX - 28, PX - 28);
    g.setLineDash([]);
    label('START', sx, sy + 52, 30);

    // pads
    for (const [num, pad] of Object.entries(PADS)) {
      const n = Number(num);
      const isTarget = n === level.targetPad;
      const isTouch = n === level.touchPad;
      const x = cx(pad.c), y = cx(pad.r);
      shape(pad.shape, x, y, 58);
      g.fillStyle = isTarget ? '#ffcf3f' : isTouch ? '#4fd1ff' : '#56627d';
      g.fill();
      g.lineWidth = isTarget || isTouch ? 10 : 5;
      g.strokeStyle = isTarget || isTouch ? '#ffffff' : '#8fa6d6';
      g.stroke();
      if (isTarget) {
        g.setLineDash([18, 10]); g.lineWidth = 6; g.strokeStyle = '#ffcf3f';
        g.strokeRect(pad.c * PX + 6, pad.r * PX + 6, PX - 12, PX - 12); g.setLineDash([]);
      }
      label(String(n), x, y + (pad.shape === 'triangle' ? 10 : 0), 56, '#0b1530');
      g.fillStyle = '#0b1530';
      if (isTarget) label('LAND', x, pad.r * PX + 22, 26);
      if (isTouch) label('FLY OVER', x, pad.r * PX + 22, 24);
    }

    // flight path (floor shadow of the route)
    if (s.path.length > 1) {
      g.strokeStyle = '#ffffff';
      g.lineWidth = 20; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath();
      s.path.forEach((p, i) => (i ? g.lineTo(cx(p.c), cx(p.r)) : g.moveTo(cx(p.c), cx(p.r))));
      g.stroke();
      g.strokeStyle = '#ff7a1a';
      g.lineWidth = 10;
      g.setLineDash([22, 14]);
      g.stroke();
      g.setLineDash([]);
      for (const p of s.path) { g.beginPath(); g.arc(cx(p.c), cx(p.r), 12, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill(); }
    }

    // where it went wrong: a cross, plus a word, never colour alone
    if (s.fail) {
      let x = cx(s.fail.c), y = cx(s.fail.r);
      if (s.fail.kind === 'net') {
        const dx = [0, 1, 0, -1][s.fail.dir], dy = [-1, 0, 1, 0][s.fail.dir];
        x += dx * PX * 0.42; y += dy * PX * 0.42;
      }
      const r = 34;
      g.lineCap = 'round';
      for (const [w, col] of [[22, '#ffffff'], [12, '#e0245e']]) {
        g.lineWidth = w; g.strokeStyle = col;
        g.beginPath(); g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); g.stroke();
      }
      label(s.fail.kind === 'net' ? 'NET' : 'HERE', x, y + 58, 28);
    }
    tex.needsUpdate = true;
  }

  return {
    mesh, cellToWorld, draw,
    dispose() { mesh.geometry.dispose(); mat.dispose(); tex.dispose(); },
  };
}
