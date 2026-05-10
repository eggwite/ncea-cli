export function makeSeparator(width = 60, style = "double") {
	const chars = {
		double: { left: "╔", mid: "═", right: "╗" },
		single: { left: "┌", mid: "─", right: "┐" },
		plain: { left: "", mid: "-", right: "" },
	};
	const s = chars[style] || chars.double;
	return s.left + s.mid.repeat(Math.max(0, width - 2)) + s.right;
}

export function makeBottomSeparator(width = 60, style = "double") {
	const chars = {
		double: { left: "╚", mid: "═", right: "╝" },
		single: { left: "└", mid: "─", right: "┘" },
		plain: { left: "", mid: "-", right: "" },
	};
	const s = chars[style] || chars.double;
	return s.left + s.mid.repeat(Math.max(0, width - 2)) + s.right;
}

function getBoxChars(style = "double") {
	const chars = {
		double: {
			topLeft: "╔",
			topMid: "═",
			topRight: "╗",
			left: "║",
			right: "║",
			bottomLeft: "╚",
			bottomMid: "═",
			bottomRight: "╝",
		},
		single: {
			topLeft: "┌",
			topMid: "─",
			topRight: "┐",
			left: "│",
			right: "│",
			bottomLeft: "└",
			bottomMid: "─",
			bottomRight: "┘",
		},
		plain: {
			topLeft: "",
			topMid: "",
			topRight: "",
			left: "",
			right: "",
			bottomLeft: "",
			bottomMid: "",
			bottomRight: "",
		},
	};
	return chars[style] || chars.double;
}

function stripAnsi(str) {
	return String(str).replace(/\x1b\[[0-9;]*m/g, "");
}

function colourise(text, colorCode) {
	if (!colorCode) return text;
	return `${colorCode}${text}${"\x1b[0m"}`;
}

export function makeTextBox(lines, width = 60, style = "double", options = {}) {
	const s = getBoxChars(style);
	const normalisedLines = (Array.isArray(lines) ? lines : [lines]).map(
		(line) => {
			if (line && typeof line === "object" && "text" in line) {
				return {
					text: String(line.text || ""),
					textColor: line.textColor || null,
				};
			}
			return { text: String(line || ""), textColor: null };
		}
	);

	const innerWidth = Math.max(
		0,
		width - 2,
		...normalisedLines.map((item) => stripAnsi(item.text).length)
	);

	const borderColor = options.borderColor || null;
	const defaultTextColor = options.textColor || null;

	const top = `${colourise(s.topLeft, borderColor)}${colourise(
		s.topMid.repeat(innerWidth),
		borderColor
	)}${colourise(s.topRight, borderColor)}`;
	const bottom = `${colourise(s.bottomLeft, borderColor)}${colourise(
		s.bottomMid.repeat(innerWidth),
		borderColor
	)}${colourise(s.bottomRight, borderColor)}`;

	const body = normalisedLines.map((lineData) => {
		const rawText = lineData.text;
		const visibleLength = stripAnsi(rawText).length;
		const padding = " ".repeat(Math.max(0, innerWidth - visibleLength));
		const coloredText = colourise(
			rawText,
			lineData.textColor || defaultTextColor
		);
		const left = colourise(s.left, borderColor);
		const right = colourise(s.right, borderColor);
		return `${left}${coloredText}${padding}${right}`;
	});

	return [top, ...body, bottom];
}
