import fs from "fs";
import os from "os";
import path from "path";
import { MANIFEST_TTL_HOURS, MANIFEST_VERSION } from "./constants.js";
import {
	CanonicalID,
	coerceYear,
	coerceYearRange,
	normaliseLevelValue,
	normaliseStandardId,
	normaliseSubject,
	subjectCodeFor,
} from "./models.js";

const DATA_DIR = path.join(os.homedir(), ".ncea-cli");
const MANIFEST_PATH = path.join(DATA_DIR, "manifest.json");

function nowIso() {
	return new Date().toISOString();
}

function defaultManifest() {
	return {
		version: MANIFEST_VERSION,
		generated: nowIso(),
		ttl_hours: MANIFEST_TTL_HOURS,
		entries: {},
	};
}

export class ManifestService {
	constructor() {
		this.path = MANIFEST_PATH;
	}

	ensureFile() {
		if (!fs.existsSync(DATA_DIR)) {
			fs.mkdirSync(DATA_DIR, { recursive: true });
		}
		if (!fs.existsSync(this.path)) {
			fs.writeFileSync(
				this.path,
				JSON.stringify(defaultManifest(), null, 2),
				"utf-8"
			);
		}
	}

	load() {
		this.ensureFile();
		try {
			const raw = JSON.parse(fs.readFileSync(this.path, "utf-8"));
			if (!raw || typeof raw !== "object" || !raw.entries) {
				return defaultManifest();
			}
			return raw;
		} catch {
			return defaultManifest();
		}
	}

	save(manifest) {
		this.ensureFile();
		fs.writeFileSync(this.path, JSON.stringify(manifest, null, 2), "utf-8");
	}

	isStale(manifest) {
		if (!manifest?.generated) return true;
		const generated = new Date(manifest.generated).getTime();
		if (Number.isNaN(generated)) return true;
		const ttlHours = Number(manifest.ttl_hours || MANIFEST_TTL_HOURS);
		return Date.now() - generated > ttlHours * 60 * 60 * 1000;
	}

	getAllPapers(manifest = null) {
		const source = manifest || this.load();
		return Object.values(source.entries)
			.flatMap((entry) => entry.papers || [])
			.filter(Boolean);
	}

	keyForPaper(paper) {
		const id = new CanonicalID({
			standardId: paper.standardId,
			level: paper.level,
			subject: paper.subject,
		});
		return id.toString();
	}

	ensureEntryShape(entry, paper) {
		const normalisedSources = Array.isArray(entry?.sources)
			? entry.sources.reduce((acc, sourceName) => {
					acc[sourceName] = { successes: 0, failures: 0 };
					return acc;
				}, {})
			: { ...(entry?.sources || {}) };

		return {
			standardId: paper.standardId,
			level: normaliseLevelValue(paper.level),
			subject: normaliseSubject(paper.subject),
			title: paper.title || entry?.title || "",
			years: entry?.years || [],
			bulkZips: entry?.bulkZips || [],
			sources: normalisedSources,
			preferred_source: entry?.preferred_source || null,
			last_verified: entry?.last_verified || nowIso(),
			papers: entry?.papers || [],
		};
	}

	ensureSourceStats(entry, sourceName) {
		if (!entry.sources[sourceName]) {
			entry.sources[sourceName] = {
				successes: 0,
				failures: 0,
			};
		}
	}

	getEntryByPaper(paper, manifest = null) {
		const source = manifest || this.load();
		const key = this.keyForPaper(paper);
		return source.entries[key] || null;
	}

	getSourcePriorityAdjustment(paper, sourceName, manifest = null) {
		const entry = this.getEntryByPaper(paper, manifest);
		if (!entry || !entry.sources[sourceName]) return 0;
		const stats = entry.sources[sourceName];
		const total = stats.successes + stats.failures;
		if (total < 3) return 0;
		const failureRate = stats.failures / total;
		return failureRate >= 0.5 ? 1 : 0;
	}

	getPreferredSource(paper, manifest = null) {
		const entry = this.getEntryByPaper(paper, manifest);
		return entry?.preferred_source || null;
	}

	setPreferredSource(paper, sourceName) {
		const manifest = this.load();
		const key = this.keyForPaper(paper);
		const existing = manifest.entries[key];
		manifest.entries[key] = this.ensureEntryShape(existing, paper);
		manifest.entries[key].preferred_source = sourceName;
		manifest.entries[key].last_verified = nowIso();
		this.save(manifest);
	}

	getByStandardId(standardId, manifest = null) {
		const id = normaliseStandardId(standardId);
		if (!id) return [];
		return this.getAllPapers(manifest).filter((paper) => paper.standardId === id);
	}

	upsertPapers(papers) {
		const manifest = this.load();

		for (const paper of papers) {
			const key = this.keyForPaper(paper);
			const existing = manifest.entries[key];
			const next = this.ensureEntryShape(existing, paper);

			const years = new Set(next.years);
			const bulkZips = Array.isArray(next.bulkZips) ? [...next.bulkZips] : [];
			const existingPapers = next.papers || [];
			const duplicate = existingPapers.find(
				(p) => p.url === paper.url && p.sourceName === paper.sourceName
			);
			const papersList = duplicate ? existingPapers : existingPapers.concat(paper);

			const year = coerceYear(paper.year);
			if (year) {
				years.add(year);
			}

			if (paper.type === "bulk_zip") {
				const range = coerceYearRange(paper.yearFrom, paper.yearTo);
				if (range) {
					const candidate = { ...range, source: paper.sourceName };
					if (
						!bulkZips.some(
							(row) =>
								row.yearFrom === candidate.yearFrom &&
								row.yearTo === candidate.yearTo &&
								row.source === candidate.source
						)
					) {
						bulkZips.push(candidate);
					}
				}
			}

			this.ensureSourceStats(next, paper.sourceName);

			manifest.entries[key] = {
				...next,
				subjectCode: subjectCodeFor(next.subject),
				years: Array.from(years).sort((a, b) => a - b),
				bulkZips,
				last_verified: nowIso(),
				papers: papersList,
			};
		}

		manifest.version = MANIFEST_VERSION;
		manifest.generated = nowIso();
		manifest.ttl_hours = MANIFEST_TTL_HOURS;

		this.save(manifest);
		return manifest;
	}

	recordDownloadOutcome(paper, success) {
		const manifest = this.load();
		const key = this.keyForPaper(paper);
		const existing = manifest.entries[key];
		if (!existing) return;

		this.ensureSourceStats(existing, paper.sourceName);
		if (success) {
			existing.sources[paper.sourceName].successes += 1;
		} else {
			existing.sources[paper.sourceName].failures += 1;
		}
		existing.last_verified = nowIso();

		manifest.entries[key] = existing;
		this.save(manifest);
	}
}
