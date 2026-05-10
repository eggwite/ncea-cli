# ncea-cli Documentation

## Overview

ncea-cli is an interactive command-line tool for finding and downloading NCEA past papers.

It is optimised for manual terminal use and supports:

- Smart search over titles, subjects, and keywords.
- Ranking that keeps exact matches in the results when they fit best.
- Multi-source paper retrieval with source preference handling.
- Local manifest and adapter caching for faster repeat usage.
- Maintenance commands for clearing cache and manifest data.

Primary entry point:

- [src/main.js](src/main.js)

## Install and Run

**Prerequisites:** 
- [Node.js](https://nodejs.org/) (Version 18+ is required to run the native test suite and native fetch).

Install dependencies:

```bash
npm install
```

Start interactive mode (from source):

```bash
npm start
```

Run directly:

```bash
node src/main.js
```

**Global Installation (Optional):**
If you want to run the tool from anywhere without navigating to the project folder, you can link it globally.
```bash
npm link
# You can now run the app from any directory
ncea
```

## CLI Options

- `-s, --search <query>`: Smart search by subject, title, or keywords.
- `-p, --path <path>`: Override the download destination.
- `-r, --refresh`: Bypass cached manifest data and refresh from sources.
- `--source <source>`: Force a source for the current session.
- `--clear-cache`: Delete cached adapter data in `~/.ncea-cli-cache`.
- `--clear-manifest-index`: Delete manifest/index data in `~/.ncea-cli`.
- `-y, --yes`: Skip confirmation prompts for destructive actions.

Example:

```bash
node src/main.js --search "L3 complex numbers" --refresh --path ./downloads
```

## Interactive Flow

1. Choose an action.
- Smart search.
- Configure settings.
- Exit.

2. Search results.
- The app returns ranked matching standards.
- You choose a standard from a select menu.
- You can choose Back to return to the main menu.

3. Standard paper selection.
- The app fetches papers for the selected standard.
- You choose one or more year or item entries.
- You choose one or more paper types per entry.
- If multiple sources are available, source selection is handled automatically or via prompt.

4. Download.
- Selected papers are deduplicated by `sourceName|url`.
- Downloads run with progress updates.
- Failed downloads can be retried once.

## Search Behaviour

The search flow is fuzzy-first, but it does not ignore exact matches. If a result is a strong literal match, it can rank first alongside fuzzy matches. When the scorer is uncertain, the CLI warns you before you continue.

The search flow also supports scholarship queries and common shorthand such as `schol` and `schl`.

## Settings

Settings are managed from the interactive Settings menu.

These options mainly control where files are saved, whether the app should refresh its saved data, and which source it should prefer when more than one site has the same paper.

Supported settings:

- `default_download_path`: Where downloaded files are saved.
- `always_refresh_sources`: Always check the source sites live instead of using saved data.
- `auto_select_source`: Automatically pick the best source when more than one is available.
- `default_source_override`: Always prefer one source unless you choose otherwise.
- `favorite_source`: The source the app should try first.

Source settings include:

- Preferred source: the site the app should try first.
- Auto-select source: whether the app should choose for you when possible.
- Default source override: a hard preference for one source.

## Data, Cache, and Manifest

The app keeps a small amount of saved data on your computer so it can open faster and avoid downloading the same information repeatedly.

Cache path:

- `~/.ncea-cli-cache`

Saved data path:

- `~/.ncea-cli`

Clear commands:

Use these if you want to force the app to rebuild its saved data from scratch.

```bash
node src/main.js --clear-cache -y
node src/main.js --clear-manifest-index -y
```

## Adapter System

Current adapters:

- `OurExamsAdapter`
- `StudyTimeAdapter`
- `NoBrainTooSmallAdapter`
- `QuirkyAdapter`
- `ToastingMeAdapter` when present in the source tree

Base adapter contract:

- [src/adapters/index.js](src/adapters/index.js)

Add-a-new-adapter specification:

- [ADDING_ADAPTER.md](ADDING_ADAPTER.md)

## Project Structure

Main folders:

- `src/adapters`: Source adapters.
- `src/core`: Search, models, config, cache, downloader, and manifest.
- `src/core/search`: Search helper modules.
- `src/utils`: Prompt and utility helpers.
- `tests`: Unit tests.
- `seed`: Tools to generate `standards.json` (the source of truth for the system's known NCEA standards).

### Seeding Baseline Data
If the official NZQA standard titles or subject categorisation changes, you can rebuild the base standard catalogue natively by running:
```bash
node seed/seed.js
```

## Scripts

From `package.json`:

- `npm start`: Run the CLI.
- `npm test`: Run the test suite.
- `npm run bench:search`: Run the search benchmark script.
- `npm run lint`: Lint `src/`.
- `npm run lint:fix`: Lint and auto-fix `src/`.

## Testing

Run the test suite:

```bash
npm test
```

Current tests validate parsing and search ranking behaviour.

## Developer Notes

Main integration points when adding or changing a source:

- `src/core/search.js`: adapter registration and fetch/index orchestration.
- `src/core/constants.js`: source priority and constants.
- `src/core/config.js`: validation for `favorite_source` and `default_source_override`.
- `src/main.js`: settings menu source options.

If you are not modifying the code, you can ignore this section.

## Troubleshooting

If no results appear:

- Retry with `--refresh`.
- Verify the query has a valid subject or title token.

If source selection feels wrong:

- Check `favorite_source` and `default_source_override` in settings.
- Toggle `auto_select_source`.

If downloads fail:

- Retry failed downloads from the built-in prompt.
- Switch source override and retry.

## Contributing

Community contributions are welcome, particularly for new adapters as paper sources shift and change!

1. Check existing Issues or open a new one prior to tackling major core modifications.
2. If adding an adapter, read [ADDING_ADAPTER.md](ADDING_ADAPTER.md).
3. Ensure you follow standard JavaScript style guidelines. Use `npm run lint` and `npm run lint:fix` to check your work. 
4. Verify everything works with `npm test` before submitting your Pull Request.