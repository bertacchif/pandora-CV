import type { Block } from "./model";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	addBlock,
	joinBlocks,
	moveBlock,
	parseSource,
	previewHtml,
	readSource,
	removeBlock,
	SourceError,
	splitHtml,
} from "./model";

const bullet = (text: string): Block => ({ kind: "bullet", html: `<li>${text}</li>` });
const paragraph = (text: string): Block => ({ kind: "paragraph", html: `<p>${text}</p>` });
const heading = (text: string, level = 3): Block => ({ kind: "heading", html: `<h${level}>${text}</h${level}>` });

const sourceError = (text: string) => {
	try {
		parseSource(text);
	} catch (error) {
		if (error instanceof SourceError) return error;
		throw error;
	}
	throw new Error("expected a SourceError");
};

describe("parseSource", () => {
	it("makes an HTML string a Snippet with one Variant", () => {
		expect(parseSource(`- "<li>Built an app</li>"`)).toEqual([{ variants: ["<li>Built an app</li>"] }]);
	});

	it("keeps Source order", () => {
		const source = `
- "<h3>Work</h3>"
- "<p>Intro</p>"
- "<li>Shipped</li>"
`;
		expect(parseSource(source)).toEqual([
			{ variants: ["<h3>Work</h3>"] },
			{ variants: ["<p>Intro</p>"] },
			{ variants: ["<li>Shipped</li>"] },
		]);
	});

	it("reads an empty Source as no Snippets", () => {
		expect(parseSource("")).toEqual([]);
		expect(parseSource("# only a comment\n")).toEqual([]);
		expect(parseSource("[]")).toEqual([]);
	});

	it("makes a variants list a Snippet with those Variants, in order", () => {
		const source = `
- "<li>First</li>"
- variants:
    - "<li>Android <strong>Java</strong></li>"
    - "<li>Android <strong>Kotlin</strong></li>"
    - "<li>Android</li>"
`;
		expect(parseSource(source)).toEqual([
			{ variants: ["<li>First</li>"] },
			{
				variants: [
					"<li>Android <strong>Java</strong></li>",
					"<li>Android <strong>Kotlin</strong></li>",
					"<li>Android</li>",
				],
			},
		]);
	});

	it("rejects a Source that is not a list", () => {
		expect(sourceError("variants: [a]")).toMatchObject({ reason: "not-a-list", position: null });
	});

	it("rejects YAML it cannot read", () => {
		expect(sourceError("- [unclosed")).toMatchObject({ reason: "invalid-yaml", position: null });
	});

	it.each([
		["an empty variants list", `- "<p>ok</p>"\n- variants: []`, "empty-variants"],
		["a non-string Variant", `- "<p>ok</p>"\n- variants: ["<p>a</p>", 3]`, "non-string-variant"],
		["an unknown key", `- "<p>ok</p>"\n- wordings: ["<p>a</p>"]`, "unknown-shape"],
		["an extra key beside variants", `- "<p>ok</p>"\n- variants: ["<p>a</p>"]\n  h2: x`, "unknown-shape"],
		["a number", `- "<p>ok</p>"\n- 42`, "unknown-shape"],
		["a nested list", `- "<p>ok</p>"\n- ["<p>a</p>"]`, "unknown-shape"],
	])("names the position of %s", (_, source, reason) => {
		expect(sourceError(source)).toMatchObject({ reason, position: 2 });
	});
});

