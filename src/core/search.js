import fs from "fs";
import path from "path";
import Fuse from "fuse.js";
import { isSea, getAsset } from "node:sea";

import { discoverAdapters } from "../adapters/loader.js";
import { config } from "./config.js";
import {
	DEFAULT_FAVORITE_SOURCE,
	PaperType,
	SOURCE_PRIORITY,
} from "./constants.js";
import { parseQuery, normaliseStandardId, normaliseSubject } from "./models.js";
import { normaliseLevelValue } from "./models.js";
import { ManifestService } from "./manifest.js";
import { buildSubjectAliases } from "./search/subjectAliases.js";
import { cleanSearchText } from "./search/cleanSearchText.js";
import {
	scoreSearchTextMatch,
	scoreSearchTokenMatch,
} from "./search/tokenNormalise.js";
import { prettifyTypeLabel } from "./search/typeLabels.js";

// Keep the offline shortlist small so fuzzy ranking stays fast and focused.
const MAX_NON_EXACT_RESULT_GROUPS = 5;

function classifySearchConfidence(score, gap) {
	// These bands separate a clear winner from a near-tie in the offline ranker.
	if (score >= 16 && gap >= 4) return "high";
	if (score >= 10 && gap >= 2) return "medium";
	return "low";
}

export class SearchAggregator {
	constructor() {
		this.adapters = [];
		this.adapterMetaByName = new Map();
		this.adapterLoadPromise = null;
		this.manifestService = new ManifestService();
		this.searchIndex = [];
		this.standardResultsMemo = new Map();
		this.seedStandardsCache = null;
		this.seedSubjectVocabularyCache = null;
	}

	async initialise() {
		// Manifest is lazily refreshed during search; initialise ensures file exists.
		this.manifestService.ensureFile();
		await this.ensureAdaptersLoaded();
	}

	async ensureAdaptersLoaded({ forceReload = false } = {}) {
		if (!forceReload && this.adapters.length > 0) {
			return this.adapters;
		}

		if (!forceReload && this.adapterLoadPromise) {
			return this.adapterLoadPromise;
		}

		this.adapterLoadPromise = discoverAdapters()
			.then((entries) => {
				this.adapters = entries.map((entry) => entry.adapter);
				this.adapterMetaByName = new Map(
					entries.map((entry) => [entry.sourceName, entry])
				);
				return this.adapters;
			})
			.finally(() => {
				this.adapterLoadPromise = null;
			});

		return this.adapterLoadPromise;
	}

	getSourceDisplayName(sourceName) {
		const key = String(sourceName || "");
		return this.adapterMetaByName.get(key)?.displayName || key;
	}

	getSourceOptions() {
		const names = [...this.adapterMetaByName.keys()];
		const priorityOrder = this.getPriorityOrder();

		names.sort((a, b) => {
			// Preserve configured source preference first, then fall back to alphabetical order.
			const aIndex = priorityOrder.indexOf(a);
			const bIndex = priorityOrder.indexOf(b);
			const aRank = aIndex === -1 ? priorityOrder.length : aIndex;
			const bRank = bIndex === -1 ? priorityOrder.length : bIndex;
			if (aRank !== bRank) return aRank - bRank;
			return a.localeCompare(b);
		});

		return names.map((name) => ({
			value: name,
			label: this.getSourceDisplayName(name),
		}));
	}

	getActiveSourceNames() {
		return new Set(this.adapters.map((adapter) => adapter.name));
	}

	filterActiveSources(papers) {
		const active = this.getActiveSourceNames();
		return papers.filter((paper) => active.has(String(paper.sourceName || "")));
	}

	async getSearchIndex({ refresh = false } = {}) {
		await this.ensureAdaptersLoaded();
		const manifest = this.manifestService.load();

		if (!refresh) {
			const cached = this.filterActiveSources(
				this.manifestService.getAllPapers(manifest)
			);
			if (cached.length > 0) {
				this.searchIndex = cached;
				return cached;
			}
		}

		// Load all adapter indexes in parallel to avoid serial network timeouts
		const adapterPromises = this.adapters.map((adapter) => adapter.getIndex());
		const adapterResults = await Promise.allSettled(adapterPromises);
		let combined = adapterResults
			.flatMap((result) => (result.status === "fulfilled" ? result.value : []))
			.filter(Boolean);

		if (combined.length > 0) {
			this.manifestService.upsertPapers(combined);
		}

		this.searchIndex = combined;
		return combined;
	}

