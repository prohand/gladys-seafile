// -----------------------------------------------------------------------------
// User-facing texts built at runtime: connection status, action answers, the
// reasons of a failure. Every one is a `{ en, fr, de, es }` object (see
// i18n.js); Gladys shows the reader's language and falls back to English.
// -----------------------------------------------------------------------------

import { localize, pick } from './i18n.js';
import { ERROR_KINDS } from './seafile/client.js';

/** A size for humans, in the reader's number format: `12.4 GB`, `850 MB`. */
export function formatBytes(bytes, language = 'en') {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) {
    return '–';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let index = 0;
  let scaled = value;
  while (scaled >= 1000 && index < units.length - 1) {
    scaled /= 1000;
    index += 1;
  }
  const digits = index === 0 || scaled >= 100 ? 0 : 1;
  const number = new Intl.NumberFormat(language, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(scaled);
  return `${number} ${units[index]}`;
}

/** A percentage in the reader's number format: `42.5 %` / `42,5 %`. */
export function formatPercent(value, language = 'en') {
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value);
  return language === 'en' ? `${number}%` : `${number} %`;
}

/** Why the integration cannot start: a setting is missing. */
export function missingSettingMessage(setting) {
  if (setting === 'server_url') {
    return {
      en: 'Enter the address of your Seafile server.',
      fr: "Indiquez l'adresse de votre serveur Seafile.",
      de: 'Gib die Adresse deines Seafile-Servers ein.',
      es: 'Indique la dirección de su servidor Seafile.',
    };
  }
  return {
    en: 'Enter an API token, or a username and a password.',
    fr: "Renseignez un jeton d'API, ou un identifiant et un mot de passe.",
    de: 'Gib ein API-Token ein, oder einen Benutzernamen und ein Passwort.',
    es: 'Indique un token de API, o un usuario y una contraseña.',
  };
}

/**
 * What a failure means for the user, and what to do about it.
 *
 * @param {Error & { kind?: string, status?: number }} err
 * @param {string} host the server, as the user typed it
 */
export function errorMessage(err, host) {
  switch (err?.kind) {
    case ERROR_KINDS.INVALID_URL:
      return {
        en: 'The server address is not a valid URL, e.g. https://seafile.example.com',
        fr: "L'adresse du serveur n'est pas une URL valide, par exemple https://seafile.example.com",
        de: 'Die Serveradresse ist keine gültige URL, z. B. https://seafile.example.com',
        es: 'La dirección del servidor no es una URL válida, p. ej. https://seafile.example.com',
      };
    case ERROR_KINDS.TIMEOUT:
      return {
        en: `${host} did not answer in time. Is the server up?`,
        fr: `${host} n'a pas répondu à temps. Le serveur est-il démarré ?`,
        de: `${host} hat nicht rechtzeitig geantwortet. Läuft der Server?`,
        es: `${host} no respondió a tiempo. ¿Está encendido el servidor?`,
      };
    case ERROR_KINDS.TLS:
      return {
        en: `The certificate of ${host} was refused. Self-signed? Turn on "Accept a self-signed certificate".`,
        fr: `Le certificat de ${host} a été refusé. Auto-signé ? Activez « Accepter un certificat auto-signé ».`,
        de: `Das Zertifikat von ${host} wurde abgelehnt. Selbstsigniert? Schalte „Selbstsigniertes Zertifikat akzeptieren“ ein.`,
        es: `Se rechazó el certificado de ${host}. ¿Autofirmado? Active «Aceptar un certificado autofirmado».`,
      };
    case ERROR_KINDS.AUTH:
      return {
        en: 'The server refused the credentials: check the API token, or the username and password.',
        fr: "Le serveur a refusé les identifiants : vérifiez le jeton d'API, ou l'identifiant et le mot de passe.",
        de: 'Der Server hat die Zugangsdaten abgelehnt: Prüfe das API-Token oder Benutzername und Passwort.',
        es: 'El servidor rechazó las credenciales: compruebe el token de API, o el usuario y la contraseña.',
      };
    case ERROR_KINDS.OTP_REQUIRED:
      return {
        en: 'This account uses two-factor authentication: use an API token instead of the password.',
        fr: "Ce compte utilise la double authentification : utilisez un jeton d'API plutôt que le mot de passe.",
        de: 'Dieses Konto nutzt Zwei-Faktor-Authentifizierung: Verwende ein API-Token statt des Passworts.',
        es: 'Esta cuenta usa la verificación en dos pasos: use un token de API en lugar de la contraseña.',
      };
    case ERROR_KINDS.UNREACHABLE:
      return {
        en: `Cannot reach ${host}. Check the address, and that Gladys can reach it on your network.`,
        fr: `Impossible de joindre ${host}. Vérifiez l'adresse, et que Gladys peut la joindre sur votre réseau.`,
        de: `${host} ist nicht erreichbar. Prüfe die Adresse und ob Gladys sie in deinem Netzwerk erreicht.`,
        es: `No se puede contactar con ${host}. Compruebe la dirección y que Gladys la alcanza en su red.`,
      };
    case ERROR_KINDS.BAD_RESPONSE:
    case ERROR_KINDS.NOT_FOUND:
      return {
        en: `${host} answered, but not like a Seafile server. Check the address.`,
        fr: `${host} a répondu, mais pas comme un serveur Seafile. Vérifiez l'adresse.`,
        de: `${host} hat geantwortet, aber nicht wie ein Seafile-Server. Prüfe die Adresse.`,
        es: `${host} respondió, pero no como un servidor Seafile. Compruebe la dirección.`,
      };
    default: {
      const status = err?.status ? `HTTP ${err.status}` : String(err?.message ?? err);
      return {
        en: `The Seafile server answered with an error (${status}).`,
        fr: `Le serveur Seafile a répondu par une erreur (${status}).`,
        de: `Der Seafile-Server hat mit einem Fehler geantwortet (${status}).`,
        es: `El servidor Seafile respondió con un error (${status}).`,
      };
    }
  }
}

