import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SeafileClient } from '../src/seafile/client.js';
import {
  readAccount,
  readLibraries,
  readSnapshot,
  selectDeviceLibraries,
  toGigabytes,
} from '../src/seafile/snapshot.js';
import { TOKEN, createFakeSeafile } from './helpers/fakeSeafile.js';

const clientOf = (fake) =>
  new SeafileClient({
    url: 'https://seafile.example.com',
    token: TOKEN,
    transport: fake.transport,
  });

test('sizes are published in decimal gigabytes, two decimals', () => {
  assert.equal(toGigabytes(42_123_456_789), 42.12);
  assert.equal(toGigabytes(0), 0);
  assert.equal(toGigabytes(-1), null);
  assert.equal(toGigabytes('x'), null);
});

test('a negative total means an unlimited quota: no percentage', () => {
  const account = readAccount({ email: 'a', usage: 5, total: -2 });
  assert.equal(account.unlimited, true);
  assert.equal(account.total, null);
  assert.equal(account.quotaPercent, null);
  assert.equal(readAccount({ usage: 25, total: 100 }).quotaPercent, 25);
  assert.equal(readAccount({ usage: 250, total: 100 }).quotaPercent, 100);
});

test('a library seen twice is listed once, as the most direct type, largest first', () => {
  const libraries = readLibraries([
    { id: 'x', name: 'X', type: 'grepo', size: 1 },
    { id: 'x', name: 'X', type: 'srepo', size: 1 },
    { id: 'y', name: 'Y', type: 'repo', size: 5 },
    { name: 'no id' },
  ]);
  assert.deepEqual(
    libraries.map((library) => [library.id, library.type]),
    [
      ['y', 'repo'],
      ['x', 'srepo'],
    ],
  );
});

test('only owned, non-virtual libraries become devices, filtered by name', () => {
  const libraries = readLibraries([
    { id: 'a', name: 'Photos', type: 'repo', size: 1 },
    { id: 'b', name: 'Sub', type: 'repo', size: 1, virtual: true },
    { id: 'c', name: 'Team', type: 'grepo', size: 1 },
    { id: 'd', name: 'Documents', type: 'repo', size: 1 },
  ]);
  assert.deepEqual(
    selectDeviceLibraries(libraries, [])
      .map((library) => library.id)
      .sort(),
    ['a', 'd'],
  );
  assert.deepEqual(
    selectDeviceLibraries(libraries, ['photos']).map((library) => library.id),
    ['a'],
  );
});

test('a snapshot gathers server, account and libraries; file counts only for devices', async () => {
  const fake = createFakeSeafile();
  const snapshot = await readSnapshot(clientOf(fake), {
    libraryDevices: true,
    libraryNames: [],
    now: () => 1234,
  });
  assert.equal(snapshot.at, 1234);
  assert.equal(snapshot.server.version, '13.0.5');
  assert.equal(snapshot.server.edition, 'community');
  assert.equal(snapshot.server.id, 'seafile.example.com');
  assert.equal(snapshot.account.quotaPercent, 42);
  assert.equal(snapshot.libraries.length, 3);
  assert.deepEqual(
    snapshot.deviceLibraries.map((library) => [library.name, library.fileCount]),
    [
      ['Photos', 1200],
      ['Documents', 340],
    ],
  );
  assert.equal(snapshot.admin, null, 'not a staff account: no admin call');
  assert.ok(!fake.requests.some((request) => request.path.includes('/admin/')));
});

test('a staff account adds the server statistics; a forbidden one degrades', async () => {
  const fake = createFakeSeafile({ isStaff: true, features: ['seafile-pro'] });
  const snapshot = await readSnapshot(clientOf(fake), { libraryDevices: false, libraryNames: [] });
  assert.equal(snapshot.server.edition, 'pro');
  assert.deepEqual(snapshot.admin, {
    users: 12,
    activeUsers: 5,
    libraries: 40,
    files: 123456,
    storage: 512_000_000_000,
    connectedDevices: 7,
  });
  assert.deepEqual(snapshot.deviceLibraries, []);

  fake.state.adminForbidden = true;
  const degraded = await readSnapshot(clientOf(fake), { libraryDevices: false, libraryNames: [] });
  assert.equal(degraded.admin, null);
});
