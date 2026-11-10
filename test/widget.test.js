import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { SeafileService } from '../src/service.js';
import {
  SEAFILE_WIDGET,
  WIDGETS,
  WIDGET_ACTIONS,
  refreshWidgets,
} from '../src/capabilities/widget.js';
import { TOKEN, createFakeSeafile } from './helpers/fakeSeafile.js';

const widget = WIDGETS[SEAFILE_WIDGET];

function setup(seafile, config = { server_url: 'https://seafile.example.com', api_token: TOKEN }) {
  const gladys = createFakeGladys();
  const fake = createFakeSeafile(seafile);
  const service = new SeafileService({ gladys, transport: fake.transport, sleep: async () => {} });
  service.configure(normalizeConfig(config));
  return { gladys, fake, service };
}

const get = (service, settings = {}) =>
  widget.get(service, { settings, language: 'en', units: 'metric' });

test('every state of the widget is rendered exactly as sent', async () => {
  const unconfigured = setup(undefined, {});
  assert.deepEqual(validateWidgetContent(await get(unconfigured.service)), []);

  const { fake, service } = setup({ isStaff: true });
  assert.deepEqual(validateWidgetContent(await get(service)), [], 'before the first reading');
  await service.refresh();
  const content = await get(service);
  assert.deepEqual(validateWidgetContent(content), []);
  assert.ok(content.components.some((component) => component.type === 'gauge'));
  assert.ok(content.components.some((component) => component.type === 'card-list'));

  fake.state.down = true;
  await service.refresh();
  assert.deepEqual(validateWidgetContent(await get(service)), [], 'unreachable');

  const unlimited = setup({ total: -2 });
  await unlimited.service.refresh();
  const noQuota = await get(unlimited.service, { libraries: 0 });
  assert.deepEqual(validateWidgetContent(noQuota), []);
  assert.ok(!noQuota.components.some((component) => component.type === 'gauge'));
  assert.ok(!noQuota.components.some((component) => component.type === 'card-list'));
});

test('the library list follows the setting, largest first', async () => {
  const { service } = setup();
  await service.refresh();
  const list = (await get(service, { libraries: 2 })).components.find(
    (c) => c.type === 'card-list',
  );
  assert.deepEqual(
    list.items.map((item) => item.title),
    ['Photos', 'Team'],
  );
});

test('every text of the content has the four languages', async () => {
  const { service } = setup();
  await service.refresh();
  const texts = [];
  JSON.stringify(await get(service), (key, value) => {
    if (value && typeof value === 'object' && 'en' in value) {
      texts.push(value);
    }
    return value;
  });
  assert.ok(texts.length > 0);
  for (const text of texts) {
    assert.deepEqual(Object.keys(text).sort(), ['de', 'en', 'es', 'fr']);
  }
});

test('the refresh button reads the server and answers a short toast', async () => {
  const { fake, service } = setup();
  const toast = await widget.action(service, { actionKey: WIDGET_ACTIONS.REFRESH, params: {} });
  assert.ok(toast.en.length <= 200);
  assert.ok(fake.requests.some((request) => request.path === '/api2/account/info/'));
  fake.state.down = true;
  const failed = await widget.action(service, { actionKey: WIDGET_ACTIONS.REFRESH, params: {} });
  assert.match(failed.en, /Cannot reach/);
  assert.ok(failed.de.length <= 200);
});

test('an unknown widget action fails, so the user sees the error', async () => {
  const { service } = setup();
  await assert.rejects(widget.action(service, { actionKey: 'nope', params: {} }), /Unknown widget/);
});

test('refreshWidgets nudges every widget', () => {
  const gladys = createFakeGladys();
  refreshWidgets(gladys);
  assert.deepEqual(gladys.fake.widgetRefreshes, Object.keys(WIDGETS));
});
