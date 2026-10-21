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

The layout stays left aligned, with a
queue beside the selected request and its history on wider screens. On narrow
screens, navigation leads into one focused request view.

The interface completion keeps the existing item list and chronological history.
Search and status filters belong beside the queue, rather than in a separate
navigation area. Queue rows include a short return identifier because several
partial returns can share one order. Gold marks an unknown refund, with a finance
status-check action and a customer explanation that the reservation remains held.

Desktop and 390-pixel screenshots show that the amount, selected item, and next
action remain readable. Narrow selection hides the queue and exposes a back
button. The large focus outline on the request heading is deliberate: keyboard
navigation must announce the destination after selecting a request or completing
a decision. Inline confirmation moves focus to its confirm button, and cancel
returns focus to the heading. Persona changes retain keyboard focus while the
server updates the session. A real browser journey found that native disabling
of the persona selector lost focus; it now uses an announced busy/disabled state
and blocks additional changes until completion.

An expired order leaves its item quantities and request action visibly disabled
and explains the deadline. An API outage provides a retry action. In-flight
request checks hold a real database row lock, so the disabled controls are
observed against the actual service rather than a mocked response.
