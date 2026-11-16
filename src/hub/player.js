import * as THREE from 'three';

/**
 * Moves the avatar over the nav grid: click or tap to walk a route, or
 * steer with arrow keys / WASD. Walking is 3.2 m/s (Justin asked for a
 * faster default than the brief's 2 m/s); running is twice that.
 */
export const WALK_SPEED = 3.2;
export const RUN_SPEED = 6.4;

export class PlayerController {
  /**
   * @param {import('../avatars/roster.js').Avatar} avatar
   * @param {import('./nav.js').NavGrid} nav
   */
  constructor(avatar, nav) {
    this.avatar = avatar;
    this.nav = nav;
    this.position = avatar.root.position;
    this.yaw = 0;
    /** @type {{x:number,z:number}[]} */
    this.path = [];
    this.moving = false;
    this._target = new THREE.Vector3();
    this.onArrive = null;
    /** run along the current click/tap route */
    this.pathRun = false;
    /** the on-screen Run toggle: when on, every move runs */
    this.runToggle = false;
    /** speed used in the last update, metres per second (0 when still) */
    this.speed = 0;
  }

  place(x, z, yaw) {
    this.position.set(x, 0.06, z);
    this.yaw = yaw;
    this.avatar.root.rotation.y = yaw;
    this.path.length = 0;
  }

  /**
   * @param {number} x @param {number} z
   * @param {{run?:boolean}} [opts]  run: a double click or double tap
   */
  walkTo(x, z, opts = {}) {
    const p = this.nav.findPath(this.position.x, this.position.z, x, z);
    this.path = p || [];
    this.pathRun = !!opts.run;
    return !!p;
  }

  stop() { this.path.length = 0; this.pathRun = false; }

  /** Speed for this frame. keys.run is Shift held with the arrow keys or WASD. */
  speedFor(keys) {
    const steering = !!(keys.x || keys.z);
    const run = this.runToggle || (steering ? !!keys.run : this.pathRun);
    return run ? RUN_SPEED : WALK_SPEED;
  }

  /**
   * @param {number} dt
   * @param {{x:number, z:number, run?:boolean}} keys  world-space steering from the keyboard, zero if none
   */
  update(dt, keys) {
    let dx = 0, dz = 0;
    const speed = this.speedFor(keys);
    const step = speed * dt;
    if (keys.x || keys.z) {
      this.path.length = 0;
      const len = Math.hypot(keys.x, keys.z);
      dx = (keys.x / len) * step; dz = (keys.z / len) * step;
      const nx = this.position.x + dx, nz = this.position.z + dz;
      if (this.nav.isWalkable(nx, nz)) { this.position.x = nx; this.position.z = nz; }
      else if (this.nav.isWalkable(nx, this.position.z)) { this.position.x = nx; dz = 0; }
      else if (this.nav.isWalkable(this.position.x, nz)) { this.position.z = nz; dx = 0; }
      else { dx = 0; dz = 0; }
    } else if (this.path.length) {
      const t = this.path[0];
      const ox = t.x - this.position.x, oz = t.z - this.position.z;
      const d = Math.hypot(ox, oz);
      if (d <= step) {
        this.position.x = t.x; this.position.z = t.z;
        dx = ox; dz = oz;
        this.path.shift();
        if (!this.path.length) { this.pathRun = false; if (this.onArrive) this.onArrive(); }
      } else {
        dx = (ox / d) * step; dz = (oz / d) * step;
        this.position.x += dx; this.position.z += dz;
      }
    }
    const moving = dx !== 0 || dz !== 0;
    this.speed = moving ? speed : 0;
    // Play the walk loop fast enough that the feet keep up with the ground.
    if (moving) this.avatar.setSpeed?.(speed);
    if (moving) {
      const want = Math.atan2(dx, dz); // avatar faces +Z
      let diff = want - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.yaw += diff * Math.min(1, dt * 12);
      this.avatar.root.rotation.y = this.yaw;
    }
    if (moving !== this.moving) { this.moving = moving; this.avatar.play(moving ? 'walk' : 'idle'); }
    this.avatar.update(dt);
  }
}

/**
 * Fixed three-quarter follow camera. It always sits on the open (+Z) side
 * of the player, away from the bus, and above the bus roof line, so it
 * never passes through the bus. No camera controls, as the brief asks.
 */
export class FollowCamera {
  /** @param {THREE.PerspectiveCamera} camera */
  constructor(camera) {
    this.camera = camera;
    this.offset = new THREE.Vector3(2.2, 5.2, 7.2);
    this.lookHeight = 0.9;
    this._want = new THREE.Vector3();
    this._look = new THREE.Vector3();
  }
  snap(target) { this.update(target, 1, true); }
  /** @param {THREE.Vector3} target */
  update(target, dt, snap = false) {
    this._want.copy(target).add(this.offset);
    if (snap) this.camera.position.copy(this._want);
    else this.camera.position.lerp(this._want, Math.min(1, dt * 5));
    this._look.set(this.camera.position.x - this.offset.x, target.y + this.lookHeight, this.camera.position.z - this.offset.z);
    this.camera.lookAt(this._look);
  }
}
