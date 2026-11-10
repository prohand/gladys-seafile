import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const REPO = 'https://github.com/prohand/gladys-seafile';

test('the first release moves Unreleased under the version and links its tag', () => {
  const text = `# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Everything.\n\n[Unreleased]: ${REPO}/commits/main\n`;
  const rolled = rollChangelog(text, '1.0.1', '2026-11-12');
  assert.match(
    rolled,
    /## \[Unreleased\]\n\n## \[1\.0\.1\] - 2026-11-12\n\n### Added\n\n- Everything\./,
  );
  assert.match(rolled, new RegExp(`\\[Unreleased\\]: ${REPO}/compare/v1\\.0\\.1\\.\\.\\.HEAD`));
  assert.match(rolled, new RegExp(`\\[1\\.0\\.1\\]: ${REPO}/releases/tag/v1\\.0\\.1`));
});

test('an empty Unreleased section still names the release', () => {
  const text = `## [Unreleased]\n\n## [1.0.1] - 2026-11-12\n\n- x\n\n[Unreleased]: ${REPO}/compare/v1.0.1...HEAD\n`;
  const rolled = rollChangelog(text, '1.0.2', '2026-11-20');
  assert.match(rolled, /## \[1\.0\.2\] - 2026-11-20\n\n- Maintenance release/);
  assert.match(
    rolled,
    new RegExp(`\\[1\\.0\\.2\\]: ${REPO}/compare/v1\\.0\\.1\\.\\.\\.v1\\.0\\.2`),
  );
});

test('the repository changelog has an Unreleased section the workflow can roll', async () => {
  const text = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(text, /^## \[Unreleased\]$/m);
  assert.match(text, new RegExp(`^\\[Unreleased\\]: ${REPO}/commits/main$`, 'm'));
  assert.notEqual(rollChangelog(text, '1.0.1', '2026-11-12'), text);
});
