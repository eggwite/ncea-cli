import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const cwd = process.cwd();
const distDir = path.join(cwd, "dist");
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

console.log("Running node --build-sea to generate executable...");
try {
	execSync(`node --build-sea ${path.join(cwd, "sea-config.json")}`, {
		stdio: "inherit",
	});
} catch (err) {
	console.error("node --build-sea failed:", err.message || err);
	process.exit(1);
}

const targetExe = path.join(distDir, "ncea-cli.exe");
if (!fs.existsSync(targetExe)) {
	console.error("Expected executable not found at", targetExe);
	process.exit(1);
}
console.log("SEA build complete:", targetExe);
