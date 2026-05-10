import test from "node:test";
import assert from "node:assert/strict";
import { SearchAggregator } from "../src/core/search.js";
import { detectNoBrainPaperType } from "../src/adapters/noBrain.js";

function makePaper({
	standardId,
	title,
	subject = "Biology",
	level = 3,
	year = 2022,
	type = "exam",
	yearFrom = null,
	yearTo = null,
	sourceName = "StudyTimeAdapter",
}) {
	return {
		standardId,
		title,
		subject,
		level,
		year,
		type,
		yearFrom,
		yearTo,
		sourceName,
		filename: `${standardId}_${year}.pdf`,
		url: `https://example.test/${standardId}/${sourceName}/${year}`,
	};
}

function stubManifestService() {
	return {
		ensureFile() {},
		load() {
			return { entries: {} };
		},
		getAllPapers() {
			return [];
		},
		getByStandardId() {
			return [];
		},
		isStale() {
			return false;
		},
		upsertPapers() {},
		getSourcePriorityAdjustment() {
			return 0;
		},
		getPreferredSource() {
			return null;
		},
	};
}

test("seed-based fuzzy search returns level+subject matches", async () => {
	const aggregator = new SearchAggregator();
	aggregator.manifestService = stubManifestService();

	aggregator.loadSeedStandards = () => [
		{
			standardId: "91603",
			title: "Plants and Animals",
			subject: "Biology",
			level: 3,
		},
		{
			standardId: "91605",
			title: "Evolutionary Processes",
			subject: "Biology",
			level: 3,
		},
		{
			standardId: "91606",
			title: "Human Evolution",
			subject: "Biology",
			level: 3,
		},
		{
			standardId: "91390",
			title: "Thermochemical Principles",
			subject: "Chemistry",
			level: 3,
		},
	];

	const paperMap = {
		91603: [makePaper({ standardId: "91603", title: "Plants and Animals" })],
		91605: [makePaper({ standardId: "91605", title: "Evolutionary Processes" })],
		91606: [makePaper({ standardId: "91606", title: "Human Evolution" })],
	};

	aggregator.fetchAdapters = [
		{
			name: "StudyTimeAdapter",
			fetchByStandard: async (id) => paperMap[id] || [],
		},
	];

	const results = await aggregator.search("L3 bio");
	assert.ok(results.length > 0);
	assert.ok(results.length <= 3);
	for (const group of results) {
		assert.equal(group.level, 3);
		assert.equal(group.subject, "Biology");
	}
});

test("whitespace-only queries return no results", async () => {
	const aggregator = new SearchAggregator();
	aggregator.manifestService = stubManifestService();
	aggregator.loadSeedStandards = () => {
		throw new Error("loadSeedStandards should not be called for empty queries");
	};

	const results = await aggregator.search("   ");
	assert.deepEqual(results, []);
});

test("grouped standard label prefers seed title over paper title", async () => {
	const aggregator = new SearchAggregator();
	aggregator.manifestService = stubManifestService();
	aggregator.loadSeedStandards = () => [
		{
			standardId: "91606",
			title: "Demonstrate understanding of trends in human evolution",
			subject: "Biology",
			level: 3,
		},
	];

	const grouped = aggregator.groupResults([
		makePaper({
			standardId: "91606",
			title: "Profiles of Expected Performance 2022",
			subject: "Biology",
			level: 3,
			year: 2024,
			sourceName: "NoBrainTooSmallAdapter",
		}),
	]);

	assert.equal(grouped.length, 1);
	assert.equal(
		grouped[0].label,
		"Standard 91606 - Demonstrate understanding of trends in human evolution (Biology L3)"
	);
});

test("scholarship queries are treated as scholarship level", async () => {
	const aggregator = new SearchAggregator();
	aggregator.manifestService = stubManifestService();
	aggregator.loadSeedStandards = () => [
		{
			standardId: "93402",
			title: "New Zealand Scholarship Economics",
			subject: "Economics",
			level: "scholarship",
		},
	];

	const results = await aggregator.search("scholarship economics");
	assert.equal(results.length, 1);
	assert.equal(results[0].level, "scholarship");
	assert.equal(
		results[0].label,
		"Standard 93402 - New Zealand Scholarship Economics (Economics Scholarship)"
	);
});

