export function normaliseSearchToken(value) {
	let token = String(value || "")
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]/g, "");

	if (!token) return "";

	return token;
}

export function normaliseSearchText(value) {
	return String(value || "")
		.split(/\s+/)
		.map((part) => normaliseSearchToken(part))
		.filter(Boolean)
		.join(" ");
}

const SEARCH_STOPWORDS = new Set([
	"a",
	"an",
	"and",
	"for",
	"from",
	"in",
	"of",
	"on",
	"or",
	"the",
	"to",
	"with",
]);

function reduceSearchToken(value) {
	// Light stemming keeps obvious word variants together without pulling in a full NLP library.
	let token = normaliseSearchToken(value);
	if (!token) return "";

	if (token.length > 6 && token.endsWith("ical")) {
		token = token.slice(0, -4);
	} else if (token.length > 5 && token.endsWith("ity")) {
		token = token.slice(0, -3);
	} else if (token.length > 5 && token.endsWith("ism")) {
		token = token.slice(0, -3);
	} else if (token.length > 5 && token.endsWith("ics")) {
		token = token.slice(0, -3);
	} else if (token.length > 4 && token.endsWith("ies")) {
		token = `${token.slice(0, -3)}y`;
	} else if (
		token.length > 4 &&
		token.endsWith("es") &&
		!token.endsWith("ses")
	) {
		token = token.slice(0, -2);
	} else if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
		token = token.slice(0, -1);
	}

	return token;
}

export function levenshteinDistance(left, right) {
	// Standard dynamic-programming edit distance used to catch small typos.
	const a = String(left || "");
	const b = String(right || "");
	if (a === b) return 0;
	if (!a.length) return b.length;
	if (!b.length) return a.length;

	const previousRow = Array.from({ length: b.length + 1 }, (_, index) => index);
	for (let i = 1; i <= a.length; i++) {
		let previousDiagonal = previousRow[0];
		previousRow[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const saved = previousRow[j];
			const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
			previousRow[j] = Math.min(
				previousRow[j] + 1,
				previousRow[j - 1] + 1,
				previousDiagonal + substitutionCost
			);
			previousDiagonal = saved;
		}
	}

	return previousRow[b.length];
}

export function scoreSearchTokenMatch(queryToken, candidateToken) {
	const normalisedQuery = normaliseSearchToken(queryToken);
	const normalisedCandidate = normaliseSearchToken(candidateToken);
	if (!normalisedQuery || !normalisedCandidate) return 0;

	const reducedQuery = reduceSearchToken(normalisedQuery);
	const reducedCandidate = reduceSearchToken(normalisedCandidate);
	if (reducedQuery && reducedQuery === reducedCandidate) return 9;
	if (normalisedQuery === normalisedCandidate) return 10;
	if (
		reducedQuery &&
		reducedCandidate &&
		(reducedQuery === normalisedCandidate || reducedCandidate === normalisedQuery)
	) {
		return 8;
	}

	const shortestLength = Math.min(
		normalisedQuery.length,
		normalisedCandidate.length
	);
	if (shortestLength >= 3) {
		if (
			normalisedQuery.startsWith(normalisedCandidate) ||
			normalisedCandidate.startsWith(normalisedQuery)
		) {
			return 8;
		}
		if (
			normalisedQuery.endsWith(normalisedCandidate) ||
			normalisedCandidate.endsWith(normalisedQuery)
		) {
			return 6;
		}
	}

	const distance = levenshteinDistance(normalisedQuery, normalisedCandidate);
	const longestLength = Math.max(
		normalisedQuery.length,
		normalisedCandidate.length
	);
	if (distance <= 1) return 6;
	if (distance <= 2 && longestLength >= 5) return 4;
	if (distance <= 3 && distance / longestLength <= 0.34) return 2;
	return 0;
}

export function scoreSearchTextMatch(queryTokens, candidateTokens) {
	const normalisedQueryTokens = (Array.isArray(queryTokens) ? queryTokens : [])
		.map((token) => normaliseSearchToken(token))
		.filter((token) => Boolean(token) && !SEARCH_STOPWORDS.has(token));
	const normalisedCandidateTokens = (
		Array.isArray(candidateTokens) ? candidateTokens : []
	)
		.map((token) => normaliseSearchToken(token))
		.filter((token) => Boolean(token) && !SEARCH_STOPWORDS.has(token));

	if (
		normalisedQueryTokens.length === 0 ||
		normalisedCandidateTokens.length === 0
	) {
		return 0;
	}

	let score = 0;
	let matchedQueryTokens = 0;

	for (const queryToken of normalisedQueryTokens) {
		let bestTokenScore = 0;
		for (const candidateToken of normalisedCandidateTokens) {
			const tokenScore = scoreSearchTokenMatch(queryToken, candidateToken);
			if (tokenScore > bestTokenScore) {
				bestTokenScore = tokenScore;
			}
		}

		if (bestTokenScore > 0) {
			matchedQueryTokens++;
			score += bestTokenScore;
		}
	}

	if (matchedQueryTokens === normalisedQueryTokens.length) {
		score += normalisedQueryTokens.length * 2;
	}

	return score;
}
