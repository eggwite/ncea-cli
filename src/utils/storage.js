import fs from "fs";
import path from "path";

export function getDirectorySize(dirPath) {
	if (!fs.existsSync(dirPath)) return 0;
	let total = 0;
	for (const item of fs.readdirSync(dirPath, { withFileTypes: true })) {
		const fullPath = path.join(dirPath, item.name);
		if (item.isDirectory()) {
			total += getDirectorySize(fullPath);
		} else if (item.isFile()) {
			total += fs.statSync(fullPath).size;
		}
	}
	return total;
}

export function getStorageUsage(cacheDir, dataDir) {
	const cacheBytes = getDirectorySize(cacheDir);
	const manifestBytes = getDirectorySize(dataDir);
	return {
		cacheBytes,
		manifestBytes,
		totalBytes: cacheBytes + manifestBytes,
	};
}
