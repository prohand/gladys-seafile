# Seafile

Diese Integration verbindet Gladys mit deinem **Seafile**-Server (Community oder Professional
Edition): wie viel Speicher dein Konto belegt, sein Kontingent, seine Bibliotheken, die
Statistik des ganzen Servers, wenn das Konto Systemadministrator ist, und ob der Server überhaupt
antwortet.

Sie liest nur: Auf deinem Server wird nie etwas geschrieben, verschoben oder gelöscht.

## Bevor du beginnst

**Gladys 5.3 oder neuer** ist erforderlich.

Gladys muss deinen Seafile-Server über das Netzwerk erreichen, unter der Adresse, unter der du ihn
im Browser öffnest (zum Beispiel `https://seafile.example.com` oder `http://192.168.1.20:8000`).

Die Integration meldet sich mit einem Seafile-Konto an. Ein normales Konto genügt; ein
**Systemadministrator**-Konto liefert zusätzlich die Statistik des ganzen Servers (Benutzer,
Dateien, Speicher).

### Der empfohlene Weg: ein API-Token

1. Öffne Seafile im Browser und melde dich mit dem Konto an, das Gladys verwenden soll.
2. Klicke auf dein Avatar (oben rechts), dann auf **Einstellungen**.
3. Klicke unter **Web API Auth Token** auf **Generieren** und kopiere das Token.
4. Füge es in das Feld **API-Token** der Integration ein.

Ein API-Token funktioniert auch, wenn das Konto Zwei-Faktor-Authentifizierung nutzt. Um Gladys
den Zugang zu entziehen, lösche das Token an derselben Stelle.

### Der andere Weg: Benutzername und Passwort

Lass das API-Token leer und fülle **Benutzername** (die E-Mail-Adresse oder Login-ID des Kontos)
und **Passwort** aus. Die Integration tauscht sie gegen ein Token, das in Seafile unter
**Einstellungen → Verknüpfte Geräte** als **Gladys Assistant** erscheint: Lösche es dort, um Gladys
den Zugang zu entziehen. Das Token wird nur im Speicher gehalten, und eine neue Anmeldung
verwendet dasselbe verknüpfte Gerät.

Mit Zwei-Faktor-Authentifizierung funktioniert das nicht: Verwende für ein solches Konto ein
API-Token.

## Konfiguration

| Feld                                    | Was hinein gehört                                                                                         |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Serveradresse                           | Die Adresse, unter der du Seafile öffnest. Ohne `http://` oder `https://` wird https angenommen.          |
| API-Token                               | Empfohlen, siehe oben. Es hat Vorrang vor Benutzername und Passwort.                                      |
| Benutzername / Passwort                 | Nur ohne API-Token.                                                                                       |
| Selbstsigniertes Zertifikat akzeptieren | Nur wenn dein Server https mit einem selbst signierten Zertifikat nutzt.                                  |
| Aktualisierungsintervall (s)            | Wie oft der Server gelesen wird, 60 bis 3600 Sekunden (Standard 300).                                     |
| Warnschwelle Kontingent (%)             | Der Wert, der den Szenenauslöser **Kontingentschwelle überschritten** auslöst (Standard 90).              |
| Bibliotheken als Geräte                 | Veröffentlicht zusätzlich ein Gerät pro Bibliothek des Kontos.                                            |
| Namen der Bibliotheken                  | Nur diese Bibliotheken werden zu Geräten, durch Kommas getrennt (Groß-/Kleinschreibung egal). Leer: alle. |

Klicke dann auf **Verbindung testen**: Die Antwort nennt die Seafile-Version, das Konto, den
belegten Speicher und die Anzahl der Bibliotheken. **Bibliotheken auflisten** zeigt die Namen, die
du in **Namen der Bibliotheken** kopieren kannst.

## Geräte

Öffne **Integrationen → Seafile → Geräte** und lege die Geräte an, die du behalten möchtest.

### Seafile-Server

| Funktion              | Wert                                                                     |
| --------------------- | ------------------------------------------------------------------------ |
| Online                | 1, wenn der Server beim letzten Lesen geantwortet hat, sonst 0           |
| Seafile version       | z. B. `13.0.5`                                                           |
| Storage used          | vom Konto belegter Speicher, in GB                                       |
| Quota                 | Kontingent des Kontos, in GB — nur wenn das Konto eines hat              |
| Quota used            | in %, nur wenn das Konto ein Kontingent hat                              |
| Libraries             | Bibliotheken, die das Konto sieht (eigene, geteilte, die seiner Gruppen) |
| Users                 | nur Systemadministrator: Konten auf dem Server                           |
| Active users          | nur Systemadministrator                                                  |
| Files on the server   | nur Systemadministrator                                                  |
| Storage of the server | nur Systemadministrator, in GB                                           |
| Connected clients     | nur Systemadministrator: verbundene Desktop- und Mobil-Clients           |

Die Kontingent- und Admin-Funktionen erscheinen, sobald der Server sie zum ersten Mal liefert: Das
Gerät wird dann mit den neuen Funktionen erneut veröffentlicht, und du kannst es in Gladys
aktualisieren.

### Seafile-Bibliotheken

Mit eingeschaltetem **Bibliotheken als Geräte** wird jede Bibliothek, die **dem Konto gehört**, zu
einem Gerät (die mit ihm geteilten nicht), oder nur die in **Namen der Bibliotheken** genannten:

| Funktion | Wert               |
| -------- | ------------------ |
| Size     | Größe, in GB       |
| Files    | Anzahl der Dateien |

Eine in Seafile umbenannte Bibliothek behält ihr Gerät: Die Geräte folgen der ID der Bibliothek,
nicht ihrem Namen.

