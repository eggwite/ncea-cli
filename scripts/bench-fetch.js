import { OurExamsAdapter } from "../src/adapters/ourExams.js";
import { StudyTimeAdapter } from "../src/adapters/studyTime.js";
import { NoBrainTooSmallAdapter } from "../src/adapters/noBrain.js";
import { QuirkyAdapter } from "../src/adapters/quirky.js";

async function time(name, fn) {
	const start = Date.now();
	try {
		const res = await fn();
		const ms = Date.now() - start;
		console.log(
			`${name}: ${ms} ms — ${Array.isArray(res) ? res.length : typeof res}`
		);
		return { ms, res };
	} catch (err) {
		const ms = Date.now() - start;
		console.log(`${name}: ERROR after ${ms} ms — ${err.message}`);
		return { ms, err };
	}
}

async function run() {
	const standard = "91901";
	const our = new OurExamsAdapter();
	const study = new StudyTimeAdapter();
	const nobrain = new NoBrainTooSmallAdapter();
	const quirky = new QuirkyAdapter();

	console.log("Benchmarking fetchByStandard for", standard);

	// getIndex for index adapters (to measure index loading)
	await time("OurExams.getIndex", () => our.getIndex());
	await time("StudyTime.getIndex", () => study.getIndex());
	await time("NoBrain.getIndex", () => nobrain.getIndex());

	// fetchByStandard in parallel (as SearchAggregator does)
	const adapters = [our, study, nobrain, quirky];
	const names = ["OurExams", "StudyTime", "NoBrain", "Quirky"];

	const promises = adapters.map((a) =>
		time(a.constructor.name + ".fetchByStandard", () =>
			a.fetchByStandard(standard)
		)
	);
	const results = await Promise.all(promises);
	console.log("Summary:");
	results.forEach((r, i) => {
		console.log(`${names[i]} -> ${r.ms} ms`);
	});
}

run().catch((e) => {
	console.error("Bench failed:", e);
	process.exit(1);
});
