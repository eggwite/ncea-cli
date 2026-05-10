import axios from "axios";
import { PaperSourceAdapter } from "./index.js";
import {
	HTTP_TIMEOUT_MS,
	PaperType,
	INDEX_CACHE_TTL_MS,
} from "../core/constants.js";
import { normaliseLevelValue, normaliseStandardId } from "../core/models.js";
import { CacheService } from "../core/cache.js";
import { extractYear } from "../utils/index.js";

const CACHE_KEY = "quirky_index";
const STANDARD_CACHE_KEY_PREFIX = "quirky_standard_";

const BASE_URL = "https://nzqa-pdf.quirky.codes";

function encodeLocationPath(location) {
	return String(location || "")
		.split("/")
		.map((part) => encodeURIComponent(part))
		.join("/");
}

export class QuirkyAdapter extends PaperSourceAdapter {
	static displayName = "Quirky NZQA PDF API";

	async buildIndex() {
		const cached = CacheService.get(CACHE_KEY, INDEX_CACHE_TTL_MS);
		return Array.isArray(cached) ? cached : [];
	}

	async fetchByStandard(standardId) {
		const id = normaliseStandardId(standardId);
		if (!id) return [];

		const standardCacheKey = `${STANDARD_CACHE_KEY_PREFIX}${id}`;
		const cachedStandard = CacheService.get(standardCacheKey, INDEX_CACHE_TTL_MS);
		if (Array.isArray(cachedStandard)) {
			return cachedStandard.map((p) => this.normalisePaper(p)).filter(Boolean);
		}

		const cachedGlobal = CacheService.get(CACHE_KEY, INDEX_CACHE_TTL_MS);
		const globalIndex = Array.isArray(cachedGlobal) ? cachedGlobal : [];
		const existingForStandard = globalIndex.filter(
			(p) => String(p.standardId) === id
		);
		if (existingForStandard.length > 0) {
			CacheService.set(standardCacheKey, existingForStandard);
			return existingForStandard
				.map((p) => this.normalisePaper(p))
				.filter(Boolean);
		}

		try {
			const response = await axios.get(`${BASE_URL}/standard/${id}`, {
				timeout: HTTP_TIMEOUT_MS,
			});
			const data = response.data;
			if (!data || data.message !== "success" || !Array.isArray(data.rows)) {
				return [];
			}

			const fetched = [];
			const currentYear = new Date().getFullYear();
			const maxPastYear = currentYear - 1;

			for (const row of data.rows) {
				const location = String(row.location || "").trim();
				const fileName = String(row.fileName || "").trim();
				if (!location) continue;

				const encodedLocation = encodeLocationPath(location);
				const url = `${BASE_URL}/${encodedLocation}`;

				const year = extractYear(location, fileName);
				if (year && year > maxPastYear) continue;

				const parts = location.split("/");
				const subject = parts[0] || "Unknown";
				const levelMatch = (parts[1] || "").match(/level_(\d)/i);
				// The API encodes level in the path segment, so fall back to 0 if it is missing.
				const level = levelMatch ? normaliseLevelValue(levelMatch[1]) : 0;

				let type = PaperType.UNKNOWN;

				// Quirky uses short location codes where the suffix usually identifies the paper type.
				const tokenMatch =
					location.match(/-([a-z]{3})(?=-\d{4}|-)/i) ||
					location.match(/-([a-z]{3})\b/i);
				const token = tokenMatch ? tokenMatch[1].toLowerCase() : null;

				const codeMap = {
					exm: PaperType.EXAM,
					mex: PaperType.EXAM,
					exp: PaperType.EXEMPLAR,
					sxp: PaperType.EXEMPLAR,
					pep: PaperType.PEP,
					atr: PaperType.CD_TRANSCRIPT,
					cdt: PaperType.CD_TRANSCRIPT,
					res: PaperType.RESOURCE,
					frm: PaperType.RESOURCE,
					mfr: PaperType.RESOURCE,
					rep: PaperType.RESOURCE,
					ass: PaperType.SCHEDULE,
					sas: PaperType.SCHEDULE,
					spc: PaperType.SPECIFICATIONS,
				};

				if (token && codeMap[token]) {
					type = codeMap[token];
				} else {
					// Fall back to filename keywords when the compact code is not present.
					if (/\bexamination paper\b/i.test(fileName)) type = PaperType.EXAM;
					else if (
						/\bcd transcript\b|\baudio transcript\b|\btranscript\b/i.test(fileName)
					)
						type = PaperType.CD_TRANSCRIPT;
					else if (/\bprofile(?:s?) of expected performance\b/i.test(fileName))
						type = PaperType.PEP;
					else if (/\bcompact disc\b|\bcd\b|\baudio\b/i.test(fileName))
						type = PaperType.CD;
					else if (/\bexemplar\b/i.test(fileName)) type = PaperType.EXEMPLAR;
					else if (
						/\bassessment report\b|\bformulae resource\b|\bresource booklet\b|\bresource\b/i.test(
							fileName
						)
					)
						type = PaperType.RESOURCE;
					else if (/\bschedule\b/i.test(fileName)) type = PaperType.SCHEDULE;
					else if (/\bspecification\b/i.test(fileName))
						type = PaperType.SPECIFICATIONS;
				}

				fetched.push({
					standardId: id,
					subject,
					title: fileName || `Standard ${id}`,
					level,
					year,
					format: "pdf",
					url,
					sourceName: this.name,
					filename: `${id}_${year || "unknown"}_${type}.pdf`,
					type,
				});
			}

			// Merge fetched rows into global cache (dedupe by URL)
			const urls = new Set(globalIndex.map((r) => r.url));
			for (const p of fetched) {
				if (!urls.has(p.url)) {
					globalIndex.push(p);
					urls.add(p.url);
				}
			}
			CacheService.set(standardCacheKey, fetched);
			CacheService.set(CACHE_KEY, globalIndex);

			return fetched.map((p) => this.normalisePaper(p)).filter(Boolean);
		} catch {
			return [];
		}
	}
}
