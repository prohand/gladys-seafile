// -----------------------------------------------------------------------------
// Manifest `actions`: the buttons of the Configuration screen.
//
//   test_connection   read the server now and say what was found
//   list_libraries    the libraries the account sees, to fill "Library names"
//
// The resolved message is shown under the button: a `{ en, fr, de, es }`
// object, never a secret.
// -----------------------------------------------------------------------------

import { missingSetting } from './config.js';
import {
  connectionReport,
  errorMessage,
  librariesReport,
  missingSettingMessage,
} from './messages.js';

/** Keys of the manifest `actions`. Never renamed. */
export const ACTION_KEYS = {
  TEST_CONNECTION: 'test_connection',
  LIST_LIBRARIES: 'list_libraries',
};

async function withReading(service, report) {
  const missing = missingSetting(service.config ?? {});
  if (missing) {
    return missingSettingMessage(missing);
  }
  const { snapshot, error } = await service.refresh({ manual: true });
  if (error || !snapshot) {
    return errorMessage(error, service.host);
  }
  return report(snapshot);
}

export const ACTIONS = {
  [ACTION_KEYS.TEST_CONNECTION]: (service) => withReading(service, connectionReport),
  [ACTION_KEYS.LIST_LIBRARIES]: (service) => withReading(service, librariesReport),
};
