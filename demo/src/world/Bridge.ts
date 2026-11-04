/** Shared geometry and walking surface for the river crossing. Local X follows the path. */
export class BridgeSurface {
  readonly halfLength = 12;
  readonly rampLength = 6;
  readonly halfWidth = 1.8;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  private readonly dx: number;
  private readonly dz: number;
  private leftHeight: number;
  private rightHeight: number;

  constructor(private ground: (x: number, z: number) => number, riverX: (z: number) => number) {
    // Intersect the actual glade → ruins path with the river centerline.
    let lo = 0, hi = 1;
    for (let i = 0; i < 32; i++) {
      const t = (lo + hi) / 2;
      if (30 + 30 * t < riverX(-14 - 14 * t)) lo = t; else hi = t;
    }
    const t = (lo + hi) / 2;
    this.x = 30 + 30 * t; this.z = -14 - 14 * t;
    const length = Math.hypot(30, 14);
    this.dx = 30 / length; this.dz = -14 / length;
    this.yaw = Math.atan2(-this.dz, this.dx);
    const bankHeight = (u: number) => Math.max(...[-this.halfWidth, 0, this.halfWidth].map(v => {
      const p = this.worldPoint(u, v); return ground(p.x, p.z);
    }));
    this.leftHeight = bankHeight(-this.halfLength) + 0.25;
    this.rightHeight = bankHeight(this.halfLength) + 0.25;
    // Keep the deck above its banks and any small ridges across its full width.
    let lift = 0;
    for (let u = -this.halfLength; u <= this.halfLength; u += 0.5) {
      for (const v of [-this.halfWidth, 0, this.halfWidth]) {
        const p = this.worldPoint(u, v);
        lift = Math.max(lift, ground(p.x, p.z) + 0.18 - this.localHeight(u, v));
      }
    }
    this.leftHeight += lift; this.rightHeight += lift;
  }

  worldPoint(u: number, v = 0) {
    return { x: this.x + u * this.dx - v * this.dz, z: this.z + u * this.dz + v * this.dx };
  }
  localPoint(x: number, z: number) {
    const x0 = x - this.x, z0 = z - this.z;
    return { u: x0 * this.dx + z0 * this.dz, v: -x0 * this.dz + z0 * this.dx };
  }
  contains(x: number, z: number, padding = 0) {
    const { u, v } = this.localPoint(x, z);
    return Math.abs(u) <= this.halfLength + this.rampLength + padding && Math.abs(v) <= this.halfWidth + padding;
  }
  localHeight(u: number, v = 0) {
    const end = this.halfLength + this.rampLength;
    if (u < -this.halfLength) {
      const p = this.worldPoint(-end, v), t = (u + end) / this.rampLength;
      return this.ground(p.x, p.z) * (1 - t) + this.leftHeight * t;
    }
    if (u > this.halfLength) {
      const p = this.worldPoint(end, v), t = (u - this.halfLength) / this.rampLength;
      return this.rightHeight * (1 - t) + this.ground(p.x, p.z) * t;
    }
    const t = (u + this.halfLength) / (2 * this.halfLength);
    return this.leftHeight * (1 - t) + this.rightHeight * t;
  }
  heightAt(x: number, z: number): number | null {
    if (!this.contains(x, z)) return null;
    const { u, v } = this.localPoint(x, z);
    return this.localHeight(u, v);
  }
}
