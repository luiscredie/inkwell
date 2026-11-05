# Inkwell 3D Demo — P1 release verification

This isolated prototype is served at https://luiscredie.github.io/inkwell/3d-demo/.

**Target baseline:** 7eaa32e7 or descendant containing the full P1. All edits to the demo stay in `site/3d-demo/` and must not change the production pages or Supabase.

## Release trigger and validation

The GitHub Pages deployment workflow builds the site from `site/` after its release checks complete successfully. Use a **fresh workflow run** for a new release instead of re-running a job inside a previously cancelled run that already uploaded an artifact named `github-pages`. In the latter case, `actions/deploy-pages@v4` can fail with `Multiple artifacts named "github-pages" were unexpectedly found`.

Check these before calling the release complete:

- Release checks pass for the target commit.
- A new **Deploy Inkwell to GitHub Pages** run completes successfully for that commit.
- The deployment artifact contains `3d-demo/index.html` and `3d-demo/experience.css`.
- Visit the public URL on desktop and mobile, checking images, logo, 3D binder opening, page turns, card spotlight, Feed and reduced motion.
- Mark untested items explicitly; automated checks do not verify cinematic fidelity or loading of all art files.

## P1 deliverables

- Binder cover opening, perspective transitions, mobile horizontal gestures and two double-page views.
- Twenty-four reference cards using the public Inkwell image directory.
- Spotlight with a clearly demonstrative foil effect, front/back illustration, interactive lighting and related cards.
- Staggered Feed entry and layered artwork.
- Isolated code with no writes to the production backend.
