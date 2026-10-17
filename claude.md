# FundMyCampus Medical Education Loan Landing Page

## Project Overview
Medical education loan eligibility checker for **FundMyCampus** — MBBS, BDS, MD, MS, MDS (and DNB), India and abroad. Built from the owner's spec: `FundMyCampus_Medical_Loan_Build_and_SEO_Specification.md` (v2.0, 14 Oct 2026; kept OUT of the repo — it contains confidential lender mappings).

Previously this repo was the MBA landing page (served at `/education-loan-for-MBA`). The medical remap lives on branch `mbbs-remap`; MBA version is on `main` history.

## Tech Stack
- Pure HTML/CSS/JS — no frameworks, no build tools
- Fonts: Inter + Playfair Display (Google Fonts)
- Hosted on **Vercel**
- API: `https://api.fundmycampus.com/api/landing-leads` (source `medical_loan_checker`)

## URLs
- **Intended canonical:** `https://www.fundmycampus.com/medical-education-loan` (spec §14) — needs a main-site rewrite; not live yet
- **Direct URL:** `landing.fundmycampus.com`
- **Main site:** `fundmycampus.com` (separate Vercel project); existing course pages `/loan-for-mbbs`, `/loan-for-bds`
- **GitHub:** `https://github.com/Amitsourav/FMC_LANDING_PAGE.git`

## How the Rewrite Works
- Main site `vercel.json` rewrites a path -> `https://landing.fundmycampus.com/`
- An inline script writes `<base href="https://landing.fundmycampus.com/">` when not on the landing domain/localhost, so assets load from both URLs

## File Structure
| File | Purpose |
|------|---------|
| `index.html` | Page structure, SEO meta, JSON-LD, static guide content |
| `style.css` | All styles — teal (#0D9488) accent; checker styles at the end |
| `engine.js` | Decision engine, verbatim from spec Appendix E (`LoanEngine.assess`) |
| `medical-data.js` | GENERATED — 2,664 institutions (906 NMC, 330 DCI, 1,441 QHEI incl. 16 additions) |
| `script.js` | Checker UI, institution combobox, results, lead capture, map, compare |
| `india-map.js` / `india-map.svg` | Interactive map; clickable states derived from the data passed in |
| `tools/build-data.py` | Regenerates `medical-data.js` from spec Appendices A–D |
| `tests/eligibility.cjs` | Spec Appendix F scenario tests — run `node tests/eligibility.cjs` (37 groups) |
| `dotted-surface.js` | Three.js animation (NOT used) |
| `logo.png` | FMC logo |

## Hard rules from the spec
- **Never reveal lender names** in public files, payloads, WhatsApp text or metadata (products use neutral labels). The old bank-logo carousel was removed for this reason.
- Don't edit `engine.js` thresholds by hand — policy changes should be versioned (credit rule `FMC-CREDIT-2026-10-14-v1`, products `2026-10-14-v2`).
- No invented claims (disbursal totals, approval rates, "48-hour approval", reviewer names).
- QHEI status is exact-record only; never inherit from an affiliated university.
- Simple-interest campaign rates auto-expire for new applications after 15 Nov 2026 (engine uses Asia/Kolkata date).

## Design Decisions
- Navbar logo is **static/non-clickable** (intentional)
- Footer logo size: **200px** height
- Lead form: success is shown **only after the API returns 2xx** (spec §11); on failure the user sees retry + WhatsApp fallback and keeps their data
- Indicative result is shown before any contact details are asked
- Map pins are spread randomly inside the state shape — not geocoded

## Pending Work
- [ ] Decide final URL; ask main-site dev to add the `/medical-education-loan` rewrite (and decide what happens to `/education-loan-for-MBA`)
- [ ] Confirm the leads API accepts the new payload (optional email, `assessment`, `attribution`, `Idempotency-Key` header)
- [ ] Real author/reviewer name for the sources panel (spec §19)
- [ ] Add redirect from `landing.fundmycampus.com` to the canonical path. **Do NOT remove `landing.fundmycampus.com` from Vercel** — the rewrite depends on it.
- [ ] Not built (spec phases 2–5): per-college SSR pages, sitemap, CRM worker, admin panel

## Deployment
- Auto-deploys on `git push` to `main` via Vercel
- Main site dev should be told separately for any `vercel.json` rewrite changes
