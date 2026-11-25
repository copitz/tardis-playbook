/**
 * Zigbee2MQTT external extension for SONOFF TRVZB rooms:
 *  - forwards each room sensor's temperature to its TRV(s) via
 *    `external_temperature_input`, with a change threshold + heartbeat
 *  - falls back to the TRVs' built-in sensor when the room sensor has not
 *    been heard from for `staleMin` minutes, and switches back once it is
 *  - calibrates each TRV's built-in sensor (`local_temperature_calibration`)
 *    once a day from the average deviation to the room sensor, so the
 *    fallback runs on sensible values
 *  - applies TRV settings on z2m start, layered: global -> room -> single TRV
 * No Home Assistant involved.
 *
 * Files:
 *   trv_setup.js            this file: the z2m extension, wires events to rooms
 *   lib/trv/config.js       DEFAULTS + ROOMS  <- edit rooms/settings here
 *   lib/trv/room.js         Room: forwarding, heartbeat, stale fallback
 *   lib/trv/calibration.js  Calibration: per-room daily calibration
 *   lib/trv/device.js       Device: base class (friendly_name, cached state)
 *   lib/trv/sensor.js       Sensor extends Device
 *   lib/trv/trv.js          Trv extends Device
 *
 * Install: copy this file and lib/ to <z2m data>/external_extensions/, then
 * restart Zigbee2MQTT. Helper modules in lib/ are cached by Node, so changes
 * there always need a full restart (saving in Frontend -> Extensions only
 * reloads this file). Log filter: [TrvSetup]
 */

const { DEFAULTS, ROOMS } = require('./lib/trv/config');
const Room = require('./lib/trv/room');

class TrvSetup {
  constructor(zigbee, mqtt, state, publishEntityState, eventBus,
              enableDisableExtension, restartCallback, addExtension, settings, logger) {
    this.eventBus = eventBus;
    this.logger = logger;
    this.baseTopic = settings.get().mqtt.base_topic;
    // Shared with all rooms / devices
    this.ctx = {
      zigbee,
      state,
      log: (level, msg) => this.log(level, msg),
      send: (name, payload) => this.eventBus.emitMQTTMessage({
        topic: `${this.baseTopic}/${name}/set`,
        message: JSON.stringify(payload),
      }),
    };
    this.rooms = [];
    this.bySensor = new Map(); // sensor friendly_name -> Room
    this.timer = null;
  }

  log(level, msg) {
    this.logger[level](`[TrvSetup] ${msg}`);
  }

  buildRooms() {
    for (const [name, config] of Object.entries(ROOMS)) {
      if (!config.sensor || !Array.isArray(config.trvs) || config.trvs.length === 0) {
        this.log('error', `room '${name}': needs 'sensor' and at least one entry in 'trvs' - skipped`);
        continue;
      }
      if (this.bySensor.has(config.sensor)) {
        this.log('error', `room '${name}': sensor '${config.sensor}' already used by room '${this.bySensor.get(config.sensor).name}' - skipped`);
        continue;
      }
      const room = new Room(name, config, DEFAULTS, this.ctx);
      const missing = room.unknownDevices;
      if (missing.length) this.log('error', `room '${name}': unknown friendly_name(s): ${missing.join(', ')}`);
      this.rooms.push(room);
      this.bySensor.set(config.sensor, room);
    }
  }

  // Every minute: stale check, then calibration sampling/applying
  tick(startup = false) {
    for (const room of this.rooms) room.checkStale();
    const now = new Date();
    for (const room of this.rooms) room.calibration?.tick(now, startup);
  }

  async start() {
    this.buildRooms();
    for (const room of this.rooms) room.start();

    this.tick(true);
    this.timer = setInterval(() => this.tick(), 60 * 1000);

    this.eventBus.onLastSeenChanged(this, (data) => {
      this.bySensor.get(data.device?.name)?.onSensorSeen();
    });

    this.eventBus.onStateChange(this, (data) => {
      const room = this.bySensor.get(data.entity?.name);
      const t = data.update?.temperature;
      if (room && typeof t === 'number') room.onSensorTemperature(t);
    });

    this.log('info', `started: ${this.rooms.length} rooms (${this.rooms.map((r) => r.name).join(', ')})`);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const room of this.rooms) room.stop();
    this.eventBus.removeListeners(this);
  }
}

module.exports = TrvSetup;
