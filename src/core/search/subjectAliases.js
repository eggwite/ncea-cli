export function buildSubjectAliases(subject) {
	const aliases = new Set();
	const base = String(subject || "").trim();
	if (!base) return [];

	const addSplitAliases = (delimiter) => {
		for (const part of base.split(delimiter)) {
			const value = part.trim();
			if (value) aliases.add(value);
		}
	};

	aliases.add(base);

	if (base.includes("&")) {
		addSplitAliases("&");
	}

	if (base.includes(" and ")) {
		addSplitAliases(" and ");
	}

	if (base.includes("(") && base.includes(")")) {
		const start = base.indexOf("(");
		const end = base.lastIndexOf(")");
		if (start >= 0 && end > start) {
			const inside = base.slice(start + 1, end).trim();
			const outside = `${base.slice(0, start)} ${base.slice(end + 1)}`.trim();
			if (inside) aliases.add(inside);
			if (outside) aliases.add(outside);
		}
	}

	if (base.includes(",")) {
		addSplitAliases(",");
	}

	if (base.includes("/")) {
		addSplitAliases("/");
	}

	return [...aliases];
}
