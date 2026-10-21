# Interface direction

The subject is a fictional clothing merchant, Northline Supply. Operators need
to understand the next permitted action, the selected garments, and whether money
has actually moved. The customer sees the same decision history in simpler form.

Use cloud `#f3f6f8`, paper `#ffffff`, ink `#253b4b`, navy `#243f58`, muted gold
`#bc9345`, and green `#28674a`. Gold marks an unresolved financial outcome; green
requires confirmed success. Color never carries state without a text label.

Use the system humanist sans family for readable dense operations, with clear
size/weight differences rather than decorative labels. Keep monetary figures
aligned and use tabular numerals. A garment/item ledger and its chronological
decision history provide the distinctive structure. Avoid a grid of KPI cards
or a marketing hero in the operational workspace.

The initial shell only confirms environment readiness. PRs 2-6 add working views;
PR 7 critiques real screenshots and finishes responsive layouts, keyboard access,
and actionable error/uncertainty states. The layout stays left aligned, with a
queue beside the selected request and its history on wider screens. On narrow
screens, navigation leads into one focused request view.
