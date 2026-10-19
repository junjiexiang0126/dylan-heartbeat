# iPhone PWA local safe-area repair

Base: `494c5cd12418ae7e9bd6711dbaa530719cf7d37e`.
Branch: `fix/iphone-work-image-safe-area`. Do not merge/deploy before owner acceptance.

## Findings

- `index.html` uses `viewport-fit=cover` and `black-translucent` status bar.
- `work.css` hides `.topbar` in Work; the shared topbar otherwise supplies top safe-area padding. Work starts at the top of the shell without its own inset. Its height already subtracts `safe-area-inset-top`, but a height subtraction does not position its header below the status bar.
- `chat-extra.js` opens `#chatImageViewer` for images in both private chat and Work. This is the viewer with the screenshot's “保存原图” control, not `#momentImageViewer` or `#fileViewer`.
- Its original `chat.css` rule uses `100dvh - 32px` height and 12px padding without safe-area offsets. The fixed 100px deduction for the image canvas also does not accommodate toolbar wrapping.
- Stylesheet order and all top-level public CSS were inspected; subsequent shared styles are retained untouched. The new viewer stylesheet loads last and every selector is scoped to `#chatImageViewer`.

## Patch scope

- `ziwei_web/public/work.css`: Work panel top margin equals the inset already subtracted from its height; prevent the Work heading from shrinking.
- `ziwei_web/public/chat-image-viewer.css`: inset the actual viewer within all four safe edges, subtract vertical safe edges from its height, use a flexible image canvas below the non-shrinking toolbar. Preserve existing colors, glass, padding and typography.
- `ziwei_web/public/index.html`: add one stylesheet link only.
- `ziwei_web/scripts/check_pwa_safe_area.cjs`: offline WebKit regression script, no production requests.
- No backend, memory, database, root container, shared CSS or navigation changes.

## Validation completed

WebKit 26.5 / Playwright webkit build 2336. Actual project HTML/CSS and actual Work / image-viewer event handlers; mocked API responses and save/share sink. All network requests blocked. CSS env values replaced in the test fixture only to model device safe areas.

| Fixture | Viewport | Safe top / bottom / left / right |
| --- | --- | --- |
| Portrait | 390 × 844 | 59 / 34 / 0 / 0 |
| Narrow | 320 × 740 | 44 / 34 / 0 / 0 |
| Landscape | 844 × 390 | 0 / 21 / 59 / 59 |
| Desktop | 1280 × 900 | 0 / 0 / 0 / 0 |

All four passed: Work header button hit testing, avatar mention, search toggle, tool center open/close, composer clearance above navigation; chat and Work image viewer close/save/previous/next/zoom and nonzero image viewport. Save test verifies handler dispatch, not a real OS download/share.

40 unchanged-page comparisons passed: 4 viewports × 2 themes × 5 pages (chat, moments, home, memory, logs). Compared visible element rectangles and selected computed typography, color, background, border, spacing, glass and opacity values against base. Motion disabled to remove transition timing differences. This is fixture layout/style comparison, not pixel screenshots with production data or downloaded font/image assets.

Negative control: the unpatched base fails the Work header safe-top check: avatar button top 14.296875px, below required 59px boundary. Node syntax check passed.

Reproduce from `ziwei_web` with Playwright and WebKit installed:

```sh
node scripts/check_pwa_safe_area.cjs /path/to/base/ziwei_web/public
```

The optional baseline directory must contain the base HTML and top-level public CSS. Without it, the four interaction scenarios run, while cross-version page comparisons are omitted.

At review time main was `75cd25fa8dbb2c8ba141cf62e60066949c09330e`; changes since base were confined to `ziwei_web/attachments.js`, unrelated to this patch. No rebase or merge performed.

## Required owner acceptance on real iPhone

No physical iPhone or installed standalone PWA was available. Automated success does not establish an iPhone PWA fix. No merge or deployment was performed; the existing live site still does not contain this patch.

On an explicitly authorized preview or later approved installation:

1. Launch from the home-screen PWA icon. Check Work title, both avatars, search and tools below the status bar; tap each, open/close the tool center, scroll long history.
2. Open the keyboard, type, dismiss it, switch tabs and return; confirm header, composer and bottom navigation remain reachable. Check portrait/landscape and cold relaunch.
3. Open images from both private chat and Work. Tap close, previous/next, zoom and 保存原图; confirm the actual iOS save/share flow. Include long filenames and toolbar wrapping.
4. Check the other five pages against the accepted design: wallpaper, Source Han/Noto Serif, glass, bubbles and navigation unchanged. Compare Safari browser mode too.
