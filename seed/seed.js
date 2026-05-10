#!/usr/bin/env node

import axios from "axios";
import * as cheerio from "cheerio";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import iconv from "iconv-lite";
import { PDFParse } from "pdf-parse";
import { createHash } from "crypto";

// Compute a module directory that works in both ESM and CommonJS/bundled contexts.
let MODULE_DIR;
if (typeof __dirname !== "undefined") {
	MODULE_DIR = __dirname;
} else {
	try {
		MODULE_DIR = dirname(fileURLToPath(import.meta.url));
	} catch (err) {
		MODULE_DIR = process.cwd();
	}
}

const NZQA_BASE = "https://www.nzqa.govt.nz";
const NZQA_WWW2_BASE = "https://www2.nzqa.govt.nz";
const SUBJECTS_URL = `${NZQA_BASE}/ncea/subjects/`;
const SCHOLARSHIP_URL = `${NZQA_WWW2_BASE}/ncea/subjects/scholarship-subjects/`;
const SEARCH_URL = `${NZQA_BASE}/ncea/assessment/search.do`;
const LEVELS = [1, 2, 3];
const DELAY_MS = 400;
const SCHOLARSHIP_CONCURRENCY = 4;
const CACHE_DIR = join(MODULE_DIR, ".cache", "http");
const CACHE_ENABLED = process.env.SEED_NO_CACHE !== "1";
const CACHE_TTL_MS = Number(
	process.env.SEED_CACHE_TTL_MS || 7 * 24 * 60 * 60 * 1000
);

const BASE_HEADERS = {
	"User-Agent":
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
	"Accept-Language": "en-NZ,en;q=0.9",
};

