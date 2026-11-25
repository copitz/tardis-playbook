// A SONOFF TRVZB thermostat.

const Device = require('./device');

class Trv extends Device {
  // settings: merged /set payload applied on start (global -> room -> TRV)
  constructor(name, settings, ctx) {
    super(name, ctx);
    this.settings = settings;
  }

  // Normally driven by the room sensor (only those are switched on fallback)
  get usesRemoteSensor() {
    return this.settings.temperature_sensor_select === 'remote_temperature';
  }

  // A fixed local_temperature_calibration in the settings disables auto calibration
  get autoCalibrated() {
    return !('local_temperature_calibration' in this.settings);
  }

  // Cached built-in sensor reading (already calibrated), or undefined
  get localTemperature() {
    const t = this.cachedState?.local_temperature;
    return typeof t === 'number' ? t : undefined;
  }

  // Cached local_temperature_calibration, 0 if unknown
  get calibrationOffset() {
    const c = this.cachedState?.local_temperature_calibration;
    return typeof c === 'number' ? c : 0;
  }

  // Sends the settings; false if there are none
  applySettings() {
    if (!Object.keys(this.settings).length) return false;
    this.set(this.settings);
    return true;
  }

  setExternalTemperature(value) {
    this.set({ external_temperature_input: value });
  }

  useRemoteSensor(remote) {
    this.set({ temperature_sensor_select: remote ? 'remote_temperature' : 'local_temperature' });
  }

  setCalibration(value) {
    this.set({ local_temperature_calibration: value });
  }
}

module.exports = Trv;
