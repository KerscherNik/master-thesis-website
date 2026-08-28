# A High-Frequency Perspective on 3D Gaussian Splatting — project page

Static project page for the MSc thesis (SAD, Spectral-Aware Densification).
Self-contained: no CDN, no build step; open `index.html` directly or serve
the directory (GitHub Pages ready, relative paths only).

- `index.html` — the page
- `static/css`, `static/js` — hand-written styles and the dependency-free
  comparison slider / video-slot logic
- `static/images` — real renders and figures, populated by
  `asset_scripts/copy_assets.py`
- `static/videos` — fly-through and training-progress mp4s; slots on the
  page show a placeholder poster until the files exist
- `asset_scripts/` — rendering scripts and SLURM templates that produce the
  videos (see its README; nothing submits automatically)
- `tests/` — unit tests (Vitest) for the pure page logic in
  `static/js/core.js`, plus end-to-end tests (Playwright) covering the asset
  loader, comparison sliders, synced video pairs, lightbox, and the
  training-progress explorer

## Behaviour notes

The page front-loads its critical videos behind a loading overlay
(`#loader`) and plays them from fully-buffered blob URLs, so the comparison
pairs can never stall or drift on network seeks; the fly-through grid loads
in the background afterwards. On `file://` everything degrades to plain
progressive `src` playback without the loader.

The fly-through section is an "arena": SAD, 3DGS, 3DGS-MCMC and FDS-GS
across four scenes (flowers, bicycle, garden, stump), 16 videos in total
(`flythrough_{sad,3dgs,mcmc,fdsgs}_{scene}.mp4`); two methods sit in the
draggable comparison at 0.6x speed, the others wait as small bench tiles
that can be dragged onto either side — the replaced method drops back to
the bench. FDS-GS renders were produced with the FDS-GS codebase and env
(its plys carry a per-Gaussian filter radius `R` that only its own
rasterizer handles; see `asset_scripts/slurm/web-flythrough-fds-retry.sh`).

## Tests

```bash
npm install
npx playwright install chromium   # >= 1.57 so the browser ships H.264
npm test                          # unit + e2e
npm run test:unit                 # Vitest only
npm run test:e2e                  # Playwright only (starts its own server on :4173)
```

## CI / deployment

`.github/workflows/ci.yml` runs the unit and e2e suites on every push and
pull request, and on a green `main` push deploys `index.html` + `static/`
to GitHub Pages. One-time setup after creating the GitHub repo:
**Settings → Pages → Build and deployment → Source: "GitHub Actions"** —
then the first push to `main` publishes the site.

Page layout adapted from the [Nerfies](https://nerfies.github.io) project
page (CC BY-SA 4.0), reimplemented without its CDN dependencies.