describe("addBlock", () => {
	const snippet = { variants: ["<li>Android <strong>Java</strong></li>", "<li>Android <strong>Kotlin</strong></li>"] };

	it("appends the clicked Variant at the end", () => {
		const blocks = [paragraph("Intro")];
		expect(addBlock(blocks, snippet, 0)).toEqual([paragraph("Intro"), bullet("Android <strong>Java</strong>")]);
	});

	it("freezes a non-first Variant", () => {
		expect(addBlock([], snippet, 1)).toEqual([bullet("Android <strong>Kotlin</strong>")]);
	});

	it("allows duplicates", () => {
		expect(addBlock(addBlock([], snippet, 0), snippet, 0)).toEqual([
			bullet("Android <strong>Java</strong>"),
			bullet("Android <strong>Java</strong>"),
		]);
	});

	it("derives the Block kind from the outer tag", () => {
		const add = (html: string) => addBlock([], { variants: [html] }, 0);
		expect(add("<h2>Experience</h2>")).toEqual([heading("Experience", 2)]);
		expect(add("<p>Text</p>")).toEqual([paragraph("Text")]);
		expect(add("<table><tr><td>x</td></tr></table>")).toEqual([
			{ kind: "opaque", html: "<table><tr><td>x</td></tr></table>" },
		]);
	});

	it("wraps a Variant with no block tag as a paragraph", () => {
		expect(addBlock([], { variants: ["Quick <em>note</em>"] }, 0)).toEqual([paragraph("Quick <em>note</em>")]);
	});

	it("ignores a Variant index outside the Snippet", () => {
		const blocks = [paragraph("Intro")];
		expect(addBlock(blocks, snippet, 2)).toBe(blocks);
	});

	it("does not mutate its input", () => {
		const blocks = Object.freeze([paragraph("Intro")]);
		expect(() => addBlock(blocks, snippet, 0)).not.toThrow();
		expect(blocks).toEqual([paragraph("Intro")]);
	});
});

describe("removeBlock", () => {
	it("removes only the Block at the given position among duplicates", () => {
		const blocks = [bullet("A"), bullet("B"), bullet("A")];
		expect(removeBlock(blocks, 2)).toEqual([bullet("A"), bullet("B")]);
		expect(removeBlock(blocks, 0)).toEqual([bullet("B"), bullet("A")]);
	});

	it("does not mutate its input", () => {
		const blocks = Object.freeze([bullet("A"), bullet("B")]);
		expect(removeBlock(blocks, 0)).toEqual([bullet("B")]);
		expect(blocks).toEqual([bullet("A"), bullet("B")]);
	});
});

describe("moveBlock", () => {
	const blocks = Object.freeze([bullet("A"), bullet("B"), bullet("C"), bullet("D")]);

	it("moves a Block down", () => {
		expect(moveBlock(blocks, 0, 2)).toEqual([bullet("B"), bullet("C"), bullet("A"), bullet("D")]);
	});

	it("moves a Block up", () => {
		expect(moveBlock(blocks, 3, 1)).toEqual([bullet("A"), bullet("D"), bullet("B"), bullet("C")]);
	});

	it("moves a Block to the very top and the very bottom", () => {
		expect(moveBlock(blocks, 2, 0)).toEqual([bullet("C"), bullet("A"), bullet("B"), bullet("D")]);
		expect(moveBlock(blocks, 1, 3)).toEqual([bullet("A"), bullet("C"), bullet("D"), bullet("B")]);
	});

	it("changes nothing when dropped on its own position", () => {
		expect(moveBlock(blocks, 1, 1)).toBe(blocks);
	});

	it("changes nothing for positions outside the list", () => {
		expect(moveBlock(blocks, -1, 0)).toBe(blocks);
		expect(moveBlock(blocks, 0, 4)).toBe(blocks);
		expect(moveBlock(blocks, 4, 0)).toBe(blocks);
	});
});

describe("joinBlocks", () => {
	it("wraps consecutive bullets in one list", () => {
		expect(joinBlocks([bullet("A"), bullet("B")])).toBe("<ul><li>A</li><li>B</li></ul>");
	});

	it("splits the list around headings and paragraphs", () => {
		expect(joinBlocks([bullet("A"), heading("Work"), bullet("B"), paragraph("Note"), bullet("C")])).toBe(
			"<ul><li>A</li></ul><h3>Work</h3><ul><li>B</li></ul><p>Note</p><ul><li>C</li></ul>",
		);
	});

	it("emits non-bullet Blocks as they are", () => {
		const table = { kind: "opaque", html: "<table><tr><td>x</td></tr></table>" } as const;
		expect(joinBlocks([heading("Work"), paragraph("Intro"), table])).toBe(
			"<h3>Work</h3><p>Intro</p><table><tr><td>x</td></tr></table>",
		);
	});

	it("wraps untagged text as a paragraph", () => {
		const added = addBlock([], { variants: ["plain text"] }, 0);
		expect(joinBlocks(added)).toBe("<p>plain text</p>");
	});

	it("joins no Blocks into an empty description", () => {
		expect(joinBlocks([])).toBe("");
	});
});

