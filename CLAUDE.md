# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) for a **Seafile** server (Community or
Professional edition): the storage and quota of an account, its libraries, and the server-wide
statistics when the account is a system admin. Requires Gladys 5.3+. Scene triggers (server
unreachable / back online, quota threshold crossed, library changed, version changed), scene
actions (read the server now, read a library) and a "Seafile" widget.

Local only (manifest `transports: ["local"]`): the integration talks to the server the user
points it at, never to a cloud. It only reads: nothing is ever written on the server.

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/service.test.js            # one file
node --test --test-name-pattern "quota"     # one test by name
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store --skip-image-check .   # store admission checks
```

CI runs `format:check`, `lint`, `test` on Node 22 and 24, the store checks and a Docker build on
pull requests. Releases: **Actions → Release** only (bumps `package.json`, manifest `version` +
`docker_image`, rolls `CHANGELOG.md`, re-runs Prettier, tags, builds, publishes the GitHub Release).

## Architecture

```
index.js                   SDK bootstrap + wiring (no Seafile logic): handlers, poll gate
src/config.js              DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/i18n.js                the four languages, `localize` / `pick`
src/messages.js            runtime texts: connection status, action answers, error reasons
src/service.js             one server: client, last reading, serialized refresh, publishing
src/actions.js             manifest `actions`: test_connection, list_libraries
src/seafile/client.js      Web API client (node:http/https), token exchange, error kinds
src/seafile/snapshot.js    one reading of the server, normalized (GB, quota %, dedup)
src/devices/server.js      "Seafile server" device: features + states
src/devices/library.js     "Seafile library" devices (opt-in)
src/devices/index.js       discovery list, states, discovery signature, poll gate
src/capabilities/scenes.js scene triggers (SceneEventTracker) + scene actions
src/capabilities/widget.js the "seafile" dashboard widget
```

### Invariants worth knowing

- **Read-only endpoints only** (plus `POST api2/auth-token/`): `api2/ping/`, `api2/server-info/`,
  `api2/auth/ping/`, `api2/account/info/`, `api2/repos/`, `api2/repos/<id>/`,
  `api/v2.1/admin/sysinfo/` (only when `account/info` says `is_staff`; a 403 there just leaves
  the admin features out).
- **The token is a secret.** An API token from the config, or a token obtained from the username
  and password and kept in memory only. It goes in the `Authorization` header and nowhere else:
  never in a log line, an error message, a state or an action answer.
- **Password sign-in registers a linked device** (`device_id` = sha1 of server + account, 40 hex
  characters, name "Gladys Assistant"): every restart reuses the same device instead of piling
  new ones up, and the user can revoke it in Seafile. A refused token signs in again once; a
  refused API token does not (the user must fix it). Two-factor accounts need an API token.
- **External ids are forever**: the server is keyed by its host (+ port + path prefix), never the
  scheme (`serverIdOf`); a library by the server and its Seafile id (a UUID that survives a
  rename). Feature, action, trigger, scene action and widget keys are stored by users: never
  renamed.
- **One reading feeds everything.** Only the server device is polled (once a minute, the
  configured interval applied by `createPollGate`); a reading publishes the states of the server
  and the library devices with `publishChangedStates` (30-minute heartbeat), republishes the
  devices only when their list changed (an admin account, a quota set, a new library), fires the
  scene events, reports the connection status and nudges the widget.
- **Refreshes are serialized**: the poll, the buttons, the scene action and the widget share the
  reading in progress.
- **An outage is retried once** (5 s) before it counts: one warning per outage, the repeats in
  debug, one `server_unreachable` event, `online = 0` published.
- **Scene events, one per transition**: the first reading after a start is a reference (no
  event); the quota alert re-arms only 2 points under the threshold; at most 20 library events
  per reading; a server down at the first reading fires nothing.
- **Polling**: Gladys `poll_frequency` is an enum in ms (1000, 2000, 10000, 15000, 30000,
  60000); any other value rejects the WHOLE discovery batch. `should_poll: true` stays published
  for cores older than 5.3. The configured `poll_frequency` is in seconds and is never published
  as is.
- **Every feature declares `min`/`max`** (NOT NULL in Gladys). Sizes are decimal GB (`1e9`), two
  decimals, like Seafile shows them.
- The rootfs is read-only and nothing is written: the session token lives in memory.

### Manifest

`test/manifest.test.js` keeps `gladys-assistant-integration.json` (config schema and its
defaults/bounds, actions, scene triggers and actions, widget, four languages everywhere,
`transports`, categories, `gladys_version >=5.3.0`, version/image coupling) in sync with the code.

## Testing

No network: `test/helpers/fakeSeafile.js` is a fake Seafile server plugged in as the client's
transport (the routes above, tokens, two-factor, 401/403/404, outages), and the SDK's
`createFakeGladys()` stands in for Gladys and refuses what the host API refuses. One test drives
the real `node:http` transport against a loopback server.

## Conventions

Prettier formats, ESLint catches mistakes. Comments explain **why**, in English. User-facing text
is `{ en, fr, de, es }` (built with `src/i18n.js`); user docs in `docs/en.md`, `docs/fr.md`,
`docs/de.md` and `docs/es.md`, kept in sync. Every user-visible change adds a line under
`## [Unreleased]` in `CHANGELOG.md`; never write a version heading, the Release workflow does.
Never edit `version` or the `docker_image` tag by hand.
