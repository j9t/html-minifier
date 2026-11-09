# Changelog

As of version 5.0.0, all notable changes to HTML Minifier (HM) are documented in this file, which is (mostly) AI-generated and (always) human-edited. Dependency updates may or may not be called out specifically.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.0.3] - 2026-11-09

### Fixed

* Fixed `mergeScripts` joining scripts with only a newline after a last line holding `//` (as in a URL), which made the next script a call where it starts with `(` or `[` (e.g., `a="https://b"` before `(c)()`)
* Fixed `collapseWhitespace` removing spaces that render:
  - after an inline element holding only an image, SVG, or other replaced content (e.g., `<a><img></a> text`)
  - within `bdi`, `bdo`, `cite`, `code`, `dfn`, `label`, `q`, and `ruby` elements next to text (e.g., `a<code> b</code>`)
  - after self-closed `svg` and `math` elements, after a no-break space, around end tags that get dropped, and before removed comments next to text
* Fixed scripts holding `<!-- <script>…</script> -->`, which browsers end only at a later `</script>`: The real end tag was dropped, which made the rest of the document script text
* Fixed `removeEmptyElements` with `removeOptionalTags` mishandling what surrounds removed elements:
  - deleting the element before an empty `body` (e.g., a `script` or `title`)
  - leaving a tag omitted because of an element that then got removed (e.g., `<a><p>b</p><footer></footer></a>` lost `</p>`, and without a `body` start tag before a removed element, a following `script` moved to the `head`)
* Fixed `removeEmptyElements` removing empty `html`, `head`, and `body` elements with attributes, which browsers don’t recreate (e.g., `<body class="a"></body>`), and `frameset` elements, without which browsers render what follows
* Fixed `removeRedundantAttributes`, `removeDefaultTypeAttributes`, and `removeEmptyAttributes` removing attributes that a `style` element in the document selects on (e.g., `type` given `input[type=text]`)
* Fixed `removeRedundantAttributes` removing `name` from `a` elements with a different `id`, which broke links to the name
* Fixed `collapseWhitespace` removing a trailing newline from `textarea` elements, which is part of their value
* Fixed comments not ending at `--!>`, and `<!-->` and `<!--->` not being read as empty comments—with `removeComments`, content up to the next `-->` was deleted
* Fixed end tags browsers read differently from the parser, which moved or merged content:
  - `</tr>` and `</tbody>` closing rows and sections that only have implied start tags were dropped, merging table rows
  - `tr` and section start tags didn’t close an implied cell, which `removeEmptyElements` saw as emptying the row
  - End tags of table parts reached outside their own table
  - End tags of formatting elements closed block elements inside them (e.g., `<a><div></a>x</div>`), and weren’t ignored from within a table when the element is outside it
  - End tags of ordinary elements weren’t ignored with a block element open inside them (e.g., `<span><div></span>x</div>`)
* Fixed `removeOptionalTags` omitting the `body` start tag before `base`, `basefont`, `bgsound`, `noframes`, and `title` elements, which moved them to the `head`
* Fixed `continueOnParseError` turning tags with quotes in attribute names into text (e.g., `<img alt="a "b" c">`, with `decodeEntities`, became `&lt;img…`)
* Fixed CDATA sections directly in `svg` and `math` elements being read as comments, `svg` elements in `annotation-xml` being read as MathML, and `isindex` being read as a void element

### Added

* Added a development-only check that minified output means the same to browsers as its source: `npm test` compares parse5 trees and rendered whitespace across option combinations, generated markup, and html5lib’s parser tests, and `npm run test:equivalence` does so for the real-world corpus

### Changed

* Made CLI directory runs (`--input-dir`, `--zero`) skip and report a file that fails rather than stop at it; a run with failures ends by listing the files and exits with code `1`

## [5.0.2] - 2026-11-09

### Fixed

