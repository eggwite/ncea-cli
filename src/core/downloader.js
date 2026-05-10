import axios from "axios";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { DOWNLOAD_HEAD_TIMEOUT_MS } from "./constants.js";

export class DownloadService {
	/**
	 * Safely download a paper. Returns true if successful, string error if failed or manual URL needed.
	 */
	static async downloadInfo(paper, downloadPath) {
		try {
			// 1. Preflight HEAD request
			const headRes = await axios.head(paper.url, {
				headers: {
					"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ncea-cli",
				},
				timeout: DOWNLOAD_HEAD_TIMEOUT_MS,
				validateStatus: false,
			});

			if (headRes.status >= 400) {
				return `Failed preflight (Status: ${headRes.status}). Try manually: ${paper.url}`;
			}

			const contentType = headRes.headers["content-type"] || "";
			const contentLength = parseInt(headRes.headers["content-length"] || "0", 10);

			// If the response looks like HTML, we are probably seeing a redirect or captcha page.
			if (contentType.includes("text/html")) {
				return `Blocked by redirect or Captcha. Requires manual intervention: ${paper.url}`;
			}

			if (contentLength > 100 * 1024 * 1024) {
				// 100MB limit
				return `File too large (${(contentLength / 1024 / 1024).toFixed(2)}MB). Skipping.`; //! magic number
			}

			// 2. Start Download
			if (!fs.existsSync(downloadPath)) {
				fs.mkdirSync(downloadPath, { recursive: true });
			}

			// avoid overwriting files with identical filenames by generating a unique filename
			const makeSafeFilename = (dir, filename, source) => {
				const parsed = path.parse(filename);
				let base = parsed.name;
				const ext = parsed.ext || "";
				let candidate = `${base}${ext}`;
				const safeSource = String(source || "").replace(/[^a-z0-9\-_.]/gi, "_");
				let counter = 1;
				while (fs.existsSync(path.join(dir, candidate))) {
					if (safeSource) {
						candidate = `${base}_${safeSource}${ext}`;
						if (!fs.existsSync(path.join(dir, candidate))) break;
					}
					candidate = `${base}_${counter}${ext}`;
					counter += 1;
				}
				return candidate;
			};

			const safeFilename = makeSafeFilename(
				downloadPath,
				paper.filename,
				paper.sourceName
			);
			const destPath = path.join(downloadPath, safeFilename);
			const writeStream = fs.createWriteStream(destPath);

			const response = await axios({
				url: paper.url,
				method: "GET",
				responseType: "stream",
				headers: {
					// Some sources block obvious automation, so this keeps the request closer to a normal browser.
					"User-Agent":
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 ncea-cli/1.0", // Pretend to be a browser, added safe client marker for "polite scraping"
				},
			});

			await pipeline(response.data, writeStream);
			return true;
		} catch (err) {
			if (paper.url.includes("githubusercontent")) {
				// Known direct download URL that doesn't restrict GET requests usually
				return `Network error fetching repo content: ${err.message}`;
			}
			return `Failed to download: ${err.message}. Try manually: ${paper.url}`;
		}
	}
}
