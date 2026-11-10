import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { SeafileService } from '../src/service.js';
import { ACTIONS, ACTION_KEYS } from '../src/actions.js';
import { formatBytes, formatPercent } from '../src/messages.js';
import { LANGUAGES } from '../src/i18n.js';
import { TOKEN, createFakeSeafile } from './helpers/fakeSeafile.js';

function setup(seafile, config = { server_url: 'https://seafile.example.com', api_token: TOKEN }) {
  const gladys = createFakeGladys();
  const fake = createFakeSeafile(seafile);
  const service = new SeafileService({ gladys, transport: fake.transport, sleep: async () => {} });
  service.configure(normalizeConfig(config));
  return { fake, service };
}

const inEveryLanguage = (message) =>
  assert.deepEqual(Object.keys(message).sort(), [...LANGUAGES].sort());

test('test_connection says what was reached, as whom, in four languages', async () => {
  const { service } = setup({ isStaff: true });
  const message = await ACTIONS[ACTION_KEYS.TEST_CONNECTION](service);
  inEveryLanguage(message);
  assert.match(message.en, /Seafile 13\.0\.5 \(Community\) as alice@example\.com/);
  assert.match(message.en, /42 GB of 100 GB used \(42%\)/);
  assert.match(message.fr, /12 utilisateurs/);
  assert.ok(!message.en.includes(TOKEN));
});

test('test_connection explains a failure and a missing setting', async () => {
  const { fake, service } = setup();
  fake.state.down = true;
  const down = await ACTIONS[ACTION_KEYS.TEST_CONNECTION](service);
  inEveryLanguage(down);
  assert.match(down.es, /seafile\.example\.com/);
  const { service: empty } = setup(undefined, {});
  const missing = await ACTIONS[ACTION_KEYS.TEST_CONNECTION](empty);
  inEveryLanguage(missing);
  assert.match(missing.de, /Adresse/);
});

test('list_libraries lists names and sizes, shared ones marked', async () => {
  const { service } = setup();
  const message = await ACTIONS[ACTION_KEYS.LIST_LIBRARIES](service);
  inEveryLanguage(message);
  assert.deepEqual(message.en.split('\n'), [
    'Photos — 30 GB',
    'Team — 9 GB (shared)',
    'Documents — 2.5 GB',
  ]);
  assert.match(message.fr, /Documents — 2,5 GB/);
});

test('sizes and percentages follow the reader number format', () => {
  assert.equal(formatBytes(1_234_567_890, 'en'), '1.2 GB');
  assert.equal(formatBytes(1_234_567_890, 'fr'), '1,2 GB');
  assert.equal(formatBytes(512, 'en'), '512 B');
  assert.equal(formatBytes(-1, 'en'), '–');
  assert.equal(formatPercent(42.5, 'en'), '42.5%');
  assert.equal(formatPercent(42.5, 'de'), '42,5 %');
});
