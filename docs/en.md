# Seafile

This integration connects Gladys to your **Seafile** server (Community or Professional edition):
how much storage your account uses, its quota, its libraries, the server-wide statistics when the
account is a system admin, and whether the server answers at all.

It only reads: nothing is ever written, moved or deleted on your server.

## Before you start

**Gladys 5.3 or newer** is required.

Gladys must be able to reach your Seafile server over the network, at the address you open it at
in a browser (for example `https://seafile.example.com` or `http://192.168.1.20:8000`).

The integration signs in as one Seafile account. A normal account is enough; a **system admin**
account also brings the statistics of the whole server (users, files, storage).

### The recommended way: an API token

1. Open Seafile in a browser and sign in with the account Gladys should use.
2. Click your avatar (top right), then **Settings**.
3. In **Web API Auth Token**, click **Generate** and copy the token.
4. Paste it in the **API token** field of the integration.

An API token also works when the account uses two-factor authentication. To cut Gladys off, delete
the token in the same place.

### The other way: a username and a password

Leave the API token empty and fill in **Username** (the email or login ID of the account) and
**Password**. The integration exchanges them for a token, which shows in Seafile under
**Settings → Linked devices** as **Gladys Assistant**: delete it there to cut Gladys off. The token
is kept in memory only, and a new sign-in reuses the same linked device.

This does not work with two-factor authentication: use an API token for such an account.

## Configuration

| Field                            | What to put there                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Server address                   | The address you open Seafile at. Without `http://` or `https://`, https is assumed.                  |
| API token                        | Recommended, see above. It wins over the username and password.                                      |
| Username / Password              | Only without an API token.                                                                           |
| Accept a self-signed certificate | Only if your server uses https with a certificate it signed itself.                                  |
| Refresh interval (s)             | How often the server is read, 60 to 3600 seconds (default 300).                                      |
| Quota alert threshold (%)        | The level that fires the **Quota threshold crossed** scene trigger (default 90).                     |
| Libraries as devices             | Also publish one device per library the account owns.                                                |
| Library names                    | Only these libraries become devices, separated by commas (case does not matter). Empty: all of them. |

Then click **Test the connection**: the answer names the Seafile version, the account, the storage
used and the number of libraries. **List the libraries** shows the names to copy into **Library
names**.

## Devices

Open **Integrations → Seafile → Devices**, then create the devices you want to keep.

### Seafile server

| Feature               | Value                                                               |
| --------------------- | ------------------------------------------------------------------- |
| Online                | 1 when the server answered the last reading, 0 otherwise            |
| Seafile version       | e.g. `13.0.5`                                                       |
| Storage used          | used by the account, in GB                                          |
| Quota                 | quota of the account, in GB — only when the account has a quota     |
| Quota used            | in %, only when the account has a quota                             |
| Libraries             | libraries the account sees (its own, shared with it, of its groups) |
| Users                 | system admin only: accounts on the server                           |
| Active users          | system admin only                                                   |
| Files on the server   | system admin only                                                   |
| Storage of the server | system admin only, in GB                                            |
| Connected clients     | system admin only: desktop and mobile clients connected             |

The quota and admin features appear the first time the server reports them: the device is then
published again, with the new features, and you can update it in Gladys.

### Seafile libraries

With **Libraries as devices** on, every library the **account owns** becomes a device (the ones
shared with it do not), or only the ones listed in **Library names**:

| Feature | Value           |
| ------- | --------------- |
| Size    | in GB           |
| Files   | number of files |

Renaming a library in Seafile keeps its device: devices follow the library's id, not its name.

## Actions

- **Test the connection** — reads the server now and says what was found.
- **List the libraries** — the libraries the account sees, the largest first, with their size;
  the shared ones are marked.

## Scenes and dashboard (Gladys 5.1+)

### Scene triggers

| Trigger                           | When                                                              | Variables                                                     |
| --------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------- |
| The Seafile server is unreachable | it stops answering, or refuses the credentials — once per outage  | server name, server address, reason (code)                    |
| The Seafile server is back online | it answers again after an outage                                  | server name, server address, minutes offline                  |
| Quota threshold crossed           | the account goes over the alert threshold of its quota            | server name, quota used (%), threshold, used (GB), quota (GB) |
| A library changed                 | a file was added, edited or removed in a library the account sees | library name, changed by, size (GB), changed at               |
| The Seafile version changed       | the server was upgraded (or downgraded)                           | server name, previous version, new version                    |

Every trigger can be limited to one device: the server, or — for **A library changed** — one
library device.

Good to know:

- The first reading after Gladys or the integration starts is only a reference: it fires nothing,
  so a restart never announces a full quota or every library again.
- A server already down when the integration starts fires no **unreachable** event (it was never
  seen up).
- A failed reading is tried once more five seconds later before it counts as an outage.
- The quota alert fires once on the way up, and fires again only after the usage went at least two
  points under the threshold.
- The reason code of **unreachable** is one of `UNREACHABLE`, `TIMEOUT`, `TLS`, `AUTH`,
  `OTP_REQUIRED`, `PERMISSION`, `NOT_FOUND`, `HTTP`, `BAD_RESPONSE`.
- **A library changed** is detected between two readings: with a 5-minute interval, several
  changes in the same five minutes fire one event.

### Scene actions

- **Read the Seafile server now** — refreshes every device now. Outputs: server online (yes/no),
  version, used (GB), quota used (%, −1 without quota), libraries.
- **Read a Seafile library** — pick a library device; outputs: library found (yes/no), name,
  size (GB), files, last change.

A server that does not answer is an output (`online` = no), not a failed action: test it in a
condition after the action.

### The "Seafile" widget

Add the **Seafile** widget to a dashboard. It shows the quota gauge (when the account has a
quota), the storage used, the number of libraries, the users (system admin), the largest
libraries, the server status, its version and the account, and a **Read now** button. Its
setting **Libraries shown** (0 to 8, default 5) sets the length of the list.

## Good to know

- Sizes are in decimal gigabytes (1 GB = 1,000,000,000 bytes), like Seafile shows them.
- The server is identified by its host (and port, and path): moving from `http://` to `https://`
  keeps the devices, a new host name creates new ones.
- Nothing is stored on disk: the token obtained from a password lives in memory.

## Troubleshooting

| Message                                     | What to do                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Cannot reach …                              | Check the address, the port, and that Gladys can reach the server (same network, firewall).    |
| … did not answer in time                    | The server is overloaded or down; check it in a browser.                                       |
| The certificate of … was refused            | A self-signed certificate: turn on **Accept a self-signed certificate**.                       |
| The server refused the credentials          | Generate a new API token, or check the username and password.                                  |
| This account uses two-factor authentication | Use an API token instead of the password.                                                      |
| … answered, but not like a Seafile server   | The address points to another site (a reverse proxy page, a login portal): fix the address.    |
| No server statistics with an admin account  | The account must be a **system** admin with the right to view system info (Seafile Pro roles). |
