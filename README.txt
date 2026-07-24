INKWELL — Lorcana Codex — how to publish
=========================================

FOLDER STRUCTURE (everything inside your "inkwell" repo root):

   inkwell/
     index.html                    <- the app (entry point)
     support.js                    <- required runtime
     cards.json                    <- shared card database
     users/
       luis.json                   <- your personal data (collection, decks, matches)
     lorcana-card-images/
       images/
         Alma_Madrigal_-_Family_Matriarch__LOR4-2.jpg
         ... (all your card jpgs)

IMPORTANT: index.html, support.js and cards.json go at the ROOT (next to the
"users" and "lorcana-card-images" folders), exactly as above.

IMAGES
   The app loads each card from:  lorcana-card-images/images/<image_file>
   where <image_file> is the "image_file" value in cards.json
   (e.g. images/Alma_Madrigal_-_Family_Matriarch__LOR4-2.jpg).
   If a file is missing, it falls back to the official Ravensburger CDN.

GITHUB PAGES
   Settings > Pages > Deploy from branch > root.
   Site URL: https://<user>.github.io/<repo>/

NOTES
   - Your edits (collection, decks, logged games) save in the browser
     (localStorage) per device.
   - Prices are computed in-app for now; send your price file to wire in real data.
