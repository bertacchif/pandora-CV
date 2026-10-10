import type { Block, SourceError } from "./model";
import type { DragEndEvent } from "@dnd-kit/core";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { generateId } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";
import { addBlock, joinBlocks, moveBlock, previewHtml, removeBlock, splitHtml } from "./model";
import { source } from "./source";
import { useConfirm } from "@/hooks/use-confirm";

const FULL_SCREEN_ON_PHONES =
	"max-sm:inset-s-0 max-sm:top-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none";

export type ComposeButtonProps = {
	/** What is being composed, e.g. "Description of role 2". */
	label: string;
	/** The description's current HTML; it opens as Blocks. */
	value: string;
	/** Receives the joined Blocks, replacing the description. */
	onSave: (html: string) => void;
};

/** Opens the composer for a description: Blocks on the left, the Source on the right. */
export function ComposeButton({ label, value, onSave }: ComposeButtonProps) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
				<Icon name="list-checks" />
				<Trans>Compose</Trans>
			</Button>
			{open && <ComposeDialog label={label} value={value} onSave={onSave} onClose={() => setOpen(false)} />}
		</>
	);
}

type ComposeDialogProps = ComposeButtonProps & { onClose: () => void };

/** Each Block keeps a stable id so dragging duplicates moves the right one. */
type Item = { id: string; block: Block };

const toItems = (blocks: readonly Block[]): Item[] => blocks.map((block) => ({ id: generateId(), block }));

const sameBlocks = (a: readonly Block[], b: readonly Block[]) =>
	a.length === b.length && a.every((block, index) => block.kind === b[index]?.kind && block.html === b[index]?.html);

