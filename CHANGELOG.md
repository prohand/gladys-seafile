# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

### Added

- First version of the Seafile integration: reads a Seafile server over the local network,
  with an API token or a username and password (exchanged for a token shown in Seafile as the
  linked device "Gladys Assistant").
- "Seafile server" device: online, Seafile version, storage used, quota and quota used (when the
  account has a quota), libraries, and the server statistics (users, active users, files, storage,
  connected clients) when the account is a system admin.
- Optional "Seafile library" devices: size and number of files of the libraries the account owns,
  all of them or the ones named in the configuration.
- Scene triggers: server unreachable, server back online, quota threshold crossed, library
  changed, Seafile version changed.
- Scene actions: read the Seafile server now, read a Seafile library.
- "Seafile" dashboard widget: quota gauge, storage, libraries, the largest libraries, server status
  and a "Read now" button.
- "Test the connection" and "List the libraries" buttons in the configuration screen.
- Accept a self-signed certificate (opt-in).
- English, French, German and Spanish: configuration screen, messages, widget and documentation.

[Unreleased]: https://github.com/prohand/gladys-seafile/commits/main
