# Captioned workflow walkthrough

The [video release](https://github.com/KleitonBarone/returns-and-refunds/releases/tag/portfolio-walkthrough-2026-10-21)
contains a locally recorded 91.04-second English-captioned demonstration. There is no spoken
narration. The recording drives the actual UI and real local services. Captions
are test-only annotations; financial results come from independent assertions.

The sequence introduces the fictional merchant, requests one tee from a three-unit
order, records support approval and warehouse receipt/inspection, and confirms
$35 in finance. The provider stores success and loses its response. Services
restart while data remains intact. A lookup recovers the original operation,
then three signed late processing-event copies preserve one ledger refund and
one success audit. Customer history shows the confirmed refund and two remaining
tees. The closing caption states the local simulation and demo-authentication
limits.

Reproduce it with `pnpm demo:record` after `pnpm browser:install`. See the
[handoff](../HANDOFF.md) for retention, conversion, and cleanup. The recording's
caption transcript, financial record, source, media hash, duration, and inspected
frames are recorded with the final delivery evidence. Its application source
matches merged commit `ba33d5732e7d10dca4d0ffba6660a15b42a20e35`; this delivery
adds the recording instrumentation and documentation.

The [MP4](https://github.com/KleitonBarone/returns-and-refunds/releases/download/portfolio-walkthrough-2026-10-21/returns-and-refunds.mp4)
is 1686867 bytes. Its anonymous download matched SHA-256
`547aa27ae87bd9bd8290d33bead67a136d6f0ffc36f6ddfff2287808441c5142`.
Frames at 8, 35, 55, 75, and 89 seconds were inspected for UI and caption readability.
The final capture came from run `codex-returns-test-67829ae2-efb3-4141-b6c7-d69377245a6b`;
all disposable resources were removed at `2026-10-21T19:31:18.310Z`.
The [media metadata](evidence/walkthrough-media.json),
[caption transcript](evidence/walkthrough-captions.json), and
[financial assertions](evidence/walkthrough-financial.json) preserve the observations.
