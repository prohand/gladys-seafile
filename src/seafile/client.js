// -----------------------------------------------------------------------------
// Seafile Web API client.
//
// Only documented, read-only endpoints (plus the token exchange):
//
//   GET  api2/ping/              anonymous liveness check ("pong")
//   GET  api2/server-info/       anonymous: version and features (pro edition…)
//   POST api2/auth-token/        username + password -> account token
//   GET  api2/auth/ping/         is the token accepted ("pong")
//   GET  api2/account/info/      usage, quota (negative total = unlimited), is_staff
//   GET  api2/repos/             the libraries the account can see, with size
//   GET  api2/repos/<id>/        one library, with its file count
//   GET  api/v2.1/admin/sysinfo/ server-wide statistics, system admins only
//
// Requests go through node:http / node:https rather than fetch: a home server
// often answers with a self-signed certificate, and only these modules let a
// single request accept one (`allow_self_signed`) without a dependency or a
// process-wide switch.
//
// The token is a secret: it travels in the Authorization header and nowhere
// else — never in a log line, an error message or a state.
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';

/** What went wrong, as a code the rest of the integration (and scenes) can read. */
export const ERROR_KINDS = {
  INVALID_URL: 'INVALID_URL',
  UNREACHABLE: 'UNREACHABLE',
  TIMEOUT: 'TIMEOUT',
  TLS: 'TLS',
  AUTH: 'AUTH',
  OTP_REQUIRED: 'OTP_REQUIRED',
  PERMISSION: 'PERMISSION',
  NOT_FOUND: 'NOT_FOUND',
  HTTP: 'HTTP',
  BAD_RESPONSE: 'BAD_RESPONSE',
};

export class SeafileError extends Error {
  /**
   * @param {string} message never carries a secret
   * @param {object} details
   * @param {string} details.kind one of ERROR_KINDS
   * @param {number} [details.status] HTTP status, when the server answered
   */
  constructor(message, { kind, status } = {}) {
    super(message);
    this.name = 'SeafileError';
    this.kind = kind ?? ERROR_KINDS.HTTP;
    this.status = status;
  }
}

/** Shown in Seafile under Settings → Linked devices, where the user can revoke it. */
export const DEVICE_NAME = 'Gladys Assistant';

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/**
 * The base URL of the server, always ending with a slash so the API paths
 * resolve under it (a Seafile served under /seafile/ keeps its prefix).
 *
 * @param {string} raw what the user typed, e.g. `seafile.example.com`
 * @returns {URL}
 */
export function normalizeServerUrl(raw) {
  let value = String(raw ?? '').trim();
  if (!value) {
    throw new SeafileError('No server URL configured', { kind: ERROR_KINDS.INVALID_URL });
  }
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new SeafileError('The server URL is not a valid URL', { kind: ERROR_KINDS.INVALID_URL });
  }
  url.search = '';
  url.hash = '';
  url.username = '';
  url.password = '';
  // Users paste the address of a page (…/libraries/, …/accounts/login/): only
  // the part before the web interface routes is the server.
  url.pathname = url.pathname
    .replace(/\/(libraries|accounts|library|profile|sys|api2|api\/v2\.1)(\/.*)?$/, '/')
    .replace(/\/*$/, '/');
  return url;
}

/**
 * The stable identifier of a server inside the external ids: its host (and
 * port, and path prefix), never the scheme, so moving from http to https does
 * not orphan the devices.
 *
 * @param {URL} url see normalizeServerUrl
 */
export function serverIdOf(url) {
  const prefix = url.pathname.replace(/^\/|\/$/g, '');
  return [url.hostname.toLowerCase(), url.port, prefix]
    .filter(Boolean)
    .join('-')
    .replace(/[^a-z0-9.-]+/gi, '-');
}

/**
 * The 40 hexadecimal characters Seafile expects as a desktop `device_id`:
 * stable for a server and an account, so every restart reuses the same linked
 * device instead of piling new ones up in the user's settings.
 */
export function deviceIdFor(url, username) {
  return createHash('sha1')
    .update(`gladys-seafile:${serverIdOf(url)}:${String(username).toLowerCase()}`)
    .digest('hex');
}

/**
 * Default transport: one HTTP(S) request, the whole body read as text.
 *
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string }>}
 */
export function nodeTransport({ url, method, headers, body, timeoutMs, allowSelfSigned }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const module = target.protocol === 'https:' ? https : http;
    const request = module.request(
      target,
      {
        method,
        headers,
        timeout: timeoutMs,
        ...(target.protocol === 'https:' ? { rejectUnauthorized: !allowSelfSigned } : {}),
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        response.on('error', reject);
      },
    );
    request.on('timeout', () => {
      request.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    });
    request.on('error', reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });
}

function transportError(err, url) {
  const code = err?.code ?? '';
  if (code === 'ETIMEDOUT') {
    return new SeafileError(`No answer from ${url.host} in time`, { kind: ERROR_KINDS.TIMEOUT });
  }
  if (TLS_CODES.has(code)) {
    return new SeafileError(`The certificate of ${url.host} was refused (${code})`, {
      kind: ERROR_KINDS.TLS,
    });
  }
  return new SeafileError(`Cannot reach ${url.host}${code ? ` (${code})` : ''}`, {
    kind: ERROR_KINDS.UNREACHABLE,
  });
}