	getPriorityOrder() {
		const favorite = config.get("favorite_source") || DEFAULT_FAVORITE_SOURCE;
		const order = SOURCE_PRIORITY.filter(Boolean);
		if (!order.includes(favorite)) {
			return order;
		}
		return [favorite, ...order.filter((name) => name !== favorite)];
	}

	sourceRank(paper, priorityOrder, manifest = null) {
		const sourceName = paper.sourceName || "";
		const baseIndex = priorityOrder.indexOf(sourceName);
		const indexScore = baseIndex === -1 ? priorityOrder.length + 1 : baseIndex;
		// Source priority adjustment is manifest-driven, so it can override the base order.
		const penalty = this.manifestService.getSourcePriorityAdjustment(
			paper,
			sourceName,
			manifest
		);
		const preferredSource = this.manifestService.getPreferredSource(
			paper,
			manifest
		);
		const preferredBoost =
			// Preferred source gets a slight boost, but never enough to override a
			// clearly better-ranked source.
			preferredSource && preferredSource === sourceName ? -0.5 : 0;
		return indexScore + penalty + preferredBoost;
	}

	sortBySourcePriority(papers, manifest = null) {
		const priorityOrder = this.getPriorityOrder();
		return [...papers].sort((a, b) => {
			const aRank = this.sourceRank(a, priorityOrder, manifest);
			const bRank = this.sourceRank(b, priorityOrder, manifest);
			if (aRank !== bRank) return aRank - bRank;
			return String(a.sourceName).localeCompare(String(b.sourceName));
		});
	}

	isBulkPaper(paper) {
		return paper.type === PaperType.BULK_ZIP;
	}

	async searchExactByStandardId(standardId, { refresh = false } = {}) {
		await this.ensureAdaptersLoaded();
		const id = normaliseStandardId(standardId);
		if (!id) return [];

		// Reuse the last exact lookup unless the caller explicitly asks for fresh source data.
		if (!refresh && this.standardResultsMemo.has(id)) {
			return this.standardResultsMemo.get(id);
		}

		let results = [];
		const manifest = this.manifestService.load();

		if (!refresh && !this.manifestService.isStale(manifest)) {
			results = this.filterActiveSources(
				this.manifestService.getByStandardId(id, manifest)
			);
		}

		if (results.length === 0 || refresh) {
			const fromSources = await Promise.allSettled(
				this.adapters.map((adapter) => adapter.fetchByStandard(id))
			);
			results = results.concat(
				fromSources
					.flatMap((result) => (result.status === "fulfilled" ? result.value : []))
					.filter(Boolean)
			);
			if (results.length > 0) {
				this.manifestService.upsertPapers(results);
			}
		}

		if (!refresh) {
			this.standardResultsMemo.set(id, results);
		}

		return results;
	}

	clearRuntimeMemo() {
		this.standardResultsMemo.clear();
	}

	clearSeedCaches() {
		this.seedStandardsCache = null;
		this.seedSubjectVocabularyCache = null;
	}

	getSeedStandardById(standardId) {
		const id = normaliseStandardId(standardId);
		if (!id) return null;

		return (
			this.loadSeedStandards().find(
				(row) => normaliseStandardId(row?.standardId) === id
			) || null
		);
	}

	formatYearRange(years) {
		if (years.length === 0) return "Unknown";
		if (years.length === 1) return String(years[0]);
		return `${years[0]}-${years[years.length - 1]}`;
	}

	prettifyType(type) {
		return prettifyTypeLabel(type);
	}

	buildLabel(group) {
		const levelDisplay =
			group.level === "scholarship"
				? "Scholarship"
				: Number(group.level) > 0
					? `L${group.level}`
					: "L?";
		return `Standard ${group.standardId} - ${group.title} (${group.subject} ${levelDisplay})`;
	}

