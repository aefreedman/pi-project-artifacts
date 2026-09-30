import manifest from "../../package.json" with { type: "json" };

/** Public provenance must identify the version of the installed package. */
export const ARTIFACTS_PACKAGE_NAME: string = manifest.name;
export const ARTIFACTS_PACKAGE_VERSION: string = manifest.version;
