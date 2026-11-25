// Base class for a Zigbee device addressed by friendly_name.
// Everything is read from z2m's cache on access (no Zigbee requests), and the
// entity is resolved every time, so re-paired / renamed devices are picked up.

class Device {
  // ctx: { zigbee, state, log(level, msg), send(friendlyName, payload) }
  constructor(name, ctx) {
    this.name = name;
    this.ctx = ctx;
  }

  get entity() {
    return this.ctx.zigbee.resolveEntity(this.name);
  }

  get exists() {
    return !!this.entity;
  }

  // z2m's cached state object, or undefined
  get cachedState() {
    const entity = this.entity;
    return entity ? this.ctx.state.get(entity) : undefined;
  }

  // ms timestamp of the last message z2m received from the device, or undefined
  get lastSeen() {
    return this.entity?.zh?.lastSeen;
  }

  // Publish to <base_topic>/<name>/set
  set(payload) {
    this.ctx.send(this.name, payload);
  }
}

module.exports = Device;
