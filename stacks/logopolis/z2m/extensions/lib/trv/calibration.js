// Daily automatic local_temperature_calibration of a room's TRVs, from the
// average deviation of their built-in sensor to the room sensor. Samples come
// from z2m's cached state, no extra Zigbee requests.

class Calibration {
  // config: merged DEFAULTS.calibration + room calibration (see config.js)
  constructor(room, config) {
    this.room = room;
    this.config = config;
    this.samples = new Map();   // Trv -> { sum, n, mirrored } since last calibration
    this.lastSampleAt = 0;      // ms timestamp of last sample round
    this.lastRunDay = undefined; // day (toDateString) of last calibration run
  }

  // Called every minute
  tick(now, startup = false) {
    // On startup only mark today as done if already past the time - no samples yet
    if (startup) {
      this.isDue(now);
      return;
    }
    if (now - this.lastSampleAt >= this.config.sampleMin * 60 * 1000 - 5000) {
      this.lastSampleAt = now.getTime();
      this.sample();
    }
    if (this.isDue(now)) this.run();
  }

  // true once per day, from the configured time on
  isDue(now) {
    const [h, m] = this.config.at.split(':').map(Number);
    const day = now.toDateString();
    if (now.getHours() * 60 + now.getMinutes() < h * 60 + m || this.lastRunDay === day) return false;
    this.lastRunDay = day;
    return true;
  }

  // Every TRV in remote mode, with a fresh room sensor, gets one sample of
  // (room temperature - TRV's uncalibrated own temperature).
  sample() {
    const room = this.room;
    if (room.fallback || room.isStale()) return;
    const remote = room.sensor.temperature;
    if (remote === undefined) return;
    const maxAge = (room.staleMin || 90) * 60 * 1000;
    for (const trv of room.remoteTrvs) {
      if (!trv.autoCalibrated) continue;
      const local = trv.localTemperature;
      if (local === undefined) continue;
      if (!(Date.now() - (trv.lastSeen ?? 0) < maxAge)) continue;
      let s = this.samples.get(trv);
      if (!s) this.samples.set(trv, s = { sum: 0, n: 0, mirrored: 0 });
      s.sum += remote - (local - trv.calibrationOffset);
      s.n += 1;
      // Does the TRV just echo the external value instead of its own sensor?
      if (room.lastSent !== undefined && Math.abs(local - room.lastSent) < 0.05) s.mirrored += 1;
    }
  }

  // Apply the averaged deviation per TRV
  run() {
    const room = this.room;
    const needed = (this.config.minHours * 60) / this.config.sampleMin;
    for (const trv of room.remoteTrvs) {
      const s = this.samples.get(trv);
      if (!s || s.n < needed) {
        room.log('info', `${trv.name} calibration skipped, only ${s?.n ?? 0}/${Math.ceil(needed)} samples`);
        continue;   // keep collecting until tomorrow
      }
      this.samples.delete(trv);
      if (s.mirrored / s.n > 0.8) {
        room.log('warning', `${trv.name} reports the external value as local_temperature `
          + `(${s.mirrored}/${s.n} samples) - cannot calibrate from cached state`);
        continue;
      }
      const current = trv.calibrationOffset;
      const value = Math.min(12.7, Math.max(-12.7, Math.round((s.sum / s.n) * 10) / 10));
      const msg = `${trv.name} avg deviation over ${s.n} samples -> calibration ${value} (was ${current})`;
      if (Math.abs(value - current) < this.config.minChange - 1e-9) {
        room.log('info', `${msg}, unchanged`);
        continue;
      }
      trv.setCalibration(value);
      room.log('info', msg);
    }
  }
}

module.exports = Calibration;
