// Source priority is an opinionated default order, then user settings and manifest rules refine it.
export const SOURCE_PRIORITY = [
	"StudyTimeAdapter",
	"QuirkyAdapter",
	"NoBrainTooSmallAdapter",
	"OurExamsAdapter",
];

export const MANIFEST_TTL_HOURS = 72; // Refresh the manifest every three days.
export const MANIFEST_VERSION = 1;
// Fuse is intentionally strict here because the higher-level scorer already handles fuzziness.
export const FUSE_THRESHOLD = 0.3;
export const FUSE_KEYS = ["standardId", "title", "subject", "titleTerms"];
export const INDEX_CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour
export const HTTP_TIMEOUT_MS = 15000;
export const DOWNLOAD_HEAD_TIMEOUT_MS = 5000;
export const DEFAULT_FAVORITE_SOURCE = SOURCE_PRIORITY[0];

export const PaperType = {
	EXAM: "exam",
	CD: "cd",
	CD_TRANSCRIPT: "cd_transcript",
	SCHEDULE: "schedule",
	SPECIFICATIONS: "specifications",
	EXEMPLAR: "exemplar",
	PEP: "pep",
	RESOURCE: "resource",
	BULK_ZIP: "bulk_zip",
	UNKNOWN: "unknown",
};