/**
 * The answer of "Test the connection": what was reached, as whom, and what
 * the integration will publish.
 */
export function connectionReport(snapshot) {
  const { server, account, libraries, admin } = snapshot;
  return localize((language) => {
    const edition = pick(language, {
      en: server.edition === 'pro' ? 'Professional' : 'Community',
      fr: server.edition === 'pro' ? 'Professionnelle' : 'Communautaire',
      de: server.edition === 'pro' ? 'Professional' : 'Community',
      es: server.edition === 'pro' ? 'Profesional' : 'Comunitaria',
    });
    const used = formatBytes(account.usage, language);
    const quota = account.unlimited
      ? pick(language, {
          en: `${used} used, no quota`,
          fr: `${used} utilisés, sans quota`,
          de: `${used} belegt, kein Kontingent`,
          es: `${used} usados, sin cuota`,
        })
      : pick(language, {
          en: `${used} of ${formatBytes(account.total, language)} used (${formatPercent(account.quotaPercent, language)})`,
          fr: `${used} utilisés sur ${formatBytes(account.total, language)} (${formatPercent(account.quotaPercent, language)})`,
          de: `${used} von ${formatBytes(account.total, language)} belegt (${formatPercent(account.quotaPercent, language)})`,
          es: `${used} usados de ${formatBytes(account.total, language)} (${formatPercent(account.quotaPercent, language)})`,
        });
    const stats = admin
      ? pick(language, {
          en: ` Server statistics: ${admin.users ?? '?'} users, ${admin.files ?? '?'} files.`,
          fr: ` Statistiques du serveur : ${admin.users ?? '?'} utilisateurs, ${admin.files ?? '?'} fichiers.`,
          de: ` Serverstatistik: ${admin.users ?? '?'} Benutzer, ${admin.files ?? '?'} Dateien.`,
          es: ` Estadísticas del servidor: ${admin.users ?? '?'} usuarios, ${admin.files ?? '?'} archivos.`,
        })
      : '';
    return pick(language, {
      en: `Connected to Seafile ${server.version} (${edition}) as ${account.email}: ${quota}, ${libraries.length} libraries.${stats}`,
      fr: `Connecté à Seafile ${server.version} (${edition}) en tant que ${account.email} : ${quota}, ${libraries.length} bibliothèques.${stats}`,
      de: `Verbunden mit Seafile ${server.version} (${edition}) als ${account.email}: ${quota}, ${libraries.length} Bibliotheken.${stats}`,
      es: `Conectado a Seafile ${server.version} (${edition}) como ${account.email}: ${quota}, ${libraries.length} bibliotecas.${stats}`,
    });
  });
}

/** The answer of "List the libraries": names and sizes, the largest first. */
export function librariesReport(snapshot, { limit = 30 } = {}) {
  const { libraries } = snapshot;
  return localize((language) => {
    if (libraries.length === 0) {
      return pick(language, {
        en: 'This account sees no library.',
        fr: 'Ce compte ne voit aucune bibliothèque.',
        de: 'Dieses Konto sieht keine Bibliothek.',
        es: 'Esta cuenta no ve ninguna biblioteca.',
      });
    }
    const shared = pick(language, {
      en: 'shared',
      fr: 'partagée',
      de: 'geteilt',
      es: 'compartida',
    });
    const lines = libraries
      .slice(0, limit)
      .map(
        (library) =>
          `${library.name} — ${formatBytes(library.size, language)}${library.type === 'repo' ? '' : ` (${shared})`}`,
      );
    const more =
      libraries.length > limit
        ? pick(language, {
            en: `\n… and ${libraries.length - limit} more.`,
            fr: `\n… et ${libraries.length - limit} de plus.`,
            de: `\n… und ${libraries.length - limit} weitere.`,
            es: `\n… y ${libraries.length - limit} más.`,
          })
        : '';
    return `${lines.join('\n')}${more}`;
  });
}
