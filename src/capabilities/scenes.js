// -----------------------------------------------------------------------------
// Scene triggers and scene actions (Gladys 5.1+).
//
// Triggers say what HAPPENED between two readings of the server, declared in
// the manifest `scene_triggers`:
//
//   server_unreachable       the server stopped answering (or refused the credentials)
//   server_back_online       it answers again, after how long
//   quota_threshold_crossed  the account went over the alert threshold of its quota
//   library_updated          a library changed (a file added, removed, edited)
//   version_changed          the server was upgraded (or downgraded)
//
// The doctrine of the core: an event is not a state (the quota stays a
// feature), and one event per transition. Hence the tracker below: the first
// reading after a start is only a reference — comparing it with nothing would
// announce every library and every full quota again at each restart — and the
// quota alert re-arms only once the usage went back under the threshold.
//
// Actions are operations a scene runs, declared in the manifest
// `scene_actions`: read the server now, read one library now.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { toGigabytes } from '../seafile/snapshot.js';
import { serverExternalIds, serverName } from '../devices/server.js';
import { LIBRARY_DEVICE_TYPE, libraryExternalIds } from '../devices/library.js';

const logger = createLogger({ name: 'scenes' });

/** Keys of the manifest `scene_triggers`. Never renamed: scenes store them. */
export const SCENE_TRIGGERS = {
  SERVER_UNREACHABLE: 'server_unreachable',
  SERVER_BACK_ONLINE: 'server_back_online',
  QUOTA_THRESHOLD_CROSSED: 'quota_threshold_crossed',
  LIBRARY_UPDATED: 'library_updated',
  VERSION_CHANGED: 'version_changed',
};

/** Keys of the manifest `scene_actions`. Same rule. */
export const SCENE_ACTION_KEYS = {
  REFRESH_NOW: 'refresh_now',
  READ_LIBRARY: 'read_library',
};

/**
 * Below the threshold by this many points before the quota alert re-arms: a
 * usage hovering around 90 % must not fire at every reading.
 */
export const QUOTA_REARM_MARGIN = 2;

/** A server full of busy libraries must stay far from the 300 events/minute of the core. */
export const MAX_LIBRARY_EVENTS_PER_READING = 20;

