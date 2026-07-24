INKWELL — Lorcana Codex — how to publish
=========================================

FOLDER STRUCTURE (inside your "inkwell" repo root):

   inkwell/
     index.html                    <- the app (entry point)
     support.js                    <- required runtime
     cards.json                    <- shared card database
     prices.json                   <- prices (LigaLorcana). Optional; drop next to index.html
     users/
       luis.json                   <- your personal data
     lorcana-card-images/
       images/                     <- your card jpgs

PRICES
   The app loads prices.json from the same folder as index.html.
   It accepts BOTH formats:
     - the full LigaLorcana export (with "prices_by_liga_id"), or
     - the compact form (with "prices": { "LOR4-2": { "n": 3.62, "f": 7.07 } }).
   For each card it uses the normal "average" (falling back to low / minimum),
   and the foil "average". Cards without a price fall back to an estimate.
   The mini 7d/30d trend line is illustrative only (no historical feed yet).

IMAGES
   Loaded from lorcana-card-images/images/<image_file> (image_file is the value
   in cards.json). Missing files fall back to the official Ravensburger CDN.

GITHUB PAGES
   Settings > Pages > Deploy from branch > root.

NOTES
   - Edits (collection, decks, games) save in the browser (localStorage) per device.
