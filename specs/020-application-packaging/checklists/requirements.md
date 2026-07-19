# Specification Quality Checklist: Application Packaging

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-17
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain — all three resolved 2026-07-17
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

**Status: all items pass (iteration 5, after the 2026-07-18 clarify session added the downgrade decision). Ready for `/speckit-plan`.**

### Escalated / clarified decisions, as resolved

| Decision | Resolution | Landed in |
|---|---|---|
| Install scope | **Per-user only.** No administrator prompt; each user their own copy. | FR-040; makes FR-013 (per-user endpoint scoping) mandatory |
| Auto-update | **Out of scope.** Split to #119 (vNext). | FR-041 |
| Code signing | **Dropped entirely** (too restrictive). Replaced by a published per-artifact checksum. Signing issue #118 closed not-planned. | FR-042/042a, 024a, 043; Clarifications note |
| Diagnostics | **Full logging (levels/rotation/retention) + crash reports, no in-app viewer.** Split to #123 (v1.0.0). | Clarifications note; Dependencies |
| Version display surface | **"About throng" dialog** from the app menu: version + build id (selectable), copyright notice, licence link, full licence text in a read-only scrollable region. | FR-003/003a; US1 scenario 4; About Dialog entity |
| Uninstall data retention | **Uninstaller checkbox "also delete my projects and settings", unticked by default.** Plain uninstall retains everything; removal needs an explicit tick. | FR-021; US3 scenarios 6–7 |
| Downgrade behaviour | **Refused.** In-place downgrade is not supported; to run an older version the user must uninstall first. The newer installation and all data are left untouched. | FR-016a; Downgrade edge case; Session 2026-07-18 |

Clarify-session record lives in the spec's `## Clarifications` → `### Session 2026-07-17` and `### Session 2026-07-18`.

### Two questions the user asked were answered, not escalated

- *Is the daemon a Windows service?* **No** — a service runs outside the user's interactive session at its own privilege level, which breaks the constitutional rule that a terminal's elevation follows the application (Principle III). FR-010/FR-011.
- *Do we need installers for each OS?* **Only for each OS throng runs on — Windows only today.** macOS/Linux have no platform implementation, so there is nothing to package. FR-038/FR-039.

### Carried risk into planning

- **FR-009 (self-contained install) is the largest technical consequence.** The daemon currently requires a host language runtime found on the system search path, and its native components are compiled against that runtime rather than Electron's — a deliberate split. Packaging must ship a runtime or unwind the split. Planning must decide which; the spec deliberately does not.
- **FR-013 (per-user endpoint scoping) is a real defect this feature must fix**, not a nicety. The daemon's endpoint is machine-wide today; per-user installs make collision reachable by ordinary users rather than only developers.
- **FR-019 (upgrade/uninstall with live terminals)** is where this feature meets Principle III most sharply. An installer that replaces the daemon while it holds live terminals is the exact hazard the constitution guards.
- **Unsigned means the Windows warning is permanent.** FR-043 requires it be explained to users. The checksum (FR-042) is an integrity check only — it does not address the warning and carries no publisher identity. Accepted trade for a solo OSS project.
- **#123 (diagnostics) ships in the same milestone.** An installed build with no console and discarded daemon output cannot be debugged from a bug report; without it, US1's "actionable bug reports" purpose is only half-delivered.