export class SceneEventTracker {
  /**
   * @param {object} [options]
   * @param {() => number} [options.now]
   */
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.reset();
  }

  /** Forget everything: another server, or a fresh start. */
  reset() {
    this.reachable = undefined;
    this.unreachableSince = null;
    this.version = undefined;
    this.quotaArmed = undefined;
    this.libraryTimes = null;
  }

  /**
   * A reading succeeded: the `{ key, data }` events it reveals.
   *
   * @param {object} gladys the SDK instance
   * @param {string} serverId see serverIdOf
   * @param {object} snapshot see readSnapshot
   * @param {object} config normalized config (the quota threshold)
   */
  observe(gladys, serverId, snapshot, config) {
    const events = [];
    const device = serverExternalIds(gladys, serverId).device;
    const name = serverName(snapshot, serverId);

    if (this.reachable === false) {
      events.push({
        key: SCENE_TRIGGERS.SERVER_BACK_ONLINE,
        data: {
          device,
          server_name: name,
          url: snapshot.server.url,
          offline_minutes:
            this.unreachableSince === null
              ? 0
              : Math.round((this.now() - this.unreachableSince) / 60_000),
        },
      });
    }
    this.reachable = true;
    this.unreachableSince = null;

    const version = snapshot.server.version || undefined;
    if (this.version && version && version !== this.version) {
      events.push({
        key: SCENE_TRIGGERS.VERSION_CHANGED,
        data: { device, server_name: name, previous_version: this.version, version },
      });
    }
    if (version) {
      this.version = version;
    }

    events.push(...this.observeQuota(device, name, snapshot.account, config.quota_alert_percent));
    events.push(...this.observeLibraries(gladys, serverId, snapshot.libraries));
    return events;
  }

  observeQuota(device, name, account, threshold) {
    if (account.unlimited || account.quotaPercent === null) {
      this.quotaArmed = undefined;
      return [];
    }
    const percent = account.quotaPercent;
    const events = [];
    if (this.quotaArmed === true && percent >= threshold) {
      events.push({
        key: SCENE_TRIGGERS.QUOTA_THRESHOLD_CROSSED,
        data: {
          device,
          server_name: name,
          quota_percent: percent,
          threshold,
          used_gb: toGigabytes(account.usage),
          quota_gb: toGigabytes(account.total),
        },
      });
      this.quotaArmed = false;
    } else if (
      percent < threshold - QUOTA_REARM_MARGIN ||
      (this.quotaArmed === undefined && percent < threshold)
    ) {
      this.quotaArmed = true;
    } else if (this.quotaArmed === undefined) {
      // Already over the threshold at the first reading: a reference, no event.
      this.quotaArmed = false;
    }
    return events;
  }

  observeLibraries(gladys, serverId, libraries) {
    const times = new Map(libraries.map((library) => [library.id, library.mtime]));
    const previous = this.libraryTimes;
    this.libraryTimes = times;
    if (previous === null) {
      return [];
    }
    const events = [];
    for (const library of libraries) {
      const before = previous.get(library.id);
      // A library created since the last reading has no "before": new, not updated.
      if (
        before === undefined ||
        library.mtime === null ||
        before === null ||
        library.mtime <= before
      ) {
        continue;
      }
      if (events.length >= MAX_LIBRARY_EVENTS_PER_READING) {
        logger.warn(
          `More than ${MAX_LIBRARY_EVENTS_PER_READING} libraries changed since the last reading: the others fire no event this time`,
        );
        break;
      }
      events.push({
        key: SCENE_TRIGGERS.LIBRARY_UPDATED,
        data: {
          device: libraryExternalIds(gladys, serverId, library.id).device,
          library_name: library.name,
          modifier: library.modifier || null,
          size_gb: toGigabytes(library.size),
          modified_at: new Date(library.mtime * 1000).toISOString(),
        },
      });
    }
    return events;
  }

  /**
   * A reading failed: the `{ key, data }` events it reveals — only the first
   * failure after a success, one event per outage.
   */
  fail(gladys, serverId, { url, reason }) {
    const wasReachable = this.reachable === true;
    if (this.reachable !== false) {
      this.unreachableSince = this.now();
    }
    this.reachable = false;
    if (!wasReachable) {
      return [];
    }
    return [
      {
        key: SCENE_TRIGGERS.SERVER_UNREACHABLE,
        data: {
          device: serverExternalIds(gladys, serverId).device,
          server_name: `Seafile ${safeHost(url) ?? serverId}`,
          url,
          reason,
        },
      },
    ];
  }
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Publish scene events, never throwing: a scene event that could not be
 * delivered must never cost the reading its states.
 */
export async function publishSceneEvents(gladys, events) {
  for (const { key, data } of events) {
    try {
      await gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} not delivered: ${err.message}`);
    }
  }
}

/** Every trigger key the code fires (the manifest test checks both directions). */
export const FIRED_SCENE_TRIGGERS = Object.values(SCENE_TRIGGERS);

/**
 * The library id inside the external id of a library device, or null when the
 * device is not a library of this server.
 */
export function libraryIdOf(externalId, serverId) {
  const marker = `:${LIBRARY_DEVICE_TYPE}:${serverId}:`;
  const index = String(externalId ?? '').indexOf(marker);
  if (index === -1) {
    return null;
  }
  const id = String(externalId).slice(index + marker.length);
  return id && !id.includes(':') ? id : null;
}

/**
 * Scene action handlers, keyed by the manifest key. Each receives the
 * service (see service.js) and the RESOLVED fields, and returns the declared
 * outputs. A server that does not answer is an output (`online: false`), not
 * a failure: a scene action is never a condition, the scene author gates the
 * following actions on the output.
 */
export const SCENE_ACTIONS = {
  async [SCENE_ACTION_KEYS.REFRESH_NOW](service) {
    const { snapshot, error } = await service.refresh({ manual: true });
    if (error || !snapshot) {
      return { online: false };
    }
    return {
      online: true,
      version: snapshot.server.version,
      used_gb: toGigabytes(snapshot.account.usage),
      quota_percent: snapshot.account.quotaPercent ?? -1,
      libraries: snapshot.libraries.length,
    };
  },

  async [SCENE_ACTION_KEYS.READ_LIBRARY](service, { fields }) {
    const id = libraryIdOf(fields.library, service.serverId);
    if (!id || !service.client) {
      return { found: false };
    }
    const library = await service.readLibrary(id);
    if (!library) {
      return { found: false };
    }
    return {
      found: true,
      name: library.name,
      size_gb: toGigabytes(library.size),
      files: library.fileCount ?? -1,
      modified_at: library.mtime ? new Date(library.mtime * 1000).toISOString() : '',
    };
  },
};
