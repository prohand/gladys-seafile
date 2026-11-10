# Seafile — Gladys Assistant integration

External integration connecting [Gladys Assistant](https://gladysassistant.com) to a
**[Seafile](https://www.seafile.com)** server (Community or Professional edition): the storage
and quota of an account, its libraries, the server-wide statistics for a system admin, and the
availability of the server.

Built on the official
[JavaScript integration template](https://github.com/GladysAssistant/integration-template-js)
and the SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).
Requires **Gladys 5.3.0 or later**.

User documentation: [English](./docs/en.md) · [Français](./docs/fr.md) · [Deutsch](./docs/de.md) ·
[Español](./docs/es.md).

## What it does

| Device                   | Gladys features                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| Seafile server           | Online, Seafile version, storage used, libraries                                             |
| … with a quota           | **+** quota (GB), quota used (%)                                                             |
| … with a system admin    | **+** users, active users, files, storage of the server, connected clients                   |
| Seafile library (opt-in) | Size (GB), files — one device per library the account owns, all of them or the ones you name |

Since Gladys 5.1 it also extends the scene editor and the dashboard (`src/capabilities/`):

- **scene triggers** — the server is unreachable, it is back online (with the minutes offline),
  the quota threshold is crossed, a library changed (by whom, when), the Seafile version changed;
- **scene actions** — read the Seafile server now (online, version, used GB, quota %, libraries
  as outputs), read a Seafile library (size, files, last change);
- **a "Seafile" widget** — quota gauge, storage and library tiles, the largest libraries, the
  server status and a **Read now** button.

Everything is read-only: the integration never writes on the server.

## How it talks to the server

One transport, declared in the manifest: **local** — the
[Seafile Web API](https://seafile-api.readme.io/) of the server you point it at, over HTTP(S),
from Node's own `node:http` / `node:https` (no dependency; an opt-in switch accepts a self-signed
certificate for that one server).

| Call                          | What for                                                      |
| ----------------------------- | ------------------------------------------------------------- |
| `GET api2/server-info/`       | version and edition (anonymous)                               |
| `POST api2/auth-token/`       | username + password → token (only without an API token)       |
| `GET api2/account/info/`      | usage, quota, `is_staff`                                      |
| `GET api2/repos/`             | the libraries the account sees, with their size               |
| `GET api2/repos/<id>/`        | file count of the libraries shown as devices                  |
| `GET api/v2.1/admin/sysinfo/` | server statistics, system admin accounts only (403 tolerated) |

Authentication is `Authorization: Token <token>`. The recommended way is an **API token**
(Seafile → Settings → Web API Auth Token): it works with two-factor authentication. A username and
password are exchanged for a token registered as the linked device **Gladys Assistant**, which
the user can revoke from Seafile; that token lives in memory only.

## Project structure

```
.
├─ index.js                          # SDK bootstrap + wiring (no Seafile logic)
├─ src/
│  ├─ config.js                      # defaults (= manifest) + normalization
│  ├─ i18n.js                        # en / fr / de / es helpers
│  ├─ messages.js                    # connection status, action answers, error reasons
│  ├─ service.js                     # one server: client, last reading, refresh, publishing
│  ├─ actions.js                     # "Test the connection", "List the libraries"
│  ├─ seafile/
│  │  ├─ client.js                   # Web API client, token exchange, error kinds
│  │  └─ snapshot.js                 # one reading, normalized
│  ├─ devices/
│  │  ├─ server.js                   # "Seafile server" device
│  │  ├─ library.js                  # "Seafile library" devices
│  │  └─ index.js                    # discovery, states, poll gate
│  └─ capabilities/
│     ├─ scenes.js                   # scene triggers + scene actions
│     └─ widget.js                   # "Seafile" dashboard widget
├─ docs/{en,fr,de,es}.md             # user documentation (re-hosted by Gladys)
├─ test/                             # node --test, fake Seafile + fake Gladys, no network
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
├─ CHANGELOG.md                      # Keep a Changelog, rolled by the Release workflow
├─ CLAUDE.md                         # project rules for coding assistants & contributors
├─ SECURITY.md                       # how to report a vulnerability privately
├─ .github/workflows/                # ci, build, release, github-release
├─ .github/scripts/changelog-release.mjs
├─ .github/dependabot.yml
└─ cover.png                         # catalog cover, 800×534 px
```

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="seafile" \
LOG_LEVEL=debug \
npm start
```

The three `GLADYS_*` variables are injected by the Gladys supervisor when the integration runs
inside its sandboxed container. The SDK reads them itself.

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test: fake Seafile server + the SDK's fake Gladys, no network
npx github:GladysAssistant/integration-store --skip-image-check .   # store admission checks
```

The same checks run on every push and pull request (Node 22 and 24), plus the store checks and a
Docker build on pull requests — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Release

Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md), then open
**Actions → Release → Run workflow** and pick `patch`, `minor` or `major`. The workflow bumps
`package.json`, the manifest `version` and `docker_image`, rolls the changelog, tags, builds the
`linux/amd64` + `linux/arm64` image to `ghcr.io/prohand/gladys-seafile`, publishes the GitHub
Release and runs the store checks against the published image. The repository carries the
`gladys-assistant-integration` topic, so the store indexer picks the new version up.

## Credits

- [Seafile](https://www.seafile.com) by Seafile Ltd. — this project is not affiliated with it.
- The endpoints follow the [Seafile Web API](https://seafile-api.readme.io/) documentation; the
  Home Assistant `seafile` integration (2026.11) and its `aioseafile` library were a useful
  reference for the token exchange and the response fields.

## License

Apache-2.0