test("groupResults renders scholarship level labels", () => {
	const aggregator = new SearchAggregator();
	aggregator.manifestService = stubManifestService();
	aggregator.loadSeedStandards = () => [
		{
			standardId: "93402",
			title: "New Zealand Scholarship Economics",
			subject: "Economics",
			level: "scholarship",
		},
	];

	const grouped = aggregator.groupResults([
		makePaper({
			standardId: "93402",
			title: "Scholarship Economics resource",
			subject: "Economics",
			level: "scholarship",
			year: 2026,
			sourceName: "OurExamsAdapter",
		}),
	]);

	assert.equal(grouped.length, 1);
	assert.equal(
		grouped[0].label,
		"Standard 93402 - New Zealand Scholarship Economics (Economics Scholarship)"
	);
});

test("abbreviated scholarship query can find scholarship biology", async () => {
	const aggregator = new SearchAggregator();
	aggregator.manifestService = stubManifestService();
	aggregator.loadSeedStandards = () => [
		{
			standardId: "93101",
			title: "New Zealand Scholarship Biology",
			subject: "Biology",
			level: "scholarship",
		},
		{
			standardId: "93203",
			title: "New Zealand Scholarship Accounting",
			subject: "Accounting",
			level: "scholarship",
		},
	];

	const results = await aggregator.search("schol bio");
	assert.equal(results.length, 1);
	assert.equal(results[0].standardId, "93101");
	assert.equal(results[0].level, "scholarship");
	assert.equal(results[0].subject, "Biology");
});

test("badly misspelled scholarship query is marked low confidence", async () => {
	const aggregator = new SearchAggregator();
	aggregator.manifestService = stubManifestService();
	aggregator.loadSeedStandards = () => [
		{
			standardId: "92022",
			title:
				"Demonstrate understanding of genetic variation in relation to an identified characteristic",
			subject: "Chemistry And Biology Chembio",
			level: 1,
		},
		{
			standardId: "92023",
			title:
				"Demonstrate understanding of how the physical properties of materials inform their use",
			subject: "Chemistry And Biology Chembio",
			level: 1,
		},
	];

	const results = await aggregator.search("shclarhsip bio");
	assert.ok(results.length > 0);
	assert.equal(results[0].matchConfidence, "low");
	assert.ok((results[0].matchScore ?? 0) < 10);
});

test("groupResults keeps bulk ZIP year ranges intact", async () => {
	const aggregator = new SearchAggregator();
	aggregator.manifestService = stubManifestService();
	aggregator.loadSeedStandards = () => [
		{
			standardId: "91606",
			title: "Demonstrate understanding of trends in human evolution",
			subject: "Biology",
			level: 3,
		},
	];

	const grouped = aggregator.groupResults([
		makePaper({
			standardId: "91606",
			title: "Biology bulk resource",
			subject: "Biology",
			level: 3,
			type: "bulk_zip",
			year: null,
			yearFrom: 2021,
			yearTo: 2023,
			sourceName: "OurExamsAdapter",
		}),
	]);

	assert.equal(grouped.length, 1);
	assert.equal(grouped[0].entries.length, 1);
	assert.equal(grouped[0].entries[0].isBulk, true);
	assert.equal(grouped[0].entries[0].yearFrom, 2021);
	assert.equal(grouped[0].entries[0].yearTo, 2023);
	assert.equal(grouped[0].entries[0].label, "Bulk ZIP 2021-2023");
});

test("builds subject vocabulary from structured subject names", () => {
	const aggregator = new SearchAggregator();
	aggregator.loadSeedStandards = () => [
		{
			standardId: "12345",
			subject: "Chemistry and Biology (ChemBio)",
			level: 2,
			title: "Combined science",
		},
	];

	const vocab = aggregator.getSeedSubjectVocabulary();
	assert.equal(vocab.length, 1);
	assert.equal(vocab[0].subject, "Chemistry And Biology Chembio");
	assert.ok(vocab[0].aliases.includes("ChemBio"));
	assert.ok(vocab[0].aliases.includes("Chemistry and Biology"));
});

test("subject abbreviations can still rank correctly without manual aliases", async () => {
	const aggregator = new SearchAggregator();
	aggregator.manifestService = stubManifestService();

	aggregator.loadSeedStandards = () => [
		{
			standardId: "91603",
			title: "Plants and Animals",
			subject: "Biology",
			level: 3,
		},
		{
			standardId: "91390",
			title: "Thermochemical Principles",
			subject: "Chemistry",
			level: 3,
		},
	];

	const results = await aggregator.search("L3 bio plants");
	assert.ok(results.length > 0);
	assert.equal(results[0].subject, "Biology");
});

