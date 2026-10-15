/**
 * Zigbee2MQTT external extension for SONOFF TRVZB rooms:
 *  - forwards each room sensor's temperature to its TRV(s) via
 *    `external_temperature_input`, with a change threshold + heartbeat
 *  - applies TRV settings on z2m start, layered: global -> room -> single TRV
 * No Home Assistant involved.
 *
 * Install: put this file in <z2m data>/external_extensions/ (or paste it in
 * Frontend -> Extensions), then restart Zigbee2MQTT. Log filter: [TrvSetup]
 */

// ------------------------------------------------------------------ config ---

// Global defaults, used by every room unless overridden.
const DEFAULTS = {
  threshold: 0.1,      // °C change vs. last value SENT before forwarding
  heartbeatMin: 30,    // re-send last value every N minutes (0 = off)
  trv: {               // sent to every TRV on z2m start (one /set payload)
    temperature_sensor_select: 'remote_temperature',
    smart_temperature_control: true,
    system_mode: 'heat',   // 'heat' = no onboard weekly schedule
    // open_window: 'OFF',
    // child_lock: 'UNLOCK',
  },
};

// Rooms. Optional per room:
//   threshold, heartbeatMin  -> override the global values
//   trv: { ... }             -> merged over DEFAULTS.trv for all TRVs of the room
// A TRV entry is either 'friendly_name' or
//   { name: 'friendly_name', trv: { ... } } -> merged over the room settings
// Set a key to null to drop it for that room/TRV (it is then not sent at all).
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

// -------------------------------------------------------------------------

function merge(...layers) {
  const out = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [k, v] of Object.entries(layer)) out[k] = v;
  }
  for (const k of Object.keys(out)) if (out[k] === null || out[k] === undefined) delete out[k];
  return out;
}

class TrvSetup {
  constructor(zigbee, mqtt, state, publishEntityState, eventBus,
              enableDisableExtension, restartCallback, addExtension, settings, logger) {
    this.zigbee = zigbee;
    this.state = state;
    this.eventBus = eventBus;
    this.logger = logger;
    this.baseTopic = settings.get().mqtt.base_topic;
    this.rooms = {};      // roomName -> resolved room config
    this.bySensor = {};   // sensor friendly_name -> roomName
    this.lastSent = {};   // roomName -> last forwarded value
    this.timers = [];
  }

  log(level, msg) {
    this.logger[level](`[TrvSetup] ${msg}`);
  }

  send(trvName, payload) {
    this.eventBus.emitMQTTMessage({
      topic: `${this.baseTopic}/${trvName}/set`,
      message: JSON.stringify(payload),
    });
  }

  buildRooms() {
    for (const [roomName, room] of Object.entries(ROOMS)) {
      if (!room.sensor || !Array.isArray(room.trvs) || room.trvs.length === 0) {
        this.log('error', `room '${roomName}': needs 'sensor' and at least one entry in 'trvs' - skipped`);
        continue;
      }
      if (this.bySensor[room.sensor]) {
        this.log('error', `room '${roomName}': sensor '${room.sensor}' already used by room '${this.bySensor[room.sensor]}' - skipped`);
        continue;
      }
      const trvs = room.trvs.map((t) => {
        const name = typeof t === 'string' ? t : t.name;
        const own = typeof t === 'string' ? null : t.trv;
        return { name, settings: merge(DEFAULTS.trv, room.trv, own) };
      });
      const resolved = {
        name: roomName,
        sensor: room.sensor,
        threshold: room.threshold ?? DEFAULTS.threshold,
        heartbeatMin: room.heartbeatMin ?? DEFAULTS.heartbeatMin,
        trvs,
      };
      const missing = [resolved.sensor, ...trvs.map((t) => t.name)]
        .filter((n) => !this.zigbee.resolveEntity(n));
      if (missing.length) this.log('error', `room '${roomName}': unknown friendly_name(s): ${missing.join(', ')}`);

      this.rooms[roomName] = resolved;
      this.bySensor[resolved.sensor] = roomName;
    }
  }

  forward(room, temp, reason) {
    const value = Math.min(99.9, Math.max(0, Math.round(temp * 10) / 10));
    for (const trv of room.trvs) this.send(trv.name, { external_temperature_input: value });
    this.lastSent[room.name] = value;
    this.log('info', `${room.name}: ${room.sensor} -> ${room.trvs.map((t) => t.name).join(', ')}: ${value} °C (${reason})`);
  }

  async start() {
    this.buildRooms();

    for (const room of Object.values(this.rooms)) {
      // Apply TRV settings
      for (const trv of room.trvs) {
        if (Object.keys(trv.settings).length) {
          this.send(trv.name, trv.settings);
          this.log('info', `${room.name}: ${trv.name} settings ${JSON.stringify(trv.settings)}`);
        }
      }
      // Initial sync from cached state, so TRVs are correct right after a restart
      const dev = this.zigbee.resolveEntity(room.sensor);
      const t = dev ? this.state.get(dev)?.temperature : undefined;
      if (typeof t === 'number') this.forward(room, t, 'startup');

      // Per-room heartbeat
      if (room.heartbeatMin > 0) {
        this.timers.push(setInterval(() => {
          const last = this.lastSent[room.name];
          if (last !== undefined) this.forward(room, last, 'heartbeat');
        }, room.heartbeatMin * 60 * 1000));
      }
    }

    this.eventBus.onStateChange(this, (data) => {
      const roomName = this.bySensor[data.entity?.name];
      if (!roomName || !data.update || typeof data.update.temperature !== 'number') return;
      const room = this.rooms[roomName];
      const t = data.update.temperature;
      const last = this.lastSent[roomName];
      // Compare against the last SENT value, not the last reading: slow drift
      // still triggers once it adds up to the threshold.
      if (last === undefined || Math.abs(t - last) >= room.threshold - 1e-9) {
        this.forward(room, t, last === undefined ? 'first' : `Δ ${(t - last).toFixed(1)}`);
      }
    });

    this.log('info', `started: ${Object.keys(this.rooms).length} rooms (${Object.keys(this.rooms).join(', ')})`);
  }

  async stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.eventBus.removeListeners(this);
  }
}

module.exports = TrvSetup;