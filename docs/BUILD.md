**Build**
- **Install dependencies (clean):** `npm ci`
- **Install (loosen peer checks if needed):** `npm install --legacy-peer-deps`
- **Build everything (bundle, launcher, installer):** `npm run build`
- **Build only bundle:** `npm run build:bundle`
- **Run locally:** `npm start`
- **Run tests:** `npm test`

**Quick dev workflow**
- After code changes that affect runtime modules run `npm run build:bundle` then `npm start` to verify behaviour.
- When adding a new adapter in DEV you may keep it as a raw ESM file in `src/adapters/` and run the app directly. To include a new adapter in the distributed SEA build you must also add a static import for it in `src/adapters/loader.js` and then run `npm run build:bundle` so the adapter is inlined.
- To rebuild the packaged launcher/installer run `npm run build`.

**Common issues & fixes encountered**
-- **TypeError: fileURLToPath(import.meta.url) / Received undefined**
  - Cause: older code guarded on `import.meta.url` which isn't available in some bundled/CommonJS contexts.
  - Fix: the loader does environment detection using `isSea()` and exposes two clear code paths: a DEV dynamic-scan path that uses the filesystem, and a SEA static-includes path used in the bundle. During development use `src/adapters/` and run `npm run build:bundle` before packaging. See [src/adapters/loader.js](src/adapters/loader.js).

-- **No adapters found at runtime**
  - Cause: In SEA, adapters are compiled into the application bundle — they must be statically imported so the bundler inlines them. In DEV the loader scans `src/adapters/`.
  - Fix: If you've added a new adapter and it's not appearing in the distributed executable, add a static import to `src/adapters/loader.js` and re-run `npm run build:bundle`.

-- **Class extends value undefined (adapters extending undefined base)**
  - Cause: some adapters or old docs previously relied on a runtime global shim to provide `PaperSourceAdapter`.
  - Fix: do not rely on a global shim. Import `PaperSourceAdapter` from `./index.js` in source adapters and ensure adapters are included in the SEA build as static imports in `src/adapters/loader.js`. The runtime loader validates adapters using `instanceof PaperSourceAdapter`.

- **Seed/standards.json not found / empty subject vocabulary**
  - Cause: when running from the built bundle or installed executable the app may look in different locations for `seed/standards.json`.
  - Fix: `src/core/search.js` now checks multiple candidate locations (project `seed/`, `seeds/`, app dir `seed/`, and `dist/seed/`). If you bundle the app, ensure `seed/standards.json` is included in the `dist`/installer (the build script already packages `seed/standards.json`).

- **DeprecationWarning: url.parse() (DEP0169)**
  - Cause: a dependency (e.g., `pdfjs-dist`, `follow-redirects`, `proxy-from-env`) uses `url.parse()` internally.
  - Fix / mitigation:
    - Update dependencies to versions that use the WHATWG `URL` API: run `npx npm-check-updates -u` then `npm install` and rebuild.
    - If `npm ci` fails due to peer conflicts, pin conflicting tools (for example ESLint) to maintain plugin compatibility or use `--legacy-peer-deps` when installing.

- **npm ci failing with peer dependency conflicts**
  - Cause: `package.json` and `package-lock.json` disagree after `ncu` changes or plugin peer ranges are incompatible with newer major versions.
  - Fixes:
    - Option A (conservative): Keep `eslint` at `^8.x` to satisfy current plugin peers. This repo pinned `eslint` back to `^8.57.1` to allow `npm ci`.
    - Option B (aggressive): Upgrade ESLint and plugins together to versions compatible with each other (requires checking each plugin's peer range).
    - Option C (temporary): `npm install --legacy-peer-deps` to bypass strict peer checks.

**Files changed during investigation**
- [src/adapters/loader.js](src/adapters/loader.js) — resilient module-dir resolution and adapter-dir fallbacks.
- [seed/seed.js](seed/seed.js) — safe MODULE_DIR fallback in place of `import.meta.url` assumption.
-- (removed) legacy runtime shim — adapters should import from [src/adapters/index.js](src/adapters/index.js) and be bundled for the SEA build.
- [src/core/search.js](src/core/search.js) — additional candidate locations for `seed/standards.json`.
- [package.json](package.json) — dependency updates and ESLint pinned to `^8.57.1` to avoid peer conflicts.

**Recommendations**
- Commit the changes and updated `package-lock.json` so CI and other devs get the same dependency set.
- If you want to fully upgrade to the latest ESLint major line, plan a minor PR that updates ESLint and all related plugins together.
- Keep a `seed/standards.json` copy in `dist/seed/` when building installers so the shipped app always has the seed data.

If you'd like, I can:
- Run the test suite now (`npm test`) and report failures.
- Create a short `CONTRIBUTING.md` with these build steps.
- Revert the `ncu` changes and instead produce a small PR that upgrades eslint/plugins together.

