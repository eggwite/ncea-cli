import { extractYear } from "../utils/year.js";
import {
	normaliseSearchToken,
	scoreSearchTokenMatch,
	scoreSearchTextMatch,
} from "./search/tokenNormalise.js";

const LEVEL_VALUE_ALIASES = {
	one: 1,
	two: 2,
	three: 3,
	schl: "scholarship",
	schol: "scholarship",
	scholar: "scholarship",
	scholarship: "scholarship",
};

const LEVEL_PATTERN_SOURCE = String.raw`\b(?:(?:level|lvel|levle|levl|lvl|l)\s*(scholarship|schl|schol|scholar|[123]|one|two|three)|(scholarship|schl|schol|scholar)|([123])|(one|two|three))\b`;
const LEVEL_PATTERN = new RegExp(LEVEL_PATTERN_SOURCE, "i");
const LEVEL_CLEAN_PATTERN = new RegExp(LEVEL_PATTERN_SOURCE, "gi");
const SCHOLARSHIP_LEVEL_ALIASES = ["scholarship", "scholar", "schol", "schl"];

const SUBJECT_CODES = {
	Mathematics: "MAT",
	Physics: "PHY",
	Chemistry: "CHE",
	Biology: "BIO",
	Science: "SCI",
	Economics: "ECO",
	English: "ENG",
	"Business Studies": "BUS",
	Unknown: "UNK",
};

const QUERY_STOPWORDS = new Set([
	"number",
	"numbers",
	"standard",
	"standards",
	"exam",
	"exams",
	"paper",
	"papers",
	"ncea",
	"nzqa",
]);

function normaliseToken(token) {
	return normaliseSearchToken(token);
}

