import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { SeafileService } from '../src/service.js';
import {
  FIRED_SCENE_TRIGGERS,
  MAX_LIBRARY_EVENTS_PER_READING,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  SceneEventTracker,
  libraryIdOf,
} from '../src/capabilities/scenes.js';
import { libraryExternalIds } from '../src/devices/library.js';
import { TOKEN, createFakeSeafile } from './helpers/fakeSeafile.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const declarationOf = (list, key) => manifest[list].find((entry) => entry.key === key);

function setup(seafile, config) {
  const gladys = createFakeGladys();
  const fake = createFakeSeafile(seafile);
  const service = new SeafileService({ gladys, transport: fake.transport, sleep: async () => {} });
  service.configure(
    normalizeConfig({ server_url: 'https://seafile.example.com', api_token: TOKEN, ...config }),
  );
  return { gladys, fake, service };
}

const eventsOf = (gladys, key) => gladys.fake.sceneEvents.filter((event) => event.key === key);

test('the first reading is a reference: no event', async () => {
  const { gladys, service } = setup({ usage: 95_000_000_000 });
  await service.refresh();
  assert.deepEqual(gladys.fake.sceneEvents, []);
});

test('the quota alert fires once on the way up, and re-arms below the margin', async () => {
  const { gladys, fake, service } = setup({ usage: 80_000_000_000 });
  await service.refresh();
  fake.state.usage = 91_000_000_000;
  await service.refresh();
  fake.state.usage = 93_000_000_000;
  await service.refresh();
  assert.equal(eventsOf(gladys, SCENE_TRIGGERS.QUOTA_THRESHOLD_CROSSED).length, 1);
  const [{ data }] = eventsOf(gladys, SCENE_TRIGGERS.QUOTA_THRESHOLD_CROSSED);
  assert.equal(data.quota_percent, 91);
  assert.equal(data.threshold, 90);
  assert.equal(data.quota_gb, 100);

  fake.state.usage = 89_000_000_000; // under 90, not under 88: still disarmed
  await service.refresh();
  fake.state.usage = 92_000_000_000;
  await service.refresh();
  assert.equal(eventsOf(gladys, SCENE_TRIGGERS.QUOTA_THRESHOLD_CROSSED).length, 1);

  fake.state.usage = 50_000_000_000;
  await service.refresh();
  fake.state.usage = 95_000_000_000;
  await service.refresh();
  assert.equal(eventsOf(gladys, SCENE_TRIGGERS.QUOTA_THRESHOLD_CROSSED).length, 2);
});

test('a changed library fires library_updated with its device; a new one does not', async () => {
  const { gladys, fake, service } = setup();
  await service.refresh();
  fake.state.libraries[0].mtime += 60;
  fake.state.libraries[0].modifier_name = 'Bob';
  fake.state.libraries.push({
    id: 'new',
    name: 'New',
    type: 'repo',
    size: 1,
    mtime: 1_800_000_000,
  });
  await service.refresh();
  const events = eventsOf(gladys, SCENE_TRIGGERS.LIBRARY_UPDATED);
  assert.equal(events.length, 1);
  assert.equal(events[0].data.library_name, 'Photos');
  assert.equal(events[0].data.modifier, 'Bob');
  assert.equal(
    events[0].data.device,
    libraryExternalIds(gladys, 'seafile.example.com', 'lib-photos').device,
  );
  assert.match(events[0].data.modified_at, /^\d{4}-\d\d-\d\dT/);
});

test('a busy server fires a bounded number of library events', () => {
  const gladys = createFakeGladys();
  const tracker = new SceneEventTracker();
  const libraries = (time) =>
    Array.from({ length: 50 }, (_, index) => ({
      id: `l${index}`,
      name: `L${index}`,
      size: 0,
      mtime: time,
    }));
  tracker.observeLibraries(gladys, 's', libraries(1));
  assert.equal(
    tracker.observeLibraries(gladys, 's', libraries(2)).length,
    MAX_LIBRARY_EVENTS_PER_READING,
  );
});

