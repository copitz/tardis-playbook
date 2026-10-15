/**
 * Zigbee2MQTT external extension that maps switch button actions (e.g. PTM 215Z
 * Green Power switches) to commands on lights / groups.
 * No Home Assistant involved.
 *
 * Install: put this file in <z2m data>/external_extensions/ (or paste it in
 * Frontend -> Extensions), then restart Zigbee2MQTT. Log filter: [SwitchBindings]
 */

// ------------------------------------------------------------------ config ---

// switch friendly_name -> action -> { target friendly_name: command }
// A command is either a state string ('ON', 'OFF', 'TOGGLE') or a full /set
// payload object, e.g. { state: 'ON', brightness: 80, transition: 1 }.
// Targets can be devices or groups; one action may drive several targets.
const SWITCHES = {
  'kueche/eingang/switch-1': {
    release_1: { 'kueche/kochen': 'ON' },
    release_2: { 'kueche/kochen': 'OFF' },
    release_3: { 'kueche/essen': 'ON' },
    release_4: { 'kueche/essen': 'OFF' },
  },
  'kueche/eingang/switch-2': {
    release_1: { 'wohnzimmer/spots': 'ON' },
    release_2: { 'wohnzimmer/spots': 'OFF' },
    release_3: { 'wohnzimmer/leuchter': 'ON' },
    release_4: { 'wohnzimmer/leuchter': 'OFF' },
  },
  'kueche/eingang/switch-3': {
    release_1: { 'kueche/eingang': 'ON' },
    release_2: { 'kueche/eingang': 'OFF' },
    release_3: { 'wohnzimmer/wand': 'ON' },
    release_4: { 'wohnzimmer/wand': 'OFF' },
  },
  'schlafen/switch-1': {
    single: { 'schlafen/bulb-1': 'TOGGLE' },
  },
};

// -------------------------------------------------------------------------

class SwitchBindings {
  constructor(zigbee, mqtt, state, publishEntityState, eventBus,
              enableDisableExtension, restartCallback, addExtension, settings, logger) {
    this.zigbee = zigbee;
    this.eventBus = eventBus;
    this.logger = logger;
    this.baseTopic = settings.get().mqtt.base_topic;
  }

  log(level, msg) {
    this.logger[level](`[SwitchBindings] ${msg}`);
  }

  send(target, payload) {
    this.eventBus.emitMQTTMessage({
      topic: `${this.baseTopic}/${target}/set`,
      message: JSON.stringify(payload),
    });
  }

  validate() {
    const names = new Set();
    for (const [sw, actions] of Object.entries(SWITCHES)) {
      names.add(sw);
      for (const targets of Object.values(actions)) Object.keys(targets).forEach((t) => names.add(t));
    }
    const missing = [...names].filter((n) => !this.zigbee.resolveEntity(n));
    if (missing.length) this.log('error', `unknown friendly_name(s): ${missing.join(', ')}`);
  }

  async start() {
    this.validate();

    this.eventBus.onStateChange(this, (data) => {
      const sw = data.entity?.name;
      const action = data.update?.action;
      if (!SWITCHES[sw] || typeof action !== 'string' || action === '') return;
      const targets = SWITCHES[sw][action];
      if (!targets) {
        this.log('debug', `${sw}: unmapped action '${action}'`);
        return;
      }
      for (const [target, cmd] of Object.entries(targets)) {
        const payload = typeof cmd === 'string' ? { state: cmd } : cmd;
        this.send(target, payload);
        this.log('info', `${sw} ${action} -> ${target} ${JSON.stringify(payload)}`);
      }
    });

    this.log('info', `started: ${Object.keys(SWITCHES).length} switches (${Object.keys(SWITCHES).join(', ')})`);
  }

  async stop() {
    this.eventBus.removeListeners(this);
  }
}

module.exports = SwitchBindings;
