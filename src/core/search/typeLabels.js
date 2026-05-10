const TYPE_LABELS = {
	exam: "Exam",
	cd: "CD",
	cd_transcript: "CD Transcript",
	schedule: "Schedule",
	bulk_zip: "Bulk ZIP",
	specifications: "Specifications",
	exemplar: "Exemplar",
	pep: "PEP",
	resource: "Resource",
	unknown: "Unknown",
};

export function prettifyTypeLabel(type) {
	const value = String(type || "");
	return (
		TYPE_LABELS[value] ||
		value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
	);
}
