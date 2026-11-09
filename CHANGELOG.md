# Changelog

As of version 5.0.0, all notable changes to HTML Minifier (HM) are documented in this file, which is (mostly) AI-generated and (always) human-edited. Dependency updates may or may not be called out specifically.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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