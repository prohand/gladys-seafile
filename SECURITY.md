# Security policy

## Supported versions

Only the latest release of the Seafile integration receives security fixes.
Update the integration from the Gladys store before reporting an issue.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-seafile](https://github.com/prohand/gladys-seafile/security), then
**Report a vulnerability**.

Include, when you can:

- the version of the integration, of Gladys and of Seafile;
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove tokens, passwords and addresses first).

You should get a first answer within 7 days. A fix is released as a new version of
the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (report to
[GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security)), Seafile
itself (report to [haiwen/seafile](https://github.com/haiwen/seafile)) and the
third-party services and APIs this integration talks to.

## Good practices for users

- Keep secrets (API token, password) only in the integration's secret fields.
- Prefer an API token to a password; with a password, the integration's token shows in Seafile
  under **Settings → Linked devices** as "Gladys Assistant" and can be revoked there.
- Use an account with the least privileges it needs: a normal account is enough; a system admin
  account only adds the server-wide statistics.
- Keep Gladys, Seafile and the integration up to date.
