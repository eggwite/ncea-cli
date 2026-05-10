import fs from "fs";
import path from "path";
import os from "os";

const CACHE_DIR = path.join(os.homedir(), ".ncea-cli-cache");
const DEFAULT_TTL = 1000 * 60 * 60 * 24; // 1 day
const DEFAULT_MEM_ENTRIES = 100;

if (!fs.existsSync(CACHE_DIR)) {
	fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function sanitizeKey(key) {
	if (typeof key !== "string") key = String(key);
	// keep safe filename characters, replace others with '_'
	const safe = key.replace(/[^a-zA-Z0-9._-]/g, "_");
	return safe.slice(0, 200);
}

export class CacheService {
	// In-memory LRU-like cache for hot hits
	static _mem = new Map();
	static _locks = new Map();
	static _maxMem =
		parseInt(process.env.NCEA_CACHE_MEM || "", 10) || DEFAULT_MEM_ENTRIES;

	static _filePathFor(key) {
		return path.join(CACHE_DIR, `${sanitizeKey(key)}.json`);
	}

	// Keep existing sync get for compatibility, but make it more robust and populate memory cache.
	static get(key, ttlMs = DEFAULT_TTL) {
		try {
			if (this._mem.has(key)) {
				const entry = this._mem.get(key);
				if (Date.now() - entry.timestamp <= ttlMs) {
					// bump LRU
					this._mem.delete(key);
					this._mem.set(key, entry);
					return entry.payload;
				}
				this._mem.delete(key);
			}

			const filePath = this._filePathFor(key);
			if (!fs.existsSync(filePath)) return null;

			const raw = fs.readFileSync(filePath, "utf-8");
			const data = JSON.parse(raw);
			if (Date.now() - data.timestamp > ttlMs) {
				try {
					fs.unlinkSync(filePath);
				} catch (e) {}
				return null;
			}

			// populate memory cache
			this._setMem(key, data.payload, data.timestamp);
			return data.payload;
		} catch (e) {
			return null;
		}
	}

	// Async getOrSet with concurrency deduplication and atomic write on set.
	static async getOrSet(key, ttlMs = DEFAULT_TTL, factory) {
		// fast sync check
		const cached = this.get(key, ttlMs);
		if (cached !== null && cached !== undefined) return cached;

		// If another caller is already creating this key, wait for it.
		if (this._locks.has(key)) {
			try {
				return await this._locks.get(key);
			} catch (e) {
				// fall through to retry
			}
		}

		const p = (async () => {
			try {
				const payload = await factory();
				if (payload !== undefined) {
					this.set(key, payload);
				}
				return payload;
			} finally {
				this._locks.delete(key);
			}
		})();

		this._locks.set(key, p);
		return p;
	}

	static set(key, payload) {
		const filePath = this._filePathFor(key);
		const tmpPath = `${filePath}.tmp`;
		const data = {
			timestamp: Date.now(),
			payload,
		};
		try {
			fs.writeFileSync(tmpPath, JSON.stringify(data), "utf-8");
			fs.renameSync(tmpPath, filePath);
			this._setMem(key, payload, data.timestamp);
		} catch (e) {
			try {
				fs.unlinkSync(tmpPath);
			} catch (e2) {}
		}
	}

	static _setMem(key, payload, timestamp = Date.now()) {
		try {
			if (this._mem.has(key)) this._mem.delete(key);
			this._mem.set(key, { payload, timestamp });
			// trim
			while (this._mem.size > this._maxMem) {
				const firstKey = this._mem.keys().next().value;
				this._mem.delete(firstKey);
			}
		} catch (e) {}
	}

	static clear() {
		try {
			if (fs.existsSync(CACHE_DIR)) {
				const files = fs.readdirSync(CACHE_DIR);
				for (const file of files) {
					if (!file.endsWith(".json")) continue;
					try {
						fs.unlinkSync(path.join(CACHE_DIR, file));
					} catch (e) {}
				}
			}
			this._mem.clear();
		} catch (e) {}
	}
}

// Periodic background cleanup of expired files (runs every 6 hours)
// Do not block process exit in CI runners; unref timer when possible.
try {
	if (!process.env.CI) {
		const tid = setInterval(
			() => {
				try {
					const files = fs.readdirSync(CACHE_DIR);
					const now = Date.now();
					for (const file of files) {
						if (!file.endsWith(".json")) continue;
						try {
							const full = path.join(CACHE_DIR, file);
							const raw = fs.readFileSync(full, "utf-8");
							const data = JSON.parse(raw);
							if (now - data.timestamp > DEFAULT_TTL * 7) {
								fs.unlinkSync(full);
							}
						} catch (e) {}
					}
				} catch (e) {}
			},
			1000 * 60 * 60 * 6
		);
		if (typeof tid.unref === "function") tid.unref();
	}
} catch (e) {}
