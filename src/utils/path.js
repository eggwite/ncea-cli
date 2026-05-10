import os from "os";
import path from "path";

export function resolveDownloadPath(input) {
	const homeDir = os.homedir();
	const rawPath = String(input || "").trim();
	if (!rawPath) return path.join(homeDir, "Downloads");
	if (path.isAbsolute(rawPath)) return rawPath;
	if (rawPath === "~") return homeDir;
	if (rawPath.startsWith("~/") || rawPath.startsWith("~\\")) {
		return path.join(homeDir, rawPath.slice(2));
	}
	return path.resolve(homeDir, rawPath);
}
