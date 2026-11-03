# Changelog

As of version 5.0.0, all notable changes to HTML Minifier (HM) are documented in this file, which is (mostly) AI-generated and (always) human-edited. Dependency updates may or may not be called out specifically.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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