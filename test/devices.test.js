import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { SeafileClient } from '../src/seafile/client.js';
import { readSnapshot } from '../src/seafile/snapshot.js';
import {
  buildDiscoveredDevices,
  buildStates,
  createPollGate,
  discoverySignature,
} from '../src/devices/index.js';
import { SERVER_FEATURES, buildOfflineStates, serverExternalIds } from '../src/devices/server.js';
import { libraryExternalIds } from '../src/devices/library.js';
import { TOKEN, createFakeSeafile } from './helpers/fakeSeafile.js';

const SERVER_ID = 'seafile.example.com';

async function snapshotOf(overrides, options = { libraryDevices: true, libraryNames: [] }) {
  const fake = createFakeSeafile(overrides);
  const client = new SeafileClient({
    url: 'https://seafile.example.com',
    token: TOKEN,
    transport: fake.transport,
  });
  return readSnapshot(client, options);
}

test('Gladys accepts the discovery, before and after the first reading', async () => {
  const gladys = createFakeGladys();
  await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, SERVER_ID, null));
  const snapshot = await snapshotOf({ isStaff: true });
  const devices = buildDiscoveredDevices(gladys, SERVER_ID, snapshot);
  await gladys.publishDiscoveredDevices(devices);
  assert.equal(gladys.fake.discoveredDevices.length, 3, 'the server and two owned libraries');
  for (const device of devices) {
    for (const feature of device.features) {
      assert.equal(typeof feature.min, 'number', `${feature.external_id} declares min`);
      assert.equal(typeof feature.max, 'number', `${feature.external_id} declares max`);
      assert.equal(feature.read_only, true);
    }
  }
});

test('the server device is polled every minute, the libraries are not', async () => {
  const gladys = createFakeGladys();
  const [server, ...libraries] = buildDiscoveredDevices(gladys, SERVER_ID, await snapshotOf());
  assert.equal(server.poll_frequency, 60_000);
  assert.equal(server.should_poll, true);
  for (const library of libraries) {
    assert.equal(library.poll_frequency, undefined);
  }
});

test('quota features exist only with a quota, admin features only for an admin', async () => {
  const gladys = createFakeGladys();
  const keysOf = (snapshot) =>
    buildDiscoveredDevices(gladys, SERVER_ID, snapshot)[0].features.map((feature) =>
      feature.external_id.split(':').pop(),
    );
  const unlimited = keysOf(await snapshotOf({ total: -2 }));
  assert.ok(!unlimited.includes(SERVER_FEATURES.QUOTA_USED));
  assert.ok(!unlimited.includes(SERVER_FEATURES.USERS));
  const admin = keysOf(await snapshotOf({ isStaff: true }));
  assert.ok(admin.includes(SERVER_FEATURES.QUOTA_USED));
  assert.ok(admin.includes(SERVER_FEATURES.USERS));
  assert.ok(admin.includes(SERVER_FEATURES.TOTAL_STORAGE));
});

test('Gladys accepts the states, with the values the server gave', async () => {
  const gladys = createFakeGladys();
  const snapshot = await snapshotOf({ isStaff: true });
  await gladys.publishStates(buildStates(gladys, SERVER_ID, snapshot));
  const server = serverExternalIds(gladys, SERVER_ID);
  assert.equal(gladys.fake.lastState(server.feature(SERVER_FEATURES.ONLINE)), 1);
  assert.equal(gladys.fake.lastState(server.feature(SERVER_FEATURES.USED)), 42);
  assert.equal(gladys.fake.lastState(server.feature(SERVER_FEATURES.QUOTA_USED)), 42);
  assert.equal(gladys.fake.lastState(server.feature(SERVER_FEATURES.VERSION)), '13.0.5');
  assert.equal(gladys.fake.lastState(server.feature(SERVER_FEATURES.USERS)), 12);
  const photos = libraryExternalIds(gladys, SERVER_ID, 'lib-photos');
  assert.equal(gladys.fake.lastState(photos.feature('size')), 30);
  assert.equal(gladys.fake.lastState(photos.feature('files')), 1200);
});

test('an offline server publishes online = 0 only', () => {
  const gladys = createFakeGladys();
  const states = buildOfflineStates(gladys, SERVER_ID);
  assert.deepEqual(states, [
    {
      device_feature_external_id: serverExternalIds(gladys, SERVER_ID).feature('online'),
      state: 0,
    },
  ]);
});

test('the discovery signature changes with the feature list', async () => {
  const gladys = createFakeGladys();
  const plain = discoverySignature(buildDiscoveredDevices(gladys, SERVER_ID, await snapshotOf()));
  const same = discoverySignature(buildDiscoveredDevices(gladys, SERVER_ID, await snapshotOf()));
  const admin = discoverySignature(
    buildDiscoveredDevices(gladys, SERVER_ID, await snapshotOf({ isStaff: true })),
  );
  assert.equal(plain, same);
  assert.notEqual(plain, admin);
});

test('the poll gate reads at the configured interval, with a half-minute tolerance', () => {
  let time = 0;
  const gate = createPollGate({ now: () => time });
  const config = { poll_frequency: 300 };
  assert.equal(gate(config), true);
  time = 60_000;
  assert.equal(gate(config), false);
  time = 271_000;
  assert.equal(gate(config), true, 'due within half a minute: read now');
  gate.touch();
  time += 60_000;
  assert.equal(gate(config), false);
  gate.reset();
  assert.equal(gate(config), true);
});
