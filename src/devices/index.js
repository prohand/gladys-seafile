// -----------------------------------------------------------------------------
// Device registry: what the integration publishes for one reading of the
// server, and the poll gate.
// -----------------------------------------------------------------------------

import { DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';
import { buildServerDevice, buildServerStates } from './server.js';
import { buildLibraryDevice, buildLibraryStates } from './library.js';

/**
 * Every device of the server: the server itself, then one per library shown
 * as a device. Before the first reading only the server is known.
 *
 * @param {object} gladys the SDK instance
 * @param {string} serverId see serverIdOf
 * @param {object | null} snapshot see readSnapshot
 */
export function buildDiscoveredDevices(gladys, serverId, snapshot) {
  return [
    buildServerDevice(gladys, serverId, snapshot),
    ...(snapshot?.deviceLibraries ?? []).map((library) =>
      buildLibraryDevice(gladys, serverId, library),
    ),
  ];
}

/** Every state of a successful reading. */
export function buildStates(gladys, serverId, snapshot) {
  return [
    ...buildServerStates(gladys, serverId, snapshot),
    ...snapshot.deviceLibraries.flatMap((library) => buildLibraryStates(gladys, serverId, library)),
  ];
}

/**
 * What the published device list depends on: when it changes (a library
 * created, an admin account, a quota set), the devices are published again.
 */
export function discoverySignature(devices) {
  return JSON.stringify(
    devices.map((device) => [
      device.external_id,
      device.name,
      device.features.map((feature) => feature.external_id),
    ]),
  );
}

// Gladys' poll ticks drift by a few milliseconds: a read due within the next
// half-minute runs now, so a 300 s interval does not slip to 360 s.
const POLL_TOLERANCE_MS = DEVICE_POLL_FREQUENCIES.EVERY_MINUTES / 2;

/**
 * The poll gate: Gladys polls the server device once a minute, the server is
 * read at the interval of the configuration (`poll_frequency`, seconds).
 *
 * @param {object} [options]
 * @param {() => number} [options.now]
 * @returns {(config: object) => boolean} whether this poll should read
 */
export function createPollGate({ now = Date.now } = {}) {
  let lastRead;
  const gate = (config) => {
    const time = now();
    if (
      lastRead !== undefined &&
      time - lastRead < config.poll_frequency * 1000 - POLL_TOLERANCE_MS
    ) {
      return false;
    }
    lastRead = time;
    return true;
  };
  // A refresh asked by hand (action, scene, widget) counts as a read.
  gate.touch = () => {
    lastRead = now();
  };
  gate.reset = () => {
    lastRead = undefined;
  };
  return gate;
}
