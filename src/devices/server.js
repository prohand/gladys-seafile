// -----------------------------------------------------------------------------
// The "Seafile server" device: the server as the configured account sees it.
//
// One device per server, keyed by its host (see serverIdOf), polled by Gladys
// once a minute — the refresh interval of the configuration is applied by
// skipping polls (createPoller). The features:
//
//   online          the server answered the last refresh (0 / 1)
//   version         Seafile version, as server-info reports it (text)
//   used            storage used by the account (GB)
//   quota           quota of the account (GB) — absent when unlimited
//   quota_used      quota used (%) — absent when unlimited
//   libraries       libraries the account can see
//   users, active_users, files, total_storage, connected_devices
//                   server-wide statistics, only for a system admin account
//
// Feature keys are stored by Gladys (history, scenes, dashboards): never
// renamed. A feature that appears later (an admin account, a quota set) makes
// the integration publish the device again.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { toGigabytes } from '../seafile/snapshot.js';

export const SERVER_DEVICE_TYPE = 'seafile-server';

export const SERVER_FEATURES = {
  ONLINE: 'online',
  VERSION: 'version',
  USED: 'used',
  QUOTA: 'quota',
  QUOTA_USED: 'quota_used',
  LIBRARIES: 'libraries',
  USERS: 'users',
  ACTIVE_USERS: 'active_users',
  FILES: 'files',
  TOTAL_STORAGE: 'total_storage',
  CONNECTED_DEVICES: 'connected_devices',
};

/** Storage bounds, in GB: a petabyte leaves room for any home or office server. */
const MAX_GB = 1_000_000;
/** Counters bounds: users, files, devices. */
const MAX_COUNT = 1_000_000_000;

export function serverExternalIds(gladys, serverId) {
  return gladys.externalIds(SERVER_DEVICE_TYPE, serverId);
}

function readOnly(feature) {
  return { read_only: true, has_feedback: false, ...feature };
}

function sizeFeature(ids, key, name, keepHistory = true) {
  return readOnly({
    name,
    external_id: ids.feature(key),
    category: DEVICE_FEATURE_CATEGORIES.DATA,
    type: DEVICE_FEATURE_TYPES.DATA.SIZE,
    unit: DEVICE_FEATURE_UNITS.GIGABYTE,
    min: 0,
    max: MAX_GB,
    keep_history: keepHistory,
  });
}

function countFeature(ids, key, name) {
  return readOnly({
    name,
    external_id: ids.feature(key),
    category: DEVICE_FEATURE_CATEGORIES.UNKNOWN,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    min: 0,
    max: MAX_COUNT,
    keep_history: true,
  });
}

/** The device name: the host the user knows the server by. */
export function serverName(snapshot, serverId) {
  try {
    return `Seafile ${new URL(snapshot.server.url).host}`;
  } catch {
    return `Seafile ${serverId}`;
  }
}

/**
 * The discovery payload of the server device.
 *
 * @param {object} gladys the SDK instance
 * @param {string} serverId see serverIdOf
 * @param {object | null} snapshot the last reading, null before the first one
 */
export function buildServerDevice(gladys, serverId, snapshot) {
  const ids = serverExternalIds(gladys, serverId);
  const features = [
    readOnly({
      name: 'Online',
      external_id: ids.feature(SERVER_FEATURES.ONLINE),
      category: DEVICE_FEATURE_CATEGORIES.UNKNOWN,
      type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
      min: 0,
      max: 1,
      keep_history: true,
    }),
    readOnly({
      name: 'Seafile version',
      external_id: ids.feature(SERVER_FEATURES.VERSION),
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
      min: 0,
      max: 0,
      keep_history: false,
    }),
    sizeFeature(ids, SERVER_FEATURES.USED, 'Storage used'),
  ];
  if (snapshot && !snapshot.account.unlimited) {
    features.push(sizeFeature(ids, SERVER_FEATURES.QUOTA, 'Quota', false));
    features.push(
      readOnly({
        name: 'Quota used',
        external_id: ids.feature(SERVER_FEATURES.QUOTA_USED),
        category: DEVICE_FEATURE_CATEGORIES.LEVEL_SENSOR,
        type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
        unit: DEVICE_FEATURE_UNITS.PERCENT,
        min: 0,
        max: 100,
        keep_history: true,
      }),
    );
  }
  features.push(countFeature(ids, SERVER_FEATURES.LIBRARIES, 'Libraries'));
  if (snapshot?.admin) {
    features.push(
      countFeature(ids, SERVER_FEATURES.USERS, 'Users'),
      countFeature(ids, SERVER_FEATURES.ACTIVE_USERS, 'Active users'),
      countFeature(ids, SERVER_FEATURES.FILES, 'Files on the server'),
      sizeFeature(ids, SERVER_FEATURES.TOTAL_STORAGE, 'Storage of the server'),
      countFeature(ids, SERVER_FEATURES.CONNECTED_DEVICES, 'Connected clients'),
    );
  }
  return {
    name: snapshot ? serverName(snapshot, serverId) : `Seafile ${serverId}`,
    external_id: ids.device,
    // Gladys polls once a minute; createPoller applies the configured interval.
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
    // Older cores only poll a device that also says so (Gladys 5.3+ sets it).
    should_poll: true,
    features,
  };
}

/**
 * The states of a successful reading. A value the server did not give is left
 * out rather than published as 0.
 */
export function buildServerStates(gladys, serverId, snapshot) {
  const ids = serverExternalIds(gladys, serverId);
  const numbers = [
    [SERVER_FEATURES.ONLINE, 1],
    [SERVER_FEATURES.USED, toGigabytes(snapshot.account.usage)],
    [SERVER_FEATURES.LIBRARIES, snapshot.libraries.length],
  ];
  if (!snapshot.account.unlimited) {
    numbers.push([SERVER_FEATURES.QUOTA, toGigabytes(snapshot.account.total)]);
    numbers.push([SERVER_FEATURES.QUOTA_USED, snapshot.account.quotaPercent]);
  }
  if (snapshot.admin) {
    numbers.push(
      [SERVER_FEATURES.USERS, snapshot.admin.users],
      [SERVER_FEATURES.ACTIVE_USERS, snapshot.admin.activeUsers],
      [SERVER_FEATURES.FILES, snapshot.admin.files],
      [SERVER_FEATURES.TOTAL_STORAGE, toGigabytes(snapshot.admin.storage)],
      [SERVER_FEATURES.CONNECTED_DEVICES, snapshot.admin.connectedDevices],
    );
  }
  const states = numbers
    .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
    .map(([key, state]) => ({ device_feature_external_id: ids.feature(key), state }));
  if (snapshot.server.version) {
    states.push({
      device_feature_external_id: ids.feature(SERVER_FEATURES.VERSION),
      text: snapshot.server.version,
    });
  }
  return states;
}

/** The single state of a failed reading: the server is offline. */
export function buildOfflineStates(gladys, serverId) {
  return [
    {
      device_feature_external_id: serverExternalIds(gladys, serverId).feature(
        SERVER_FEATURES.ONLINE,
      ),
      state: 0,
    },
  ];
}
