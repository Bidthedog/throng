# Quickstart: validating 067

Each story's *Independent Test* in [spec.md](spec.md) is the scenario to run. The automated layers are:

```sh
npx vitest run --project unit packages/core/tests/unit/
npx vitest run --project component packages/ui/tests/component/
npx vitest run --project integration packages/ui/tests/integration/instance-guard.test.ts
npx vitest run --project contract packages/ui/tests/contract/electron-clipboard.contract.test.ts
```

Behaviour in real file managers (Windows Explorer, GNOME Files, KDE Dolphin, Nemo, on X11 and Wayland) is proven by the hand-test plan FR-109 requires, not by these commands.

Contracts: [contracts/ipc.md](contracts/ipc.md). Entities: [data-model.md](data-model.md). Decisions: [research.md](research.md).
