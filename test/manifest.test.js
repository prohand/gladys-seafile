// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store indexer validates the manifest, but it cannot know which handlers
// the code registers: these tests keep both sides in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, LIMITS } from '../src/config.js';
import { ACTIONS } from '../src/actions.js';
import { FIRED_SCENE_TRIGGERS, SCENE_ACTIONS } from '../src/capabilities/scenes.js';
import { WIDGETS } from '../src/capabilities/widget.js';
import { LANGUAGES } from '../src/i18n.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

// The store vocabulary of the catalog shelves.
const CATEGORIES = [
  'climate',
  'lighting',
  'energy',
  'security',
  'multimedia',
  'appliances',
  'environment',
  'protocols',
  'network',
  'notifications',
  'assistants',
  'services',
];

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

/** Every multi-language object of the manifest, with where it is. */
function textObjects(node, path = '') {
  const found = [];
  if (Array.isArray(node)) {
    node.forEach((item, index) => found.push(...textObjects(item, `${path}[${index}]`)));
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (['label', 'description', 'placeholder'].includes(key)) {
        found.push({ path: `${path}.${key}`, value });
      } else {
        found.push(...textObjects(value, `${path}.${key}`));
      }
    }
  }
  return found;
}

test('every text of the manifest is written in English, French, German and Spanish', () => {
  const texts = textObjects(manifest);
  assert.ok(texts.length > 50);
  for (const { path, value } of texts) {
    assert.equal(typeof value, 'object', `${path} must be a multi-language object`);
    for (const language of LANGUAGES) {
      assert.ok(
        typeof value[language] === 'string' && value[language].trim(),
        `${path}.${language} is missing`,
      );
    }
  }
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [language, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${language} has ${text.length} characters`,
    );
  }
});

test('the integration talks to the server over the local network only', () => {
  assert.deepEqual(manifest.transports, ['local']);
});

test('categories are 1 to 3 known shelves, and need Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const category of manifest.categories) {
    assert.ok(CATEGORIES.includes(category), `unknown category ${category}`);
  }
  assert.ok(isAtLeast(minGladysVersion(), [4, 86, 0]));
});

test('scene triggers, scene actions and widgets require Gladys >= 5.1.0 (5.3.0 declared)', () => {
  for (const field of ['scene_triggers', 'scene_actions', 'widgets']) {
    assert.ok(manifest[field]?.length > 0, `${field} declared`);
  }
  assert.ok(isAtLeast(minGladysVersion(), [5, 3, 0]));
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.keys(ACTIONS).sort());
});

test('every scene_actions key has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
});

test('every widget has a content handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.keys(WIDGETS).sort());
  assert.ok(manifest.widgets.length <= 5);
});

test('every trigger the code fires is declared, and every declared one is fired', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), [...FIRED_SCENE_TRIGGERS].sort());
});

test('config_schema defaults and bounds match the code', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `${field.key} has a default in DEFAULT_CONFIG`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `${field.key} default`);
    }
    if (LIMITS[field.key]) {
      assert.equal(field.min, LIMITS[field.key].min, `${field.key} min`);
      assert.equal(field.max, LIMITS[field.key].max, `${field.key} max`);
    }
  }
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    assert.ok(keysOf(manifest.config_schema).includes(key), `${key} is in the config_schema`);
  }
});

test('secrets are secret fields', () => {
  const types = Object.fromEntries(manifest.config_schema.map((field) => [field.key, field.type]));
  assert.equal(types.api_token, 'secret');
  assert.equal(types.password, 'secret');
});

test('section fields are purely presentational, with https links', () => {
  const sections = manifest.config_schema.filter((field) => field.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamic = allFields.filter((field) => field.source !== undefined);
  assert.ok(dynamic.length > 0);
  for (const field of dynamic) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined);
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-seafile:${manifest.version}`);
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/prohand\/gladys-seafile\//,
  );
});

test('scene action timeouts stay within the core bounds', () => {
  for (const action of manifest.scene_actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
  }
});