test('an upgrade fires version_changed', async () => {
  const { gladys, fake, service } = setup();
  await service.refresh();
  fake.state.version = '14.0.1';
  await service.refresh();
  const [event] = eventsOf(gladys, SCENE_TRIGGERS.VERSION_CHANGED);
  assert.deepEqual([event.data.previous_version, event.data.version], ['13.0.5', '14.0.1']);
});

test('a server down at the first reading fires no unreachable event', async () => {
  const { gladys, service } = setup({ down: true });
  await service.refresh();
  assert.deepEqual(eventsOf(gladys, SCENE_TRIGGERS.SERVER_UNREACHABLE), []);
});

test('every event carries only declared, primitive keys', async () => {
  const { gladys, fake, service } = setup({ usage: 10 });
  await service.refresh();
  fake.state.usage = 99_000_000_000;
  fake.state.version = '14.0.0';
  fake.state.libraries[1].mtime += 1;
  await service.refresh();
  fake.state.down = true;
  await service.refresh();
  fake.state.down = false;
  await service.refresh();
  const fired = new Set(gladys.fake.sceneEvents.map((event) => event.key));
  assert.deepEqual([...fired].sort(), [...FIRED_SCENE_TRIGGERS].sort(), 'every trigger exercised');
  for (const { key, data } of gladys.fake.sceneEvents) {
    const trigger = declarationOf('scene_triggers', key);
    const declared = [...keysOf(trigger.fields), ...keysOf(trigger.variables)];
    assert.ok(Object.keys(data).length <= 30);
    for (const [name, value] of Object.entries(data)) {
      assert.ok(declared.includes(name), `${key}: data.${name} is not declared`);
      assert.ok(value === null || typeof value !== 'object', `${key}: data.${name} not primitive`);
    }
  }
});

test('refresh_now returns the declared outputs, online false when down', async () => {
  const { fake, service } = setup();
  const outputs = await SCENE_ACTIONS.refresh_now(service, { fields: {} });
  assert.deepEqual(outputs, {
    online: true,
    version: '13.0.5',
    used_gb: 42,
    quota_percent: 42,
    libraries: 3,
  });
  const declared = keysOf(declarationOf('scene_actions', 'refresh_now').outputs);
  for (const key of Object.keys(outputs)) {
    assert.ok(declared.includes(key), `output ${key} is not declared`);
  }
  fake.state.down = true;
  assert.deepEqual(await SCENE_ACTIONS.refresh_now(service, { fields: {} }), { online: false });
});

test('read_library reads the chosen library device, found false otherwise', async () => {
  const { gladys, service } = setup();
  const device = libraryExternalIds(gladys, 'seafile.example.com', 'lib-docs').device;
  const outputs = await SCENE_ACTIONS.read_library(service, { fields: { library: device } });
  assert.deepEqual(outputs, {
    found: true,
    name: 'Documents',
    size_gb: 2.5,
    files: 340,
    modified_at: new Date(1_700_000_100 * 1000).toISOString(),
  });
  const declared = keysOf(declarationOf('scene_actions', 'read_library').outputs);
  for (const key of Object.keys(outputs)) {
    assert.ok(declared.includes(key));
  }
  const missing = libraryExternalIds(gladys, 'seafile.example.com', 'gone').device;
  assert.deepEqual(await SCENE_ACTIONS.read_library(service, { fields: { library: missing } }), {
    found: false,
  });
  assert.deepEqual(
    await SCENE_ACTIONS.read_library(service, { fields: { library: 'ext:x:seafile-server:y' } }),
    { found: false },
  );
});

test('libraryIdOf only accepts a library of this server', () => {
  assert.equal(libraryIdOf('ext:sel:seafile-library:srv:abc-123', 'srv'), 'abc-123');
  assert.equal(libraryIdOf('ext:sel:seafile-library:other:abc', 'srv'), null);
  assert.equal(libraryIdOf(undefined, 'srv'), null);
});
