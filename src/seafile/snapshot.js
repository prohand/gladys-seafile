// -----------------------------------------------------------------------------
// One reading of the server: everything the devices, the widget and the scene
// triggers need, gathered in a single pass and turned into plain numbers.
//
// The calls, in order: server-info (anonymous: tells a dead server from a
// refused token), account info, the library list, the details of the
// libraries shown as devices (only they carry a file count), and the
// server-wide statistics when the account is a system admin.
// -----------------------------------------------------------------------------

import { ERROR_KINDS, SeafileError } from './client.js';

/** Bytes in a gigabyte, the unit Gladys displays sizes in (decimal, like Seafile). */
export const BYTES_PER_GB = 1e9;

/** Bytes → gigabytes, two decimals. */
export function toGigabytes(bytes) {
  const number = Number(bytes);
  if (!Number.isFinite(number) || number < 0) {
    return null;
  }
  return Math.round((number / BYTES_PER_GB) * 100) / 100;
}

/** Library types of api2/repos/: the account's own ones first, they win a duplicate. */
const TYPE_PRIORITY = { repo: 0, srepo: 1, grepo: 2 };

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * The account as the devices show it. Seafile reports an unlimited quota as a
 * negative total (-2): no quota, no percentage.
 */
export function readAccount(raw) {
  const usage = Math.max(0, finite(raw?.usage) ?? 0);
  const total = finite(raw?.total);
  const unlimited = total === null || total < 0;
  return {
    email: String(raw?.email ?? ''),
    name: String(raw?.name ?? raw?.email ?? ''),
    isStaff: raw?.is_staff === true,
    usage,
    total: unlimited ? null : total,
    unlimited,
    quotaPercent:
      unlimited || total === 0 ? null : Math.round(Math.min(100, (usage / total) * 100) * 10) / 10,
  };
}

/** One library of api2/repos/, normalized. */
export function readLibrary(raw) {
  return {
    id: String(raw.id),
    name: String(raw.name ?? raw.id),
    type: String(raw.type ?? 'repo'),
    owner: String(raw.owner ?? ''),
    size: Math.max(0, finite(raw.size) ?? 0),
    encrypted: raw.encrypted === true,
    virtual: raw.virtual === true,
    // Seconds since the epoch, as Seafile gives it.
    mtime: finite(raw.mtime),
    modifier: String(raw.modifier_name ?? raw.modifier_email ?? ''),
    fileCount: null,
  };
}

/**
 * The libraries the account can see, each once: a library shared with the
 * user AND with one of their groups appears twice in api2/repos/.
 */
export function readLibraries(list) {
  const byId = new Map();
  for (const raw of list ?? []) {
    if (!raw || raw.id === undefined || raw.id === null) {
      continue;
    }
    const library = readLibrary(raw);
    const known = byId.get(library.id);
    if (!known || (TYPE_PRIORITY[library.type] ?? 9) < (TYPE_PRIORITY[known.type] ?? 9)) {
      byId.set(library.id, library);
    }
  }
  return [...byId.values()].sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
}

/**
 * The libraries published as Gladys devices: the account's own ones (not the
 * shared ones, not the virtual sub-libraries), restricted to the names the
 * user listed when they listed any.
 *
 * @param {Array} libraries see readLibraries
 * @param {string[]} names see parseLibraryNames
 */
export function selectDeviceLibraries(libraries, names) {
  return libraries.filter(
    (library) =>
      library.type === 'repo' &&
      !library.virtual &&
      (names.length === 0 || names.includes(library.name.toLowerCase())),
  );
}

/** Server-wide statistics of api/v2.1/admin/sysinfo/. */
export function readAdmin(raw) {
  return {
    users: finite(raw?.users_count),
    activeUsers: finite(raw?.active_users_count),
    libraries: finite(raw?.repos_count),
    files: finite(raw?.total_files_count),
    storage: finite(raw?.total_storage),
    connectedDevices: finite(raw?.current_connected_devices_count),
  };
}

/**
 * Read the server once.
 *
 * @param {import('./client.js').SeafileClient} client
 * @param {object} options
 * @param {boolean} options.libraryDevices whether the libraries are devices
 * @param {string[]} options.libraryNames see parseLibraryNames
 * @param {() => number} [options.now]
 */
export async function readSnapshot(client, { libraryDevices, libraryNames, now = Date.now }) {
  const info = await client.serverInfo();
  const account = readAccount(await client.accountInfo());
  const libraries = readLibraries(await client.libraries());

  const deviceLibraries = libraryDevices ? selectDeviceLibraries(libraries, libraryNames) : [];
  for (const library of deviceLibraries) {
    try {
      const detail = await client.library(library.id);
      library.fileCount = finite(detail?.file_count);
    } catch (err) {
      // A library deleted between the two calls: it simply keeps no count.
      if (!(err instanceof SeafileError) || err.kind !== ERROR_KINDS.NOT_FOUND) {
        throw err;
      }
    }
  }

  let admin = null;
  if (account.isStaff) {
    try {
      admin = readAdmin(await client.adminSysinfo());
    } catch (err) {
      // A staff account without the "view system info" permission (Seafile
      // Pro admin roles): the server stats stay out, nothing else changes.
      if (!(err instanceof SeafileError) || err.kind !== ERROR_KINDS.PERMISSION) {
        throw err;
      }
    }
  }

  const features = Array.isArray(info?.features) ? info.features.map(String) : [];
  return {
    at: now(),
    server: {
      id: client.serverId,
      url: client.url.toString(),
      version: String(info?.version ?? ''),
      edition: features.includes('seafile-pro') ? 'pro' : 'community',
    },
    account,
    libraries,
    deviceLibraries,
    admin,
  };
}