function normalisePhrase(value) {
	// Collapse accents and punctuation so subject aliases compare consistently.
	return String(value || "")
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function titleCaseSubject(value) {
	const raw = String(value || "").trim();
	if (!raw) return "Unknown";
	return raw
		.split(" ")
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
		.join(" ");
}

function parseLevelToken(token) {
	const normalisedToken = String(token || "").toLowerCase();
	// Accept common scholarship abbreviations as the same level.
	if (
		normalisedToken === "scholarship" ||
		normalisedToken === "schl" ||
		normalisedToken === "schol" ||
		normalisedToken === "scholar"
	) {
		return "scholarship";
	}
	return LEVEL_VALUE_ALIASES[normalisedToken] || Number(normalisedToken);
}

function isScholarshipLikeToken(token) {
	const normalisedToken = normaliseSearchToken(token);
	if (!normalisedToken) return false;

	// Catch typos and shorthand that still look like scholarship.
	return SCHOLARSHIP_LEVEL_ALIASES.some(
		(alias) => scoreSearchTokenMatch(normalisedToken, alias) >= 2
	);
}

export function normaliseLevelValue(value) {
	const raw = String(value || "")
		.trim()
		.toLowerCase();
	if (!raw) return 0;
	if (
		raw === "scholarship" ||
		raw === "schl" ||
		raw === "schol" ||
		raw === "scholar"
	) {
		return "scholarship";
	}
	if (/^[123]$/.test(raw)) return Number(raw);
	if (/^l[123]$/.test(raw)) return Number(raw.slice(1));
	const numeric = Number(raw);
	return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

export function coerceYear(value) {
	const year = Number(value);
	return Number.isInteger(year) && year > 0 ? year : null;
}

export function coerceYearRange(yearFrom, yearTo) {
	const from = coerceYear(yearFrom);
	const to = coerceYear(yearTo);
	if (!from || !to || to < from) return null;
	return { yearFrom: from, yearTo: to };
}

export function normaliseSubject(subject) {
	const raw = String(subject || "").trim();
	if (!raw) return "Unknown";

	// Remove level markers and separators so source-specific subject names collapse
	// to a stable display name.
	const collapsed = raw
		.toLowerCase()
		.replace(/[/_-]+/g, " ")
		.replace(/\blevel\s*[123]\b/g, " ")
		.replace(/\b(l[123])\b/g, " ")
		.replace(/[^a-z\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	return titleCaseSubject(collapsed);
}

export function subjectCodeFor(subject) {
	const normalised = normaliseSubject(subject);
	return SUBJECT_CODES[normalised] || "UNK";
}

function inferSubjectFromTerms(terms, subjectVocabulary = []) {
	if (!Array.isArray(subjectVocabulary) || subjectVocabulary.length === 0) {
		return {
			subject: null,
			confidence: null,
		};
	}

	const queryTerms = terms.map(normaliseToken).filter(Boolean);
	if (queryTerms.length === 0) {
		return {
			subject: null,
			confidence: null,
		};
	}

	let best = null;
	let second = null;

	const scoreAlias = (aliasTokens) => {
		// Score how well the user's query terms match the alias tokens. By
		// treating the query as the primary token list we avoid double-counting
		// when an alias contains multiple tokens that match the same query term
		// (e.g. "biology" and "chembio" both matching "bio").
		const aliasScore = scoreSearchTextMatch(queryTerms, aliasTokens);
		if (aliasScore <= 0) return null;

		const normalisedAliasTokens = aliasTokens
			.map(normaliseSearchToken)
			.filter(Boolean);
		const explicitMatch = queryTerms.some((queryTerm) =>
			normalisedAliasTokens.some((aliasToken) => {
				if (aliasToken === normaliseSearchToken(queryTerm)) return true;
				if (normaliseSearchToken(queryTerm).length < 3) return false;
				return aliasToken.startsWith(normaliseSearchToken(queryTerm));
			})
		);

		return {
			score: aliasScore + (explicitMatch ? 2 : 0),
			explicitMatch,
		};
	};

	for (const entry of subjectVocabulary) {
		const subjectName = String(entry?.subject || "").trim();
		if (!subjectName) continue;
		const normalisedSubjectName = subjectName.toLowerCase();
		const compoundPenalty = /\b(and|&|\/|\()/.test(normalisedSubjectName) ? 4 : 0;
		// Combined subject names are less specific, so bias toward single-subject matches.
		const simpleSubjectBoost = compoundPenalty > 0 ? 0 : 2;
		const subjectSpecificity = Math.max(
			1,
			titleCaseSubject(subjectName).split(" ").filter(Boolean).length
		);

		const aliases = [
			subjectName,
			...(Array.isArray(entry.aliases) ? entry.aliases : []),
		]
			.map((alias) => normalisePhrase(alias))
			.filter(Boolean);

		let entryScore = null;
		let explicitMatch = false;

		for (const alias of aliases) {
			const aliasTokens = alias.split(" ").filter(Boolean);
			if (aliasTokens.length === 0) continue;

			const aliasScore = scoreAlias(aliasTokens);
			if (!aliasScore) continue;

			const candidateScore =
				aliasScore.score +
				1 / subjectSpecificity -
				compoundPenalty +
				simpleSubjectBoost;
			if (aliasScore.explicitMatch) {
				explicitMatch = true;
			}

			if (entryScore === null || candidateScore > entryScore) {
				entryScore = candidateScore;
			}
		}

		if (entryScore === null) continue;

		if (!best || entryScore > best.score) {
			second = best;
			best = {
				subject: titleCaseSubject(subjectName),
				score: entryScore,
				explicitMatch,
			};
		} else if (!second || entryScore > second.score) {
			second = {
				subject: titleCaseSubject(subjectName),
				score: entryScore,
				explicitMatch,
			};
		}
	}

	if (!best || best.score < 4) {
		return {
			subject: null,
			confidence: null,
		};
	}

	if (second && best.score - second.score < 0.5) {
		return {
			subject: null,
			confidence: null,
		};
	}

	return {
		subject: best.subject,
		confidence: best.explicitMatch ? "explicit" : "fuzzy",
	};
}

export function normaliseStandardId(value) {
	const input = String(value || "").trim();
	const match = input.match(/(\d{5})/);
	return match ? match[1] : "";
}

export class CanonicalID {
	constructor({ standardId, level, subject, year = null, type = null }) {
		this.standardId = normaliseStandardId(standardId);
		this.level = normaliseLevelValue(level);
		this.subject = normaliseSubject(subject);
		this.subjectCode = subjectCodeFor(this.subject);
		this.year = coerceYear(year);
		this.type = type ? String(type).toLowerCase() : null;
	}

	static fromPaper(paper) {
		return new CanonicalID({
			standardId: paper.standardId,
			level: paper.level,
			subject: paper.subject,
			year: paper.year,
			type: paper.type,
		});
	}

	static parse(value) {
		const parts = String(value || "").split("-");
		if (parts.length < 3) {
			throw new Error(`Invalid CanonicalID string: ${value}`);
		}
		const [level, standardId, subjectCode, year, ...rest] = parts;
		return new CanonicalID({
			standardId,
			level,
			subject:
				Object.keys(SUBJECT_CODES).find(
					(key) => SUBJECT_CODES[key] === subjectCode
				) || "Unknown",
			year: coerceYear(year),
			type: rest.length > 0 ? rest.join("-") : null,
		});
	}

	toString() {
		const base = `${this.level}-${this.standardId}-${this.subjectCode}`;
		if (this.year && this.type) {
			return `${base}-${this.year}-${this.type}`;
		}
		return base;
	}
}

export function parseQuery(raw, options = {}) {
	const { subjectVocabulary = [] } = options;
	const query = String(raw || "").trim();
	if (!query) {
		return {
			raw: "",
			level: null,
			year: null,
			terms: [],
		};
	}

	let level = null;
	const lower = query.toLowerCase();
	const levelMatch = lower.match(LEVEL_PATTERN);
	if (levelMatch) {
		level = parseLevelToken(
			levelMatch[1] || levelMatch[2] || levelMatch[3] || levelMatch[4]
		);
	}

	const rawTokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
	// Years and common shorthand can also imply scholarship even when the level
	// token is missing or malformed.
	if (!level && rawTokens.some((token) => isScholarshipLikeToken(token))) {
		level = "scholarship";
	}

	const year = extractYear(query);

	const cleaned = lower
		.replace(LEVEL_CLEAN_PATTERN, " ")
		.replace(/\b(20\d{2}|19\d{2})\b/g, " ")
		.replace(/[^a-z0-9\s]/g, " ");

	const terms = cleaned
		.split(/\s+/)
		.map((token) => normaliseToken(token))
		.filter(
			// Strip level tokens, years, standard IDs, and generic search filler.
			(token) =>
				token &&
				!isScholarshipLikeToken(token) &&
				!/^[123]$/.test(token) &&
				!/^(one|two|three)$/.test(token) &&
				!/^\d{5}$/.test(token) &&
				!QUERY_STOPWORDS.has(token)
		);

	const { subject, confidence: subjectConfidence } = inferSubjectFromTerms(
		terms,
		subjectVocabulary
	);
	const subjectCode = subject ? subjectCodeFor(subject) : null;

	return {
		raw: query,
		level,
		year,
		subject,
		subjectCode,
		subjectConfidence,
		terms,
	};
}
