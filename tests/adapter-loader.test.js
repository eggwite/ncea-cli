import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { discoverAdapters } from "../src/adapters/loader.js";

function writeFile(filePath, content) {
	fs.writeFileSync(filePath, content, "utf8");
}

test("discoverAdapters loads exported adapter classes", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ncea-adapters-"));
	try {
		const baseAdapterUrl = pathToFileURL(
			path.resolve(process.cwd(), "src/adapters/index.js")
		).href;

		writeFile(
			path.join(tempDir, "example.js"),
			[
				`import { PaperSourceAdapter } from ${JSON.stringify(baseAdapterUrl)};`,
				"export class ExampleAdapter extends PaperSourceAdapter {",
				"\tstatic displayName = 'Example Source';",
				"}",
			].join("\n")
		);
		writeFile(path.join(tempDir, "helper.js"), "export const ignored = true;\n");

		const entries = await discoverAdapters({ adaptersDir: tempDir });
		assert.equal(entries.length, 1);
		assert.equal(entries[0].sourceName, "ExampleAdapter");
		assert.equal(entries[0].displayName, "Example Source");
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("discoverAdapters keeps only one adapter per source name", async () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ncea-adapters-"));
	try {
		const baseAdapterUrl = pathToFileURL(
			path.resolve(process.cwd(), "src/adapters/index.js")
		).href;

		const duplicateAdapterModule = [
			`import { PaperSourceAdapter } from ${JSON.stringify(baseAdapterUrl)};`,
			"export class DuplicateAdapter extends PaperSourceAdapter {}",
		].join("\n");

		writeFile(path.join(tempDir, "a.js"), duplicateAdapterModule);
		writeFile(path.join(tempDir, "b.js"), duplicateAdapterModule);

		const entries = await discoverAdapters({ adaptersDir: tempDir });
		assert.equal(entries.length, 1);
		assert.equal(entries[0].sourceName, "DuplicateAdapter");
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});