* Fixed `minifyCSS` and `minifyJS` deleting or breaking custom fragments that start a rule or statement, follow a `case` clause or label, or sit in an `@charset`, `@import`, or `@namespace` statement that would be dropped with them—CSS and JavaScript with such a fragment are now kept as written:
  - `<style>b { top: 0 }\n<?php echo 1; ?></style>` lost the PHP block
  - `<style>a { top: 0 }\n<?php echo 1; ?>\nb { top: 0 }</style>` had its rules merged across the fragment
  - `<script>b()\n<?php if (x): ?>\nc()\n<?php endif; ?>\nd()</script>` became a syntax error when the condition was false
  - `<style>@import <?= $u ?>;a{top:0}</style>` lost the at-rule and the fragment
  - `<script>switch (a) { case 1: <?= $x ?> }</script>` became `if(1===a) <?= $x ?>`, which is wrong if the fragment renders several statements
  - `<script>l: <?= $x ?>;</script>` lost the label
* Fixed `collapseBooleanAttributes` turning `hidden="until-found"` into `hidden`, which made the content unfindable
* Fixed `collapseBooleanAttributes` removing values that hold a custom fragment or `htmlmin:ignore` markup, which deleted template code (e.g., `checked="<?= $c ?>"`), and `hidden` and `draggable` values that hold a character reference, where only decoding shows the state
* Fixed `collapseBooleanAttributes` removing the loop count of `marquee` elements (`<marquee loop="3">` became `<marquee loop>`, which loops forever) and the values of attributes in SVG and MathML, where HTML’s Boolean attributes don’t apply (e.g., `<mfenced open="[">` lost its delimiter)
* Fixed `collapseWhitespace` removing spaces around and within SVG `tspan` and `textPath` elements, which joined words (e.g., `a <tspan>b</tspan>` became `a<tspan>b</tspan>`)
* Fixed `collapseWhitespace` collapsing whitespace within SVG `script` and `style` elements written in uppercase, which could break their code (e.g., a line comment in `<svg><SCRIPT>` swallowed the next line)
* Fixed `collapseBooleanAttributes` not collapsing `alpha`, `headingreset`, `nomodule`, `playsinline`, `shadowrootclonable`, `shadowrootcustomelementregistry`, `shadowrootdelegatesfocus`, and `shadowrootserializable`
* Fixed `collapseBooleanAttributes` removing the values of `defaultchecked`, `defaultmuted`, `defaultselected`, `enabled`, `indeterminate`, `pauseonexit`, and `visible`, none of which are HTML attributes (e.g., `<my-widget visible="false">` became `<my-widget visible>`)

### Changed

* Made `collapseBooleanAttributes` leave custom elements alone, as these define what their attributes mean (e.g., `<my-toggle checked="false">` keeps its value)
* Made the CLI show the help when run in a terminal without any arguments, rather than waiting for input

## [5.0.1] - 2026-11-03

### Fixed

* Fixed two regular expression denial-of-service (ReDoS) issues ([GHSA-9wmg-23wv-h297](https://github.com/j9t/html-minifier-next/security/advisories/GHSA-9wmg-23wv-h297)—thanks [@aweiaaaaa](https://github.com/aweiaaaaa)), each causing quadratic (O(n²)) backtracking on the `minify()` path, now replaced by linear-time scans:
  - A long `htmlmin:ignore` block without tags, with `collapseWhitespace` enabled
  - A long whitespace run inside an `ignoreCustomFragments` match, with default options

## [5.0.0] - 2026-11-03

### Fixed

* Fixed `decodeEntities` (and `minifyJS`, in event handler attributes) turning an escaped ampersand into one that starts a character reference, which changed the value browsers read (e.g., `title="&amp;copy b"` → `title="&copy b"`, read as “© b,” now kept; and in text, `&amp;#169` → `&#169`, now `&amp#169`)
* Fixed `decodeEntities` (and `minifyJS`, in event handler attributes) leaving character references without a semicolon in attributes undecoded where browsers decode them (e.g., `title="&copy b"`, now `title="© b"`)

### Changed

* **BREAKING:** Rebuilt HTML Minifier on [HTML Minifier Next](https://github.com/j9t/html-minifier-next) 9.1.1 (see [its changelog](https://github.com/j9t/html-minifier-next/blob/main/CHANGELOG.md) for many changes since HTML Minifier 4.0.0)
  - **Migration:** Follow [the HTML Minifier 4 to 5 upgrade guide](https://meiert.com/blog/html-minifier-4-5/)
* **BREAKING:** Made HTML Minifier ESM-only, requiring Node.js ≥22.13
* Added `hm` as a short CLI command next to `html-minifier`