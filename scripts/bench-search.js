import { performance } from "node:perf_hooks";
import { SearchAggregator } from "../src/core/search.js";
import { parseQuery } from "../src/core/models.js";

function percentile(values, p) {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
	return sorted[idx];
}

function summarise(name, timingsMs) {
	const total = timingsMs.reduce((sum, v) => sum + v, 0);
	const avg = total / timingsMs.length;
	console.log(`\n${name}`);
	console.log(`runs: ${timingsMs.length}`);
	console.log(`avg: ${avg.toFixed(3)} ms`);
	console.log(`p50: ${percentile(timingsMs, 50).toFixed(3)} ms`);
	console.log(`p95: ${percentile(timingsMs, 95).toFixed(3)} ms`);
	console.log(`max: ${Math.max(...timingsMs).toFixed(3)} ms`);
}

async function run() {
	const aggregator = new SearchAggregator();
	const subjectVocabulary = aggregator.getSeedSubjectVocabulary();

	const queries = [
		"L3 bio plants",
		"level 2 chemistry equilibrium",
		"as 91101",
		"english unfamiliar text 2023",
		"statistics probability 2021",
		"te reo maori level 1",
		"earth and space waves l2",
		"business studies marketing",
		"economics inflation",
		"physics mechanics",
	];

	const parseTimings = [];
	for (let i = 0; i < 5000; i++) {
		const q = queries[i % queries.length];
		const t0 = performance.now();
		parseQuery(q, { subjectVocabulary });
		parseTimings.push(performance.now() - t0);
	}

	const rankTimings = [];
	for (let i = 0; i < 1500; i++) {
		const q = queries[i % queries.length];
		const parsed = parseQuery(q, { subjectVocabulary });
		const t0 = performance.now();
		aggregator.rankSeedStandardIds(q, parsed, 5);
		rankTimings.push(performance.now() - t0);
	}

	summarise("parseQuery benchmark", parseTimings);
	summarise("rankSeedStandardIds benchmark", rankTimings);
	console.log(`\nsubject vocabulary size: ${subjectVocabulary.length}`);
	console.log(`seed standards cached: ${aggregator.loadSeedStandards().length}`);
}

run().catch((err) => {
	console.error("bench-search failed:", err);
	process.exit(1);
});
