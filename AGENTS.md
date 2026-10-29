# Project guidance

## Product and architecture

- This is the existing Angular 21 standalone SPA. Extend it; do not initialize a second Angular project.
- The current product is the editorial workspace: podcast analytics, topics, research dossiers, transcript-derived style profiles, scripts, and settings.
- Named Angular Router paths provide stable URLs for the editorial views. The current shell still renders those views from one page component/template; new work should move feature-specific UI and logic into feature areas incrementally rather than expanding that component further.
- `src/app/workspace.store.ts` owns editorial models, versioned browser persistence, CSV parsing, neutral scoring, style-profile calculations, and episode links.
- `src/app/ai-api.service.ts` calls the local Node API. Keep provider keys on the server; never expose them to browser code or commit secret files.
- `backend/server.mjs` is the local Node API. It authenticates local requests, calls the OpenAI Responses API, records usage/jobs in SQLite, and exposes health and AI endpoints. SQLite currently stores API usage and job records; editorial data remains in browser `localStorage`.
- `backend/data/inside-verbrechen.sqlite` is runtime data; do not inspect, commit, overwrite, or delete it unless explicitly requested.
- `public/assets/analytics.csv` is the runtime copy of supplied analytics in `data/analytics/`.

## Editorial data integrity

- Never invent podcast statistics, case facts, sources, or completed analysis.
- Manually entered source URLs remain unverified until a verification workflow exists.
- Current episode statistics do not include themes, durations, or comparable observation windows. Mark those metrics unavailable and do not claim thematic correlations or outcome predictions.
- Style profiles derive only from imported TXT/Markdown transcripts. Script generation must continue to work with the configured neutral style when no reference transcript exists.
- Script generation remains gated by manual dossier approval and must use only dossier information. Clearly state that generation is not an automated fact audit.

## Episode foundation and migration

- `Episode` is the shared link between an existing topic, its dossier, and script IDs, preparing for a future production project.
- Persisted browser data uses versioned keys. Preserve existing topic/dossier/script IDs and user data when migrating; migrations must be idempotent and non-destructive.
- Do not put audio blobs or other large media in `localStorage`. Audio storage, project editing, and production metadata require a separately designed local storage/API boundary before implementation.
- The production area is planned but not implemented. Do not imply that recording, audio editing, media uploads, waveform rendering, effects, or audio export already work.

## Development conventions

- Use strict TypeScript, standalone Angular APIs, signals, and SCSS consistent with the installed Angular version.
- Preserve existing editorial behavior while refactoring. Keep route names stable and make new production functionality a separate feature area when it is approved.
- Never read `.env` or print secrets. `.env` is local configuration and must remain ignored by Git.
- When changing application behavior, run `npm run build` and `npm test -- --watch=false`, unless the user explicitly limits verification.
