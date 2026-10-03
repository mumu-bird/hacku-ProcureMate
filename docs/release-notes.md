# ProcureMate v0.1.2 · HacKU 2026 prototype

Local Next.js / TypeScript / SQLite procurement prototype covering event gifts, inventory replenishment and employee equipment.

This version fixes the observed HK$400 free-standard-delivery threshold, isolates the small-order shipping stop, protects confirmed payment/refund states against stale network replies, validates payment amounts/currencies, recovers lost payment IDs from verified events, prevents adapter mixing, leases concurrent captures, and serializes cross-process audit writes. Evidence exports now include the full audit chain. The browser replenishment test completes a second authorized purchase and receipt after consumption. External font loading was removed for local demo reliability.

v0.1.1's fixed-HK$80 calculation and video are superseded; use v0.1.2 materials.
The three-minute captioned recording shows an actual prototype transaction, a server-side shipping-cost budget stop, replenishment and onboarding. Current demonstration uses a transparent rule planner and simulated payments. It does not represent a real HKT merchant order or verified Stripe/model network integration.

Validation: 34 core tests and 3 browser workflows passed; TypeScript and production build passed. The 7-slide PDF includes source boundaries, competitors and unverified assumptions.

The official manual-route evidence is still missing. The team should complete its five-participant task comparison, verify real model/Stripe network integrations when credentials are available, and submit its official form. The payment score assesses proposed-rail feasibility, not mandatory Stripe integration. See `docs/award-evidence.md` and `docs/submission-checklist.md`.

Release attachments (the selected repository is currently private): `ProcureMate-demo.webm` (180 seconds, captions, no narration) and `ProcureMate-pitch.pdf`.

The team must make its competition repository and submission materials publicly accessible before submission.
