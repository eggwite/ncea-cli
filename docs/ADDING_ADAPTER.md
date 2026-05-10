# Adding a New Adapter

This guide explains the technical requirements for adding a new paper source adapter to ncea-cli.

Adapters retrieve, map, and return paper data from an external source (HTML pages, JSON endpoints, etc.) into the exact JSON shape required by the CLI.

This guide describes the two supported runtime environments and how to author adapters that work in both:

- DEV — running from the repository (`node src/main.js`). Adapters are authored as raw ESM files in `src/adapters/` and can be dynamically loaded during development.
- SEA — the compiled, distributed executable. Adapters are statically imported into the bundle at build time and inlined; there is no runtime filesystem adapter directory in the SEA environment.

## `PaperSourceAdapter` API

Every adapter must extend the `PaperSourceAdapter` class and implement one or both of the main fetching methods. Adapter validity is determined by `instanceof PaperSourceAdapter` at runtime — the loader checks that an exported class extends the shared `PaperSourceAdapter` base.

### Imports required (development)
When authoring adapters in `src/adapters/` import the base class from `./index.js` and author the adapter as an ESM class that extends it.

```javascript
import { PaperSourceAdapter } from "./index.js";
import { PaperType, INDEX_CACHE_TTL_MS } from "../core/constants.js";
import { CacheService } from "../core/cache.js";

export class ExampleAdapter extends PaperSourceAdapter {
  static displayName = "Example Educational Source";

  async buildIndex() { /* ... */ }
  async fetchByStandard(standardId) { /* ... */ }
}
```

Note: In DEV you may use raw ESM adapters in `src/adapters/`. For the SEA (packaged) build, adapters are statically imported into the application bundle — to include a new adapter in the distributed executable, add it as a static import in `src/adapters/loader.js` and run the build step so the adapter is inlined.

### `buildIndex()`

The CLI uses this method to build a searchable catalogue of papers. If the source provides a bulk index or search page that lists all available papers, implement this method.

```javascript
/**
 * Scrapes the source to build a complete index of all available papers.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of raw paper objects.
 */
async buildIndex() {
  // 1. Fetch data from source endpoint
  // 2. Map data to the required JS object shape
  // 3. Return the mapped array
}
```

### `fetchByStandard(standardId)`

The CLI uses this method when a user selects a specific standard number. It is responsible for fetching all material associated with that standard.

```javascript
/**
 * Scrapes the source for papers belonging to a specific standard.
 * @param {string} standardId - The 5-digit standard ID to fetch papers for (e.g. "91606")
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of raw paper objects.
 */
async fetchByStandard(standardId) {
  // 1. Fetch data from the endpoint specific to standardId
  // 2. Map data to the required JS object shape
  // 3. Return the mapped array
}
```

## Required Data Shapes

Your methods must return arrays of plain JSON objects. You should map source-specific data to one of the following two schemas. 

Note: You must use the `PaperType` constants rather than raw string literals.

### Single File (PDFs, Docs)

```json
{
  "standardId": "91606",
  "subject": "Biology",
  "title": "Demonstrate understanding of trends in human evolution",
  "level": 3,
  "year": 2024,
  "format": "pdf",
  "url": "https://example.org/91606/2024/exam.pdf",
  "sourceName": "ExampleAdapter",
  "filename": "91606_2024_exam.pdf",
  "type": "exam" // Provided via PaperType.EXAM
}
```

### Bulk Archive (ZIPs)

```json
{
  "standardId": "91606",
  "subject": "Biology",
  "title": "Topic specific resources",
  "level": 3,
  "yearFrom": 2014,
  "yearTo": 2020,
  "format": "zip",
  "url": "https://example.org/91606/archive.zip",
  "sourceName": "ExampleAdapter",
  "filename": "91606_2014-2020_bulk.zip",
  "type": "bulk_zip" // Provided via PaperType.BULK_ZIP
}
```

## Data Normalisation & Validation Rules

When your adapter returns the array of paper objects, the `PaperSourceAdapter` base class runs `normalisePaper(paper)` for each row and invalid objects are dropped. The strict filtering rules are unchanged:
- `standardId` must be present and parseable.
- `url` must be present.
- For `PaperType.BULK_ZIP`, `coerceYearRange(yearFrom, yearTo)` must succeed.
- For single-file types, `coerceYear(year)` must succeed.