	groupResults(papers) {
		const grouped = {};
		const manifest = this.manifestService.load();

		for (const paper of this.sortBySourcePriority(papers, manifest)) {
			const standardKey = paper.standardId;
			const isBulk = this.isBulkPaper(paper);
			const year = Number(paper.year);
			const yearFrom = Number(paper.yearFrom);
			const yearTo = Number(paper.yearTo);
			if (!grouped[standardKey]) {
				const seedStandard = this.getSeedStandardById(standardKey);
				grouped[standardKey] = {
					standardId: paper.standardId,
					level: normaliseLevelValue(paper.level),
					title:
						String(seedStandard?.title || paper.title || "").trim() ||
						`Standard ${paper.standardId}`,
					subject: normaliseSubject(paper.subject),
					entries: {},
				};
			}

			const standardGroup = grouped[standardKey];
			const entryKey = isBulk
				? `bulk_${paper.yearFrom}_${paper.yearTo}`
				: `year_${paper.year}`;

			if (!standardGroup.entries[entryKey]) {
				standardGroup.entries[entryKey] = {
					entryKey,
					isBulk,
					year: isBulk ? null : year,
					yearFrom: isBulk ? yearFrom : null,
					yearTo: isBulk ? yearTo : null,
					papersByType: {},
					sourceSet: new Set(),
				};
			}

			const entry = standardGroup.entries[entryKey];
			entry.sourceSet.add(paper.sourceName);
			if (!entry.papersByType[paper.type]) {
				entry.papersByType[paper.type] = [];
			}
			entry.papersByType[paper.type].push(paper);
		}

		return Object.values(grouped).map((group) => {
			const entries = Object.values(group.entries).map((entry) => {
				const typeChoices = Object.keys(entry.papersByType)
					.sort()
					.map((type) => ({
						type,
						label: this.prettifyType(type),
						papers: this.sortBySourcePriority(entry.papersByType[type], manifest),
						sourceCount: new Set(
							entry.papersByType[type].map((paper) => paper.sourceName)
						).size,
					}));

				const sourceSummary = Array.from(entry.sourceSet).sort().join(", ");
				const typeSummary = typeChoices.map((type) => type.label).join(", ");

				return {
					...entry,
					typeChoices,
					sourceSummary,
					typeSummary,
					label: entry.isBulk
						? `Bulk ZIP ${entry.yearFrom}-${entry.yearTo}`
						: `${entry.year}`,
				};
			});

			entries.sort((a, b) => {
				if (a.isBulk && !b.isBulk) return 1;
				if (!a.isBulk && b.isBulk) return -1;
				if (a.isBulk && b.isBulk) return (a.yearFrom || 0) - (b.yearFrom || 0);
				return (b.year || 0) - (a.year || 0);
			});

			return {
				standardId: group.standardId,
				level: group.level,
				title: group.title,
				subject: group.subject,
				label: this.buildLabel(group),
				entries,
			};
		});
	}

	loadSeedStandards() {
		if (this.seedStandardsCache) {
			return this.seedStandardsCache;
		}

		if (isSea()) {
			try {
				const raw = JSON.parse(getAsset("standards.json", "utf8"));
				this.seedStandardsCache = Object.values(raw?.standards || {});
				return this.seedStandardsCache;
			} catch {
				this.seedStandardsCache = [];
				return this.seedStandardsCache;
			}
		}

		// Look in a few places depending on whether we're running from source,
		// from the built `dist` tree, or from an installed/bundled location.
		const appDir = path.dirname(process.argv[1] || process.cwd());
		const candidates = [
			path.resolve(process.cwd(), "seed/standards.json"),
			path.resolve(process.cwd(), "seeds/standards.json"),
			path.resolve(appDir, "seed/standards.json"),
			path.resolve(appDir, "seeds/standards.json"),
			path.resolve(appDir, "dist", "seed", "standards.json"),
		];

		for (const standardsPath of candidates) {
			if (!fs.existsSync(standardsPath)) continue;
			try {
				const raw = JSON.parse(fs.readFileSync(standardsPath, "utf8"));
				this.seedStandardsCache = Object.values(raw?.standards || {});
				return this.seedStandardsCache;
			} catch {
				this.seedStandardsCache = [];
				return this.seedStandardsCache;
			}
		}

		this.seedStandardsCache = [];
		return this.seedStandardsCache;
	}