function ComposeDialog({ label, value, onSave, onClose }: ComposeDialogProps) {
	const confirm = useConfirm();
	const [initial] = useState(() => splitHtml(value));
	const [items, setItems] = useState<readonly Item[]>(() => toItems(initial));
	const confirming = useRef(false);
	const sensors = useSensors(
		// A small distance keeps clicks on the handle from starting a drag.
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);

	const blocks = items.map((item) => item.block);

	const add = (snippetIndex: number, variantIndex: number) => {
		const snippet = source.snippets[snippetIndex];
		if (!snippet) return;
		setItems((current) => {
			const [added] = addBlock([], snippet, variantIndex);
			return added ? [...current, { id: generateId(), block: added }] : current;
		});
	};

	const remove = (index: number) => setItems((current) => removeBlock(current, index));

	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (!over) return;
		const from = items.findIndex((item) => item.id === active.id);
		const to = items.findIndex((item) => item.id === over.id);
		setItems((current) => moveBlock(current, from, to));
	};

	// Cancel, Esc and clicking outside never lose arranging work without asking.
	const requestClose = async () => {
		if (confirming.current) return;
		if (sameBlocks(blocks, initial)) return onClose();

		confirming.current = true;
		const discard = await confirm(t`Discard your changes?`, {
			description: t`The Blocks you arranged won't be saved.`,
			confirmText: t`Discard`,
			cancelText: t`Keep composing`,
		});
		confirming.current = false;
		if (discard) onClose();
	};

	const save = () => {
		onSave(joinBlocks(blocks));
		onClose();
	};

	return (
		<Dialog open onOpenChange={(next) => !next && void requestClose()}>
			<DialogContent
				closeLabel={t`Close`}
				className={cn(
					"flex h-[min(820px,calc(100svh-2rem))] max-h-none flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1120px,calc(100%-2rem))]",
					FULL_SCREEN_ON_PHONES,
				)}
			>
				<div className="grid gap-0.5 ps-6 pe-14 pt-5 pb-4">
					<DialogTitle>
						<Trans>Compose</Trans>
					</DialogTitle>
					<DialogDescription className="text-[13px] leading-[18px]">{label}</DialogDescription>
				</div>

				<div className="grid min-h-0 flex-1 gap-4 overflow-y-auto border-y border-line px-6 py-4 md:grid-cols-2 md:overflow-hidden">
					<section aria-labelledby="compose-blocks" className="flex min-h-0 flex-col gap-2">
						<h3 id="compose-blocks" className="text-[13px] font-medium text-ink-2">
							<Trans>Blocks</Trans>
						</h3>
						<div className="min-h-0 flex-1 md:overflow-y-auto">
							{blocks.length === 0 ? (
								<p className="rounded-lg border border-dashed border-line-2 p-4 text-sm text-ink-3">
									<Trans>Click a Snippet in the Source to add it here.</Trans>
								</p>
							) : (
								<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
									<SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
										<ol className="grid gap-1.5">
											{items.map(({ id, block }, index) => (
												<BlockRow key={id} id={id} block={block} index={index} onRemove={() => remove(index)} />
											))}
										</ol>
									</SortableContext>
								</DndContext>
							)}
						</div>
					</section>

					<section aria-labelledby="compose-source" className="flex min-h-0 flex-col gap-2">
						<h3 id="compose-source" className="text-[13px] font-medium text-ink-2">
							<Trans>Source</Trans>
						</h3>
						<div className="min-h-0 flex-1 md:overflow-y-auto">
							{source.error ? <SourceErrorMessage error={source.error} /> : <SourcePane onAdd={add} />}
						</div>
					</section>
				</div>

				<div className="flex flex-col-reverse gap-2 px-6 py-4 sm:flex-row sm:justify-end">
					<Button variant="secondary" onClick={() => void requestClose()}>
						<Trans>Cancel</Trans>
					</Button>
					<Button onClick={save}>
						<Trans>Save</Trans>
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

type BlockRowProps = { id: string; block: Block; index: number; onRemove: () => void };

/** One Block: drag by its handle, remove with × or a right-click. */
function BlockRow({ id, block, index, onRemove }: BlockRowProps) {
	const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({ id });

	return (
		<li
			ref={setNodeRef}
			style={{ transform: CSS.Translate.toString(transform), transition }}
			onContextMenu={(event) => {
				event.preventDefault();
				onRemove();
			}}
			className={cn(
				"flex list-none items-start gap-1 rounded-lg border border-line bg-raised py-1 pe-1",
				isDragging && "relative z-10 shadow-e2",
			)}
		>
			<button
				type="button"
				aria-label={t`Reorder Block ${index + 1}`}
				className="flex h-8 w-7 shrink-0 cursor-grab touch-none items-center justify-center text-ink-3 active:cursor-grabbing"
				{...attributes}
				{...listeners}
			>
				<Icon name="dots-six-vertical" size={18} />
			</button>
			<div
				className="wysiwyg min-w-0 flex-1 py-1 *:my-0!"
				// The Source is bundled by the author and the description is their own; previewHtml drops scripts anyway.
				// oxlint-disable-next-line react/no-danger -- Blocks preview their HTML as it will print.
				dangerouslySetInnerHTML={{ __html: previewHtml(block.html) }}
			/>
			<IconButton icon="x" label={t`Remove Block ${index + 1}`} size="icon-xs" onClick={onRemove} />
		</li>
	);
}

type SourcePaneProps = { onAdd: (snippetIndex: number, variantIndex: number) => void };

/** Every Snippet in Source order; a Snippet with several Variants lists them indented under a count. */
function SourcePane({ onAdd }: SourcePaneProps) {
	if (source.snippets.length === 0) {
		return (
			<p className="text-sm text-ink-3">
				<Trans>The Source is empty.</Trans>
			</p>
		);
	}

	return (
		<ul className="grid gap-1">
			{source.snippets.map((snippet, snippetIndex) => {
				const [only] = snippet.variants;
				if (snippet.variants.length === 1 && only !== undefined) {
					return <VariantButton key={snippetIndex} html={only} onClick={() => onAdd(snippetIndex, 0)} />;
				}

				return (
					<li key={snippetIndex} className="grid gap-1">
						<span className="px-2 pt-1 text-xs text-ink-3">
							<Plural value={snippet.variants.length} one="# Variant" other="# Variants" />
						</span>
						<ul className="ms-3 grid gap-1 border-s border-line ps-2">
							{snippet.variants.map((variant, variantIndex) => (
								<VariantButton key={variantIndex} html={variant} onClick={() => onAdd(snippetIndex, variantIndex)} />
							))}
						</ul>
					</li>
				);
			})}
		</ul>
	);
}

type VariantButtonProps = { html: string; onClick: () => void };

function VariantButton({ html, onClick }: VariantButtonProps) {
	return (
		<li className="list-none">
			<button
				type="button"
				onClick={onClick}
				className="block w-full cursor-pointer rounded-md px-2 py-1 text-start transition-colors duration-quick hover:bg-hover"
			>
				<span
					className="wysiwyg block *:my-0!"
					// oxlint-disable-next-line react/no-danger -- Variants preview their HTML as it will print.
					dangerouslySetInnerHTML={{ __html: previewHtml(html) }}
				/>
			</button>
		</li>
	);
}

type SourceErrorMessageProps = { error: SourceError };

/** Says which Snippet broke the Source, so the file can be fixed without the editor crashing. */
function SourceErrorMessage({ error }: SourceErrorMessageProps) {
	const position = error.position ?? 0;
	const message = {
		"invalid-yaml": t`The Source isn't valid YAML: ${error.message}`,
		"not-a-list": t`The Source must be a list of Snippets.`,
		"empty-variants": t`Snippet ${position}: "variants" needs at least one Variant.`,
		"non-string-variant": t`Snippet ${position}: every Variant must be an HTML string.`,
		"unknown-shape": t`Snippet ${position} must be an HTML string, or an object with a single "variants" list.`,
	}[error.reason];

	return (
		<div role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft p-3 text-sm text-danger-text">
			<Icon name="warning-circle" className="mt-0.5 shrink-0" />
			<p>{message}</p>
		</div>
	);
}
