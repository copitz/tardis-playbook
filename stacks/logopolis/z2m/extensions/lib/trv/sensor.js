// A room temperature sensor.

const Device = require('./device');

class Sensor extends Device {
  constructor(name, ctx) {
    super(name, ctx);
    this.heardAt = undefined; // ms timestamp of the last message we got from it
  }

  // Cached temperature, or undefined
  get temperature() {
    const t = this.cachedState?.temperature;
    return typeof t === 'number' ? t : undefined;
  }

  markHeard(ts = Date.now()) {
    this.heardAt = ts;
  }

  // Initialise heardAt from z2m's lastSeen (on startup)
  syncHeard() {
    const seen = this.lastSeen;
    if (typeof seen === 'number') this.heardAt = seen;
  }

  // false if never heard of within the window; maxAgeMin <= 0 = never silent
  isSilentFor(maxAgeMin) {
    return maxAgeMin > 0
      && (this.heardAt === undefined || Date.now() - this.heardAt > maxAgeMin * 60 * 1000);
  }
}

module.exports = Sensor;
