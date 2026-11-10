import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  missingSetting,
  normalizeConfig,
  parseLibraryNames,
} from '../src/config.js';

test('an empty config gets every default', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('numbers typed as strings are read, and kept within the manifest bounds', () => {
  const config = normalizeConfig({ poll_frequency: '600', quota_alert_percent: '150' });
  assert.equal(config.poll_frequency, 600);
  assert.equal(config.quota_alert_percent, 100);
  assert.equal(normalizeConfig({ poll_frequency: 5 }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: 'abc' }).poll_frequency, 300);
  assert.equal(normalizeConfig({ poll_frequency: '' }).poll_frequency, 300);
});

test('texts are trimmed, the password never', () => {
  const config = normalizeConfig({ server_url: ' https://s.example ', password: ' p w ' });
  assert.equal(config.server_url, 'https://s.example');
  assert.equal(config.password, ' p w ');
});

test('booleans are only true when they are', () => {
  assert.equal(normalizeConfig({ library_devices: 'true' }).library_devices, false);
  assert.equal(normalizeConfig({ library_devices: true }).library_devices, true);
  assert.equal(normalizeConfig({ allow_self_signed: true }).allow_self_signed, true);
});

test('library names: commas or lines, without case', () => {
  assert.deepEqual(parseLibraryNames(' Photos, Documents\nMusic ,, '), [
    'photos',
    'documents',
    'music',
  ]);
  assert.deepEqual(parseLibraryNames(''), []);
});

test('missingSetting names what to fill in first', () => {
  assert.equal(missingSetting(normalizeConfig()), 'server_url');
  assert.equal(missingSetting(normalizeConfig({ server_url: 's' })), 'credentials');
  assert.equal(missingSetting(normalizeConfig({ server_url: 's', username: 'u' })), 'credentials');
  assert.equal(missingSetting(normalizeConfig({ server_url: 's', api_token: 't' })), null);
  assert.equal(
    missingSetting(normalizeConfig({ server_url: 's', username: 'u', password: 'p' })),
    null,
  );
});