test("electricity and magnetism query ranks the electrical systems standard first", async () => {
	const aggregator = new SearchAggregator();
	aggregator.manifestService = stubManifestService();

	aggregator.loadSeedStandards = () => [
		{
			standardId: "91524",
			title: "Demonstrate understanding of mechanical systems",
			subject: "Physics",
			level: 3,
		},
		{
			standardId: "91525",
			title: "Demonstrate understanding of Modern Physics",
			subject: "Physics",
			level: 3,
		},
		{
			standardId: "91526",
			title: "Demonstrate understanding of electrical systems",
			subject: "Physics",
			level: 3,
		},
		{
			standardId: "91527",
			title:
				"Use physics knowledge to develop an informed response to a socio-scientific issue",
			subject: "Physics",
			level: 3,
		},
	];

	const results = await aggregator.search("electricity and magnetism");

	assert.ok(results.length > 0);
	assert.equal(results[0].standardId, "91526");
});

test("chemistry queries do not get pulled toward combined subjects", async () => {
	const aggregator = new SearchAggregator();
	aggregator.manifestService = stubManifestService();

	aggregator.loadSeedStandards = () => [
		{
			standardId: "90825",
			title: "Analyse a religious tradition(s) in Aotearoa New Zealand",
			subject: "Religious Studies",
			level: 3,
		},
		{
			standardId: "90828",
			title:
				"Evaluate a personal action that contributes towards a sustainable future",
			subject: "Education For Sustainability",
			level: 3,
		},
		{
			standardId: "91165",
			title:
				"Demonstrate understanding of the properties of selected organic compounds",
			subject: "Chemistry",
			level: 3,
		},
		{
			standardId: "91390",
			title:
				"Demonstrate understanding of the chemistry used in the development of a current technology",
			subject: "Chemistry",
			level: 3,
		},
		{
			standardId: "91391",
			title: "Demonstrate understanding of the properties of organic compounds",
			subject: "Chemistry and Biology (ChemBio)",
			level: 3,
		},
	];

	const results = await aggregator.search("Chem L3 organics");

	assert.ok(results.length > 0);
	assert.ok(results.every((group) => group.subject === "Chemistry"));
	assert.equal(results[0].standardId, "91165");
});

test("NoBrain exam URLs ignore ncea-resource folders and schedules stay schedules", () => {
	assert.equal(
		detectNoBrainPaperType(
			"https://www.nobraintoosmall.co.nz/NCEA/bio3/nqfdocs/ncea-resource/exams/2024/91606-exm-2024.pdf"
		),
		"exam"
	);
	assert.equal(
		detectNoBrainPaperType("/NCEA/bio3/bio3-2024-ass.pdf"),
		"schedule"
	);
});

test("typo in complex numbers query still ranks the Mathematics standard first", async () => {
	const aggregator = new SearchAggregator();
	aggregator.manifestService = stubManifestService();

	aggregator.loadSeedStandards = () => [
		{
			standardId: "91381",
			title:
				"Apply business knowledge to address a complex problem(s) in a given global business context",
			subject: "Business Studies",
			level: 3,
		},
		{
			standardId: "91511",
			title:
				"Write complex Latin sentences that demonstrate understanding of Latin",
			subject: "Latin",
			level: 3,
		},
		{
			standardId: "91577",
			title: "Apply the algebra of complex numbers in solving problems",
			subject: "Mathematics",
			level: 3,
		},
		{
			standardId: "91614",
			title:
				"Demonstrate understanding of operational parameters in complex and highly complex technological systems",
			subject: "Technology",
			level: 3,
		},
	];

	const results = await aggregator.search("L3 complex numebrs");
	assert.ok(results.length > 0);
	assert.equal(results[0].standardId, "91577");
});

test("plain complex numbers query ranks the Mathematics standard first", async () => {
	const aggregator = new SearchAggregator();
	aggregator.manifestService = stubManifestService();

	aggregator.loadSeedStandards = () => [
		{
			standardId: "91625",
			title: "Demonstrate understanding of a complex machine",
			subject: "Technology",
			level: 3,
		},
		{
			standardId: "91902",
			title: "Use complex techniques to develop a database",
			subject: "Digital Technologies",
			level: 3,
		},
		{
			standardId: "91905",
			title: "Use complex techniques to develop a network",
			subject: "Digital Technologies",
			level: 3,
		},
		{
			standardId: "91643",
			title: "Implement complex procedures to process a specified product",
			subject: "Technology",
			level: 3,
		},
		{
			standardId: "91904",
			title: "Use complex techniques to develop an electronics outcome",
			subject: "Digital Technologies",
			level: 3,
		},
		{
			standardId: "91577",
			title: "Apply the algebra of complex numbers in solving problems",
			subject: "Mathematics",
			level: 3,
		},
	];

	const results = await aggregator.search("complex numbers");
	assert.ok(results.length > 0);
	assert.equal(results[0].standardId, "91577");
});
