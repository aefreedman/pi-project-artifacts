import manifest from "../../package.json" with { type: "json" };
/** Public provenance must identify the version of the installed package. */
export const ARTIFACTS_PACKAGE_NAME = manifest.name;
export const ARTIFACTS_PACKAGE_VERSION = manifest.version;
