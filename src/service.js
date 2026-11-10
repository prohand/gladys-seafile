// -----------------------------------------------------------------------------
// The integration's state: one Seafile server, its client, its last reading.
//
// Every surface goes through `refresh()` — the Gladys poll, "Test the
// connection", the scene action, the widget button — and a refresh is
// serialized: a second caller waits for the reading in progress instead of
// hitting the server twice.
//
// What a reading does, in order: publish the devices again when their list
// changed, publish the states that changed, fire the scene events, report the
// connection status, nudge the widget.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { missingSetting, parseLibraryNames } from './config.js';
import { ERROR_KINDS, SeafileClient, SeafileError } from './seafile/client.js';
import { readLibrary, readSnapshot } from './seafile/snapshot.js';
import { buildDiscoveredDevices, buildStates, discoverySignature } from './devices/index.js';
import { buildOfflineStates } from './devices/server.js';
import { SceneEventTracker, publishSceneEvents } from './capabilities/scenes.js';
import { errorMessage, missingSettingMessage } from './messages.js';

const logger = createLogger({ name: 'service' });

/** Unchanged values are re-published this often, so the history keeps a point. */
export const STATE_HEARTBEAT_MS = 30 * 60 * 1000;

/** A network failure is tried once more after this pause before counting as an outage. */
export const RETRY_DELAY_MS = 5_000;

