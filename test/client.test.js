import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  DEVICE_NAME,
  ERROR_KINDS,
  SeafileClient,
  deviceIdFor,
  nodeTransport,
  normalizeServerUrl,
  serverIdOf,
} from '../src/seafile/client.js';
import { TOKEN, createFakeSeafile } from './helpers/fakeSeafile.js';

test('the server URL is normalized to its root, https by default', () => {
  assert.equal(
    normalizeServerUrl('seafile.example.com').toString(),
    'https://seafile.example.com/',
  );
  assert.equal(
    normalizeServerUrl('http://192.168.1.20:8000/libraries/abc/?x=1#y').toString(),
    'http://192.168.1.20:8000/',
  );
  assert.equal(
    normalizeServerUrl('https://example.com/seafile/accounts/login/').toString(),
    'https://example.com/seafile/',
  );
  assert.throws(() => normalizeServerUrl(''), { kind: ERROR_KINDS.INVALID_URL });
  assert.throws(() => normalizeServerUrl('http://'), { kind: ERROR_KINDS.INVALID_URL });
});

test('the server id ignores the scheme, keeps port and prefix', () => {
  assert.equal(
    serverIdOf(normalizeServerUrl('https://Seafile.Example.com')),
    'seafile.example.com',
  );
  assert.equal(serverIdOf(normalizeServerUrl('http://seafile.example.com')), 'seafile.example.com');
  assert.equal(serverIdOf(normalizeServerUrl('http://10.0.0.2:8000/sf/')), '10.0.0.2-8000-sf');
});

test('the device id is 40 hex characters, stable per server and account', () => {
  const url = normalizeServerUrl('https://seafile.example.com');
  const id = deviceIdFor(url, 'Alice@example.com');
  assert.match(id, /^[0-9a-f]{40}$/);
  assert.equal(id, deviceIdFor(url, 'alice@example.com'));
  assert.notEqual(id, deviceIdFor(url, 'bob@example.com'));
});

test('an API token is sent as "Authorization: Token …"', async () => {
  const fake = createFakeSeafile();
  const client = new SeafileClient({
    url: 'https://s.example',
    token: TOKEN,
    transport: fake.transport,
  });
  const account = await client.accountInfo();
  assert.equal(account.email, 'alice@example.com');
  assert.equal(fake.requests.at(-1).headers.Authorization, `Token ${TOKEN}`);
  assert.equal(await client.ping(), true);
  assert.equal(await client.authPing(), true);
});

test('username and password are exchanged for a token, registered as a linked device', async () => {
  const fake = createFakeSeafile();
  const client = new SeafileClient({
    url: 'https://s.example',
    username: 'alice@example.com',
    password: 'secret',
    transport: fake.transport,
  });
  await client.accountInfo();
  const login = fake.requests.find((request) => request.path === '/api2/auth-token/');
  const form = new URLSearchParams(login.body);
  assert.equal(form.get('device_name'), DEVICE_NAME);
  assert.match(form.get('device_id'), /^[0-9a-f]{40}$/);
  assert.equal(client.token, fake.state.issuedToken);
});

test('a refused password token signs in again, once', async () => {
  const fake = createFakeSeafile();
  const client = new SeafileClient({
    url: 'https://s.example',
    username: 'alice@example.com',
    password: 'secret',
    transport: fake.transport,
  });
  await client.accountInfo();
  fake.state.validTokens.clear();
  await client.accountInfo();
  const logins = fake.requests.filter((request) => request.path === '/api2/auth-token/');
  assert.equal(logins.length, 2);
});

test('a refused API token is an AUTH error, with no second try', async () => {
  const fake = createFakeSeafile();
  const client = new SeafileClient({
    url: 'https://s.example',
    token: 'wrong',
    transport: fake.transport,
  });
  await assert.rejects(client.accountInfo(), { kind: ERROR_KINDS.AUTH, status: 401 });
  assert.equal(fake.requests.length, 1);
});

test('a wrong password and a two-factor account are told apart', async () => {
  const fake = createFakeSeafile();
  const wrong = new SeafileClient({
    url: 'https://s.example',
    username: 'alice@example.com',
    password: 'nope',
    transport: fake.transport,
  });
  await assert.rejects(wrong.accountInfo(), { kind: ERROR_KINDS.AUTH });
  fake.state.otp = true;
  const otp = new SeafileClient({
    url: 'https://s.example',
    username: 'alice@example.com',
    password: 'secret',
    transport: fake.transport,
  });
  await assert.rejects(otp.accountInfo(), { kind: ERROR_KINDS.OTP_REQUIRED });
});

test('HTTP statuses and transport failures become error kinds, without the token', async () => {
  const fake = createFakeSeafile();
  const client = new SeafileClient({
    url: 'https://s.example',
    token: TOKEN,
    transport: fake.transport,
  });
  await assert.rejects(client.adminSysinfo(), { kind: ERROR_KINDS.PERMISSION, status: 403 });
  await assert.rejects(client.library('missing'), { kind: ERROR_KINDS.NOT_FOUND });
  fake.state.down = true;
  await assert.rejects(client.serverInfo(), (err) => {
    assert.equal(err.kind, ERROR_KINDS.UNREACHABLE);
    assert.ok(!err.message.includes(TOKEN));
    return true;
  });
  fake.state.downError = Object.assign(new Error('self signed'), {
    code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
  });
  await assert.rejects(client.serverInfo(), { kind: ERROR_KINDS.TLS });
});

test('an answer that is not JSON is a BAD_RESPONSE', async () => {
  const client = new SeafileClient({
    url: 'https://s.example',
    token: TOKEN,
    transport: async () => ({ status: 200, headers: {}, body: '<html>login</html>' }),
  });
  await assert.rejects(client.accountInfo(), { kind: ERROR_KINDS.BAD_RESPONSE });
});

test('the node transport reads a real HTTP answer, and times out', async (t) => {
  const server = http.createServer((request, response) => {
    if (request.url === '/slow') {
      return; // never answers
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ path: request.url, auth: request.headers.authorization }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const answer = await nodeTransport({
    url: `${base}/api2/ping/`,
    method: 'GET',
    headers: { Authorization: 'Token x' },
    timeoutMs: 2000,
  });
  assert.equal(answer.status, 200);
  assert.deepEqual(JSON.parse(answer.body), { path: '/api2/ping/', auth: 'Token x' });

  const client = new SeafileClient({ url: `${base}/slow-server/`, token: 't', timeoutMs: 100 });
  client.url = new URL(`${base}/`);
  await assert.rejects(client.request('slow', { auth: false }), { kind: ERROR_KINDS.TIMEOUT });
});
