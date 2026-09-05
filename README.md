# GT Prasanth Arvind — Portfolio

Personal portfolio of **GT Prasanth Arvind**, Structural Design Engineer (Coimbatore, Tamil Nadu, India).
Multi-storey RCC design, high-rise structural analysis, and BIM coordination — from concept to construction.

**Live site:** <https://gtprasantharvind.github.io/Portfolio/>

## Contents

| Path | What it is |
|---|---|
| `index.html` | The full one-page portfolio — hero, profile, Blue Sky Tower gallery, drawing sheets, ETABS work, experience, contact. All CSS and JS are inline in this file. |
| `map.html` / `map.js` / `map-data.js` | "Atlas" — a WebGL particle map of India zooming to Coimbatore, with pins for the places behind the work. `map-data.js` holds the geometry; POI content is near the top of the `POIS` array in `map.js`. |
| `assets/` | Renders, drawing sheets, ETABS captures, cutaways. |
| `assets/vendor/` | Self-hosted three.js r128 and GSAP 3.15.0 + ScrollTrigger — pinned, no third-party CDN at runtime. |
| `GT_Prasanth_Arvind_CV.pdf` | Downloadable CV (linked from the hero and the contact block). |
| `GT_Portfolio_Signature.pdf` | Long-form portfolio PDF. |

## Stack

Plain static HTML/CSS/JS — no build step, no dependencies to install.

- **three.js r128** — the particle tower in the hero and the atlas map
- **GSAP 3.15 + ScrollTrigger** — scroll-driven reveals, the pinned word-reveal, the sideways gallery
- **Google Fonts** — Space Grotesk, Lora, JetBrains Mono (the only remaining external request)

## Running locally

Open `index.html` directly, or serve the folder so relative paths behave exactly as they will in production:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploying

GitHub Pages, from the repository root: **Settings → Pages → Deploy from a branch → `main` / `(root)`**.
No build step and no Jekyll processing is needed. The site is served from <https://gtprasantharvind.github.io/Portfolio/>.

## Editing notes

- **Content lives in the markup**, not in a data file — experience rows are in the `#xp` section of `index.html`, and the atlas pins are in the `POIS` array in `map.js`.
- **Everything is in one stylesheet** at the top of `index.html`. Mobile rules are grouped under the `MOBILE / TOUCH` banner near the end — desktop layout and mobile layout are deliberately kept separate there.
- **Breakpoint is 820px.** Below it: the top bar becomes a scrim-backed row, the chapter counter is hidden, the gallery becomes a swipeable snap carousel, and GSAP's pinned scenes are torn down (handled by `gsap.matchMedia`, so rotating the device switches modes cleanly).
- **If a graceful-degradation check is needed**, block the vendor scripts — the page adds a `no-fx` class and renders fully static rather than blank.

## Licence

Code is free to learn from. Project imagery, drawings and CV content are © GT Prasanth Arvind — please don't reuse them.