	buildSubjectAliases(subject) {
		return buildSubjectAliases(subject);
	}

	getSeedSubjectVocabulary() {
		if (this.seedSubjectVocabularyCache) {
			return this.seedSubjectVocabularyCache;
		}

		const standards = this.loadSeedStandards().filter(Boolean);
		const bySubject = new Map();

		for (const row of standards) {
			const subject = normaliseSubject(row.subject);
			if (!subject || subject === "Unknown") continue;

			if (!bySubject.has(subject)) {
				bySubject.set(subject, {
					subject,
					aliases: new Set(),
				});
			}

			const bucket = bySubject.get(subject);
			for (const alias of this.buildSubjectAliases(row.subject)) {
				bucket.aliases.add(alias);
			}
		}

		this.seedSubjectVocabularyCache = [...bySubject.values()].map((entry) => ({
			subject: entry.subject,
			aliases: [...entry.aliases],
		}));

		return this.seedSubjectVocabularyCache;
	}

	rankSeedStandardCandidates(parsedQuery, limit = 3) {
		const standards = this.loadSeedStandards().filter(
			(row) => row && row.standardId
		);
		if (standards.length === 0) return [];

		let filtered = standards;
		if (parsedQuery.level) {
			filtered = filtered.filter(
				(row) =>
					normaliseLevelValue(row.level) === normaliseLevelValue(parsedQuery.level)
			);
		}

		if (parsedQuery.subject) {
			const querySubject = normaliseSubject(parsedQuery.subject).toLowerCase();
			const subjectMatched = filtered.filter((row) => {
				const rowSubject = normaliseSubject(row.subject).toLowerCase();
				return rowSubject === querySubject || rowSubject.includes(querySubject);
			});
			if (subjectMatched.length > 0) {
				filtered = subjectMatched;
			}
		}

		const searchQuery = cleanSearchText(parsedQuery.raw, parsedQuery.level);
		const queryTerms = searchQuery.split(" ").filter(Boolean);
		const subjectAliasTokens = parsedQuery.subject
			? new Set(
					this.buildSubjectAliases(parsedQuery.subject)
						.flatMap((alias) => alias.split(/\s+/))
						.map((token) => cleanSearchText(token).trim())
						.filter(Boolean)
				)
			: new Set();
		const rankingQueryTerms =
			parsedQuery.subjectConfidence === "explicit"
				? // If the subject is already explicit, drop terms that only restate it.
					queryTerms.filter(
						(token) =>
							!Array.from(subjectAliasTokens).some(
								(aliasToken) => scoreSearchTokenMatch(token, aliasToken) >= 8
							)
					)
				: queryTerms;
		const effectiveQueryTerms =
			rankingQueryTerms.length > 0 ? rankingQueryTerms : queryTerms;

		const scoreStandard = (row) => {
			const titleText = cleanSearchText(row.shortTitle || row.title || "");
			const subjectText = cleanSearchText(row.subject || "");
			const titleScore = scoreSearchTextMatch(
				effectiveQueryTerms,
				titleText.split(" ")
			);
			const subjectScore = scoreSearchTextMatch(
				effectiveQueryTerms,
				subjectText.split(" ")
			);
			// Subject matches help, but they are capped so a weak subject hit does not
			// outrank a much better title match.
			// Subject text helps, but it is capped so it cannot overpower the title.
			return titleScore + Math.min(subjectScore, 6);
		};

		if (!searchQuery) {
			return filtered.slice(0, limit).map((row) => ({
				standardId: String(row.standardId),
				score: 0,
				fuseScore: 1,
				confidence: "low",
			}));
		}

		const fuseCandidates = new Fuse(filtered, {
			keys: ["standardId", "shortTitle", "title", "subject"],
			// Subject-constrained queries can be tighter; free-text queries need a
			// wider net because users often omit the exact title.
			threshold: parsedQuery.subject ? 0.32 : 0.42,
			ignoreLocation: true,
			includeScore: true,
		})
			.search(searchQuery)
			.sort((a, b) => {
				const aScore = scoreStandard(a.item);
				const bScore = scoreStandard(b.item);
				if (aScore !== bScore) return bScore - aScore;
				if ((a.score ?? 0) !== (b.score ?? 0))
					return (a.score ?? 0) - (b.score ?? 0);
				return String(a.item.standardId).localeCompare(String(b.item.standardId));
			});

		const candidates =
			fuseCandidates.length > 0
				? fuseCandidates
				: filtered.map((item) => ({ item, score: 1 }));

		const scored = candidates.map(({ item, score }) => ({
			standardId: String(item.standardId),
			item,
			score: scoreStandard(item),
			fuseScore: score ?? 1,
		}));

		scored.sort((a, b) => {
			// Rank by our domain score first, then use Fuse and ID order as tie-breakers.
			if (a.score !== b.score) return b.score - a.score;
			if (a.fuseScore !== b.fuseScore) return a.fuseScore - b.fuseScore;
			return a.standardId.localeCompare(b.standardId);
		});

		const dedupedEntries = [];
		const seen = new Set();
		for (const entry of scored) {
			if (seen.has(entry.standardId)) continue;
			seen.add(entry.standardId);
			dedupedEntries.push(entry);
		}

		if (dedupedEntries.length > 0) {
			// Confidence is based on the gap between the top two unique standards.
			const topScore = dedupedEntries[0]?.score ?? 0;
			const secondScore = dedupedEntries[1]?.score ?? 0;
			const gap = topScore - secondScore;
			const confidence = classifySearchConfidence(topScore, gap);
			return dedupedEntries.slice(0, limit).map((entry) => ({
				standardId: entry.standardId,
				score: entry.score,
				fuseScore: entry.fuseScore,
				confidence,
				matchGap: gap,
			}));
		}

		if (parsedQuery.subject || parsedQuery.level) {
			return filtered.slice(0, limit).map((row) => ({
				standardId: String(row.standardId),
				score: 0,
				fuseScore: 1,
				confidence: "low",
			}));
		}

		return [];
	}

