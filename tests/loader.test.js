import { test } from "node:test";
import assert from "node:assert/strict";
import path from "path";

import { discoverAdapters } from "../src/adapters/loader.js";
import { PaperSourceAdapter } from "../src/adapters/index.js";

test("discoverAdapters (dev path) filters, loads and deduplicates adapter files", async (t) => {
	const fakeDir = "/fake/adapters";
	const mockFs = {
		readdirSync(dir, opts) {
			assert.equal(dir, fakeDir);
			return [
				{ name: "index.js", isFile: () => true },
				{ name: "loader.js", isFile: () => true },
				{ name: "valid.js", isFile: () => true },
				{ name: "dup1.js", isFile: () => true },
				{ name: "dup2.js", isFile: () => true },
				{ name: "readme.md", isFile: () => true },
			];
		},
	};

	const mockRequire = (modulePath) => {
		const name = path.basename(modulePath);
		if (name === "valid.js") {
			return {
				ValidAdapter: class ValidAdapter extends PaperSourceAdapter {
					constructor() {
						super();
						this.name = "Valid";
					}
					buildIndex() {}
					fetchByStandard() {}
					normalisePaper() {}
				},
			};
		}
		if (name === "dup1.js" || name === "dup2.js") {
			return {
				DupAdapter: class DupAdapter extends PaperSourceAdapter {
					constructor() {
						super();
						this.name = "Dup";
					}
					buildIndex() {}
					fetchByStandard() {}
					normalisePaper() {}
				},
			};
		}
		return {};
	};

	const results = await discoverAdapters({
		adaptersDir: fakeDir,
		requireFn: mockRequire,
		fsModule: mockFs,
	});

	// Expect two unique sources: Valid and Dup
	assert.equal(Array.isArray(results), true);
	const names = results.map((r) => r.sourceName).sort();
	assert.deepEqual(names, ["Dup", "Valid"].sort());
});

test("discoverAdapters handles empty directory (dev path)", async (t) => {
	const mockFs = {
		readdirSync() {
			return [];
		},
	};
	const res = await discoverAdapters({
		adaptersDir: "/empty",
		fsModule: mockFs,
		requireFn: () => ({}),
	});
	assert.deepEqual(res, []);
});
