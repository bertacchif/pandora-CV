import type { Node } from "node-html-parser";
import { NodeType, parse as parseHtml } from "node-html-parser";
import { parse as parseYaml } from "yaml";

/**
 * Compose: build a description from a Source of reusable Snippets. Pure: no React, DOM or editor, so every
 * rule here is tested on its own. No function mutates its input.
 */

export type BlockKind = "paragraph" | "heading" | "bullet" | "opaque";

/** One element of the Source. Each Variant is one HTML block string. */
export type Snippet = { variants: string[] };

/** One element of the composition: a frozen copy of a Variant, or a piece split from existing description HTML. */
export type Block = { kind: BlockKind; html: string };

export type SourceErrorReason =
	| "invalid-yaml"
	| "not-a-list"
	| "empty-variants"
	| "non-string-variant"
	| "unknown-shape";

/** A Source that can't be read. `position` is the 1-based position of the offending Snippet, if one is to blame. */
export class SourceError extends Error {
	readonly reason: SourceErrorReason;
	readonly position: number | null;

	constructor(reason: SourceErrorReason, position: number | null = null, detail?: string) {
		super(detail ?? (position === null ? reason : `${reason} at Snippet ${position}`));
		this.name = "SourceError";
		this.reason = reason;
		this.position = position;
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function toSnippet(item: unknown, index: number): Snippet {
	const position = index + 1;
	if (typeof item === "string") return { variants: [item] };

	if (!isRecord(item) || Object.keys(item).length !== 1 || !("variants" in item)) {
		throw new SourceError("unknown-shape", position);
	}

	const variants = item.variants;
	if (!Array.isArray(variants) || variants.length === 0) throw new SourceError("empty-variants", position);
	if (!variants.every((variant) => typeof variant === "string")) {
		throw new SourceError("non-string-variant", position);
	}
	return { variants: [...variants] };
}

/**
 * Reads Source YAML: a flat list where each item is an HTML block string, or `{ variants: [...] }` holding a
 * non-empty list of them. Throws a SourceError naming the Snippet's position when the Source is invalid.
 */
export function parseSource(text: string): Snippet[] {
	let data: unknown;
	try {
		data = parseYaml(text);
	} catch (error) {
		throw new SourceError("invalid-yaml", null, error instanceof Error ? error.message : undefined);
	}

	if (data === null || data === undefined) return [];
	if (!Array.isArray(data)) throw new SourceError("not-a-list");
	return data.map(toSnippet);
}

const INLINE_TAGS = new Set([
	"a",
	"abbr",
	"b",
	"br",
	"cite",
	"code",
	"em",
	"i",
	"mark",
	"q",
	"s",
	"small",
	"span",
	"strong",
	"sub",
	"sup",
	"u",
]);

const HEADING = /^h[1-6]$/;

const UNSAFE_TAGS = "script, style, iframe, object, embed, link, meta, base, form";

const tagOf = (node: Node) => (node.nodeType === NodeType.ELEMENT_NODE ? node.rawTagName.toLowerCase() : null);

const isInline = (node: Node) => node.nodeType === NodeType.TEXT_NODE || INLINE_TAGS.has(tagOf(node) ?? "");

/** Top-level nodes that carry content: elements and non-blank text. */
const contentNodes = (html: string) =>
	parseHtml(html, { comment: false }).childNodes.filter(
		(node) => node.nodeType === NodeType.ELEMENT_NODE || (node.nodeType === NodeType.TEXT_NODE && node.text.trim()),
	);

const kindOfTag = (tag: string | null): BlockKind | null => {
	if (tag === "p") return "paragraph";
	if (tag === "li") return "bullet";
	if (tag && HEADING.test(tag)) return "heading";
	return null;
};

/** The Block a Variant freezes into: its outer tag decides the kind; text with no block tag becomes a paragraph. */
function toBlock(variant: string): Block {
	const html = variant.trim();
	const nodes = contentNodes(html);
	const [only] = nodes;

	if (nodes.length === 1 && only) {
		const kind = kindOfTag(tagOf(only));
		if (kind) return { kind, html };
	}
	if (nodes.every(isInline)) return { kind: "paragraph", html: `<p>${html}</p>` };
	return { kind: "opaque", html };
}

/** Appends a frozen copy of the Snippet's Variant at `variantIndex`. Duplicates are allowed. */
export function addBlock(blocks: readonly Block[], snippet: Snippet, variantIndex: number): readonly Block[] {
	const variant = snippet.variants[variantIndex];
	if (variant === undefined) return blocks;
	return [...blocks, toBlock(variant)];
}

/** Removes the Block at `index`; by position, so duplicates go one at a time. */
export function removeBlock<T = Block>(blocks: readonly T[], index: number): readonly T[] {
	return blocks.filter((_, position) => position !== index);
}

/** Moves the Block at `from` so it ends up at `to`. Its own position, or one outside the list, changes nothing. */
export function moveBlock<T = Block>(blocks: readonly T[], from: number, to: number): readonly T[] {
	const inRange = (index: number) => index >= 0 && index < blocks.length;
	const moving = blocks[from];
	if (from === to || !inRange(from) || !inRange(to) || moving === undefined) return blocks;

	const next = blocks.filter((_, position) => position !== from);
	next.splice(to, 0, moving);
	return next;
}

/** Joins Blocks into one description, wrapping each run of consecutive bullets in a single `<ul>`. */
export function joinBlocks(blocks: readonly Block[]): string {
	let html = "";
	let inList = false;

	for (const block of blocks) {
		const bullet = block.kind === "bullet";
		if (bullet && !inList) html += "<ul>";
		if (!bullet && inList) html += "</ul>";
		inList = bullet;
		html += block.html;
	}

	return inList ? `${html}</ul>` : html;
}

/**
 * Splits a description into Blocks: each top-level paragraph and heading, and each item of a top-level list
 * (ordered lists too, which rejoin as bullets). Any other top-level element stays one opaque Block, unchanged;
 * loose top-level text and inline marks become a paragraph.
 */
export function splitHtml(html: string): Block[] {
	const blocks: Block[] = [];
	let loose = "";

	const flushLoose = () => {
		if (loose.trim()) blocks.push({ kind: "paragraph", html: `<p>${loose.trim()}</p>` });
		loose = "";
	};

	for (const node of contentNodes(html)) {
		if (isInline(node)) {
			loose += node.toString();
			continue;
		}

		flushLoose();
		const tag = tagOf(node);
		const kind = kindOfTag(tag);

		if (tag === "ul" || tag === "ol") {
			for (const item of node.childNodes) {
				if (tagOf(item) === "li") blocks.push({ kind: "bullet", html: item.toString() });
			}
		} else {
			blocks.push({ kind: kind ?? "opaque", html: node.toString() });
		}
	}

	flushLoose();
	return blocks;
}

/**
 * HTML for showing a Variant or Block in the composer's panes: a lone bullet gets its list, and scripts, embeds,
 * event handlers and `javascript:` links are dropped.
 */
export function previewHtml(html: string): string {
	const trimmed = html.trim();
	const root = parseHtml(/^<li[\s>]/i.test(trimmed) ? `<ul>${trimmed}</ul>` : trimmed, { comment: false });
	for (const element of root.querySelectorAll(UNSAFE_TAGS)) element.remove();
	for (const element of root.querySelectorAll("*")) {
		for (const name of Object.keys(element.attributes)) {
			const value = element.getAttribute(name) ?? "";
			if (/^on/i.test(name) || /^\s*(javascript|data|vbscript):/i.test(value)) element.removeAttribute(name);
		}
	}
	return root.toString();
}

export type SourceResult = { snippets: Snippet[]; error: null } | { snippets: []; error: SourceError };

/** Reads a Source without throwing, so a broken file shows an error instead of breaking the editor. */
export function readSource(text: string): SourceResult {
	try {
		return { snippets: parseSource(text), error: null };
	} catch (error) {
		if (error instanceof SourceError) return { snippets: [], error };
		throw error;
	}
}
