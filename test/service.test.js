import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { SeafileService } from '../src/service.js';
import { serverExternalIds } from '../src/devices/server.js';
import { SCENE_TRIGGERS } from '../src/capabilities/scenes.js';
import { TOKEN, createFakeSeafile } from './helpers/fakeSeafile.js';

const SERVER_ID = 'seafile.example.com';

function setup({ seafile, config } = {}) {
  const gladys = createFakeGladys();
  const fake = createFakeSeafile(seafile);
  let time = 1_000_000;
  const changes = [];
  const service = new SeafileService({
    gladys,
    transport: fake.transport,
    now: () => time,
    sleep: async () => {},
    onChange: () => changes.push(time),
  });
  service.configure(
    normalizeConfig({ server_url: 'https://seafile.example.com', api_token: TOKEN, ...config }),
  );
  return { gladys, fake, service, changes, advance: (ms) => (time += ms) };
}

test('a reading publishes devices, states and a connected status', async () => {
  const { gladys, service, changes } = setup({ config: { library_devices: true } });
  const { snapshot, error } = await service.refresh();
  assert.equal(error, null);
  assert.equal(snapshot.account.email, 'alice@example.com');
  assert.equal(gladys.fake.discoveredDevices.length, 3);
  const online = serverExternalIds(gladys, SERVER_ID).feature('online');
  assert.equal(gladys.fake.lastState(online), 1);
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  assert.equal(changes.length, 1, 'the widget is nudged');
});

test('the devices are published again only when their list changes', async () => {
  const { gladys, fake, service } = setup();
  await service.refresh();
  await service.refresh();
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, 1);
  fake.state.isStaff = true;
  await service.refresh();
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, 2);
  const features = gladys.fake.discoveredDevices[0].features.map((f) => f.external_id);
  assert.ok(features.some((id) => id.endsWith(':users')));
});

test('unchanged values are not published twice', async () => {
  const { gladys, service } = setup();
  await service.refresh();
  const first = gladys.fake.states.length;
  await service.refresh();
  assert.equal(gladys.fake.states.length, first);
});

test('concurrent refreshes share one reading', async () => {
  const { fake, service } = setup();
  await Promise.all([service.refresh(), service.refresh(), service.refresh()]);
  assert.equal(fake.requests.filter((r) => r.path === '/api2/account/info/').length, 1);
});

test('an outage: retried once, offline state, one event, an explaining status', async () => {
  const { gladys, fake, service, advance } = setup();
  await service.refresh();
  fake.state.down = true;
  const before = fake.requests.length;
  const { error } = await service.refresh();
  assert.equal(error.kind, 'UNREACHABLE');
  assert.equal(fake.requests.length - before, 2, 'one more try before the outage counts');
  const online = serverExternalIds(gladys, SERVER_ID).feature('online');
  assert.equal(gladys.fake.lastState(online), 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  for (const language of ['en', 'fr', 'de', 'es']) {
    assert.ok(gladys.fake.connectionStatus.message[language].includes('seafile.example.com'));
  }
  await service.refresh();
  const unreachable = gladys.fake.sceneEvents.filter(
    (event) => event.key === SCENE_TRIGGERS.SERVER_UNREACHABLE,
  );
  assert.equal(unreachable.length, 1, 'one event per outage');
  assert.equal(unreachable[0].data.reason, 'UNREACHABLE');

  advance(10 * 60_000);
  fake.state.down = false;
  await service.refresh();
  const back = gladys.fake.sceneEvents.find(
    (event) => event.key === SCENE_TRIGGERS.SERVER_BACK_ONLINE,
  );
  assert.equal(back.data.offline_minutes, 10);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a refused token is not retried and says what to check', async () => {
  const { gladys, fake, service } = setup({ config: { api_token: 'wrong' } });
  const { error } = await service.refresh();
  assert.equal(error.kind, 'AUTH');
  assert.equal(fake.requests.filter((r) => r.path === '/api2/account/info/').length, 1);
  assert.match(gladys.fake.connectionStatus.message.en, /API token/);
});

test('an incomplete config publishes no device and says what is missing', async () => {
  const gladys = createFakeGladys();
  const service = new SeafileService({ gladys, transport: createFakeSeafile().transport });
  assert.equal(
    service.configure(normalizeConfig({ server_url: 'https://s.example' })),
    'credentials',
  );
  await service.announce();
  assert.deepEqual(gladys.fake.discoveredDevices, []);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /jeton/);
  const { snapshot } = await service.refresh();
  assert.equal(snapshot, null);
});

test('another server forgets the last reading; new credentials keep it', async () => {
  const { service } = setup();
  await service.refresh();
  service.configure(
    normalizeConfig({ server_url: 'http://seafile.example.com', api_token: TOKEN }),
  );
  assert.ok(service.snapshot, 'same host: same server');
  service.configure(normalizeConfig({ server_url: 'https://other.example', api_token: TOKEN }));
  assert.equal(service.snapshot, null);
});

test('readLibrary reads one library now, null when it is gone', async () => {
  const { service } = setup();
  const library = await service.readLibrary('lib-photos');
  assert.equal(library.name, 'Photos');
  assert.equal(library.fileCount, 1200);
  assert.equal(await service.readLibrary('missing'), null);
});
