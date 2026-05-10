import { build } from "esbuild";
import fs from "fs";
import path from "path";

const outDir = path.join(process.cwd(), "dist");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

await build({
	entryPoints: ["src/main.js"],
	bundle: true,
	platform: "node",
	format: "cjs",
	outfile: path.join(outDir, "bundle.cjs"),
	target: "node25",
	sourcemap: false,
	logLevel: "info",
});
console.log("Bundled to dist/bundle.cjs");
