// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user from the `config_schema` of
// `gladys-assistant-integration.json`; the SDK fetches it (`getConfig`) and
// hands every change to `onConfigUpdated`. This module only applies the
// defaults and forces the types, so the rest of the code never deals with a
// number typed as a string or a missing key.
// -----------------------------------------------------------------------------

/** Defaults: they MUST match the `default` values of the manifest config_schema. */
export const DEFAULT_CONFIG = {
  server_url: '',
  api_token: '',
  username: '',
  password: '',
  allow_self_signed: false,
  // Seconds between two reads of the server. Gladys polls at most once a
  // minute: slower intervals are applied by skipping polls (see createPoller).
  poll_frequency: 300,
  quota_alert_percent: 90,
  library_devices: false,
  library_names: '',
};

/** Bounds of the numeric fields, as the manifest declares them. */
export const LIMITS = {
  poll_frequency: { min: 60, max: 3600 },
  quota_alert_percent: { min: 1, max: 100 },
};

function clampNumber(value, fallback, { min, max }) {
  const number = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The library names typed by the user, one per comma or line, compared
 * without case. Empty means "every library the account owns".
 *
 * @param {string} raw
 * @returns {string[]}
 */
export function parseLibraryNames(raw) {
  return text(raw)
    .split(/[,\n]/)
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Merge the user config with the defaults and force the types.
 *
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    server_url: text(raw.server_url),
    api_token: text(raw.api_token),
    username: text(raw.username),
    // A password may legitimately start or end with a space: never trimmed.
    password: typeof raw.password === 'string' ? raw.password : '',
    allow_self_signed: raw.allow_self_signed === true,
    poll_frequency: clampNumber(
      raw.poll_frequency,
      DEFAULT_CONFIG.poll_frequency,
      LIMITS.poll_frequency,
    ),
    quota_alert_percent: clampNumber(
      raw.quota_alert_percent,
      DEFAULT_CONFIG.quota_alert_percent,
      LIMITS.quota_alert_percent,
    ),
    library_devices: raw.library_devices === true,
    library_names: text(raw.library_names),
  };
}

/**
 * What is missing before the integration can talk to the server, or null.
 *
 * @returns {'server_url' | 'credentials' | null}
 */
export function missingSetting(config) {
  if (!config.server_url) {
    return 'server_url';
  }
  if (!config.api_token && !(config.username && config.password)) {
    return 'credentials';
  }
  return null;
}
