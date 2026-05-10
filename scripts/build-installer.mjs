import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const issPath = path.join(process.cwd(), "installer", "ncea-cli.iss");
const distExe = path.join(process.cwd(), "dist", "ncea-cli.exe");

if (!fs.existsSync(issPath)) {
	console.error("Inno Setup script not found at installer/ncea-cli.iss");
	process.exit(1);
}

if (!fs.existsSync(distExe)) {
	console.error(
		"dist/ncea-cli.exe not found. Run the SEA build to produce dist/ncea-cli.exe before running the installer build."
	);
	process.exit(1);
}

const isccCmd = "iscc";
console.log("Invoking Inno Setup Compiler (iscc) to build installer...");
const res = spawnSync(isccCmd, [issPath], { stdio: "inherit" });
if (res.error) {
	console.error(
		"Failed to run iscc: ensure Inno Setup (iscc) is installed and in your PATH."
	);
	process.exit(1);
}
if (res.status !== 0) process.exit(res.status);
console.log("Installer build finished.");
