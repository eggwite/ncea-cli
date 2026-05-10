#!/usr/bin/env node
// Top-level handlers to surface full stack traces for debugging
process.on("uncaughtException", (err) => {
	// Print stack if available, otherwise the error object
	console.error("uncaughtException", err && err.stack ? err.stack : err);
});
process.on("unhandledRejection", (reason) => {
	console.error(
		"unhandledRejection",
		reason && reason.stack ? reason.stack : reason
	);
});
import { Command } from "commander";
import * as p from "@clack/prompts";
import fs from "fs";
import os from "os";
import { SearchAggregator } from "./core/search.js";
import { DownloadService } from "./core/downloader.js";
import { CacheService } from "./core/cache.js";
import { config } from "./core/config.js";
import { ManifestService } from "./core/manifest.js";
import path from "path";
import {
	PROMPT_CANCELLED,
	createPrompt,
	formatBytes,
	getStorageUsage,
	makeTextBox,
	resolveDownloadPath,
	wasPromptCancelled,
} from "./utils/index.js";

const program = new Command();
const color = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	cyan: "\x1b[36m",
	blue: "\x1b[34m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	red: "\x1b[31m",
	gray: "\x1b[90m",
	magenta: "\x1b[35m",
	white: "\x1b[37m",
	black: "\x1b[30m",
	bgGreen: "\x1b[42m",
};

const CACHE_DIR = path.join(os.homedir(), ".ncea-cli-cache");
const DATA_DIR = path.join(os.homedir(), ".ncea-cli");

const prompt = createPrompt();

function printHeader() {
	// prettier-ignore
	const titleBox = makeTextBox(
		[
			{ text: "███╗   ██╗ ██████╗███████╗ █████╗        ██████╗██╗     ██╗", textColor: color.cyan },
			{ text: "████╗  ██║██╔════╝██╔════╝██╔══██╗      ██╔════╝██║     ██║", textColor: color.cyan },
			{ text: "██╔██╗ ██║██║     █████╗  ███████║█████╗██║     ██║     ██║", textColor: color.blue },
			{ text: "██║╚██╗██║██║     ██╔══╝  ██╔══██║╚════╝██║     ██║     ██║", textColor: color.blue },
			{ text: "██║ ╚████║╚██████╗███████╗██║  ██║      ╚██████╗███████╗██║", textColor: color.blue },
			{ text: "╚═╝  ╚═══╝ ╚═════╝╚══════╝╚═╝  ╚═╝       ╚═════╝╚══════╝╚═╝", textColor: color.blue },
			{text:"Fast search. Clean picks — All in one place.", textColor: color.gray},

		],
		60,
		"double",
		{ borderColor: color.blue }
	);
	console.log("");
	for (const line of titleBox) {
		console.log(line);
	}
	console.log("");
}

program
	.name("ncea-cli")
	.description(
		"Interactive CLI to search and download NCEA Past Papers securely"
	)
	.version("1.0.0");

