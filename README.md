# Ravenyz Shop

Statischer Shop (`public/`) + kleine Node.js-API (`server/`) für Stripe Checkout und Bestell-Mails.

```
ravenyz/
├── products.json        ← Produkte (hier neue Produkte eintragen)
├── shipping.json        ← Versandzonen, Preise, Länder
├── public/              ← Webseite (nginx liefert diese Dateien aus)
│   └── images/products/ ← Produktbilder
├── server/              ← API: /api/products, /api/checkout, /api/webhook
│   ├── .env.example     ← Vorlage für Stripe- und Mail-Zugangsdaten
│   └── data/            ← orders.jsonl: alle bezahlten Bestellungen
└── deploy/              ← nginx- und systemd-Konfiguration
```

## Ablauf einer Bestellung

1. Kunde legt Produkte in den Warenkorb und wählt das Lieferland (Schweiz → Post, Ausland → DHL).
2. „Pay with card“ öffnet die Stripe-Zahlungsseite. Dort gibt der Kunde E-Mail, Name, Telefon, Liefer- und Rechnungsadresse und Karte ein.
3. Nach der Zahlung meldet Stripe das an `/api/webhook`. Der Server speichert die Bestellung in `server/data/orders.jsonl` und schickt eine Mail an `info@hoferaytee.ch`.
4. Der Kunde bekommt die Zahlungsquittung von Stripe (in Stripe aktivieren, siehe unten).

Preise kommen immer aus `products.json` auf dem Server, nie aus dem Browser.

## Neues Produkt hinzufügen

1. Bild nach `public/images/products/` legen (SVG, PNG oder JPG, quadratisch wirkt am besten).
2. In `products.json` einen Eintrag ergänzen:

```json
{
  "id": "mein-produkt",
  "sku": "RVZ-XX1",
  "name": "Mein Produkt",
  "tagline": "Ein Satz, was es tut.",
  "description": "Längere Beschreibung.",
  "price": 49.00,
  "image": "images/products/mein-produkt.png",
  "highlights": ["Merkmal 1", "Merkmal 2"],
  "specs": { "Versorgung": "5 V DC", "Funk": "Wi-Fi 2.4 GHz" },
  "active": true
}
```

- `id`: eindeutig, nur Kleinbuchstaben und Bindestriche, später nicht mehr ändern.
- `price`: in CHF.
- `"active": false` blendet ein Produkt aus, ohne es zu löschen.
- Auf ein gültiges JSON achten (Kommas zwischen Einträgen). Prüfen mit: `python3 -m json.tool products.json`

Kein Neustart nötig, die Datei wird bei jeder Anfrage neu gelesen.

## Installation auf dem Server

### 1. DNS
Beim Domain-Anbieter von ravenyz.com zwei A-Records auf `83.79.219.174` setzen (`@` und `www`), keinen AAAA-Record.

### 2. Dateien kopieren
In der PowerShell (Ordner `ravenyz` entpackt in `Downloads`):
```
scp -r "$env:USERPROFILE\Downloads\ravenyz" luc@192.168.1.135:~/
```
Auf dem Server:
```
sudo apt install nodejs npm
sudo mv ~/ravenyz /var/www/ravenyz
cd /var/www/ravenyz/server
sudo npm install --omit=dev
```

### 3. Zugangsdaten
```
sudo cp .env.example .env
sudo nano .env
```
Stripe-Schlüssel, Webhook-Geheimnis (Schritt 6) und SMTP-Daten deines Mail-Anbieters eintragen.

### 4. Eigener Benutzer und Rechte
```
sudo useradd --system --no-create-home --shell /usr/sbin/nologin ravenyz
sudo chown -R root:root /var/www/ravenyz
sudo chown -R ravenyz:ravenyz /var/www/ravenyz/server/data
sudo chown root:ravenyz /var/www/ravenyz/server/.env
sudo chmod 640 /var/www/ravenyz/server/.env
sudo find /var/www/ravenyz/public -type d -exec chmod 755 {} \;
sudo find /var/www/ravenyz/public -type f -exec chmod 644 {} \;
```

### 5. Dienst starten
```
sudo cp /var/www/ravenyz/deploy/ravenyz-shop.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ravenyz-shop
sudo systemctl status ravenyz-shop
```
Logs ansehen: `sudo journalctl -u ravenyz-shop -f`

### 6. nginx und HTTPS
```
sudo cp /var/www/ravenyz/deploy/nginx-ravenyz.conf /etc/nginx/sites-available/ravenyz
sudo ln -s /etc/nginx/sites-available/ravenyz /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d ravenyz.com -d www.ravenyz.com
```

### 7. Stripe einrichten (zuerst im Testmodus)
1. **API-Schlüssel:** Dashboard → Entwickler → API-Schlüssel → geheimen Schlüssel (`sk_test_…`) in `.env` als `STRIPE_SECRET_KEY`.
2. **Webhook:** Dashboard → Entwickler → Webhooks → Endpunkt hinzufügen
   - URL: `https://ravenyz.com/api/webhook`
   - Ereignisse: `checkout.session.completed` und `checkout.session.async_payment_succeeded`
   - Signatur-Geheimnis (`whsec_…`) in `.env` als `STRIPE_WEBHOOK_SECRET`.
3. **Quittungen an Kunden:** Einstellungen → Kunden-E-Mails → „Erfolgreiche Zahlungen“ aktivieren.
4. Neustart: `sudo systemctl restart ravenyz-shop`

### 8. Testen
Bestellung mit der Testkarte `4242 4242 4242 4242`, beliebiges zukünftiges Datum, beliebige CVC. Danach sollte eine Mail mit `[TEST]` im Betreff ankommen und die Bestellung in `server/data/orders.jsonl` stehen.

### 9. Live schalten
Stripe-Konto vollständig verifizieren, dann im Live-Modus einen neuen API-Schlüssel (`sk_live_…`) und einen neuen Webhook anlegen, beide in `.env` ersetzen und den Dienst neu starten.

## Vor dem Live-Gang ausfüllen
- `public/imprint.html`, `terms.html`, `privacy.html`, `shipping.html`: gelb markierte Platzhalter ersetzen.
- Preise und technische Daten in `products.json` prüfen (aktuell Platzhalter).
- Versandkosten und Länder in `shipping.json` prüfen.

## Lokal testen (optional)
```
cd server && npm install && cp .env.example .env   # Test-Schlüssel eintragen, BASE_URL=http://localhost:3001
node server.js
```
Dann http://localhost:3001 öffnen. Webhooks lokal mit der Stripe CLI: `stripe listen --forward-to localhost:3001/api/webhook`.
