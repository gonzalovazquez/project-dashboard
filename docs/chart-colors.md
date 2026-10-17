# Chart colors

Chart colors come from the documented palette of the data-viz method and were checked with its validator
(`validate_palette.js`) against the actual card surfaces: `#ffffff` in light, `#2a2a2d` in dark. The interface chrome
(pills, tiles, sidebar) keeps the macOS system colors, which are labeled text and not chart marks.

| Use | Light | Dark | Result |
|---|---|---|---|
| Project series 1, 2, 3 (the focus slots) | `#2a78d6` `#eb6834` `#1baf7a` | `#3987e5` `#d95926` `#199e70` | Passes lightness, chroma, CVD separation and the normal-vision floor on adjacent pairs and on all pairs. Light aqua is 2.82:1 on white, below 3:1, so the table view and tooltips are the required relief |
| Everything else | `#898781` | `#898781` | The documented muted neutral. De-emphasis, not an identity color |
| Stage ramp, Not started to Shipped | `#86b6ef` `#5598e7` `#2a78d6` `#1c5cab` | `#1c5cab` `#2a78d6` `#5598e7` `#86b6ef` | Passes as an ordinal ramp: monotone lightness, one hue, light end 2.11:1 light and 2.16:1 dark. Stages are ordered, so one hue stepped by lightness is correct |
| Past review point | `#ec835a` | `#ec835a` | The documented "serious" status color. Always paired with the words "over" or "past review point" |

Rules every chart follows: a legend for two or more series, direct labels where there is room, a "View as table" for
every chart, tooltips on hover and on keyboard focus with hit areas of at least 24px, bars at most 24px thick with a
rounded data end, 2px gaps between stacked segments, and text in text colors, never in the data color.

## Where stage history comes from

Notion records no status history, and a page only knows when it entered its *current* stage, so past stages cannot be
reconstructed. The app therefore writes one record per day after each scan, `{date, projects per stage}`, to
`stage-history.json` in its data folder (400 days at most). The "Projects by stage" chart draws only those records and
says so while history is short. Nothing is invented.
