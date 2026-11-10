// -----------------------------------------------------------------------------
// The "Seafile" dashboard widget (Gladys 5.1+).
//
// Built from the last reading of the server, so it shows something even when
// the user has not created the devices: storage tiles, the largest libraries,
// the server status, and a button to read the server now. The content is
// declarative (the core renders it with its own theme and dark mode) and every
// text is `{ en, fr, de, es }`.
//
// The core caches the content until `ttl_seconds`; the service nudges it after
// every reading (`refreshWidgets`), so the TTL is only a safety net.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { localize, pick } from '../i18n.js';
import { missingSetting } from '../config.js';
import { errorMessage, formatBytes, missingSettingMessage } from '../messages.js';
import { toGigabytes } from '../seafile/snapshot.js';

const logger = createLogger({ name: 'widget' });

/** Widget key, as declared in the manifest `widgets`. Never renamed: dashboards store it. */
export const SEAFILE_WIDGET = 'seafile';

/** Keys of the button actions the content declares. */
export const WIDGET_ACTIONS = { REFRESH: 'refresh' };

/** The `libraries` setting: how many libraries the list shows. */
export const DEFAULT_LIBRARIES_SHOWN = 5;
const MAX_LIBRARIES_SHOWN = 8;

/** Status values are capped at 40 characters by the core. */
function shorten(value, max = 40) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function librariesShown(settings) {
  const value = Number(settings?.libraries);
  if (
    settings?.libraries === undefined ||
    settings?.libraries === null ||
    !Number.isFinite(value)
  ) {
    return DEFAULT_LIBRARIES_SHOWN;
  }
  return Math.max(0, Math.min(MAX_LIBRARIES_SHOWN, Math.round(value)));
}

const LABELS = {
  used: { en: 'Used', fr: 'Utilisé', de: 'Belegt', es: 'Usado' },
  quota: { en: 'Quota used', fr: 'Quota utilisé', de: 'Kontingent', es: 'Cuota usada' },
  libraries: { en: 'Libraries', fr: 'Bibliothèques', de: 'Bibliotheken', es: 'Bibliotecas' },
  users: { en: 'Users', fr: 'Utilisateurs', de: 'Benutzer', es: 'Usuarios' },
  server: { en: 'Server', fr: 'Serveur', de: 'Server', es: 'Servidor' },
  version: { en: 'Version', fr: 'Version', de: 'Version', es: 'Versión' },
  account: { en: 'Account', fr: 'Compte', de: 'Konto', es: 'Cuenta' },
  online: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  offline: { en: 'Unreachable', fr: 'Injoignable', de: 'Nicht erreichbar', es: 'Inaccesible' },
  waiting: {
    en: 'Not read yet',
    fr: 'Pas encore lu',
    de: 'Noch nicht gelesen',
    es: 'Aún no leído',
  },
  refresh: { en: 'Read now', fr: 'Lire maintenant', de: 'Jetzt lesen', es: 'Leer ahora' },
  shared: { en: 'Shared', fr: 'Partagée', de: 'Geteilt', es: 'Compartida' },
  encrypted: { en: 'Encrypted', fr: 'Chiffrée', de: 'Verschlüsselt', es: 'Cifrada' },
};

function serverStatus(service) {
  if (service.lastError) {
    return { value: LABELS.offline, color: WIDGET_COLORS.DANGER };
  }
  if (service.snapshot) {
    return { value: LABELS.online, color: WIDGET_COLORS.SUCCESS };
  }
  return { value: LABELS.waiting, color: WIDGET_COLORS.NEUTRAL };
}

function libraryCard(library) {
  const badge =
    library.type !== 'repo'
      ? { text: LABELS.shared, color: WIDGET_COLORS.INFO }
      : library.encrypted
        ? { text: LABELS.encrypted, color: WIDGET_COLORS.WARNING }
        : undefined;
  return {
    title: shorten(library.name, 60),
    subtitle: localize((language) => formatBytes(library.size, language)),
    ...(library.mtime ? { date: new Date(library.mtime * 1000).toISOString() } : {}),
    ...(badge ? { badge } : {}),
  };
}

