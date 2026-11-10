// -----------------------------------------------------------------------------
// A fake Seafile server, as a transport the client calls instead of the
// network: the routes the integration uses, answering like Seafile does, with
// state the tests change between two readings.
// -----------------------------------------------------------------------------

export const TOKEN = 'a'.repeat(40);

export function createFakeSeafile(overrides = {}) {
  const state = {
    version: '13.0.5',
    features: ['seafile-basic', 'office-preview'],
    email: 'alice@example.com',
    name: 'Alice',
    password: 'secret',
    otp: false,
    isStaff: false,
    // Admin of the server but without the "view system info" right.
    adminForbidden: false,
    usage: 42_000_000_000,
    total: 100_000_000_000,
    validTokens: new Set([TOKEN]),
    issuedToken: 'b'.repeat(40),
    down: false,
    downError: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    libraries: [
      {
        id: 'lib-photos',
        name: 'Photos',
        type: 'repo',
        owner: 'alice@example.com',
        size: 30_000_000_000,
        encrypted: false,
        mtime: 1_700_000_000,
        modifier_name: 'Alice',
        permission: 'rw',
        file_count: 1200,
      },
      {
        id: 'lib-docs',
        name: 'Documents',
        type: 'repo',
        owner: 'alice@example.com',
        size: 2_500_000_000,
        encrypted: true,
        mtime: 1_700_000_100,
        modifier_name: 'Alice',
        permission: 'rw',
        file_count: 340,
      },
      {
        id: 'lib-team',
        name: 'Team',
        type: 'grepo',
        owner: 'bob@example.com',
        size: 9_000_000_000,
        encrypted: false,
        mtime: 1_700_000_200,
        modifier_name: 'Bob',
        permission: 'r',
        file_count: 80,
      },
      // The same library seen through a direct share: listed once.
      {
        id: 'lib-team',
        name: 'Team',
        type: 'srepo',
        owner: 'bob@example.com',
        size: 9_000_000_000,
        encrypted: false,
        mtime: 1_700_000_200,
        permission: 'r',
      },
    ],
    sysinfo: {
      users_count: 12,
      active_users_count: 5,
      repos_count: 40,
      total_files_count: 123456,
      total_storage: 512_000_000_000,
      current_connected_devices_count: 7,
    },
    ...overrides,
  };
  const requests = [];

  const json = (status, body, headers = {}) => ({
    status,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

  async function transport({ url, method, headers, body }) {
    const { pathname } = new URL(url);
    requests.push({ method, path: pathname, headers, body });
    if (state.down) {
      throw state.downError;
    }
    const token = String(headers?.Authorization ?? '').replace(/^Token /, '');
    const authed = state.validTokens.has(token);

    if (pathname.endsWith('/api2/ping/')) {
      return json(200, 'pong');
    }
    if (pathname.endsWith('/api2/server-info/')) {
      return json(200, { version: state.version, features: state.features });
    }
    if (pathname.endsWith('/api2/auth-token/') && method === 'POST') {
      const form = new URLSearchParams(body);
      if (form.get('username') !== state.email || form.get('password') !== state.password) {
        return json(400, { non_field_errors: ['Unable to login with provided credentials.'] });
      }
      if (state.otp) {
        return json(
          400,
          { non_field_errors: ['Two factor auth token is missing.'] },
          {
            'x-seafile-otp': 'required',
          },
        );
      }
      state.validTokens.add(state.issuedToken);
      return json(200, { token: state.issuedToken });
    }
    if (!authed) {
      return json(401, { detail: 'Invalid token' });
    }
    if (pathname.endsWith('/api2/auth/ping/')) {
      return json(200, 'pong');
    }
    if (pathname.endsWith('/api2/account/info/')) {
      return json(200, {
        email: state.email,
        name: state.name,
        usage: state.usage,
        total: state.total,
        is_staff: state.isStaff,
      });
    }
    if (pathname.endsWith('/api2/repos/')) {
      return json(
        200,
        state.libraries.map(({ file_count: _fileCount, ...library }) => library),
      );
    }
    const repo = pathname.match(/\/api2\/repos\/([^/]+)\/$/);
    if (repo) {
      const library = state.libraries.find((entry) => entry.id === decodeURIComponent(repo[1]));
      return library ? json(200, library) : json(404, { error_msg: 'Library not found.' });
    }
    if (pathname.endsWith('/api/v2.1/admin/sysinfo/')) {
      if (!state.isStaff || state.adminForbidden) {
        return json(403, { error_msg: 'Permission denied.' });
      }
      return json(200, state.sysinfo);
    }
    return json(404, { error_msg: 'Not found' });
  }

  return { state, requests, transport };
}
