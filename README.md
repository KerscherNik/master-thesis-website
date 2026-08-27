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

Page layout adapted from the [Nerfies](https://nerfies.github.io) project
page (CC BY-SA 4.0), reimplemented without its CDN dependencies.
