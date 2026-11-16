/**
 * Draws the eyepiece view on a 2D canvas: sky, ground, compass, constellation
 * lines, stars, the Moon (with its real phase and named features), Saturn,
 * the Andromeda Galaxy, the centre ring and hop arrows. Draws only when asked.
 * Nothing here allocates per star or per frame except the canvas state.
 */
import { ZOOMS, CON_NAMES, centerTol, basis, scaleFor, project, vec, moonDisk, moonSunDir, tangentFrame, dot } from './sky.js';
import { MOON_FEATURES, MOON_RADIUS_KM } from './levels.js';

const D = Math.PI / 180;
const COMPASS = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];

/**
 * @param {ReturnType<import('./sky.js').parseSky>} sky
 * @param {Record<string, any>} objects
 */
export function createRenderer(sky, objects) {
  const b = { f: [0, 0, 0], r: [0, 0, 0], u: [0, 0, 0] };
  const p = [0, 0], q = [0, 0];
  const moonTex = buildMoonTexture(sky.moon, 1024);
  // constellation label anchors: mean of each figure's stars
  const conAnchors = sky.cons.map((c) => {
    let x = 0, y = 0, z = 0;
    const seen = new Set(c.segs);
    for (const i of seen) { x += sky.pos[i * 3]; y += sky.pos[i * 3 + 1]; z += sky.pos[i * 3 + 2]; }
    const l = Math.hypot(x, y, z);
    return { name: CON_NAMES[c.abbr] || c.abbr, v: [x / l, y / l, z / l] };
  });
  const horizon = [];
  for (let k = 0; k <= 72; k++) horizon.push([0, 0]);

  /**
   * @param {CanvasRenderingContext2D} g
   * @param {number} size  canvas size in px (square)
   * @param {import('./sky.js').View} view
   * @param {{lines?:boolean, labels?:boolean, labelIds?:Set<string>, arrow?:{from:number[], to:number[]}|null,
   *          reticle?:boolean, chart?:{ids:string[], tags:string[]}|null, ground?:boolean}} o
   */
  function draw(g, size, view, o = {}) {
    const R = size / 2, cx = R, cy = R;
    const z = ZOOMS[view.zoom];
    basis(view, b);
    const s = scaleFor(z.fov, R);
    const cosLim = Math.cos(Math.min(89, z.fov * 0.75) * D);
    const px = size / 600; // size factor for marks
    g.save();
    g.clearRect(0, 0, size, size);
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
    // sky
    g.fillStyle = '#0a1330';
    g.fillRect(0, 0, size, size);

    // constellation lines
    if (o.lines && view.zoom !== 'high') {
      g.strokeStyle = 'rgba(130, 175, 255, 0.55)';
      g.lineWidth = Math.max(1, 1.6 * px);
      g.beginPath();
      for (const c of sky.cons) {
        for (let k = 0; k < c.segs.length; k += 2) {
          const i = c.segs[k] * 3, j = c.segs[k + 1] * 3;
          if (!project(b, s, sky.pos[i], sky.pos[i + 1], sky.pos[i + 2], p)) continue;
          if (!project(b, s, sky.pos[j], sky.pos[j + 1], sky.pos[j + 2], q)) continue;
          if (Math.abs(p[0]) > 3 * R && Math.abs(q[0]) > 3 * R) continue;
          g.moveTo(cx + p[0], cy + p[1]); g.lineTo(cx + q[0], cy + q[1]);
        }
      }
      g.stroke();
    }

    // Andromeda Galaxy: a soft oval along its real position angle
    drawM31(g, cx, cy, s, z, view);

    // stars
    const lim = z.limitMag;
    const k0 = view.zoom === 'finder' ? 0.62 : view.zoom === 'low' ? 0.5 : 0.42;
    for (let i = 0; i < sky.n; i++) {
      const m = sky.mag[i];
      if (m > lim) continue;
      const x = sky.pos[i * 3], y = sky.pos[i * 3 + 1], w = sky.pos[i * 3 + 2];
      if (x * b.f[0] + y * b.f[1] + w * b.f[2] < cosLim) continue;
      if (!project(b, s, x, y, w, p)) continue;
      const r = Math.min(6, Math.max(0.9, 0.9 + (lim - m) * k0)) * px * 1.25;
      const a = Math.min(1, 0.45 + (lim - m) * 0.25);
      g.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
      g.beginPath(); g.arc(cx + p[0], cy + p[1], r, 0, Math.PI * 2); g.fill();
    }

    drawSaturn(g, cx, cy, s, z, view, px);
    drawMoon(g, cx, cy, s, view, px);

    // ground below the horizon
    if (o.ground !== false && view.alt - z.fov * 0.6 < 1) {
      let n = 0;
      for (let k = 0; k <= 72; k++) {
        const v = vec(-0.3, view.az - 120 + k * (240 / 72));
        if (project(b, s, v[0], v[1], v[2], p)) { horizon[n][0] = cx + p[0]; horizon[n][1] = cy + p[1]; n++; }
      }
      if (n > 1) {
        g.fillStyle = '#16241a';
        g.beginPath();
        g.moveTo(horizon[0][0], horizon[0][1]);
        for (let k = 1; k < n; k++) g.lineTo(horizon[k][0], horizon[k][1]);
        g.lineTo(horizon[n - 1][0], size * 3); g.lineTo(horizon[0][0], size * 3); g.closePath();
        g.fill();
        g.strokeStyle = '#3c5a3f'; g.lineWidth = 3 * px; g.stroke();
      }
      g.font = `700 ${Math.round(18 * Math.max(0.9, px))}px system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'top';
      for (const [t, az] of COMPASS) {
        const v = vec(-1.5, az);
        if (!project(b, s, v[0], v[1], v[2], p) || Math.abs(p[0]) > R || Math.abs(p[1]) > R) continue;
        g.fillStyle = '#e8f0ff';
        g.fillText(t, cx + p[0], cy + p[1] + 4);
      }
    }

    // labels
    if (o.labels) {
      g.textAlign = 'center'; g.textBaseline = 'middle';
      if (view.zoom === 'finder' && !o.chart) {
        g.font = `600 ${Math.round(16 * Math.max(1, px))}px system-ui, sans-serif`;
        g.fillStyle = 'rgba(170, 200, 255, 0.9)';
        for (const c of conAnchors) {
          if (dot(c.v, b.f) < cosLim) continue;
          if (project(b, s, c.v[0], c.v[1], c.v[2], p)) g.fillText(c.name.toUpperCase(), cx + p[0], cy + p[1]);
        }
      }
      if (!o.labelIds?.has('moon') && view.zoom === 'finder' && project(b, s, sky.moon.v[0], sky.moon.v[1], sky.moon.v[2], p)) label(g, 'Moon', cx + p[0], cy + p[1] + 18 * px, px);
    }
    if (o.labelIds) {
      for (const id of o.labelIds) {
        const ob = objects[id];
        if (!ob || !ob.zooms.includes(view.zoom)) continue;
        if (id === 'moon' && view.zoom !== 'finder') continue; // the Moon fills the view up close
        if (!project(b, s, ob.v[0], ob.v[1], ob.v[2], p)) continue;
        // found marker: a square bracket around it, plus its name
        const hsz = 12 * px;
        if (view.zoom !== 'high') { // up close the bracket would hide the thing itself
          g.strokeStyle = '#ffd34d'; g.lineWidth = 2.5 * px;
          g.strokeRect(cx + p[0] - hsz, cy + p[1] - hsz, hsz * 2, hsz * 2);
        }
        label(g, ob.name.replace(/^the /, ''), cx + p[0], cy + p[1] + hsz + (view.zoom === 'high' ? 26 : 12) * px, px, '#ffd34d');
      }
    }
    if (o.chart) {
      o.chart.ids.forEach((id, n) => {
        const ob = objects[id];
        if (!ob || !project(b, s, ob.v[0], ob.v[1], ob.v[2], p)) return;
        if (n > 0) {
          const prev = objects[o.chart.ids[n - 1]];
          if (project(b, s, prev.v[0], prev.v[1], prev.v[2], q)) arrow(g, cx + q[0], cy + q[1], cx + p[0], cy + p[1], '#ffd34d', 3 * px, 10 * px);
        }
        g.fillStyle = '#ffd34d';
        g.beginPath(); g.arc(cx + p[0], cy + p[1], 4 * px, 0, Math.PI * 2); g.fill();
        label(g, o.chart.tags[n], cx + p[0], cy + p[1] - 16 * px, px, '#ffffff');
      });
    }
    // hop arrow after a miss
    if (o.arrow && project(b, s, o.arrow.from[0], o.arrow.from[1], o.arrow.from[2], p) && project(b, s, o.arrow.to[0], o.arrow.to[1], o.arrow.to[2], q)) {
      arrow(g, cx + p[0], cy + p[1], cx + q[0], cy + q[1], '#ffd34d', 5 * px, 22 * px, true);
    }
    // centre ring: inside it counts as centered
    if (o.reticle !== false) {
      const rr = s * 2 * Math.tan((centerTol(view.zoom) / 2) * D);
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2 * px;
      g.setLineDash([8 * px, 6 * px]);
      g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
      g.beginPath();
      g.moveTo(cx - rr - 14 * px, cy); g.lineTo(cx - rr - 4 * px, cy);
      g.moveTo(cx + rr + 4 * px, cy); g.lineTo(cx + rr + 14 * px, cy);
      g.moveTo(cx, cy - rr - 14 * px); g.lineTo(cx, cy - rr - 4 * px);
      g.moveTo(cx, cy + rr + 4 * px); g.lineTo(cx, cy + rr + 14 * px);
      g.stroke();
    }
    g.restore();
    // eyepiece rim
    g.strokeStyle = '#05070d'; g.lineWidth = Math.max(6, 10 * px);
    g.beginPath(); g.arc(cx, cy, R - g.lineWidth / 2, 0, Math.PI * 2); g.stroke();
  }

  function drawM31(g, cx, cy, s, z, view) {
    const m = sky.m31;
    if (!project(b, s, m.aV[0], m.aV[1], m.aV[2], p) || !project(b, s, m.bV[0], m.bV[1], m.bV[2], q)) return;
    const ax = (p[0] + q[0]) / 2, ay = (p[1] + q[1]) / 2;
    const half = Math.hypot(q[0] - p[0], q[1] - p[1]) / 2;
    if (Math.abs(ax) - half > 2 * cx || Math.abs(ay) - half > 2 * cy) return;
    const ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
    // what a small telescope shows: the bright middle, fading out; the full 3 degree disk stays very faint
    const core = view.zoom === 'finder' ? 0.55 : view.zoom === 'low' ? 0.55 : 0.85;
    g.save();
    g.translate(cx + ax, cy + ay);
    g.rotate(ang);
    g.scale(1, m.minor / m.major);
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, half);
    grd.addColorStop(0, `rgba(235, 230, 255, ${core})`);
    grd.addColorStop(0.08, `rgba(220, 215, 245, ${core * 0.55})`);
    grd.addColorStop(0.35, 'rgba(190, 190, 230, 0.16)');
    grd.addColorStop(1, 'rgba(160, 170, 220, 0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(0, 0, Math.max(half, 3), 0, Math.PI * 2); g.fill();
    g.restore();
  }

  function drawSaturn(g, cx, cy, s, z, view, px) {
    const sat = sky.saturn;
    if (!project(b, s, sat.v[0], sat.v[1], sat.v[2], p)) return;
    if (Math.abs(p[0]) > 2 * cx || Math.abs(p[1]) > 2 * cy) return;
    const x = cx + p[0], y = cy + p[1];
    // disk size at true scale (degrees -> px), with a floor so it is never invisible
    const degPx = s * 2 * Math.tan(0.5 * D) ;
    const diskR = (sat.diam / 3600 / 2) * degPx;
    if (diskR < 2.2) {
      g.fillStyle = '#fff4d6';
      g.beginPath(); g.arc(x, y, Math.min(6, 2.4 + (z.limitMag - sat.mag) * 0.35) * px * 1.25, 0, Math.PI * 2); g.fill();
      return;
    }
    // ring plane is square to Saturn's spin axis; tilt from Astronomy Engine
    project(b, s, sat.northV[0], sat.northV[1], sat.northV[2], q);
    const axisAng = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const ringA = diskR * 2.27, ringB = ringA * Math.sin(Math.abs(sat.ringTilt) * D);
    g.save();
    g.translate(x, y);
    g.rotate(axisAng + Math.PI / 2);
    g.lineWidth = Math.max(1.5, ringA * 0.2);
    g.strokeStyle = '#f1e2b0';
    g.beginPath(); g.ellipse(0, 0, ringA * 0.85, Math.max(0.6, ringB * 0.85), 0, Math.PI, Math.PI * 2); g.stroke();
    g.fillStyle = '#f3dfa6';
    g.beginPath(); g.ellipse(0, 0, diskR, diskR * 0.9, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(0, 0, ringA * 0.85, Math.max(0.6, ringB * 0.85), 0, 0, Math.PI); g.stroke();
    g.restore();
  }

  function drawMoon(g, cx, cy, s, view, px) {
    const m = sky.moon;
    if (!project(b, s, m.v[0], m.v[1], m.v[2], p)) return;
    project(b, s, m.northV[0], m.northV[1], m.northV[2], q);
    const pxPerDeg = Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.25;
    const r = Math.max(7 * px, (m.diam / 2) * pxPerDeg);
    if (Math.abs(p[0]) - r > 2 * cx || Math.abs(p[1]) - r > 2 * cy) return;
    const ang = Math.atan2(q[0] - p[0], -(q[1] - p[1])); // screen angle of lunar north from straight up
    g.save();
    g.translate(cx + p[0], cy + p[1]);
    if (view.zoom === 'finder') {
      const glow = g.createRadialGradient(0, 0, r, 0, 0, r * 6);
      glow.addColorStop(0, 'rgba(220, 225, 255, 0.35)');
      glow.addColorStop(1, 'rgba(220, 225, 255, 0)');
      g.fillStyle = glow;
      g.beginPath(); g.arc(0, 0, r * 6, 0, Math.PI * 2); g.fill();
    }
    g.rotate(ang);
    g.drawImage(moonTex, -r, -r, r * 2, r * 2);
    g.restore();
  }

  return { draw, moonTex };
}

/** Arrow from (x1,y1) to (x2,y2). */
function arrow(g, x1, y1, x2, y2, color, w, head, dashed = false) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ex = x2 - Math.cos(a) * head * 0.6, ey = y2 - Math.sin(a) * head * 0.6;
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = w;
  if (dashed) g.setLineDash([w * 3, w * 2]);
  g.beginPath(); g.moveTo(x1 + Math.cos(a) * Math.min(14, len * 0.2), y1 + Math.sin(a) * Math.min(14, len * 0.2)); g.lineTo(ex, ey); g.stroke();
  g.setLineDash([]);
  g.beginPath();
  g.moveTo(x2, y2);
  g.lineTo(x2 - Math.cos(a - 0.45) * head, y2 - Math.sin(a - 0.45) * head);
  g.lineTo(x2 - Math.cos(a + 0.45) * head, y2 - Math.sin(a + 0.45) * head);
  g.closePath(); g.fill();
}

function label(g, text, x, y, px, color = '#ffffff') {
  g.font = `700 ${Math.round(16 * Math.max(1, px))}px system-ui, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 4; g.strokeStyle = 'rgba(5, 10, 30, 0.9)';
  g.strokeText(text, x, y);
  g.fillStyle = color;
  g.fillText(text, x, y);
}

/**
 * The Moon as seen tonight, drawn once: lunar north up, IAU east to the right
 * (which is the sky's west, as it looks to the eye). Maria and craters sit at
 * their IAU Gazetteer positions, shifted by tonight's libration, and the
 * terminator follows tonight's phase.
 */
export function buildMoonTexture(moon, size) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
  const g = c.getContext('2d');
  const R = size / 2;
  const toXY = (d) => [R + d.x * R, R - d.y * R];
  // highland base
  const base = g.createRadialGradient(R * 0.9, R * 0.9, R * 0.1, R, R, R);
  base.addColorStop(0, '#e9e6df'); base.addColorStop(1, '#bdb8ae');
  g.fillStyle = base;
  g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); g.fill();
  g.save();
  g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); g.clip();
  // maria
  for (const f of MOON_FEATURES) {
    if (f.kind !== 'mare') continue;
    const d = moonDisk(f.lat, f.lon, moon.libLat, moon.libLon);
    if (!d) continue;
    const [x, y] = toXY(d);
    const rr = ((f.km / 2) / MOON_RADIUS_KM) * R;
    const cosc = Math.sqrt(Math.max(0.05, 1 - d.x * d.x - d.y * d.y));
    g.save();
    g.translate(x, y);
    g.fillStyle = 'rgba(128, 126, 121, 0.6)';
    g.filter = `blur(${Math.round(R * 0.012)}px)`;
    g.beginPath();
    if (f.stretch) g.ellipse(0, 0, rr, (rr / f.stretch) * cosc, 0, 0, Math.PI * 2); // long east-west band
    else { g.rotate(Math.atan2(-d.y, d.x)); g.ellipse(0, 0, rr * cosc, rr, 0, 0, Math.PI * 2); }
    g.fill();
    g.filter = 'none';
    g.restore();
  }
  // craters, with rays for the young ones
  const sun = moonSunDir(moon);
  for (const f of MOON_FEATURES) {
    if (f.kind !== 'crater') continue;
    const d = moonDisk(f.lat, f.lon, moon.libLat, moon.libLon);
    if (!d) continue;
    const [x, y] = toXY(d);
    const rr = Math.max(3, ((f.km / 2) / MOON_RADIUS_KM) * R);
    const cosc = Math.sqrt(Math.max(0.05, 1 - d.x * d.x - d.y * d.y));
    const radial = Math.atan2(-d.y, d.x);
    if (f.rays) {
      g.strokeStyle = 'rgba(255, 255, 250, 0.33)';
      g.lineWidth = Math.max(1.5, rr * 0.12);
      const n = f.id === 'tycho' ? 14 : 10;
      const len = f.id === 'tycho' ? R * 0.75 : R * 0.3;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + (k % 3) * 0.13;
        const l = len * (0.45 + ((k * 37) % 10) / 18);
        g.beginPath(); g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
      }
      const halo = g.createRadialGradient(x, y, rr, x, y, rr * 3);
      halo.addColorStop(0, 'rgba(255,255,250,0.45)'); halo.addColorStop(1, 'rgba(255,255,250,0)');
      g.fillStyle = halo; g.beginPath(); g.arc(x, y, rr * 3, 0, Math.PI * 2); g.fill();
    }
    g.save();
    g.translate(x, y); g.rotate(radial); g.scale(cosc, 1); g.rotate(-radial);
    // floor
    g.fillStyle = f.dark ? '#7d7a74' : f.rays ? '#f2efe8' : '#c9c4ba';
    g.beginPath(); g.arc(0, 0, rr, 0, Math.PI * 2); g.fill();
    // shadow inside the rim on the side toward the Sun, bright rim on the far side
    g.strokeStyle = 'rgba(40, 38, 36, 0.75)'; g.lineWidth = Math.max(1.5, rr * 0.28);
    const sa = Math.atan2(-sun.y, sun.x);
    g.beginPath(); g.arc(0, 0, rr * 0.86, sa - 1.2, sa + 1.2); g.stroke();
    g.strokeStyle = 'rgba(255, 255, 255, 0.9)'; g.lineWidth = Math.max(1.2, rr * 0.18);
    g.beginPath(); g.arc(0, 0, rr, sa + Math.PI - 1.3, sa + Math.PI + 1.3); g.stroke();
    if (f.id === 'tycho' || f.id === 'copernicus') { g.fillStyle = '#ffffff'; g.beginPath(); g.arc(0, 0, rr * 0.18, 0, Math.PI * 2); g.fill(); }
    g.restore();
  }
  // night side: the part of the disk the Sun does not light tonight
  g.save();
  g.translate(R, R);
  g.rotate(Math.atan2(-sun.y, sun.x)); // +x now points at the Sun (canvas y is down)
  const t = Math.cos(moon.phaseAngle * D);
  g.fillStyle = 'rgba(10, 19, 48, 0.97)'; // matches the sky, with a hint of earthshine
  g.beginPath();
  g.arc(0, 0, R + 1, Math.PI / 2, Math.PI * 1.5);             // dark limb, through the side away from the Sun
  g.ellipse(0, 0, Math.abs(t) * R, R + 1, 0, Math.PI * 1.5, Math.PI / 2, t > 0);
  g.closePath();
  g.fill();
  g.restore();
  g.restore();
  return c;
}
