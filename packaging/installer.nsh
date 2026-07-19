; Custom NSIS include for throng's electron-builder installer (020 FR-016a, FR-018, FR-019, FR-021).
;
; 1. Downgrade refusal (FR-016a) — installing an older version over a newer one is blocked.
; 2. Running-app handling (FR-018 atomic, FR-019 handoff) — an install never half-replaces a RUNNING
;    throng: if throng is running it refuses and asks the user to close it first; closing throng runs
;    the app's OWN three-choice live-terminal prompt, so terminals are never silently orphaned.
; 3. Uninstall data retention (FR-021) — a plain/silent uninstall RETAINS all data (safe default); an
;    interactive uninstall offers an opt-in prompt to also delete it. Never removed without a yes.

!include "LogicLib.nsh"
!include "WordFunc.nsh"
!include "nsProcess.nsh"
!insertmacro VersionCompare

; INSTALL init: downgrade refusal (FR-016a) then the running-app guard (FR-018/FR-019).
!macro customInit
  ReadRegStr $R0 SHCTX "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ${If} $R0 != ""
    ${VersionCompare} "$R0" "${VERSION}" $R1
    ; $R1 == 1 -> installed ($R0) is NEWER than this installer (${VERSION}) -> downgrade.
    ${If} $R1 == 1
      MessageBox MB_OK|MB_ICONSTOP \
        "A newer version of throng ($R0) is already installed.$\n$\nInstalling this older version \
in place is not supported. Uninstall the current version first (your projects and settings are kept \
by default), then run this installer again."
      Quit
    ${EndIf}
  ${EndIf}
  retry_running:
  ${nsProcess::FindProcess} "throng.exe" $R9
  ${If} $R9 == 0
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION \
      "throng is currently running and must be closed before installing.$\n$\nClose throng now — if \
any terminals have live processes, throng will ask whether to leave them running, terminate them, or \
cancel. Then click Retry.$\n$\nClick Cancel to abort and leave your current installation untouched." \
      /SD IDCANCEL IDRETRY retry_running
    ${nsProcess::Unload}
    Quit
  ${EndIf}
  ${nsProcess::Unload}
!macroend

; UNINSTALL data retention (FR-021): the opt-in "also delete my data" prompt. `IfSilent` skips the
; prompt entirely in a silent (/S) uninstall — the SAFE DEFAULT is retain, so an unattended uninstall
; never blocks and never deletes data; only an interactive "Yes" removes it. (A MessageBox is used
; instead of a custom nsDialogs page, which trips NSIS warning 6020 in electron-builder's two-pass build.)
!macro customUnInstall
  IfSilent un_keep_data
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "throng has been removed.$\n$\nYour projects, settings and themes are KEPT by default so you can \
reinstall without losing anything.$\n$\nAlso delete that data now? This cannot be undone." \
    IDNO un_keep_data
    RMDir /r "$APPDATA\throng"
    RMDir /r "$PROFILE\.throng"
  un_keep_data:
!macroend
