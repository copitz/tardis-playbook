// A room: one sensor driving one or more TRVs. Handles forwarding with
// threshold + heartbeat and the fallback to the TRVs' own sensor while the
// room sensor is stale.

const Sensor = require('./sensor');
const Trv = require('./trv');
const Calibration = require('./calibration');

// Shallow merge; null/undefined values remove the key.
function merge(...layers) {
  const out = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [k, v] of Object.entries(layer)) out[k] = v;
  }
  for (const k of Object.keys(out)) if (out[k] === null || out[k] === undefined) delete out[k];
  return out;
}

class Room {
  // config: one ROOMS entry, defaults: DEFAULTS (see config.js)
  constructor(name, config, defaults, ctx) {
    this.name = name;
    this.ctx = ctx;
    this.sensor = new Sensor(config.sensor, ctx);
    this.trvs = config.trvs.map((t) => (typeof t === 'string'
      ? new Trv(t, merge(defaults.trv, config.trv), ctx)
      : new Trv(t.name, merge(defaults.trv, config.trv, t.trv), ctx)));
    this.threshold = config.threshold ?? defaults.threshold;
    this.heartbeatMin = config.heartbeatMin ?? defaults.heartbeatMin;
    this.staleMin = config.staleMin ?? defaults.staleMin;
    this.calibration = config.calibration === false || defaults.calibration === false
      ? null : new Calibration(this, merge(defaults.calibration, config.calibration));

    this.lastSent = undefined; // last forwarded value
    this.fallback = false;     // true while TRVs run on their own sensor
    this.heartbeat = null;
  }

  log(level, msg) {
    this.ctx.log(level, `${this.name}: ${msg}`);
  }

  get remoteTrvs() {
    return this.trvs.filter((t) => t.usesRemoteSensor);
  }

  // friendly_names z2m does not know
  get unknownDevices() {
    return [this.sensor, ...this.trvs].filter((d) => !d.exists).map((d) => d.name);
  }

  isStale() {
    return this.sensor.isSilentFor(this.staleMin);
  }

  // ------------------------------------------------------------- lifecycle --

  start() {
    for (const trv of this.trvs) {
      if (trv.applySettings()) this.log('info', `${trv.name} settings ${JSON.stringify(trv.settings)}`);
    }
    // Initial sync from cached state, so TRVs are correct right after a restart
    // (only if the cached value is still fresh - otherwise fall back right away)
    this.sensor.syncHeard();
    const t = this.sensor.temperature;
    if (this.isStale()) this.enterFallback();
    else if (t !== undefined) this.forward(t, 'startup');

    // Heartbeat (paused while the sensor is stale, so a dead sensor's last
    // value isn't kept alive forever)
    if (this.heartbeatMin > 0) {
      this.heartbeat = setInterval(() => {
        if (this.lastSent !== undefined && !this.fallback) this.forward(this.lastSent, 'heartbeat');
      }, this.heartbeatMin * 60 * 1000);
    }
  }

  stop() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  // ---------------------------------------------------------------- events --

  // Any message from the sensor (also e.g. humidity-only reports)
  onSensorSeen() {
    this.sensor.markHeard();
  }

  onSensorTemperature(t) {
    this.sensor.markHeard();
    if (this.fallback) {
      this.leaveFallback(t);
      return;
    }
    // Compare against the last SENT value, not the last reading: slow drift
    // still triggers once it adds up to the threshold.
    const last = this.lastSent;
    if (last === undefined || Math.abs(t - last) >= this.threshold - 1e-9) {
      this.forward(t, last === undefined ? 'first' : `Δ ${(t - last).toFixed(1)}`);
    }
  }

  // Called every minute
  checkStale() {
    if (this.isStale()) this.enterFallback();
  }

  // ------------------------------------------------------------ forwarding --

  forward(temp, reason) {
    const value = Math.min(99.9, Math.max(0, Math.round(temp * 10) / 10));
    for (const trv of this.trvs) trv.setExternalTemperature(value);
    this.lastSent = value;
    this.log('info', `${this.sensor.name} -> ${this.trvs.map((t) => t.name).join(', ')}: ${value} °C (${reason})`);
  }

  enterFallback() {
    if (this.fallback) return;
    this.fallback = true;
    const trvs = this.remoteTrvs;
    for (const trv of trvs) trv.useRemoteSensor(false);
    const seen = this.sensor.heardAt;
    const ago = seen === undefined ? 'never' : `${Math.round((Date.now() - seen) / 60000)} min ago`;
    this.log('warning', `${this.sensor.name} stale (last seen ${ago}) -> ${trvs.map((t) => t.name).join(', ')} use local temperature`);
  }

  leaveFallback(temp) {
    if (!this.fallback) return;
    this.fallback = false;
    // Value first, so the TRV has a fresh reading when it switches back
    this.forward(temp, 'sensor back');
    const trvs = this.remoteTrvs;
    for (const trv of trvs) trv.useRemoteSensor(true);
    this.log('info', `${this.sensor.name} back -> ${trvs.map((t) => t.name).join(', ')} use remote temperature`);
  }
}

module.exports = Room;
