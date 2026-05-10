import Conf from "conf";
import { DEFAULT_FAVORITE_SOURCE } from "./constants.js";

const schema = {
	default_download_path: {
		type: "string",
		default: "~/Downloads/",
	},
	always_refresh_sources: {
		type: "boolean",
		default: false,
	},
	auto_select_source: {
		type: "boolean",
		default: true,
	},
	default_source_override: {
		type: "string",
		default: "",
	},
	favorite_source: {
		type: "string",
		default: DEFAULT_FAVORITE_SOURCE,
	},
};

export const config = new Conf({ projectName: "ncea-cli", schema });
