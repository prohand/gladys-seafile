// -----------------------------------------------------------------------------
// One "Seafile library" device per library the account owns, when the user
// turned "Libraries as devices" on (optionally restricted to some names).
//
// Keyed by the server and the library id Seafile gives it (a UUID that
// survives a rename), never by its name. The features:
//
//   size     size of the library (GB)
//   files    number of files (from the library details)
//
// Not polled by Gladys on their own: the server device's refresh reads every
// library at once and publishes their states.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { toGigabytes } from '../seafile/snapshot.js';

export const LIBRARY_DEVICE_TYPE = 'seafile-library';

export const LIBRARY_FEATURES = {
  SIZE: 'size',
  FILES: 'files',
};

export function libraryExternalIds(gladys, serverId, libraryId) {
  return gladys.externalIds(LIBRARY_DEVICE_TYPE, `${serverId}:${libraryId}`);
}

export function buildLibraryDevice(gladys, serverId, library) {
  const ids = libraryExternalIds(gladys, serverId, library.id);
  return {
    name: `Seafile – ${library.name}`,
    external_id: ids.device,
    features: [
      {
        name: 'Size',
        external_id: ids.feature(LIBRARY_FEATURES.SIZE),
        category: DEVICE_FEATURE_CATEGORIES.DATA,
        type: DEVICE_FEATURE_TYPES.DATA.SIZE,
        unit: DEVICE_FEATURE_UNITS.GIGABYTE,
        min: 0,
        max: 1_000_000,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      },
      {
        name: 'Files',
        external_id: ids.feature(LIBRARY_FEATURES.FILES),
        category: DEVICE_FEATURE_CATEGORIES.UNKNOWN,
        type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
        min: 0,
        max: 1_000_000_000,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      },
    ],
  };
}

export function buildLibraryStates(gladys, serverId, library) {
  const ids = libraryExternalIds(gladys, serverId, library.id);
  return [
    [LIBRARY_FEATURES.SIZE, toGigabytes(library.size)],
    [LIBRARY_FEATURES.FILES, library.fileCount],
  ]
    .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
    .map(([key, state]) => ({ device_feature_external_id: ids.feature(key), state }));
}
