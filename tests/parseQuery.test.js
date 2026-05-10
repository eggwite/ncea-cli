import test from "node:test";
import assert from "node:assert/strict";
import { parseQuery } from "../src/core/models.js";

const subjectVocabulary = [
	{ subject: "Biology", aliases: ["biology", "bio"] },
	{ subject: "Business Studies", aliases: ["business studies", "business"] },
	{ subject: "Chemistry", aliases: ["chemistry", "chem"] },
];

test("parseQuery handles typo level token and fuzzy subject token", () => {
	const parsed = parseQuery("levl 3 bio animal plants response", {
		subjectVocabulary,
	});

	assert.equal(parsed.level, 3);
	assert.equal(parsed.subject, "Biology");
	assert.equal(parsed.subjectConfidence, "explicit");
	assert.deepEqual(parsed.terms, ["bio", "animal", "plants", "response"]);
});

test("parseQuery handles word-based level tokens", () => {
	const parsed = parseQuery("three biology animal response", {
		subjectVocabulary,
	});

	assert.equal(parsed.level, 3);
	assert.equal(parsed.subject, "Biology");
	assert.equal(parsed.subjectConfidence, "explicit");
	assert.deepEqual(parsed.terms, ["biology", "animal", "response"]);
});

test("parseQuery strips standalone level tokens from fuzzy terms", () => {
	const parsed = parseQuery("2 plants animal response", {
		subjectVocabulary,
	});

	assert.equal(parsed.level, 2);
	assert.equal(parsed.subject, null);
	assert.deepEqual(parsed.terms, ["plants", "animal", "response"]);
});

test("parseQuery avoids ambiguous fuzzy subject matches", () => {
	const parsed = parseQuery("bus level 3", {
		subjectVocabulary: [
			{ subject: "Business Studies", aliases: ["business", "bus"] },
			{ subject: "Business Management", aliases: ["business management", "bus"] },
		],
	});

	assert.equal(parsed.level, 3);
	assert.equal(parsed.subject, null);
	assert.equal(parsed.subjectConfidence, null);
});

test("parseQuery prefers chemistry over combined chemistry and biology aliases", () => {
	const parsed = parseQuery("Chem L3 organics", {
		subjectVocabulary: [
			{ subject: "Chemistry", aliases: ["chemistry"] },
			{
				subject: "Chemistry and Biology (ChemBio)",
				aliases: ["chemistry and biology", "chembio"],
			},
		],
	});

	assert.equal(parsed.level, 3);
	assert.equal(parsed.subject, "Chemistry");
	assert.equal(parsed.subjectConfidence, "explicit");
});

test("parseQuery recognises scholarship as a level token", () => {
	const parsed = parseQuery("scholarship economics", {
		subjectVocabulary: [{ subject: "Economics", aliases: ["economics"] }],
	});

	assert.equal(parsed.level, "scholarship");
	assert.equal(parsed.subject, "Economics");
	assert.deepEqual(parsed.terms, ["economics"]);
});

test("parseQuery recognises schol as a scholarship level token", () => {
	const parsed = parseQuery("schol bio", {
		subjectVocabulary: [{ subject: "Biology", aliases: ["biology", "bio"] }],
	});

	assert.equal(parsed.level, "scholarship");
	assert.equal(parsed.subject, "Biology");
	assert.deepEqual(parsed.terms, ["bio"]);
});

test("parseQuery recognises schl as a scholarship level token", () => {
	const parsed = parseQuery("schl bio", {
		subjectVocabulary: [{ subject: "Biology", aliases: ["biology", "bio"] }],
	});

	assert.equal(parsed.level, "scholarship");
	assert.equal(parsed.subject, "Biology");
	assert.deepEqual(parsed.terms, ["bio"]);
});

test("parseQuery recognises a misspelled scholarship token", () => {
	const parsed = parseQuery("shclarhsip bio", {
		subjectVocabulary: [{ subject: "Biology", aliases: ["biology", "bio"] }],
	});

	assert.equal(parsed.level, null);
	assert.equal(parsed.subject, "Biology");
	assert.deepEqual(parsed.terms, ["shclarhsip", "bio"]);
});