const RETRIED_KINDS = new Set([ERROR_KINDS.UNREACHABLE, ERROR_KINDS.TIMEOUT]);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class SeafileService {
  /**
   * @param {object} options
   * @param {object} options.gladys the SDK instance
   * @param {Function} [options.transport] HTTP transport (tests inject a fake server)
   * @param {() => number} [options.now]
   * @param {(ms: number) => Promise<void>} [options.sleep]
   * @param {(gladys: object) => void} [options.onChange] called after every reading (widget nudge)
   * @param {string} [options.clientVersion]
   */
  constructor({ gladys, transport, now = Date.now, sleep = wait, onChange, clientVersion }) {
    this.gladys = gladys;
    this.transport = transport;
    this.now = now;
    this.sleep = sleep;
    this.onChange = onChange ?? (() => {});
    this.clientVersion = clientVersion;
    this.tracker = new SceneEventTracker({ now });
    this.config = null;
    this.client = null;
    this.snapshot = null;
    this.lastError = null;
    this.pending = null;
    this.publishedSignature = null;
    this.connectionMessage = undefined;
  }

  /** The server id of the current configuration, null when not configured. */
  get serverId() {
    return this.client?.serverId ?? null;
  }

  /** The address of the server, for the messages. */
  get host() {
    return this.client?.url.host ?? this.config?.server_url ?? '';
  }

  /**
   * Apply a (new) configuration. Another server forgets the last reading and
   * the scene references; new credentials on the same server keep them.
   *
   * @returns {string | null} the missing setting, see missingSetting
   */
  configure(config) {
    const previousServer = this.serverId;
    this.config = config;
    this.lastError = null;
    const missing = missingSetting(config);
    if (missing) {
      this.client = null;
    } else {
      try {
        this.client = new SeafileClient({
          url: config.server_url,
          token: config.api_token,
          username: config.username,
          password: config.password,
          allowSelfSigned: config.allow_self_signed,
          clientVersion: this.clientVersion,
          ...(this.transport ? { transport: this.transport } : {}),
        });
      } catch (err) {
        this.client = null;
        this.lastError = err;
      }
    }
    if (this.serverId !== previousServer) {
      this.snapshot = null;
      this.tracker.reset();
    }
    // Called on every (re)connection too: Gladys may have restarted, so the
    // device list and the connection status are published again once.
    this.forgetPublished();
    return missing;
  }

  /** Publish the device list and the connection status again at the next reading. */
  forgetPublished() {
    this.publishedSignature = null;
    this.connectionMessage = undefined;
  }

  /**
   * Publish what is known before any reading (the server device, so the user
   * can create it), and say what is missing when the config is incomplete.
   */
  async announce() {
    const missing = missingSetting(this.config ?? {});
    if (missing || !this.client) {
      const message = missing ? missingSettingMessage(missing) : errorMessage(this.lastError, '');
      await this.reportConnection(false, message);
      await this.publishDevices([]);
      return;
    }
    await this.publishDevices(buildDiscoveredDevices(this.gladys, this.serverId, this.snapshot));
  }

  async publishDevices(devices) {
    const signature = discoverySignature(devices);
    if (signature === this.publishedSignature) {
      return;
    }
    await this.gladys.publishDiscoveredDevices(devices);
    this.publishedSignature = signature;
  }

  async reportConnection(connected, message) {
    const key = connected ? 'ok' : JSON.stringify(message ?? null);
    if (key === this.connectionMessage) {
      return;
    }
    await this.gladys.setConnectionStatus(connected, connected ? undefined : message);
    this.connectionMessage = key;
  }

  /**
   * Read the server now (or join the reading in progress).
   *
   * @returns {Promise<{ snapshot: object | null, error: Error | null }>}
   */
  refresh({ manual = false } = {}) {
    if (!this.pending) {
      this.pending = this.doRefresh({ manual }).finally(() => {
        this.pending = null;
      });
    }
    return this.pending;
  }

  async read() {
    const options = {
      libraryDevices: this.config.library_devices,
      libraryNames: parseLibraryNames(this.config.library_names),
      now: this.now,
    };
    try {
      return await readSnapshot(this.client, options);
    } catch (err) {
      if (!(err instanceof SeafileError) || !RETRIED_KINDS.has(err.kind)) {
        throw err;
      }
      logger.debug(`${err.message}: one more try in ${RETRY_DELAY_MS / 1000} s`);
      await this.sleep(RETRY_DELAY_MS);
      return readSnapshot(this.client, options);
    }
  }

  async doRefresh({ manual }) {
    if (!this.client) {
      await this.announce();
      return { snapshot: null, error: this.lastError ?? new Error('Not configured') };
    }
    const serverId = this.serverId;
    let snapshot;
    try {
      snapshot = await this.read();
    } catch (err) {
      await this.onFailure(serverId, err);
      return { snapshot: null, error: err };
    }
    // The configuration changed while the server was being read: this reading
    // belongs to the previous server, drop it.
    if (serverId !== this.serverId) {
      return { snapshot: null, error: new Error('Configuration changed during the reading') };
    }
    await this.onSuccess(serverId, snapshot, { manual });
    return { snapshot, error: null };
  }

  async onSuccess(serverId, snapshot, { manual }) {
    const wasFailing = this.lastError !== null;
    this.snapshot = snapshot;
    this.lastError = null;
    if (wasFailing || manual) {
      logger.info(
        `Seafile ${snapshot.server.version} reached at ${this.host} as ${snapshot.account.email}`,
      );
    }
    await this.publishDevices(buildDiscoveredDevices(this.gladys, serverId, snapshot));
    await this.gladys.publishChangedStates(buildStates(this.gladys, serverId, snapshot), {
      heartbeat: STATE_HEARTBEAT_MS,
    });
    await publishSceneEvents(
      this.gladys,
      this.tracker.observe(this.gladys, serverId, snapshot, this.config),
    );
    await this.reportConnection(true);
    this.onChange(this.gladys);
  }

  async onFailure(serverId, err) {
    const firstFailure = this.lastError === null;
    this.lastError = err;
    // One warning per outage, the repeats in debug: a server down for a night
    // must not fill the logs.
    const line = `Reading ${this.host} failed: ${err.message}`;
    if (firstFailure) {
      logger.warn(line);
    } else {
      logger.debug(line);
    }
    try {
      await this.gladys.publishChangedStates(buildOfflineStates(this.gladys, serverId), {
        heartbeat: STATE_HEARTBEAT_MS,
      });
    } catch (publishErr) {
      logger.warn(`Offline state not published: ${publishErr.message}`);
    }
    await publishSceneEvents(
      this.gladys,
      this.tracker.fail(this.gladys, serverId, {
        url: this.client.url.toString(),
        reason: err.kind ?? ERROR_KINDS.HTTP,
      }),
    );
    await this.reportConnection(false, errorMessage(err, this.host));
    this.onChange(this.gladys);
  }

  /**
   * One library, read now (with its file count), or null when the server
   * does not know it anymore.
   */
  async readLibrary(id) {
    try {
      const raw = await this.client.library(id);
      const library = readLibrary({ ...raw, id: raw?.id ?? id });
      library.fileCount = Number.isFinite(Number(raw?.file_count)) ? Number(raw.file_count) : null;
      return library;
    } catch (err) {
      if (err instanceof SeafileError && err.kind === ERROR_KINDS.NOT_FOUND) {
        return null;
      }
      throw err;
    }
  }
}