const SEARCH_HEADERS = {
	...BASE_HEADERS,
	Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ensureCacheDir() {
	if (!existsSync(CACHE_DIR)) {
		mkdirSync(CACHE_DIR, { recursive: true });
	}
}

function cacheFilePathForUrl(url) {
	const hash = createHash("sha1").update(url).digest("hex");
	return join(CACHE_DIR, `${hash}.bin`);
}

function readCacheEntry(filePath) {
	if (!existsSync(filePath)) return null;
	if (CACHE_TTL_MS > 0) {
		const age = Date.now() - statSync(filePath).mtimeMs;
		if (age > CACHE_TTL_MS) return null;
	}
	return readFileSync(filePath);
}

async function fetchWithCache(url, options = {}) {
	const { headers, timeout = 15000, responseType = "text" } = options;

	ensureCacheDir();
	const cachePath = cacheFilePathForUrl(url);

	if (CACHE_ENABLED) {
		const cached = readCacheEntry(cachePath);
		if (cached) {
			return responseType === "arraybuffer" ? cached : cached.toString("utf8");
		}
	}

	const res = await axios.get(url, {
		headers,
		timeout,
		responseType: "arraybuffer",
	});

	const body = Buffer.from(res.data);
	if (CACHE_ENABLED) writeFileSync(cachePath, body);

	return responseType === "arraybuffer" ? body : body.toString("utf8");
}

function scoreDecodedHtml(text) {
	const replacement = (text.match(/\uFFFD/g) || []).length;
	const c1Controls = (text.match(/[\u0080-\u009F]/g) || []).length;
	const mojibake = (text.match(/Ã.|Â.|â.|Ä.|Å./g) || []).length;
	return replacement * 5 + c1Controls * 4 + mojibake;
}

// NZQA pages can vary between UTF-8 content and latin1-ish responses.
// Decode both and pick the cleaner result to avoid mangled macrons.
function decodeNzqaHtml(buffer) {
	const utf8 = iconv.decode(buffer, "utf8");
	const latin1 = iconv.decode(buffer, "latin1");
	return scoreDecodedHtml(utf8) <= scoreDecodedHtml(latin1) ? utf8 : latin1;
}

// Sanity check: if a string contains a literal ? where a Māori macron should be,
// it means encoding is broken. Detects sequences like M?ori or ?huatanga.
function containsMangledMacron(str) {
	return /[a-zA-Z]\?[a-zA-Z]/.test(str);
}

function assertNoMangledMacrons(str, context) {
	if (containsMangledMacron(str)) {
		console.error(`\nFatal: mangled macron character detected in "${context}"`);
		console.error(`  Value: ${str}`);
		console.error(
			"  The response encoding is not being decoded correctly. Exiting."
		);
		process.exit(1);
	}
}

function repairMangledWithSubjectQuery(value, subjectQuery) {
	if (!value || !subjectQuery) return value;
	if (!containsMangledMacron(value)) return value;

	const mangledSubjectQuery = subjectQuery.replace(/[ĀāĒēĪīŌōŪū]/g, "?");
	if (mangledSubjectQuery === subjectQuery) return value;

	return value.replaceAll(mangledSubjectQuery, subjectQuery);
}

async function mapWithConcurrency(items, concurrency, worker) {
	const results = new Array(items.length);
	let nextIndex = 0;

	const runners = Array.from(
		{ length: Math.max(1, Math.min(concurrency, items.length)) },
		async () => {
			while (true) {
				const index = nextIndex++;
				if (index >= items.length) return;
				results[index] = await worker(items[index], index);
			}
		}
	);

	await Promise.all(runners);
	return results;
}

// ── Step 1: Collect all subject query terms from the NZQA subjects index ─────

async function fetchSubjectQueries() {
	console.log("Fetching NZQA subjects index...");
	const data = await fetchWithCache(SUBJECTS_URL, {
		headers: BASE_HEADERS,
		timeout: 10000,
	});
	const $ = cheerio.load(data, { decodeEntities: true });

	const queries = new Set();

	$("a[href*='assessment/search.do']").each((_, el) => {
		const href = $(el).attr("href") || "";
		const match = href.match(/[?&]query=([^&]+)/);
		if (match) queries.add(decodeURIComponent(match[1].replace(/\+/g, " ")));
	});

	$("a.links-list-block__link").each((_, el) => {
		const text = $(el)
			.text()
			.trim()
			.replace(/\s*\(.*?\)\s*$/, "");
		if (text) queries.add(text);
	});

	const result = [...queries].sort();
	console.log(`  Found ${result.length} subject query terms`);
	return result;
}

// ── Step 2: Search NZQA for achievement standards per subject + level ─────────

async function searchStandards(subjectQuery, level) {
	const paddedLevel = String(level).padStart(2, "0");
	const params = new URLSearchParams({
		query: subjectQuery,
		view: "achievements",
		level: paddedLevel,
	});

	const data = await fetchWithCache(`${SEARCH_URL}?${params}`, {
		headers: SEARCH_HEADERS,
		timeout: 15000,
		responseType: "arraybuffer",
	});
	const html = decodeNzqaHtml(Buffer.from(data));
	const $ = cheerio.load(html, { decodeEntities: true });
	const standards = [];

	$("tr.dataHighlight").each((_, row) => {
		const cells = $(row).find("td strong");
		if (cells.length < 4) return;

		const rawId = $(cells[0]).text().trim();
		const subjectRaw = $(cells[1]).text().trim();
		const titleRaw = $(cells[2]).text().trim();
		const subject = repairMangledWithSubjectQuery(subjectRaw, subjectQuery);
		const title = repairMangledWithSubjectQuery(titleRaw, subjectQuery);
		const credits = parseInt($(cells[3]).text().replace(/\D/g, ""), 10) || null;
		const assessmentType = $(cells[4]) ? $(cells[4]).text().trim() : null;

		if (!/^9\d{4}$/.test(rawId)) return;
		if (!title) return;
		if (assessmentType === "Internal") return;

		// Fail fast if encoding is broken
		assertNoMangledMacrons(title, `title of ${rawId}`);
		assertNoMangledMacrons(subject, `subject of ${rawId}`);

		standards.push({
			standardId: rawId,
			title,
			subject: subject || subjectQuery,
			level,
			credits,
			active: true,
		});
	});

	return standards;
}

// ── Step 3: Collect scholarship subject page URLs ─────────────────────────────

async function fetchScholarshipSubjectUrls() {
	console.log("Fetching scholarship subjects index...");
	const data = await fetchWithCache(SCHOLARSHIP_URL, {
		headers: BASE_HEADERS,
		timeout: 10000,
	});
	const $ = cheerio.load(data, { decodeEntities: true });

	const urls = [];
	$("a.links-list-block__link").each((_, el) => {
		const href = $(el).attr("href") || "";
		// Only follow internal scholarship subject links
		if (href.includes("/scholarship-subjects/") && !href.includes("#")) {
			const full = href.startsWith("http") ? href : `${NZQA_WWW2_BASE}${href}`;
			const subject = $(el)
				.text()
				.trim()
				.replace(/\s*New Zealand Scholarship\s*/i, "")
				.trim();
			if (!urls.find((u) => u.url === full)) urls.push({ url: full, subject });
		}
	});

	console.log(`  Found ${urls.length} scholarship subjects`);
	return urls;
}

// ── Step 4: Parse scholarship assessment specification PDFs for standard IDs ──

function extractScholarshipStandardIdFromText(text) {
	const nearPerformanceStandard = text.match(
		/Performance\s+Standard\s*[:\-]?\s*([\s\S]{0,200})/i
	);
	if (nearPerformanceStandard) {
		const idInSection = nearPerformanceStandard[1].match(/\b9\d{4}\b/);
		if (idInSection) return idInSection[0];
	}

	const allIds = [...text.matchAll(/\b9\d{4}\b/g)].map((m) => m[0]);
	const uniqueIds = [...new Set(allIds)];
	if (uniqueIds.length === 1) return uniqueIds[0];

	return null;
}

function toAbsoluteNzqaUrl(href) {
	if (!href) return null;
	if (href.startsWith("http")) return href;
	if (href.startsWith("/")) return `${NZQA_WWW2_BASE}${href}`;
	return `${NZQA_WWW2_BASE}/${href}`;
}

async function fetchScholarshipPageData({ url, subject }) {
	const data = await fetchWithCache(url, {
		headers: BASE_HEADERS,
		timeout: 15000,
	});
	const $ = cheerio.load(data, { decodeEntities: true });

	const pageTitle =
		$("h1.page-hero__title").text().trim() || $("h1").first().text().trim();

	let pdfUrl = null;
	$("a[href$='.pdf']").each((_, el) => {
		if (pdfUrl) return;
		const href = $(el).attr("href") || "";
		const text = $(el).text().trim();
		if (
			/assessment-specifications/i.test(href) ||
			(/assessment\s+specification/i.test(text) && /scholarship/i.test(text))
		) {
			pdfUrl = toAbsoluteNzqaUrl(href);
		}
	});

	if (!pdfUrl) {
		console.warn(
			`  ! No assessment specification PDF found for scholarship subject: ${subject} (${url})`
		);
		return null;
	}

	return { subject, pageTitle, pdfUrl };
}

async function fetchScholarshipStandard({ url, subject }) {
	const pageData = await fetchScholarshipPageData({ url, subject });
	if (!pageData) return null;

	const pdfData = await fetchWithCache(pageData.pdfUrl, {
		headers: BASE_HEADERS,
		timeout: 15000,
		responseType: "arraybuffer",
	});
	const parser = new PDFParse({ data: Buffer.from(pdfData) });
	const parsed = await parser.getText();
	await parser.destroy();
	const standardId = extractScholarshipStandardIdFromText(parsed.text || "");

	if (!standardId) {
		console.warn(
			`  ! No standard ID found in scholarship assessment specification PDF: ${subject} (${pageData.pdfUrl})`
		);
		return null;
	}

	assertNoMangledMacrons(subject, `scholarship subject: ${subject}`);

	return {
		standardId,
		title: `New Zealand Scholarship ${subject}`,
		subject,
		level: "scholarship",
		credits: null,
		active: true,
	};
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
	const catalogue = {};
	let totalRequests = 0;

	const subjects = await fetchSubjectQueries();

	for (const subject of subjects) {
		for (const level of LEVELS) {
			try {
				const standards = await searchStandards(subject, level);
				totalRequests++;

				for (const s of standards) {
					if (
						!catalogue[s.standardId] ||
						(!catalogue[s.standardId].credits && s.credits)
					) {
						catalogue[s.standardId] = s;
					}
				}

				if (standards.length > 0) {
					console.log(`  ${subject} L${level} -> ${standards.length} standards`);
				} else {
					process.stdout.write(".");
				}
			} catch (err) {
				// process.exit calls from assertNoMangledMacrons propagate naturally
				console.warn(`  x ${subject} L${level}: ${err.message}`);
			}

			await sleep(DELAY_MS);
		}
	}

	process.stdout.write("\n");

	// 3. Scrape scholarship subjects
	console.log("Scraping scholarship standards...");
	const scholarshipSubjects = await fetchScholarshipSubjectUrls();
	const scholarshipStandards = await mapWithConcurrency(
		scholarshipSubjects,
		SCHOLARSHIP_CONCURRENCY,
		async (entry) => {
			try {
				const standard = await fetchScholarshipStandard(entry);
				if (standard) {
					console.log(`  ${entry.subject} -> ${standard.standardId}`);
				}
				return standard;
			} catch (err) {
				console.warn(`  x ${entry.subject}: ${err.message}`);
				return null;
			} finally {
				await sleep(DELAY_MS);
			}
		}
	);

	for (const standard of scholarshipStandards) {
		if (standard && !catalogue[standard.standardId]) {
			catalogue[standard.standardId] = standard;
		}
	}

	process.stdout.write("\n");

	const uniqueCount = Object.keys(catalogue).length;
	const output = {
		meta: {
			generated: new Date().toISOString(),
			source: "NZQA achievement standards search",
			totalRequests,
			total: uniqueCount,
		},

		standards: catalogue,
	};

	const outPath = join(__dirname, "standards.json");
	writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");
	console.log(`Done. ${uniqueCount} unique standards written to ${outPath}`);
}

main().catch((err) => {
	console.error("Fatal:", err);
	process.exit(1);
});