program
	.option(
		"-s, --search <query>",
		"Smart search by title, subject, or keywords (or standard ID)"
	)
	.option("-p, --path <path>", "Custom download path")
	.option("-r, --refresh", "Bypass manifest cache and refresh from sources")
	.option("--clear-cache", "Clear cached adapter files (~/.ncea-cli-cache)")
	.option(
		"--clear-manifest-index",
		"Clear manifest/index metadata (~/.ncea-cli)"
	)
	.option("-y, --yes", "Skip confirmation prompts for destructive actions")
	.option("--source <source>", "Force source for the current session")
	.action(async (options) => {
		p.intro("NCEA CLI");
		const manifestService = new ManifestService();
		const aggregator = new SearchAggregator();
		const initSpinner = p.spinner();
		initSpinner.start("Initializing search index...");
		await aggregator.initialise();
		initSpinner.stop("Search index ready.");
		printHeader();

		const downloadPath = resolveDownloadPath(
			options.path || config.get("default_download_path") || "~/Downloads/"
		);
		const refreshOverride = Boolean(options.refresh);
		const cliSourceOverride = options.source ? String(options.source) : null;
		const skipConfirm = Boolean(options.yes);
		let runOnceQuery = options.search || null;
		let runOnceMode = Boolean(runOnceQuery);

		const clearCacheFiles = () => {
			CacheService.clear();
			aggregator.clearRuntimeMemo();
		};

		const clearManifestIndexes = () => {
			if (fs.existsSync(DATA_DIR)) {
				fs.rmSync(DATA_DIR, { recursive: true, force: true });
			}
			aggregator.clearRuntimeMemo();
		};

		const confirmDestructive = async (message) => {
			if (skipConfirm) return true;
			const answer = await prompt.confirm(
				{ message, initialValue: false },
				"Destructive action cancelled."
			);
			if (wasPromptCancelled(answer)) return false;
			return Boolean(answer);
		};

		const getSourceOptions = ({ includeNone = false } = {}) => {
			const options = aggregator.getSourceOptions().map((source) => ({
				value: source.value,
				label: source.label,
			}));
			if (!includeNone) return options;
			return [{ value: "", label: "None (auto source selection)" }, ...options];
		};

		const pickPreferredAdapter = async () => {
			const options = getSourceOptions();
			if (options.length === 0) {
				p.log.warn("No adapters are currently available.");
				return false;
			}

			const source = await prompt.select(
				{
					message: "Choose preferred adapter:",
					options,
				},
				"Adapter selection cancelled."
			);
			if (wasPromptCancelled(source)) return false;
			config.set("favorite_source", source);
			p.log.success(
				`Preferred source saved: ${aggregator.getSourceDisplayName(source)}`
			);
			return true;
		};

		const pickDefaultSourceOverride = async () => {
			const source = await prompt.select(
				{
					message: "Set default source override (--source equivalent):",
					options: getSourceOptions({ includeNone: true }),
				},
				"Source override selection cancelled."
			);
			if (wasPromptCancelled(source)) return false;
			config.set("default_source_override", source);
			p.log.success(
				source
					? `Default source override saved: ${aggregator.getSourceDisplayName(source)}`
					: "Default source override cleared."
			);
			return true;
		};

		const pickDownloadPath = async () => {
			const currentPath = config.get("default_download_path") || "~/Downloads/";
			const resolvedCurrentPath = resolveDownloadPath(currentPath);
			const value = await prompt.text(
				{
					message: `Set default download path (e.g. ${resolvedCurrentPath}):`,
					placeholder: currentPath,
					initialValue: currentPath,
				},
				"Download path selection cancelled."
			);
			if (wasPromptCancelled(value)) return false;

			const nextPath = String(value || "").trim();
			if (!nextPath) {
				p.log.warn("Download path cannot be empty.");
				return false;
			}

			config.set("default_download_path", nextPath);
			p.log.success(
				`Default download path saved: ${nextPath} -> ${resolveDownloadPath(nextPath)}`
			);
			return true;
		};

		const openSourceSettings = async () => {
			while (true) {
				const action = await prompt.select(
					{
						message: "Source settings",
						options: [
							{
								label: "Preferred adapter",
								value: "preferred",
								hint: "Used first when multiple sources provide the same file",
							},
							{
								label: `Auto-select source when available (${Boolean(config.get("auto_select_source")) ? "ON" : "OFF"})`,
								value: "auto_source_toggle",
								hint: "When ON, pick the saved or preferred source automatically",
							},
							{
								label: "Default source override",
								value: "override",
								hint: "Force one source by default (can still override via CLI)",
							},
							{ label: "Back", value: "back", hint: "Return to Settings" },
						],
					},
					"Source settings closed."
				);
				if (wasPromptCancelled(action)) return;

				if (action === "back") return;
				if (action === "preferred") {
					const completed = await pickPreferredAdapter();
					if (!completed) return;
					continue;
				}
				if (action === "auto_source_toggle") {
					const nextValue = !Boolean(config.get("auto_select_source"));
					config.set("auto_select_source", nextValue);
					p.log.info(
						`Auto-select source when available: ${nextValue ? "ON" : "OFF"}`
					);
					continue;
				}
				if (action === "override") {
					const completed = await pickDefaultSourceOverride();
					if (!completed) return;
				}
			}
		};

		const openSettingsMenu = async () => {
			while (true) {
				const usage = getStorageUsage(CACHE_DIR, DATA_DIR);
				const refreshEnabled = Boolean(config.get("always_refresh_sources"));
				const refreshLabel = refreshEnabled ? "ON" : "OFF";
				const autoSourceLabel = Boolean(config.get("auto_select_source"))
					? "ON"
					: "OFF";
				const favoriteSourceValue = config.get("favorite_source") || "";
				const favoriteSourceLabel = favoriteSourceValue
					? aggregator.getSourceDisplayName(favoriteSourceValue)
					: "Default source priority";
				const overrideSourceValue = config.get("default_source_override") || "";
				const overrideSourceLabel = overrideSourceValue
					? aggregator.getSourceDisplayName(overrideSourceValue)
					: "None";
				const downloadPathSetting =
					config.get("default_download_path") || "~/Downloads/";
				const resolvedDownloadPath = resolveDownloadPath(downloadPathSetting);

				const action = await prompt.select(
					{
						message: "Settings",
						options: [
							{
								label: `Download location (${resolvedDownloadPath})`,
								value: "download_path",
								hint: `Current setting: ${downloadPathSetting}`,
							},
							{
								label: `Source preferences (${favoriteSourceLabel}; auto ${autoSourceLabel}; override ${overrideSourceLabel})`,
								value: "sources",
								hint:
									"Manage preferred adapter, auto source selection, and default override",
							},
							{
								label: `Always refresh remote sources (${refreshLabel})`,
								value: "refresh_toggle",
								hint: "When ON, bypass local manifest and query sources live",
							},
							{
								label: `Clear cache (${formatBytes(usage.cacheBytes)})`,
								value: "clear_cache",
								hint: "Deletes adapter cache files under ~/.ncea-cli-cache",
							},
							{
								label: `Clear manifest/index metadata (${formatBytes(usage.manifestBytes)})`,
								value: "clear_manifest",
								hint: "Removes ~/.ncea-cli metadata so indexes are rebuilt",
							},
							{ label: "Back", value: "back", hint: "Return to main menu" },
						],
					},
					"Settings menu closed."
				);
				if (wasPromptCancelled(action)) return;

				if (action === "back") return;
				if (action === "download_path") {
					const completed = await pickDownloadPath();
					if (!completed) return;
					continue;
				}
				if (action === "sources") {
					await openSourceSettings();
					continue;
				}
				if (action === "refresh_toggle") {
					config.set("always_refresh_sources", !refreshEnabled);
					p.log.info(
						`Always refresh remote sources: ${!refreshEnabled ? "ON" : "OFF"}`
					);
					continue;
				}

				if (action === "clear_cache") {
					const ok = await confirmDestructive("Clear cache files now? (y/N)");
					if (!ok) {
						p.log.warn("Cancelled.");
						continue;
					}
					clearCacheFiles();
					p.log.success("Cache cleared.");
					continue;
				}

				if (action === "clear_manifest") {
					const ok = await confirmDestructive(
						"Clear manifest/index metadata now? (y/N)"
					);
					if (!ok) {
						p.log.warn("Cancelled.");
						continue;
					}
					clearManifestIndexes();
					p.log.success("Manifest/index metadata cleared.");
				}
			}
		};

		if (options.clearCache) {
			const ok = await confirmDestructive("Clear cache files now? (y/N)");
			if (ok) {
				clearCacheFiles();
				p.log.success("Cache cleared.");
			} else {
				p.log.warn("Cache clear cancelled.");
			}
		}

		if (options.clearManifestIndex) {
			const ok = await confirmDestructive(
				"Clear manifest/index metadata now? (y/N)"
			);
			if (ok) {
				clearManifestIndexes();
				p.log.success("Manifest/index metadata cleared.");
			} else {
				p.log.warn("Manifest/index clear cancelled.");
			}
		}

		if ((options.clearCache || options.clearManifestIndex) && !runOnceMode) {
			p.outro("Done.");
			return;
		}

		const nonEmptyInput = async (message) => {
			while (true) {
				function randomPlaceholder() {
					const arrayOfPlaceholders = [
						"L3 Complex Numbers",
						"Bio Level 2 Cells",
						"Japanese",
					];
					const randomElement =
						arrayOfPlaceholders[
							Math.floor(Math.random() * arrayOfPlaceholders.length)
						];
					return randomElement;
				}
				const value = await prompt.text(
					{ message, placeholder: randomPlaceholder() },
					"Input cancelled."
				);
				if (wasPromptCancelled(value)) return PROMPT_CANCELLED;
				const trimmed = String(value).trim();
				if (trimmed) return trimmed;
				p.log.warn("Input cannot be empty. Please try again.");
			}
		};

		while (true) {
			try {
				const shouldRefresh = Boolean(
					refreshOverride || config.get("always_refresh_sources")
				);
				const sourceOverride =
					cliSourceOverride || config.get("default_source_override") || null;

				let query = runOnceQuery;
				const sourceSelectionByStandard = {};

				if (!runOnceMode) {
					p.log.message("↑↓ navigate • space select • a all • i invert • ⏎ submit");
					const action = await prompt.select(
						{
							message: "What would you like to do?",
							options: [
								{
									label: "Smart search (keywords/subject, or standard ID)",
									value: "query",
								},
								{ label: "Configure Settings", value: "settings" },
								{ label: "Exit", value: "exit" },
							],
						},
						"Session cancelled."
					);
					if (wasPromptCancelled(action)) break;

					if (action === "exit") {
						break;
					}

					if (action === "settings") {
						await openSettingsMenu();
						continue;
					}

					if (action === "query") {
						query = await nonEmptyInput("Enter keyword, subject or title:");
						if (wasPromptCancelled(query)) break;
					}
				}

				if (!query) {
					if (runOnceMode) break;
					continue;
				}

				const searchSpinner = p.spinner();
				searchSpinner.start(
					shouldRefresh
						? "Refreshing papers from remote sources..."
						: "Searching standards from local index..."
				);

				const results = await aggregator.search(query, {
					refresh: shouldRefresh,
				});
				searchSpinner.stop(
					`Found ${results.length} matching standard${results.length === 1 ? "" : "s"}.`
				);

				if (results.length === 0) {
					p.log.warn("No results found for your query.");
					if (runOnceMode) break;
					continue;
				}

				const topResult = results[0];
				if (
					topResult &&
					(topResult.matchConfidence === "low" ||
						(Number.isFinite(topResult.matchScore)
							? topResult.matchScore < 10
							: false))
				) {
					// Keep this conservative so near-miss results still prompt a sanity check.
					p.log.warn(
						"The engine is not sure about these results; refine the query if you need a better match."
					);
				}

				if (results.length > 1) {
					const queryTerms = String(query || "")
						.toLowerCase()
						.split(/\s+/)
						.filter(Boolean);
					const bestTitle = (results[0]?.label || "").toLowerCase();
					const allMatched = queryTerms.every((term) => bestTitle.includes(term));
					if (!allMatched) {
						p.log.info("Showing the top matches.");
					}
				}

				const standardChoices = [
					...results.map((r) => ({ label: r.label, value: r })),
					{ label: "Back", value: "back", hint: "Return to main menu" },
				];

				const selectedGroup = await prompt.select(
					{
						message: "Select standard to download:",
						options: standardChoices,
					},
					"Selection cancelled."
				);
				if (wasPromptCancelled(selectedGroup)) break;

				if (selectedGroup === "back") {
					// const confirmBack = await confirmBackNavigation("Return to main menu?");
					// if (!confirmBack) {
					continue;
					// }
					// if (runOnceMode) break;
					// continue;
				}

				const allSelectedPapers = [];
				let navigateBack = false;
				const autoSelectSource = Boolean(config.get("auto_select_source"));

				const groupPapersBySource = (papersForType) => {
					const sourceGroups = {};
					for (const paper of papersForType) {
						if (!sourceGroups[paper.sourceName]) {
							sourceGroups[paper.sourceName] = [];
						}
						sourceGroups[paper.sourceName].push(paper);
					}
					return sourceGroups;
				};

				const chooseSourceName = async (
					sourceGroups,
					standardId,
					fallbackPaper
				) => {
					const availableSources = Object.keys(sourceGroups);
					if (availableSources.length === 0) return null;

					if (sourceOverride && sourceGroups[sourceOverride]) {
						return sourceOverride;
					}

					if (autoSelectSource) {
						const rememberedSource = sourceSelectionByStandard[standardId];
						if (rememberedSource && sourceGroups[rememberedSource]) {
							return rememberedSource;
						}

						const preferredSource = manifestService.getPreferredSource(fallbackPaper);
						if (preferredSource && sourceGroups[preferredSource]) {
							return preferredSource;
						}
					}

					if (availableSources.length === 1) {
						return availableSources[0];
					}

					const sourceChoice = await prompt.select(
						{
							message: `Choose source for Standard ${standardId}:`,
							options: availableSources.map((sourceName) => ({
								label: `${aggregator.getSourceDisplayName(sourceName)} (${sourceGroups[sourceName].length} file${sourceGroups[sourceName].length === 1 ? "" : "s"})`,
								value: sourceName,
							})),
						},
						"Source selection cancelled."
					);
					if (wasPromptCancelled(sourceChoice)) return PROMPT_CANCELLED;
					return sourceChoice;
				};

				const resolvePaperForType = async (papersForType, standardId) => {
					if (!Array.isArray(papersForType) || papersForType.length === 0) {
						return null;
					}

					const sourceGroups = groupPapersBySource(papersForType);
					const sourceName = await chooseSourceName(
						sourceGroups,
						standardId,
						papersForType[0]
					);
					if (wasPromptCancelled(sourceName)) return PROMPT_CANCELLED;
					if (sourceName && !sourceSelectionByStandard[standardId]) {
						sourceSelectionByStandard[standardId] = sourceName;
					}

					const matchedPapers = sourceGroups[sourceName] || [];
					const selectedPaper = matchedPapers[0] || null;
					if (selectedPaper && sourceName) {
						manifestService.setPreferredSource(selectedPaper, sourceName);
					}
					return selectedPaper;
				};

				const fetchSpinner = p.spinner();
				fetchSpinner.start("Checking selected standard...");

				const papers = await aggregator.searchExactByStandardId(
					selectedGroup.standardId,
					{
						refresh: shouldRefresh,
					}
				);
				const selectedGroupWithEntries = aggregator
					.groupResults(papers)
					.find(
						(group) => String(group.standardId) === String(selectedGroup.standardId)
					);

				if (
					!selectedGroupWithEntries ||
					!Array.isArray(selectedGroupWithEntries.entries) ||
					selectedGroupWithEntries.entries.length === 0
				) {
					fetchSpinner.stop("Finished checking selected standard.");
					p.log.warn(`Papers weren't found for: ${selectedGroup.standardId}`);
					if (runOnceMode) break;
					continue;
				}

				fetchSpinner.stop("Found papers for selected standard.");

				const group = selectedGroupWithEntries;

				const entryChoicesByYear = group.entries.map((entry) => ({
					label: `${entry.label} | ${entry.typeSummary} | Sources: ${entry.sourceSummary}`,
					value: entry,
				}));

				const entryChoices = [
					...entryChoicesByYear,
					{ label: "Back", value: "back", hint: "Return to main menu" },
				];

				let selectedEntries;
				while (true) {
					selectedEntries = await prompt.multiselect(
						{
							message: `Choose items for ${group.label}:`,
							options: entryChoices,
							required: false,
						},
						"Selection cancelled."
					);

					if (wasPromptCancelled(selectedEntries)) {
						selectedEntries = "cancel";
						break;
					}

					if (selectedEntries.includes("back") && selectedEntries.length > 1) {
						p.log.warn(
							"You cannot select 'Back' alongside other items. Please choose one or the other."
						);
						continue;
					}

					if (selectedEntries.length === 0) {
						p.log.warn(
							`No items selected for ${group.standardId}. Please choose at least one.`
						);
						continue;
					}

					break;
				}

				if (selectedEntries === "cancel") {
					navigateBack = true;
				}

				if (
					!navigateBack &&
					selectedEntries.length === 1 &&
					selectedEntries[0] === "back"
				) {
					// const confirmBack = await confirmBackNavigation("Return to main menu?");
					// if (!confirmBack) {
					continue;
					// }
					// navigateBack = true;
				}

				if (!navigateBack) {
					for (const entry of selectedEntries) {
						const typeSelection = await prompt.multiselect(
							{
								message: `Choose paper types for ${entry.label}:`,
								options: entry.typeChoices.map((typeChoice) => ({
									label: `${typeChoice.label} (${typeChoice.sourceCount} source${typeChoice.sourceCount === 1 ? "" : "s"})`,
									value: typeChoice.type,
								})),
								required: false,
							},
							"Type selection cancelled."
						);

						if (wasPromptCancelled(typeSelection)) {
							navigateBack = true;
							break;
						}

						if (typeSelection.length === 0) {
							p.log.warn(`No paper types selected for ${entry.label}.`);
							continue;
						}

						for (const typeChoice of entry.typeChoices) {
							if (!typeSelection.includes(typeChoice.type)) continue;
							const papersForType = Array.isArray(typeChoice.papers)
								? typeChoice.papers
								: [];
							if (papersForType.length === 0) continue;

							const chosenPaper = await resolvePaperForType(
								papersForType,
								group.standardId
							);

							if (wasPromptCancelled(chosenPaper)) {
								navigateBack = true;
								break;
							}

							if (!chosenPaper) {
								continue;
							}

							allSelectedPapers.push(chosenPaper);
						}
						if (navigateBack) break;
					}
				}

				if (navigateBack) {
					continue;
				}

				if (allSelectedPapers.length === 0) {
					p.log.warn("No papers selected.");
					if (runOnceMode) break;
					continue;
				}

				const dedupedPapers = [];
				const seenPaperKeys = new Set();
				for (const paper of allSelectedPapers) {
					const key = `${paper.sourceName}|${paper.url}`;
					if (seenPaperKeys.has(key)) continue;
					seenPaperKeys.add(key);
					dedupedPapers.push(paper);
				}

				p.log.step(`Starting download to ${path.resolve(downloadPath)}`);
				const downloadSpinner = p.spinner();
				const totalDownloads = dedupedPapers.length;
				downloadSpinner.start("Downloading selected papers...");

				const errors = [];

				for (let i = 0; i < totalDownloads; i++) {
					const paper = dedupedPapers[i];
					downloadSpinner.message(
						`Downloading ${i + 1}/${totalDownloads}: ${paper.filename}`
					);
					const result = await DownloadService.downloadInfo(paper, downloadPath);
					manifestService.recordDownloadOutcome(paper, result === true);
					if (result !== true)
						errors.push({
							paper,
							error: String(result),
						});
				}
				downloadSpinner.stop("Download complete.");
				if (errors.length > 0) {
					p.log.warn("Some downloads failed:");
					errors.forEach(({ paper, error }) => {
						p.log.warn(`${paper.filename} [${paper.sourceName}]`);
						p.log.message(`  ${error}`);
						p.log.message(`  URL: ${paper.url}`);
					});

					const retryFailed = await prompt.select(
						{
							message: "Retry failed downloads once?",
							options: [
								{ label: "Yes, retry failed", value: true },
								{ label: "No", value: false },
							],
						},
						"Retry prompt cancelled."
					);
					if (wasPromptCancelled(retryFailed)) break;

					if (retryFailed) {
						const retrySpinner = p.spinner();
						retrySpinner.start("Retrying failed items...");
						let retriedSuccess = 0;
						for (const failed of errors) {
							const retryResult = await DownloadService.downloadInfo(
								failed.paper,
								downloadPath
							);
							if (retryResult === true) retriedSuccess++;
						}
						retrySpinner.stop(
							`Retry complete: ${retriedSuccess}/${errors.length} recovered.`
						);
					}
				}

				if (runOnceMode) break;

				const again = await prompt.select(
					{
						message: "Do you want to search/download another standard?",
						options: [
							{ label: "Yes", value: true },
							{ label: "No, exit", value: false },
						],
					},
					"Session cancelled."
				);
				if (wasPromptCancelled(again)) break;

				if (!again) break;
				query = null;
				runOnceMode = false;
				runOnceQuery = null;
			} catch (err) {
				p.log.error(`Unexpected error: ${err.message || err}`);
				p.outro("Session ended with errors.");
				process.exit(1);
			}
		}
		p.outro("Hope to see you again soon!");
	});

program.parse(process.argv);
