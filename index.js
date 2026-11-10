// -----------------------------------------------------------------------------
// Entry point of the Seafile integration.
//
// Wiring only — no Seafile logic here (see src/service.js):
//   1. instantiate the SDK (connection, auth, reconnection: handled by it);
//   2. register every handler BEFORE connect();
//   3. connect, read the configuration, read the server.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR
// The SDK reads them itself: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { SeafileService } from './src/service.js';
import { createPollGate } from './src/devices/index.js';
import { serverExternalIds } from './src/devices/server.js';
import { ACTIONS } from './src/actions.js';
import { SCENE_ACTIONS } from './src/capabilities/scenes.js';
import { WIDGETS, refreshWidgets } from './src/capabilities/widget.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
const service = new SeafileService({ gladys, onChange: refreshWidgets, clientVersion: version });
const pollGate = createPollGate();

async function applyConfig(raw) {
  service.configure(normalizeConfig(raw));
  pollGate.reset();
  await service.announce();
  await service.refresh({ manual: true });
  pollGate.touch();
  refreshWidgets(gladys);
}

// --- Discovery: Gladys asks for the devices ---------------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> reading the server');
  service.forgetPublished();
  await service.refresh({ manual: true });
  pollGate.touch();
});

// --- Polling: only the server device is polled, once a minute ---------------
// The gate applies the refresh interval of the configuration; one reading
// publishes the states of every device (server and libraries).
gladys.onPoll(async (device) => {
  if (
    !service.serverId ||
    device.external_id !== serverExternalIds(gladys, service.serverId).device
  ) {
    return;
  }
  if (pollGate(service.config)) {
    await service.refresh();
  }
});

// Every feature is read-only: a command can only be a mistake.
gladys.onSetValue(async (device) => {
  throw new Error(`${device.external_id} has no controllable feature`);
});

// --- Configuration screen buttons --------------------------------------------
for (const [key, handler] of Object.entries(ACTIONS)) {
  gladys.onAction(key, (fields) => handler(service, { fields }));
}

// --- Scene actions (Gladys 5.1+) ---------------------------------------------
// Scene TRIGGERS need no handler: the service fires them after each reading.
for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
  gladys.onSceneAction(key, (fields) => handler(service, { fields }));
}

// --- Dashboard widget (Gladys 5.1+) ------------------------------------------
for (const [key, widget] of Object.entries(WIDGETS)) {
  gladys.onWidgetGet(key, (request) => widget.get(service, request));
  gladys.onWidgetAction(key, (actionKey, params, { settings }) =>
    widget.action(service, { actionKey, params, settings }),
  );
}

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  await applyConfig(newConfig);
});

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  try {
    await applyConfig(await gladys.getConfig());
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les journaux de l'intégration.",
        de: 'Die Initialisierung ist fehlgeschlagen, prüfe die Protokolle der Integration.',
        es: 'La inicialización ha fallado, consulte los registros de la integración.',
      })
      .catch(() => {});
  }
});

gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
});

logger.info(`Starting the Seafile integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
