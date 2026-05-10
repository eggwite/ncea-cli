import axios from "axios";
import * as cheerio from "cheerio";
import { PaperSourceAdapter } from "./index.js";
import { CacheService } from "../core/cache.js";
import { INDEX_CACHE_TTL_MS } from "../core/constants.js";
import { normaliseStandardId } from "../core/models.js";
import { extractYear } from "../utils/index.js";

const CACHE_KEY = "studytime_index";
const HTTP_TIMEOUT_MS = 15000;

export class StudyTimeAdapter extends PaperSourceAdapter {
	static displayName = "StudyTime HTML Scraper";

	async buildIndex() {
		return [];
	}

	async fetchByStandard(standardId) {
		const id = normaliseStandardId(standardId);
		if (!id) return [];

		const cached = await CacheService.getOrSet(
			CACHE_KEY,
			INDEX_CACHE_TTL_MS,
			() => this._crawlAll()
		);

		return cached
			.filter((paper) => normaliseStandardId(paper.standardId) === id)
			.map((paper) => this.normalisePaper(paper))
			.filter(Boolean);
	}

	async _crawlAll() {
		const papers = [];
		try {
			const { data: mainHtml } = await axios.get(
				"https://studytime.co.nz/exams/",
				{ timeout: HTTP_TIMEOUT_MS }
			);
			const $main = cheerio.load(mainHtml);
			const subjectLinks = [];

			$main('a[href*="/exams/level-"]').each((_, el) => {
				const text = $main(el).text().trim();
				const href = $main(el).attr("href");
				if (text.length > 0 && href) {
					subjectLinks.push(href);
				}
			});

			// Deduplicate subject links
			const uniqueLinks = [...new Set(subjectLinks)];

			// Fetch all subject pages in parallel
			const fetchPromises = uniqueLinks.map(async (url) => {
				try {
					const absoluteUrl = url.startsWith("http")
						? url
						: `https://studytime.co.nz${url.startsWith("/") ? "" : "/"}${url}`;
					const { data: subHtml } = await axios.get(absoluteUrl, {
						timeout: HTTP_TIMEOUT_MS,
					});
					const $ = cheerio.load(subHtml);

					let currentStandardId = null;
					let currentStandardTitle = null;

					// The H3 sets the current standard, and the following links belong to it.
					$("h3, a").each((_, el) => {
						const $el = $(el);
						if (el.tagName === "h3") {
							const text = $el.text().trim();
							// Standard headings start with the five-digit ID, followed by an optional title.
							const match = text.match(/^(\d{5})\s*(?:[-–—]\s*)?(.*)/);
							// Use the heading title when present; otherwise keep an empty string.
							if (match) {
								currentStandardId = match[1];
								currentStandardTitle = match[2] || "";
							}
						} else if (el.tagName === "a" && currentStandardId) {
							const href = $el.attr("href");
							if (href && href.toLowerCase().endsWith(".pdf")) {
								const label = $el.text().trim();
								let type = "exam";
								if (label.toLowerCase().includes("schedule")) {
									type = "schedule";
								}

								const absolutePaperUrl = href.startsWith("http")
									? href
									: new URL(href, absoluteUrl).toString();

								const hrefFileName = absolutePaperUrl.split("/").pop() || "";
								// Search the label, filename, and resolved URL so the year survives
								// whichever field happens to contain it.
								const year = extractYear(label, hrefFileName, absolutePaperUrl);

								papers.push({
									standardId: currentStandardId,
									subject: absoluteUrl.split("/").filter(Boolean).pop() || "Unknown",
									title: currentStandardTitle,
									level: absoluteUrl.includes("level-1")
										? 1
										: absoluteUrl.includes("level-2")
											? 2
											: absoluteUrl.includes("level-3")
												? 3
												: 0,
									year,
									format: "pdf",
									url: absolutePaperUrl,
									sourceName: this.name,
									filename: `${currentStandardId}_${year || "unknown"}_${type}.pdf`,
									type,
								});
							}
						}
					});
				} catch (e) {
					// Ignore failures on individual pages
				}
			});

			await Promise.all(fetchPromises);
			return papers;
		} catch (err) {
			console.error(`Failed to build StudyTime index: ${err.message}`);
			return [];
		}
	}
}
