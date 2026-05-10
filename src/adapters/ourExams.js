import axios from "axios";
import { PaperSourceAdapter } from "./index.js";
import { CacheService } from "../core/cache.js";
import {
	HTTP_TIMEOUT_MS,
	INDEX_CACHE_TTL_MS,
	PaperType,
} from "../core/constants.js";
import { normaliseLevelValue, normaliseStandardId } from "../core/models.js";

const SEARCH_INDEX_URL = "https://www.ourexams.org/searchIndex.json";
const CACHE_KEY = "ourexams_index";

function buildBulkPaper(adapterName, item) {
	const standardId = item.number;
	const title = item.title ? item.title.trim() : "";
	const subject = item.subject
		? item.subject.replace(",", "").trim()
		: "Unknown";
	const startYear = Number(item["start-year"]);
	const endYear = Number(item["end-year"]);
	const level = normaliseLevelValue(item.level);

	return {
		standardId,
		subject,
		title,
		level,
		yearFrom: Number.isInteger(startYear) ? startYear : null,
		yearTo: Number.isInteger(endYear) ? endYear : null,
		format: "zip",
		url: `https://raw.githubusercontent.com/JelyMe/NCEAPapers/main/zipped/${standardId}.zip`,
		sourceName: adapterName,
		filename: `${standardId}_bulk.zip`,
		type: PaperType.BULK_ZIP,
	};
}

function mapIndexToBulkPapers(adapterName, indexData) {
	return (Array.isArray(indexData) ? indexData : []).map((item) =>
		buildBulkPaper(adapterName, item)
	);
}

export class OurExamsAdapter extends PaperSourceAdapter {
	static displayName = "OurExams GitHub Repository";

	async _loadIndexData() {
		return CacheService.getOrSet(CACHE_KEY, INDEX_CACHE_TTL_MS, async () => {
			try {
				const response = await axios.get(SEARCH_INDEX_URL, {
					timeout: HTTP_TIMEOUT_MS,
				});
				return Array.isArray(response.data) ? response.data : [];
			} catch (err) {
				console.error(`Failed to fetch from ${this.name}:`, err.message);
				return [];
			}
		});
	}

	async buildIndex() {
		return mapIndexToBulkPapers(this.name, await this._loadIndexData());
	}

	async fetchByStandard(standardId) {
		const id = normaliseStandardId(standardId);
		if (!id) return [];

		const indexData = await this._loadIndexData();
		const matched = (indexData || []).filter(
			(item) => String(item.number) === id
		);
		if (matched.length === 0) return [];

		return mapIndexToBulkPapers(this.name, matched)
			.map((paper) => this.normalisePaper(paper))
			.filter(Boolean);
	}
}