function statusError(status, method, path) {
  switch (status) {
    case 401:
      return new SeafileError(`The server refused the credentials (${method} ${path})`, {
        kind: ERROR_KINDS.AUTH,
        status,
      });
    case 403:
      return new SeafileError(`Permission denied (${method} ${path})`, {
        kind: ERROR_KINDS.PERMISSION,
        status,
      });
    case 404:
      return new SeafileError(`Not found (${method} ${path})`, {
        kind: ERROR_KINDS.NOT_FOUND,
        status,
      });
    default:
      return new SeafileError(`HTTP ${status} (${method} ${path})`, {
        kind: ERROR_KINDS.HTTP,
        status,
      });
  }
}

export class SeafileClient {
  /**
   * @param {object} options
   * @param {string} options.url the server, see normalizeServerUrl
   * @param {string} [options.token] an account token (Web API Auth Token)
   * @param {string} [options.username] with `password`, exchanged for a token
   * @param {string} [options.password]
   * @param {boolean} [options.allowSelfSigned]
   * @param {number} [options.timeoutMs]
   * @param {string} [options.clientVersion] reported when registering the device
   * @param {Function} [options.transport] see nodeTransport (tests inject theirs)
   */
  constructor({
    url,
    token = '',
    username = '',
    password = '',
    allowSelfSigned = false,
    timeoutMs = 10_000,
    clientVersion = '1.0.0',
    transport = nodeTransport,
  }) {
    this.url = normalizeServerUrl(url);
    this.serverId = serverIdOf(this.url);
    this.configuredToken = token;
    this.token = token || null;
    this.username = username;
    this.password = password;
    this.allowSelfSigned = allowSelfSigned;
    this.timeoutMs = timeoutMs;
    this.clientVersion = clientVersion;
    this.transport = transport;
  }

  /** Whether the client signs in with a password (and can sign in again). */
  get usesPassword() {
    return !this.configuredToken && Boolean(this.username && this.password);
  }

  async send(path, { method = 'GET', headers = {}, body } = {}) {
    const target = new URL(path, this.url);
    try {
      return await this.transport({
        url: target.toString(),
        method,
        headers: { Accept: 'application/json', 'User-Agent': 'gladys-seafile', ...headers },
        body,
        timeoutMs: this.timeoutMs,
        allowSelfSigned: this.allowSelfSigned,
      });
    } catch (err) {
      throw transportError(err, this.url);
    }
  }

  /**
   * Exchange the username and password for an account token, registered as
   * a linked device of the account so the user sees it and can revoke it.
   */
  async login() {
    if (!this.usesPassword) {
      throw new SeafileError('No API token and no username/password configured', {
        kind: ERROR_KINDS.AUTH,
      });
    }
    const form = new URLSearchParams({
      username: this.username,
      password: this.password,
      device_id: deviceIdFor(this.url, this.username),
      device_name: DEVICE_NAME,
      platform: 'linux',
      client_version: this.clientVersion,
    }).toString();
    const response = await this.send('api2/auth-token/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': String(Buffer.byteLength(form)),
      },
      body: form,
    });
    if (response.status === 400) {
      const otp = String(response.headers?.['x-seafile-otp'] ?? '').toLowerCase();
      if (otp === 'required') {
        throw new SeafileError('The account requires two-factor authentication', {
          kind: ERROR_KINDS.OTP_REQUIRED,
          status: 400,
        });
      }
      throw new SeafileError('The server refused the username or the password', {
        kind: ERROR_KINDS.AUTH,
        status: 400,
      });
    }
    if (response.status !== 200) {
      throw statusError(response.status, 'POST', 'api2/auth-token/');
    }
    const token = parseJson(response.body)?.token;
    if (typeof token !== 'string' || !token) {
      throw new SeafileError('The server answered the sign-in without a token', {
        kind: ERROR_KINDS.BAD_RESPONSE,
      });
    }
    this.token = token;
    return token;
  }

  /**
   * One API call. Authenticated calls sign in first when needed, and sign in
   * again ONCE when a password-based token was refused (revoked from the
   * Seafile settings, server reinstalled…).
   */
  async request(path, { auth = true, text = false } = {}) {
    if (auth && !this.token) {
      await this.login();
    }
    let response = await this.send(path, { headers: auth ? this.authHeaders() : {} });
    if (auth && response.status === 401 && this.usesPassword) {
      this.token = null;
      await this.login();
      response = await this.send(path, { headers: this.authHeaders() });
    }
    if (response.status < 200 || response.status >= 300) {
      throw statusError(response.status, 'GET', path);
    }
    if (text) {
      return response.body;
    }
    const parsed = parseJson(response.body);
    if (parsed === undefined) {
      throw new SeafileError(`Unexpected answer to GET ${path} (not JSON)`, {
        kind: ERROR_KINDS.BAD_RESPONSE,
      });
    }
    return parsed;
  }

  authHeaders() {
    return { Authorization: `Token ${this.token}` };
  }

  /** `true` when the server answers its anonymous ping. */
  async ping() {
    const body = await this.request('api2/ping/', { auth: false, text: true });
    return body.replace(/"/g, '').trim() === 'pong';
  }

  /** `true` when the token is accepted. */
  async authPing() {
    const body = await this.request('api2/auth/ping/', { text: true });
    return body.replace(/"/g, '').trim() === 'pong';
  }

  serverInfo() {
    return this.request('api2/server-info/', { auth: false });
  }

  accountInfo() {
    return this.request('api2/account/info/');
  }

  async libraries() {
    const list = await this.request('api2/repos/');
    if (!Array.isArray(list)) {
      throw new SeafileError('Unexpected answer to GET api2/repos/ (not a list)', {
        kind: ERROR_KINDS.BAD_RESPONSE,
      });
    }
    return list;
  }

  library(id) {
    return this.request(`api2/repos/${encodeURIComponent(id)}/`);
  }

  adminSysinfo() {
    return this.request('api/v2.1/admin/sysinfo/');
  }
}

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}
