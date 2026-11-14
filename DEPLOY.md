# Deploy to GitHub Pages

The app is published automatically: every push to `main` runs the workflow [.github/workflows/deploy.yml](.github/workflows/deploy.yml), which installs dependencies, runs the tests, builds the app and publishes `dist/` to GitHub Pages.

Live site: **https://aspirchik.github.io/arcada-planner/**

---

## How it is set up

1. **Base path** — `vite.config.ts` has `base: '/arcada-planner/'`, matching the repository name. If the repository is renamed, change it too.
2. **Pages source** — repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Workflow** — `.github/workflows/deploy.yml` (build job → `upload-pages-artifact`, deploy job → `deploy-pages`). It can also be started by hand: **Actions → Deploy to GitHub Pages → Run workflow**.

A failing test stops the deploy, so a broken build never replaces the live site.

## Checking a deploy

- **Actions** tab — each push shows a "Deploy to GitHub Pages" run; the deploy job links to the site.
- From the terminal: `gh run list --workflow deploy.yml` and `gh run watch`.

## Manual deploy (alternative)

The older way still works and pushes `dist/` to a `gh-pages` branch:

```bash
npm run deploy
```

To use it, switch **Settings → Pages → Source** to *Deploy from a branch* → `gh-pages` / root.

## Troubleshooting

- **Blank page after deploy:** make sure `base` in `vite.config.ts` matches the repository name exactly (e.g., `/arcada-planner/`).
- **Assets not loading:** SVG paths in `catalog.json` must be relative (e.g., `sofa`, not `/assets/2d/sofa`).
- **404 on refresh:** the app has no client-side router, so this shouldn't happen.

## Local development

```bash
npm install
npm run dev
```

Opens at [http://localhost:5173/arcada-planner/](http://localhost:5173/arcada-planner/).

## Production build (without deploy)

```bash
npm run build
npm run preview
```

The `preview` command serves the built `dist/` folder locally to verify everything works before deploying.