If your source data lacks valid years or other required fields, either supply parseable fallbacks or filter those rows before returning them from your adapter.

## Caching Data with `CacheService`

Fetching external data repeatedly per-keystroke or session wastes bandwidth. Use the internal `CacheService` to wrap your HTTP calls, providing a cache key string and a Time-To-Live (TTL) integer.

```javascript
import { CacheService } from "../core/cache.js";
import { INDEX_CACHE_TTL_MS } from "../core/constants.js";

// Inside your adapter method:
const CACHE_KEY = `example_adapter_index`;

return CacheService.getOrSet(CACHE_KEY, INDEX_CACHE_TTL_MS, async () => {
  // If the cache is valid, getOrSet skips this callback entirely.
  // Otherwise, it awaits this function, saves the result to ~/.ncea-cli-cache, and returns it.
  const response = await fetch("...");
  const data = await response.json();
  
  return data.map(item => ({
    // object mapping
  }));
});
```

## Fully Commented Adapter Example

This complete example illustrates `import` usage, `PaperType` categorisation, data mapping, and cache integration. Store new adapters in the `src/adapters/` directory.

```javascript
import { PaperSourceAdapter } from "./index.js";
import { CacheService } from "../core/cache.js";
import { HTTP_TIMEOUT_MS, INDEX_CACHE_TTL_MS, PaperType } from "../core/constants.js";

export class ExampleAdapter extends PaperSourceAdapter {
  static displayName = "Example Educational Source";

  /**
   * Scrapes the source to build a complete index of all available papers.
   * Cached to prevent spamming the source's index endpoint.
   * @returns {Promise<Array<Object>>} 
   */
  async buildIndex() {
    return CacheService.getOrSet("example_index", INDEX_CACHE_TTL_MS, async () => {
      try {
        // Fetch raw data
        const response = await fetch("https://example.org/api/index.json", {
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
        const rows = await response.json();

        // Map the source-specific objects to ncea-cli schema expectations
        return rows.map((row) => ({
          standardId: row.standardId, // string: "91606"
          subject: row.category || "Unknown", 
          title: row.name || `Standard ${row.standardId}`,
          level: Number(row.nqrLevel) || 0,
          year: Number(row.yearPublished), // Must be a valid integer, parsed by base
          format: "pdf",
          url: row.downloadLink, // The row will be dropped if url is completely missing
          sourceName: this.name, // Extracted from PaperSourceAdapter
          filename: `${row.standardId}_${row.yearPublished}_${PaperType.EXAM}.pdf`,
          type: PaperType.EXAM, // Always use PaperType constants instead of strings
        }));
      } catch (err) {
        console.error(`Failed to fetch from ${this.name}: ${err.message}`);
        // Return an empty array on failure so the CLI can fallback to other sources
        return [];
      }
    });
  }

  /**
   * Scrapes the source for papers belonging to a specific standard.
   * If this source's `buildIndex()` returns everything, standard fetching is just filtering it.
   * @param {string} standardId 
   * @returns {Promise<Array<Object>>}
   */
  async fetchByStandard(standardId) {
    if (!standardId) return [];

    // 'getIndex()' is a base adapter method that automatically calls your 
    // implemented 'buildIndex()', normalises the results, and caches them in ram.
    const index = await this.getIndex();
    
    // Filter the full catalogue down to exactly what the user selected
    return index.filter((paper) => String(paper.standardId) === standardId);
  }
}
```

### Notes on runtime exports and SEA build

During development author adapters as ESM in `src/adapters/` and import from `./index.js`. For the SEA build adapters are statically imported and inlined in the compiled bundle; there is no runtime adapter directory in the distributed executable. To include a new adapter in the SEA build:

1. Add the adapter source file to `src/adapters/` (ESM).
2. Add a static import in `src/adapters/loader.js` (so the bundler inlines it).
3. Run the build step (`npm run build:bundle`) to produce the release bundle.

Do not rely on undocumented runtime shims — import `PaperSourceAdapter` from `./index.js` instead.

## Pull Requests and Issues

If you've completed a new adapter and it works locally, consider submitting a Pull Request to merge your source into the main repository. 
If an adapter you've added is broken due to a core bug, or if you encounter typing/schema issues requiring core changes, please open an Issue with trace logs attached.
