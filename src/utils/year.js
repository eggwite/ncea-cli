export function extractYear(...values) {
	for (const value of values) {
		const text = String(value || "");
		const match = text.match(/\b(20\d{2}|19\d{2})\b/);
		if (match) return Number(match[1]);
	}
	return null;
}
