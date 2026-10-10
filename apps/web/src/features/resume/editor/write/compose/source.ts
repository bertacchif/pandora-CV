import { readSource } from "./model";

/**
 * The Source text bundled with the app: the author's gitignored `source.local.yaml` when present, otherwise the
 * committed `source.example.yaml`. The glob makes the local file optional at build time, and Vite reloads both in
 * dev. A build made on a machine with the local file bundles it.
 */
const files = import.meta.glob<string>("./source.{local,example}.yaml", {
	query: "?raw",
	import: "default",
	eager: true,
});

const sourceText = files["./source.local.yaml"] ?? files["./source.example.yaml"] ?? "";

/** The parsed Source, or the error naming the Snippet that broke it. */
export const source = readSource(sourceText);
