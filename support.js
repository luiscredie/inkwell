INKWELL — Lorcana Codex — how to publish
=========================================

1. Upload ALL of these to your GitHub repo (keep the folder structure):

   index.html          <- the app (entry point)
   support.js          <- required runtime
   cards.json          <- shared card database (with image manifest merged in)
   users/luis.json     <- your personal data (collection, decks, matches)
   images/             <- YOUR card images (see below)

2. IMAGES
   Card images load from the local "images/" folder first, e.g.:
       images/Alma_Madrigal_-_Family_Matriarch__LOR4-2.jpg
   The file names are exactly the "image_file" values inside cards.json.
   Drop your images/ folder next to index.html. If an image is missing,
   the app automatically falls back to the official Ravensburger CDN.

3. GITHUB PAGES
   Repo Settings > Pages > Deploy from branch > root. Your site will be at
   https://<user>.github.io/<repo>/

4. NOTES
   - Your edits (collection quantities, new decks, logged games) are saved
     in the browser (localStorage) per device.
   - To update prices later, the values are computed in-app for now; send me
     your price file and I'll wire it in.
