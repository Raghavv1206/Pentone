# Pentone additive browser upgrade

The existing interface, local model, tool entry points and legacy handlers are retained. The upgrade adds browser tools through the existing `spec` and default-handler convention; small integration changes register them, preserve command scope, propagate cancellation and enforce local speech.

## Using the upgrade

- Rebuild and reload the unpacked production extension. Additional tools appear in the existing Tools screen and are discoverable by the local model through `getBrowserTools`.
- In Settings, enable optional access to bookmarks, downloads, browsing history, recently closed tabs or tab groups as needed. Ordinary tab and page tools need no new permission prompt.
- Use a supported Chrome installation with its on-device AI model. On first microphone use, Pentone checks local speech support and automatically installs a supported language pack when needed. It reuses an installed English dialect before downloading another English pack. Setup shows progress and can be cancelled; cancelling prevents later microphone startup even if Chrome finishes the download. If Chrome needs another click, use the **Set up microphone** action. Settings also offers **Set up local speech**. Speech synthesis uses local voices only; install a system voice if none is available.
- Model downloads and wake-word license activation can use the network. Page navigation and downloads still access websites. No cloud AI inference or online speech fallback is introduced.

## Correct tab scope

With `Mail · Docs · YouTube · GitHub`, “close all tabs to the left of YouTube” leaves `YouTube · GitHub`. Text and voice shortcuts consume qualifiers before legacy matching. An execution-time check also rejects a broader model-generated `closeTab({all:true})` call.

Relative and exception tools resolve a unique reference in one window, recheck the tab order, and close only captured IDs. Missing or duplicate references produce an error with candidate IDs before anything closes. The reference and other windows are preserved. Duplicate cleanup compares complete URLs and preferentially preserves an active or pinned copy.

## Implementation and safety boundaries

- **Zod** validates strict argument schemas; unexpected fields, unsafe URL schemes, embedded URL credentials, oversized inputs and excessive nesting are rejected. The runtime tool-discovery schemas come from the same definitions used to validate execution.
- **Native Chrome APIs** handle tabs, windows, bookmarks, downloads, sessions and history. Multi-step operations report partial progress when they fail.
- **dom-accessibility-api** supplies roles, accessible names and hidden-state checks. The locally bundled page agent runs in the isolated world, supports permitted frames and open shadow roots, and binds operations to a document ID. It never evaluates model- or page-supplied code.
- **Papa Parse** exports tables with quoting and spreadsheet-formula escaping. Results carry source URLs and have bounded output. Page content is treated as untrusted evidence in the model instructions.
- The Stop control aborts active waits and saved workflows. A stopped run cannot perform a later waiting-tool click. Already dispatched browser actions cannot be undone by cancellation.
- Bookmark deletion and exact-URL history deletion require a short-lived, single-use confirmation bound to the parameters, current targets and task. Named consequential page controls use the same review step. Confirmation is supplied by the extension UI, not a model-provided boolean. This is a defense in depth measure, not a general classifier for every website's business actions.
- Form tools use native setters and text-only editable content, preserve explicit field targets, and never submit automatically. Passwords and file inputs require direct interaction or the existing authorized profile/resume flow.
- Saved workflows use an allowlist, at most 20 steps, whole-value parameters and fresh runtime IDs. They cannot recursively invoke workflows or hide arbitrary script execution. Workspaces store URLs, order, pins and available groups locally; private windows are excluded.

## Supported limits

The tool catalog is in [browser-tool-catalog.md](browser-tool-catalog.md). Research and accessible-reading playbooks reuse the existing on-device AI for comparison, explanation, simplification and translation.

This does not give an extension unrestricted access to every Chrome surface or website. Chrome-internal pages, native permission/file dialogs, closed shadow roots, denied frame access, CAPTCHAs and actions requiring trusted physical input can require the user. Synthetic hover events do not move the real pointer. Custom calendars, sliders and player menus can be operated through inspected controls; native date/range/quality tools do not guess unsupported widgets.

Skip tools click a real enabled control and verify that it disappears; they do not bypass unskippable ads or claim playback advanced without evidence. Transcripts must already be exposed by loaded caption cues or a visible transcript panel. Cookie rejection never falls back to accepting.

Individual waits are limited to 60 seconds. Research opens at most ten explicit results and reads at most five pages, preserving origin, path and query filters while following an inspected pagination link. It stops at repeated or unsupported pagination; arbitrary “load more” widgets use ordinary inspect/click/read steps. Long-running unattended monitoring is not installed.

Workspaces do not preserve unsaved forms, authentication state or page memory. Chrome's history URL deletion removes every visit for that exact URL; it cannot delete an individual visit. Cancelling a download does not delete its local file.

## Development

Production builds run `scripts/build-page-agent.cjs` in post-build. Unit tests build the isolated agent via `pretest`. For the existing Plasmo development server, run `node scripts/build-page-agent.cjs --dev` after its initial build and after editing the page agent. Regenerate thin tool entry points and the catalog with `node scripts/generate-browser-tools.cjs` when adding tool definitions.

`tests/browser-upgrade.test.ts` covers actual text and voice command routing, generated tab layouts, DOM targeting, controls, extraction, permissions, cancellation, confirmation binding and local workflows. The real Edge suite loads the packaged extension in an isolated profile and tests the original closure scenario, page-agent execution and Stop behavior. See [production-readiness.md](production-readiness.md) for measured results and remaining release checks.