describe("splitHtml", () => {
	it("opens an empty description as no Blocks", () => {
		expect(splitHtml("")).toEqual([]);
		expect(splitHtml("  \n ")).toEqual([]);
	});

	it.each([1, 2, 3, 4, 5, 6])("makes an h%i one heading Block", (level) => {
		expect(splitHtml(`<h${level}>Title</h${level}>`)).toEqual([heading("Title", level)]);
	});

	it("makes a paragraph one Block", () => {
		expect(splitHtml("<p>Text</p>")).toEqual([paragraph("Text")]);
	});

	it("makes each item of a list its own bullet Block", () => {
		expect(splitHtml("<ul><li>A</li><li>B</li><li>C</li></ul>")).toEqual([bullet("A"), bullet("B"), bullet("C")]);
	});

	it("makes ordered-list items bullet Blocks, rejoined as an unordered list", () => {
		const blocks = splitHtml("<ol><li>A</li><li>B</li></ol>");
		expect(blocks).toEqual([bullet("A"), bullet("B")]);
		expect(joinBlocks(blocks)).toBe("<ul><li>A</li><li>B</li></ul>");
	});

	it("keeps inline marks inside a Block", () => {
		expect(
			splitHtml(
				'<ul><li><p>Led <strong>five</strong> <em>engineers</em> at <a href="https://x.dev">X</a></p></li></ul>',
			),
		).toEqual([
			{
				kind: "bullet",
				html: '<li><p>Led <strong>five</strong> <em>engineers</em> at <a href="https://x.dev">X</a></p></li>',
			},
		]);
	});

	it("keeps a table as one opaque Block that survives saving unchanged", () => {
		const table = '<table><tbody><tr><td colspan="2">x</td></tr></tbody></table>';
		const blocks = splitHtml(table);
		expect(blocks).toEqual([{ kind: "opaque", html: table }]);
		expect(joinBlocks(blocks)).toBe(table);
	});

	it("keeps mixed content in order", () => {
		const html = "<h3>Work</h3><p>Intro</p><ul><li>A</li><li>B</li></ul><blockquote>Q</blockquote><p>End</p>";
		expect(splitHtml(html)).toEqual([
			heading("Work"),
			paragraph("Intro"),
			bullet("A"),
			bullet("B"),
			{ kind: "opaque", html: "<blockquote>Q</blockquote>" },
			paragraph("End"),
		]);
	});

	it("wraps top-level text as a paragraph", () => {
		expect(splitHtml("Plain <strong>text</strong>")).toEqual([paragraph("Plain <strong>text</strong>")]);
	});
});

describe("round trip", () => {
	it("opens what was saved as the same Blocks", () => {
		const blocks = [heading("Work"), bullet("A"), bullet("B <em>b</em>"), paragraph("Note"), bullet("C")];
		expect(splitHtml(joinBlocks(blocks))).toEqual(blocks);
	});

	it("saves the same description after one pass", () => {
		const html = "<p>Intro</p><ol><li>A</li></ol><ul><li>B</li></ul><table><tr><td>x</td></tr></table>Tail";
		const once = joinBlocks(splitHtml(html));
		expect(joinBlocks(splitHtml(once))).toBe(once);
	});
});

describe("previewHtml", () => {
	it("drops scripts, event handlers and javascript: links but keeps formatting", () => {
		expect(
			previewHtml(
				'<p onclick="x()">Hi <strong>there</strong><script>alert(1)</script> <a href="javascript:x()">a</a></p>',
			),
		).toBe("<p>Hi <strong>there</strong> <a>a</a></p>");
	});

	it("puts a lone bullet in a list", () => {
		expect(previewHtml("<li>A</li>")).toBe("<ul><li>A</li></ul>");
	});
});

describe("readSource", () => {
	it("returns the error instead of throwing", () => {
		expect(readSource("- 42")).toMatchObject({ snippets: [], error: { reason: "unknown-shape", position: 1 } });
	});

	it("reads the committed example Source without errors", () => {
		const example = readFileSync(new URL("./source.example.yaml", import.meta.url), "utf8");
		const { snippets, error } = readSource(example);
		expect(error).toBeNull();
		expect(snippets.some((snippet) => snippet.variants.length > 1)).toBe(true);
	});
});