/**
 * The widget content.
 *
 * @param {import('../service.js').SeafileService} service
 * @param {object} request what onWidgetGet receives: `settings`, `language`
 */
export function buildWidgetContent(service, { settings } = {}) {
  const config = service.config ?? {};
  const missing = missingSetting(config);
  if (missing) {
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', variant: 'body', text: missingSettingMessage(missing) }],
    };
  }

  const snapshot = service.snapshot;
  const components = [];
  if (snapshot) {
    const { account } = snapshot;
    if (!account.unlimited && account.quotaPercent !== null) {
      components.push({
        type: 'gauge',
        label: LABELS.quota,
        value: account.quotaPercent,
        min: 0,
        max: 100,
        unit: '%',
        color:
          account.quotaPercent >= config.quota_alert_percent
            ? WIDGET_COLORS.DANGER
            : WIDGET_COLORS.PRIMARY,
      });
    }
    components.push({
      type: 'value',
      label: LABELS.used,
      value: toGigabytes(account.usage) ?? 0,
      unit: 'GB',
      icon: 'hard-drive',
    });
    components.push({
      type: 'value',
      label: LABELS.libraries,
      value: snapshot.libraries.length,
      icon: 'folder',
    });
    if (snapshot.admin?.users !== null && snapshot.admin?.users !== undefined) {
      components.push({
        type: 'value',
        label: LABELS.users,
        value: snapshot.admin.users,
        icon: 'users',
      });
    }
    const shown = librariesShown(settings);
    if (shown > 0 && snapshot.libraries.length > 0) {
      components.push({
        type: 'card-list',
        display: 'list',
        items: snapshot.libraries.slice(0, shown).map(libraryCard),
      });
    }
  }

  if (service.lastError) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: localize((language) =>
        shorten(pick(language, errorMessage(service.lastError, service.host)), 80),
      ),
    });
  }

  const status = serverStatus(service);
  components.push({
    type: 'status',
    items: [
      { label: LABELS.server, icon: 'server', ...status },
      ...(snapshot
        ? [
            {
              label: LABELS.version,
              icon: 'tag',
              value: shorten(snapshot.server.version || '?'),
              color: WIDGET_COLORS.NEUTRAL,
            },
            {
              label: LABELS.account,
              icon: 'user',
              value: shorten(snapshot.account.email),
              color: WIDGET_COLORS.NEUTRAL,
            },
          ]
        : []),
    ],
  });
  components.push({
    type: 'button',
    label: LABELS.refresh,
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: WIDGET_ACTIONS.REFRESH },
  });

  return {
    // The service nudges the widget after every reading: this is the net.
    ttl_seconds: Math.min(3600, Math.max(60, config.poll_frequency ?? 300)),
    components,
  };
}

export const WIDGETS = {
  [SEAFILE_WIDGET]: {
    async get(service, request) {
      logger.debug(`onWidgetGet <- ${SEAFILE_WIDGET}`);
      return buildWidgetContent(service, request);
    },

    /** A tapped button: read the server now, and say how it went (≤ 200 characters). */
    async action(service, { actionKey }) {
      logger.info(`onWidgetAction <- ${SEAFILE_WIDGET}.${actionKey}`);
      if (actionKey !== WIDGET_ACTIONS.REFRESH) {
        throw new Error(`Unknown widget action: ${actionKey}`);
      }
      const { error } = await service.refresh({ manual: true });
      if (error) {
        return localize((language) =>
          shorten(pick(language, errorMessage(error, service.host)), 200),
        );
      }
      return {
        en: 'Seafile server read.',
        fr: 'Serveur Seafile lu.',
        de: 'Seafile-Server gelesen.',
        es: 'Servidor Seafile leído.',
      };
    },
  },
};

/**
 * Ask the core to re-pull every widget now (rate-limited core-side to one per
 * 10 s per widget, dropped while disconnected).
 */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
