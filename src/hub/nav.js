/**
 * Grid navigation over the walk_area mesh. Pure math, no three.js.
 * The mesh is rasterised into small square cells; A* finds a route and
 * string pulling turns it into as few straight segments as possible.
 * With nothing in the way the route is one straight line, as the brief asks.
 */

export class NavGrid {
  /**
   * @param {number} minX @param {number} minZ @param {number} cols @param {number} rows
   * @param {number} cell @param {Uint8Array} walkable
   */
  constructor(minX, minZ, cols, rows, cell, walkable) {
    this.minX = minX; this.minZ = minZ; this.cols = cols; this.rows = rows; this.cell = cell;
    this.walkable = walkable;
    const n = cols * rows;
    this._g = new Float32Array(n);
    this._f = new Float32Array(n);
    this._from = new Int32Array(n);
    this._state = new Uint8Array(n); // 0 new, 1 open, 2 closed
    this._heap = new Int32Array(n);
  }

  /**
   * Build from triangles in world space (x, y, z triples), using the XZ plane.
   * @param {ArrayLike<number>} positions
   * @param {ArrayLike<number>|null} indices
   * @param {number} [cell]
   */
  static fromTriangles(positions, indices, cell = 0.25) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], z = positions[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const cols = Math.max(1, Math.ceil((maxX - minX) / cell));
    const rows = Math.max(1, Math.ceil((maxZ - minZ) / cell));
    const walk = new Uint8Array(cols * rows);
    const triCount = indices ? indices.length / 3 : positions.length / 9;
    const eps = 1e-6;
    for (let t = 0; t < triCount; t++) {
      const ia = indices ? indices[t * 3] : t * 3;
      const ib = indices ? indices[t * 3 + 1] : t * 3 + 1;
      const ic = indices ? indices[t * 3 + 2] : t * 3 + 2;
      const ax = positions[ia * 3], az = positions[ia * 3 + 2];
      const bx = positions[ib * 3], bz = positions[ib * 3 + 2];
      const cx = positions[ic * 3], cz = positions[ic * 3 + 2];
      const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
      if (Math.abs(area) < 1e-12) continue;
      const c0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - minX) / cell));
      const c1 = Math.min(cols - 1, Math.floor((Math.max(ax, bx, cx) - minX) / cell));
      const r0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - minZ) / cell));
      const r1 = Math.min(rows - 1, Math.floor((Math.max(az, bz, cz) - minZ) / cell));
      for (let r = r0; r <= r1; r++) {
        const pz = minZ + (r + 0.5) * cell;
        for (let c = c0; c <= c1; c++) {
          const px = minX + (c + 0.5) * cell;
          const w0 = ((bx - px) * (cz - pz) - (bz - pz) * (cx - px)) / area;
          const w1 = ((cx - px) * (az - pz) - (cz - pz) * (ax - px)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 >= -eps && w1 >= -eps && w2 >= -eps) walk[r * cols + c] = 1;
        }
      }
    }
    return new NavGrid(minX, minZ, cols, rows, cell, walk);
  }

  cellOf(x, z) {
    return { c: Math.floor((x - this.minX) / this.cell), r: Math.floor((z - this.minZ) / this.cell) };
  }
  center(c, r) {
    return { x: this.minX + (c + 0.5) * this.cell, z: this.minZ + (r + 0.5) * this.cell };
  }
  okCell(c, r) {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows && this.walkable[r * this.cols + c] === 1;
  }
  isWalkable(x, z) {
    const { c, r } = this.cellOf(x, z);
    return this.okCell(c, r);
  }

  /** Closest walkable point to (x, z), searching outward ring by ring. */
  nearestWalkable(x, z, maxRadius = 40) {
    const { c, r } = this.cellOf(x, z);
    if (this.okCell(c, r)) return { x, z };
    let best = null, bestD = Infinity;
    for (let rad = 1; rad <= maxRadius; rad++) {
      for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        if (!this.okCell(c + dc, r + dr)) continue;
        const p = this.center(c + dc, r + dr);
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < bestD) { bestD = d; best = p; }
      }
      if (best) return best;
    }
    return null;
  }

  /** True if the straight segment stays on walkable cells. */
  lineOfSight(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const step = this.cell * 0.25;
    const n = Math.max(1, Math.ceil(len / step));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (!this.isWalkable(ax + dx * t, az + dz * t)) return false;
    }
    return true;
  }

  /**
   * Route from a to b. Returns waypoints after the start, ending at b
   * (or the nearest walkable point to b), or null if b cannot be reached.
   * @returns {{x:number,z:number}[]|null}
   */
  findPath(ax, az, bx, bz) {
    const start = this.isWalkable(ax, az) ? { x: ax, z: az } : this.nearestWalkable(ax, az);
    const goal = this.isWalkable(bx, bz) ? { x: bx, z: bz } : this.nearestWalkable(bx, bz);
    if (!start || !goal) return null;
    if (this.lineOfSight(start.x, start.z, goal.x, goal.z)) return [goal];

    const cols = this.cols;
    const s = this.cellOf(start.x, start.z), g = this.cellOf(goal.x, goal.z);
    const si = s.r * cols + s.c, gi = g.r * cols + g.c;
    const G = this._g, F = this._f, from = this._from, state = this._state, heap = this._heap;
    state.fill(0);
    let hn = 0;
    const h = (i) => {
      const c = i % cols, r = (i / cols) | 0;
      const dx = Math.abs(c - g.c), dz = Math.abs(r - g.r);
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
    };
    const push = (i) => {
      let k = hn++; heap[k] = i;
      while (k > 0) { const p = (k - 1) >> 1; if (F[heap[p]] <= F[heap[k]]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
    };
    const pop = () => {
      const top = heap[0]; heap[0] = heap[--hn];
      let k = 0;
      while (true) {
        const l = 2 * k + 1, r = l + 1; let m = k;
        if (l < hn && F[heap[l]] < F[heap[m]]) m = l;
        if (r < hn && F[heap[r]] < F[heap[m]]) m = r;
        if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
      }
      return top;
    };
    G[si] = 0; F[si] = h(si); from[si] = -1; state[si] = 1; push(si);
    let found = false;
    while (hn > 0) {
      const cur = pop();
      if (state[cur] === 2) continue;
      state[cur] = 2;
      if (cur === gi) { found = true; break; }
      const cc = cur % cols, cr = (cur / cols) | 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = cc + dc, nr = cr + dr;
        if (!this.okCell(nc, nr)) continue;
        if (dr && dc && (!this.okCell(cc + dc, cr) || !this.okCell(cc, cr + dr))) continue; // no corner cutting
        const ni = nr * cols + nc;
        if (state[ni] === 2) continue;
        const ng = G[cur] + (dr && dc ? Math.SQRT2 : 1);
        if (state[ni] === 0 || ng < G[ni]) {
          G[ni] = ng; F[ni] = ng + h(ni); from[ni] = cur; state[ni] = 1; push(ni);
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let i = gi; i !== -1; i = from[i]) cells.push(i);
    cells.reverse();
    const pts = cells.map((i) => this.center(i % cols, (i / cols) | 0));
    pts[0] = start; pts[pts.length - 1] = goal;
    // String pulling: from each anchor jump to the farthest visible point.
    const out = [];
    let a = 0;
    while (a < pts.length - 1) {
      let b = pts.length - 1;
      while (b > a + 1 && !this.lineOfSight(pts[a].x, pts[a].z, pts[b].x, pts[b].z)) b--;
      out.push(pts[b]);
      a = b;
    }
    return out;
  }
}