	rankSeedStandardIds(parsedQuery, limit = 3) {
		return this.rankSeedStandardCandidates(parsedQuery, limit).map(
			(entry) => entry.standardId
		);
	}

	buildOfflineStandardGroups(standardIds) {
		const byId = new Map(
			this.loadSeedStandards().map((row) => [String(row.standardId), row])
		);

		return standardIds
			.map((id) => {
				const standardId = String(id?.standardId || id);
				const row = byId.get(standardId);
				if (!row) return null;
				const matchScore = typeof id === "object" ? (id.score ?? null) : null;
				const matchGap = typeof id === "object" ? (id.matchGap ?? null) : null;
				const matchConfidence =
					typeof id === "object" ? (id.confidence ?? null) : null;
				const normalisedLevel = normaliseLevelValue(row.level);
				const title = String(
					row.shortTitle || row.title || `Standard ${standardId}`
				);
				const subject = normaliseSubject(row.subject);
				return {
					standardId,
					level: normalisedLevel,
					title,
					subject,
					matchScore,
					matchGap,
					matchConfidence,
					label: this.buildLabel({
						standardId,
						level: normalisedLevel,
						title,
						subject,
					}),
					entries: [],
				};
			})
			.filter(Boolean);
	}

	async search(rawQuery, options = {}) {
		const trimmedQuery = String(rawQuery || "").trim();
		if (!trimmedQuery) {
			return [];
		}

		let rankedStandardCandidates = [];
		const parsedQuery = parseQuery(rawQuery, {
			subjectVocabulary: this.getSeedSubjectVocabulary(),
		});
		void options;
		rankedStandardCandidates = this.rankSeedStandardCandidates(
			parsedQuery,
			MAX_NON_EXACT_RESULT_GROUPS
		);

		if (rankedStandardCandidates.length === 0) return [];

		const grouped = this.buildOfflineStandardGroups(rankedStandardCandidates);
		const rankMap = new Map(
			rankedStandardCandidates.map((entry, i) => [entry.standardId, i])
		);

		grouped.sort(
			(a, b) =>
				(rankMap.get(a.standardId) ?? Number.MAX_SAFE_INTEGER) -
				(rankMap.get(b.standardId) ?? Number.MAX_SAFE_INTEGER)
		);

		return grouped.slice(0, MAX_NON_EXACT_RESULT_GROUPS);
	}
}
