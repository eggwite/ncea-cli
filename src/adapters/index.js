import {
	normaliseStandardId,
	normaliseSubject,
	CanonicalID,
	coerceYear,
	coerceYearRange,
	normaliseLevelValue,
} from "../core/models.js";
import { PaperType } from "../core/constants.js";

export class PaperSourceAdapter {
	constructor() {
		this.name = this.constructor.name;
		this._index = null;
		this._indexPromise = null;
	}

	async buildIndex() {
		return [];
	}

	async getIndex() {
		if (this._index) return this._index;
		if (this._indexPromise) return this._indexPromise;

		this._indexPromise = this.buildIndex()
			.then((rows) => {
				const normalisedRows = rows
					.map((paper) => this.normalisePaper(paper))
					.filter(Boolean);
				this._index = normalisedRows;
				return normalisedRows;
			})
			.finally(() => {
				this._indexPromise = null;
			});

		return this._indexPromise;
	}

	async fetchByStandard(standardId) {
		const id = normaliseStandardId(standardId);
		if (!id) return [];
		const index = await this.getIndex();
		return index.filter((paper) => paper.standardId === id);
	}

	normalisePaper(paper) {
		if (!paper) return null;

		const standardId = normaliseStandardId(paper.standardId);
		if (!standardId || !paper.url) {
			console.warn(
				`[${this.name}] Skipping invalid paper: missing standardId/url`
			);
			return null;
		}

		const level = normaliseLevelValue(paper.level);
		const subject = normaliseSubject(paper.subject);
		const type = String(paper.type || PaperType.UNKNOWN).toLowerCase();

		// Skip PEP files entirely
		if (type === PaperType.PEP) {
			return null;
		}

		if (type === PaperType.BULK_ZIP) {
			const range = coerceYearRange(paper.yearFrom, paper.yearTo);
			if (!range) {
				return null;
			}
			const { yearFrom, yearTo } = range;

			const canonicalId = new CanonicalID({
				standardId,
				level,
				subject,
			}).toString();

			return {
				canonicalId,
				standardId,
				subject,
				title: String(paper.title || "").trim(),
				level,
				yearFrom,
				yearTo,
				format: String(paper.format || "zip").toLowerCase(),
				url: String(paper.url),
				sourceName: String(paper.sourceName || this.name),
				filename: String(
					paper.filename || `${standardId}_${yearFrom}-${yearTo}_bulk.zip`
				),
				type: PaperType.BULK_ZIP,
				titleTerms: `${paper.title || ""} ${subject}`.trim(),
			};
		}

		const year = coerceYear(paper.year);

		if (!year) {
			return null;
		}

		const canonicalId = new CanonicalID({
			standardId,
			level,
			subject,
			year,
			type,
		}).toString();

		return {
			canonicalId,
			standardId,
			subject,
			title: String(paper.title || "").trim(),
			level,
			year,
			format: String(paper.format || "pdf").toLowerCase(),
			url: String(paper.url),
			sourceName: String(paper.sourceName || this.name),
			filename: String(
				paper.filename ||
					`${standardId}_${year || "unknown"}_${paper.type || "exam"}.${paper.format || "pdf"}`
			),
			type,
			titleTerms: `${paper.title || ""} ${subject}`.trim(),
		};
	}
}

/**
 * Standardised Paper object:
 * {
 *   standardId: "91170",
 *   subject: "Physics",
 *   title: "Demonstrate understanding of waves",
 *   level: "2",
 *   year: "2020",
 *   format: "pdf", // or doc, zip
 *   url: "...",
 *   sourceName: "OurExamsAdapter",
 *   filename: "91170-2020.pdf",
 *   type: "exam" // exam, schedule, resource, etc.
 * }
 */
