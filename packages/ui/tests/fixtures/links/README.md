# Link fixtures

The tree every layer of spec 045 (*Clickable File Links*) reads from. It is described in
`specs/045-clickable-file-links/quickstart.md` §2.

`README.md` itself is a fixture: US2 scenario 2 and US5 scenarios 2–3 need a file the shipped
Markdown preview provider accepts.

The four executable fixtures — `setup.exe`, `build.bat`, `deploy.ps1`, `shortcut.lnk` — are inert
placeholder bytes. **No test ever runs one.** Only their extensions are under test (FR-039, FR-039a,
SC-010).

`../links-outside/elsewhere.txt` sits outside every project root, for the out-of-project cases
(US4 scenario 3, US5 scenario 5, SC-007).
