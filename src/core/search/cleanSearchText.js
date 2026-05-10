import {
	normaliseSearchText,
	normaliseSearchToken,
	scoreSearchTokenMatch,
} from "./tokenNormalise.js";
import { normaliseLevelValue } from "../models.js";

const SCHOLARSHIP_LEVEL_ALIASES = ["scholarship", "scholar", "schol", "schl"];

function isScholarshipLikeToken(token) {
	const normalisedToken = normaliseSearchToken(token);
	if (!normalisedToken) return false;

	return SCHOLARSHIP_LEVEL_ALIASES.some(
		(alias) => scoreSearchTokenMatch(normalisedToken, alias) >= 2
	);
}

export function cleanSearchText(value, level = null) {
	let text = String(value || "");
	const normalisedLevel = normaliseLevelValue(level);
	if (normalisedLevel === "scholarship") {
		text = text
			.split(/\s+/)
			.filter((part) => !isScholarshipLikeToken(part))
			.join(" ");
	} else if (normalisedLevel) {
		const levelPattern = new RegExp(
			String.raw`\b(?:level\s*)?l?${Number(normalisedLevel)}\b`,
			"gi"
		);
		text = text.replace(levelPattern, " ");
	}

	return normaliseSearchText(text);
}
