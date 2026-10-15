# Black Marble static data host

Workers Static Assets serves these files directly, without a Worker script, R2,
NASA credentials, or a paid Workers subscription. Current Workers Free limits:
20,000 files per version; 25 MiB per file. All 540 frozen 2025 app tiles fit.
https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/

Prepare from an independently verified local annual release:

```powershell
.venv/Scripts/python.exe services/black-marble/prepare.py <verified-dataset-directory>
cd services/black-marble
node ../kakao-search/node_modules/wrangler/bin/wrangler.js deploy
```

The existing Kakao service installs Wrangler 4.148.0. Its search Worker is a
separate deployment and is not changed by this command. `assets/` is ignored;
never commit H5 files or credentials. The preparation checks all file hashes and
required H5 fields, and publishes only compact tiles, a catalogue and notices.

The immutable `/VJ146A4-2025/` release is pinned by the app's bundled catalogue.
Do not replace files at these URLs with different bytes. A new data release must
use a new prefix and ship a matching catalogue in an app update. Old prefixes
must remain available to supported app versions. The app downloads only tiles
covering the selected place and its model radius, verifies size, SHA-256 and H5
fields, then publishes an atomic local index. A saved region works offline.

https://astrosky-black-marble.jmgj-kakao-search.workers.dev/
