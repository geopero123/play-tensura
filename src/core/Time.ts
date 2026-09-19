/** Global time with hit-stop and slow-motion support. */
export class Time {
  scale = 1;
  dt = 0; // scaled delta
  rawDt = 0; // unscaled delta
  elapsed = 0; // scaled elapsed
  rawElapsed = 0;
  private hitstopLeft = 0;
  private slowLeft = 0;
  private slowScale = 1;
  private last = performance.now();

  tick(now: number) {
    let raw = (now - this.last) / 1000;
    this.last = now;
    if (raw > 0.1) raw = 0.1;
    if (raw < 0) raw = 0;
    this.rawDt = raw;
    this.rawElapsed += raw;

    let s = 1;
    if (this.hitstopLeft > 0) {
      this.hitstopLeft -= raw;
      s = 0.02;
    } else if (this.slowLeft > 0) {
      this.slowLeft -= raw;
      s = this.slowScale;
    }
    this.scale = s;
    this.dt = raw * s;
    this.elapsed += this.dt;
  }

  hitstop(seconds: number) {
    this.hitstopLeft = Math.max(this.hitstopLeft, seconds);
  }
  slowmo(seconds: number, scale = 0.25) {
    this.slowLeft = Math.max(this.slowLeft, seconds);
    this.slowScale = scale;
  }
  get inSlowmo() {
    return this.slowLeft > 0;
  }
}
