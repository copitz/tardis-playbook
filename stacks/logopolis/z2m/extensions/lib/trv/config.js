// Configuration for the TrvSetup extension (../../trv_setup.js).
// Changes here need a Zigbee2MQTT restart (helper modules are cached by Node).

// Global defaults, used by every room unless overridden.
const DEFAULTS = {
  threshold: 0.1,      // °C change vs. last value SENT before forwarding
  heartbeatMin: 30,    // re-send last value every N minutes (0 = off)
  staleMin: 90,        // sensor silent for N minutes -> TRVs use their own sensor (0 = off)
  calibration: {       // automatic local_temperature_calibration (false = off)
    sampleMin: 5,      // sample cached room sensor vs. TRV temperature every N minutes
    at: '04:00',       // apply once a day at this local time (HH:MM)
    minHours: 6,       // need at least this much sampled time, else keep collecting
    minChange: 0.2,    // °C - only write when the new value differs at least this much
  },
  trv: {               // sent to every TRV on z2m start (one /set payload)
    temperature_sensor_select: 'remote_temperature',
    smart_temperature_control: true,
    system_mode: 'heat',   // 'heat' = no onboard weekly schedule
    // open_window: 'OFF',
    // child_lock: 'UNLOCK',
  },
};

// Rooms. Optional per room:
//   threshold, heartbeatMin, staleMin -> override the global values
//   calibration: false | { ... } -> off, or merged over DEFAULTS.calibration
//   trv: { ... }             -> merged over DEFAULTS.trv for all TRVs of the room
// A TRV entry is either 'friendly_name' or
//   { name: 'friendly_name', trv: { ... } } -> merged over the room settings
// Set a key to null to drop it for that room/TRV (it is then not sent at all).
// A TRV whose settings contain local_temperature_calibration is not auto-calibrated.
const ROOMS = {
  buero: {
    sensor: 'buero/ths',
    trvs: ['buero/trv'],
  },
  gaeste: {
    sensor: 'gaeste/ths',
    trvs: ['gaeste/trv'],
  },
  kind1: {
    sensor: 'kind1/ths',
    trvs: ['kind1/trv'],
  },
  kind2: {
    sensor: 'kind2/ths',
    trvs: ['kind2/trv-l', 'kind2/trv-r'],
  },
  schlafen: {
    sensor: 'schlafen/ths',
    trvs: ['schlafen/trv'],
  },
};

// Examples of overrides:
//   kind1: {
//     sensor: 'kind1/ths',
//     threshold: 0.2,
//     trv: { child_lock: 'LOCK' },
//     trvs: ['kind1/trv'],
//   },
//   kind2: {
//     sensor: 'kind2/ths',
//     trvs: ['kind2/trv-l', { name: 'kind2/trv-r', trv: { smart_temperature_control: false } }],
//   },

module.exports = { DEFAULTS, ROOMS };
