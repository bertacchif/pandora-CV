# Reactive Resume

A resume builder. This glossary covers terms whose meaning here is narrower than everyday use.

## Language

### Compose

Building a description field (experience, role, project, volunteer) from reusable content instead of typing it.

**Source**:
The YAML file of reusable content bundled with the app: an ordered list of Snippets. The author's real Source is the gitignored `source.local.yaml`; the committed `source.example.yaml` holds fictional content and loads when no local file exists.
_Avoid_: master list, library, template

**Snippet**:
One element of the Source, offering one or more Variants. Identified by its position in the Source.
_Avoid_: item, entry, template

**Variant**:
One alternative HTML block of a Snippet: a heading (`<h1>`–`<h6>`), a paragraph (`<p>`) or a bullet (`<li>`). Text with no block tag is a paragraph.
_Avoid_: option, version, wording

**Block**:
One element of the composition being built: a frozen copy of the Variant that was clicked, or a piece split from the description's existing HTML. Later Source edits don't change it. Saving joins Blocks into the description, wrapping each run of bullets in one list.
_Avoid_: entry (that is a resume item such as a job or a project), line, row

### Elsewhere

**Entry**:
One item of a resume section: a job, a school, a project.

**Template**:
A PDF layout. Not used for reusable content.