## Aktionen

- **Verbindung testen** — liest den Server sofort und sagt, was gefunden wurde.
- **Bibliotheken auflisten** — die Bibliotheken, die das Konto sieht, die größten zuerst, mit
  ihrer Größe; geteilte sind markiert.

## Szenen und Dashboard (Gladys 5.1+)

### Szenenauslöser

| Auslöser                                 | Wann                                                                            | Variablen                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Der Seafile-Server ist nicht erreichbar  | er antwortet nicht mehr oder lehnt die Zugangsdaten ab — einmal pro Ausfall     | Servername, Serveradresse, Grund (Code)                                   |
| Der Seafile-Server ist wieder erreichbar | er antwortet nach einem Ausfall wieder                                          | Servername, Serveradresse, Minuten offline                                |
| Kontingentschwelle überschritten         | das Konto überschreitet die Warnschwelle seines Kontingents                     | Servername, Kontingent belegt (%), Schwelle, belegt (GB), Kontingent (GB) |
| Eine Bibliothek hat sich geändert        | in einer sichtbaren Bibliothek wurde eine Datei hinzugefügt, geändert, entfernt | Name der Bibliothek, geändert von, Größe (GB), geändert am                |
| Die Seafile-Version hat sich geändert    | der Server wurde aktualisiert (oder zurückgestuft)                              | Servername, vorherige Version, neue Version                               |

Jeder Auslöser lässt sich auf ein Gerät beschränken: den Server, oder — bei **Eine Bibliothek hat
sich geändert** — ein Bibliotheksgerät.

Gut zu wissen:

- Das erste Lesen nach dem Start von Gladys oder der Integration dient nur als Referenz: Es löst
  nichts aus, ein Neustart meldet also nie erneut ein volles Kontingent oder alle Bibliotheken.
- Ein Server, der beim Start der Integration schon ausgefallen ist, löst **nicht erreichbar** nicht
  aus (er wurde nie laufend gesehen).
- Ein fehlgeschlagenes Lesen wird fünf Sekunden später einmal wiederholt, bevor es als Ausfall
  zählt.
- Die Kontingentwarnung wird einmal beim Anstieg ausgelöst, und erst wieder, nachdem die Belegung
  mindestens zwei Punkte unter die Schwelle gefallen ist.
- Der Grundcode von **nicht erreichbar** ist einer von `UNREACHABLE`, `TIMEOUT`, `TLS`, `AUTH`,
  `OTP_REQUIRED`, `PERMISSION`, `NOT_FOUND`, `HTTP`, `BAD_RESPONSE`.
- **Eine Bibliothek hat sich geändert** wird zwischen zwei Lesevorgängen erkannt: Bei einem
  Intervall von 5 Minuten ergeben mehrere Änderungen in denselben fünf Minuten ein einziges
  Ereignis.

### Szenenaktionen

- **Seafile-Server jetzt lesen** — aktualisiert alle Geräte sofort. Ausgaben: Server online
  (ja/nein), Version, belegt (GB), Kontingent belegt (%, −1 ohne Kontingent), Bibliotheken.
- **Seafile-Bibliothek lesen** — wähle ein Bibliotheksgerät; Ausgaben: Bibliothek gefunden
  (ja/nein), Name, Größe (GB), Dateien, letzte Änderung.

Ein Server, der nicht antwortet, ist eine Ausgabe (`online` = nein), keine fehlgeschlagene Aktion:
Prüfe sie in einer Bedingung nach der Aktion.

### Das Widget „Seafile“

Füge das Widget **Seafile** einem Dashboard hinzu. Es zeigt die Kontingentanzeige (wenn das Konto
ein Kontingent hat), den belegten Speicher, die Anzahl der Bibliotheken, die Benutzer
(Systemadministrator), die größten Bibliotheken, den Serverstatus, seine Version und das Konto,
sowie eine Schaltfläche **Jetzt lesen**. Seine Einstellung **Angezeigte Bibliotheken** (0 bis 8,
Standard 5) legt die Länge der Liste fest.

## Gut zu wissen

- Größen sind in dezimalen Gigabyte (1 GB = 1.000.000.000 Byte), wie Seafile sie anzeigt.
- Der Server wird über seinen Host (und Port, und Pfad) erkannt: Der Wechsel von `http://` zu
  `https://` behält die Geräte, ein neuer Hostname erzeugt neue.
- Auf der Festplatte wird nichts gespeichert: Das aus einem Passwort gewonnene Token lebt im
  Speicher.

## Fehlerbehebung

| Meldung                                              | Was tun                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| … ist nicht erreichbar                               | Prüfe Adresse, Port und ob Gladys den Server erreicht (gleiches Netzwerk, Firewall).                   |
| … hat nicht rechtzeitig geantwortet                  | Der Server ist überlastet oder aus; prüfe ihn im Browser.                                              |
| Das Zertifikat von … wurde abgelehnt                 | Ein selbst signiertes Zertifikat: Schalte **Selbstsigniertes Zertifikat akzeptieren** ein.             |
| Der Server hat die Zugangsdaten abgelehnt            | Erzeuge ein neues API-Token oder prüfe Benutzername und Passwort.                                      |
| Dieses Konto nutzt Zwei-Faktor-Authentifizierung     | Verwende ein API-Token statt des Passworts.                                                            |
| … hat geantwortet, aber nicht wie ein Seafile-Server | Die Adresse zeigt auf eine andere Seite (Reverse-Proxy-Seite, Login-Portal): Korrigiere die Adresse.   |
| Keine Serverstatistik mit einem Admin-Konto          | Das Konto muss **System**administrator sein, mit dem Recht, Systeminfos zu sehen (Seafile-Pro-Rollen). |
