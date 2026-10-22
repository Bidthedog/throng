; Custom NSIS include for throng's electron-builder installer.
;   020 FR-016a, FR-018, FR-019, FR-021 (the original three behaviours) and
;   058 FR-001..FR-017b (machine-wide installation).
;
; HOW THE TEMPLATE IS CHANGED (058 research D3). electron-builder's `nsis.script` option replaces
; the template's two-pass build and drops the uninstaller, so it is not used. Instead this include
; makes the template's own `!include installSection.nsh` / `!include multiUserUi.nsh` resolve to
; the vendored copies in packaging/nsis/: makensis runs with the template directory as its working
; directory and looks there FIRST, so after `!cd` to packaging/nsis the vendored copies win, and the
; template directory is added as an include directory so every other relative include still finds
; its file. The guard test (packages/ui/tests/unit/nsis-vendored-templates.test.ts) pins the upstream
; files and fails if these two lines go; packaging/nsis/UPSTREAM.md records what was changed.
;
; 1. Scope (FR-001, FR-002): per-user is the default unless /allusers is given, and a silent
;    machine-wide install without administrator rights fails before anything is touched (FR-010).
; 2. Running-app handling (020 FR-018 atomic, FR-019 handoff; 058 FR-015, FR-016a, FR-017) -- decided
;    for THIS copy's install root only, by the in-use helper, and nothing is ever terminated.
; 3. Uninstall data retention (020 FR-021; 058 FR-016) -- a plain/silent uninstall RETAINS all data;
;    an interactive uninstall offers an opt-in prompt that deletes only the performing account's data.
; 4. Files in use by another account are replaced or removed at the next restart (FR-016a).

!include "LogicLib.nsh"
!include "WordFunc.nsh"
!include "nsProcess.nsh"
!insertmacro VersionCompare

!addincludedir "${__FILEDIR__}\..\node_modules\app-builder-lib\templates\nsis"
!cd "${__FILEDIR__}\nsis"

; The in-use helper pair, staged by the packaging step (058 T017) and embedded in the setup so it
; works against an install root of ANY earlier version.
!define THRONG_IN_USE_DIR "${__FILEDIR__}\..\packages\ui\build\resources\in-use"

; contracts/install-switches.md -- Elevation-declined text (FR-010a).
!define THRONG_MSG_ELEVATION_DECLINED "Installing throng for everyone on this computer needs administrator approval, which was not given. Nothing has been installed. Choose Only for me to install for yourself, or try again."

; FR-010 -- printed on the attached console by an unattended machine-wide install that cannot elevate.
!define THRONG_MSG_SILENT_NEEDS_ADMIN "throng: installing for every user of this computer needs administrator rights, and an unattended install never asks for them. Nothing has been installed. Run the installer from an elevated prompt, or leave out /allusers to install for the current user only."

; 1 when another account is using this copy and the run is unattended: nothing is terminated, in-use
; files are replaced or removed at the next restart, and the run ends with exit code 3010.
Var throngInUseOthers
!ifndef BUILD_UNINSTALLER
  Var throngScopeLabel
!endif

; Append one line to a diagnostic record, but ONLY when that file already exists: the hand-test driver
; creates it (a path every account can write, whatever a process's own temp folder is), so a normal
; install writes nothing. Lets a run that never showed the expected message be told from one that
; never asked. Clobbers $R8 and the error flag.
!macro throngSetupLog text
  ${If} ${FileExists} "C:\Users\Public\throng-setup.log"
    ; The error flag may already be set by whatever ran before (a registry read of a missing value), and
    ; the test below would then skip every write.
    ClearErrors
    FileOpen $R8 "C:\Users\Public\throng-setup.log" a
    ${IfNot} ${Errors}
      FileSeek $R8 0 END
      FileWrite $R8 "${text}$\r$\n"
      FileClose $R8
    ${EndIf}
  ${EndIf}
  ClearErrors
!macroend

; FR-010: a silent machine-wide install without administrator rights. Writes to the console the
; setup was started from (a GUI-subsystem exe has none until it attaches), exits 740
; (ERROR_ELEVATION_REQUIRED) and never raises the elevation prompt.
!macro throngRefuseSilentMachineWide
  System::Call 'kernel32::AttachConsole(i -1)i.r0'
  System::Call 'kernel32::GetStdHandle(i -11)p.r1'
  StrCpy $2 "${THRONG_MSG_SILENT_NEEDS_ADMIN}$\r$\n"
  StrLen $3 $2
  System::Call 'kernel32::WriteFile(p r1, m r2, i r3, *i .r4, p 0)i'
  SetErrorLevel 740
  Quit
!macroend

; INSTALL init, after the template's initMultiUser has run.
;
; The downgrade refusal that used to be here ran before the scope was chosen and so only ever
; read HKCU; it now lives in packaging/nsis/installSection.nsh (058 T058).
!macro customInit
  ${GetParameters} $R0
  !insertmacro throngSetupLog "init: parameters=[$R0]"
  ${If} ${Silent}
    !insertmacro throngSetupLog "init: silent"
  ${EndIf}
  ${If} ${UAC_IsAdmin}
    !insertmacro throngSetupLog "init: admin"
  ${EndIf}
  ${If} ${UAC_IsInnerInstance}
    !insertmacro throngSetupLog "init: inner instance"
  ${EndIf}
  ${GetOptions} $R0 "/allusers" $R1
  ${If} ${Errors}
    ClearErrors
    ; No machine-wide request. The template would still pick the machine-wide scope when a machine-wide
    ; copy exists, and (silently) raise an elevation prompt to upgrade it. FR-002: an install that makes
    ; no choice is per-user, in the usual place, and never prompts.
    ${IfNot} ${UAC_IsInnerInstance}
      ${If} ${Silent}
        StrCpy $hasPerMachineInstallation "0"
      ${EndIf}
      !insertmacro setInstallModePerUser
    ${EndIf}
  ${Else}
    ClearErrors
    ${IfNot} ${UAC_IsInnerInstance}
    ${AndIfNot} ${UAC_IsAdmin}
    ${AndIf} ${Silent}
      !insertmacro throngRefuseSilentMachineWide
    ${EndIf}
  ${EndIf}
!macroend

; Is throng running from THIS copy's install root? (058 D9, FR-015, FR-016a, FR-017.)
;
; The template's default terminates processes; this never does. The verdict comes from in-use.mjs,
; run with the EXISTING installation's own bundled runtime. The installer carries its own copy of the
; helper (an earlier install root has none); the uninstaller prefers the one beside the install.
;
;   free        -> carry on
;   own-only    -> the three-choice handoff of 020 FR-019: close throng (its own prompt guards live
;                  terminals), then Retry. Cancel leaves the installation untouched, exit 2.
;   others      -> interactive: refuse before changing anything, naming each account, exit 2.
;                  unattended: carry on without terminating anything (in-use files are handled at
;                  the next restart; the run ends 3010).
;
; If the helper cannot run, fall back to the by-name check: any throng.exe means "close it first".
!macro customCheckAppRunning
  StrCpy $throngInUseOthers "0"
  !insertmacro throngSetupLog "check for $INSTDIR"
  ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    StrCpy $R3 ""
    !ifndef BUILD_UNINSTALLER
      InitPluginsDir
      File /oname=$PLUGINSDIR\in-use.mjs "${THRONG_IN_USE_DIR}\in-use.mjs"
      File /oname=$PLUGINSDIR\in-use-classify.js "${THRONG_IN_USE_DIR}\in-use-classify.js"
      File /oname=$PLUGINSDIR\in-use-cli.mjs "${THRONG_IN_USE_DIR}\in-use-cli.mjs"
      ; The setup runs the plain entry point: the helper's own "started as the script" check did not
      ; hold in $PLUGINSDIR (hand test MT-05: the helper printed nothing from here).
      StrCpy $R3 "$PLUGINSDIR\in-use-cli.mjs"
    !else
      ${If} ${FileExists} "$INSTDIR\resources\in-use\in-use.mjs"
        StrCpy $R3 "$INSTDIR\resources\in-use\in-use.mjs"
      ${EndIf}
    !endif
    ${Do}
      StrCpy $R2 ""
      StrCpy $R1 ""
      ${If} $R3 == ""
      ${OrIfNot} ${FileExists} "$INSTDIR\resources\runtime\node.exe"
        !insertmacro throngSetupLog "in-use helper NOT run for $INSTDIR: helper=[$R3]"
      ${EndIf}
      ${If} $R3 != ""
      ${AndIf} ${FileExists} "$INSTDIR\resources\runtime\node.exe"
        ; Through cmd.exe: from the setup, nsExec starting the runtime directly returned exit 0 and NO
        ; output (even for `--version`), while the same command through cmd.exe answered. The
        ; uninstaller's direct call is unaffected.
        nsExec::ExecToStack '"$SYSDIR\cmd.exe" /c ""$INSTDIR\resources\runtime\node.exe" "$R3" --nsis "$INSTDIR""'
        Pop $R0
        Pop $R1
        !insertmacro throngSetupLog "in-use helper for $INSTDIR: exit=$R0 output=$R1"
        ${If} $R0 == 0
          ; "<decision>|<message>" -- free, own-only or others
          StrCpy $R2 $R1 4
          ; Exit 0 with nothing (or something unrecognised) on stdout is NOT an answer. It happened:
          ; the helper's entry point did not run from a short-named $PLUGINSDIR, printed nothing and
          ; exited 0, and an empty decision read as "free" while another account's node.exe held the
          ; install open.
          ${If} $R2 != "free"
          ${AndIf} $R2 != "own-"
          ${AndIf} $R2 != "othe"
            StrCpy $R2 ""
          ${EndIf}
        ${EndIf}
      ${EndIf}
      !insertmacro throngSetupLog "helper decision=[$R2]"
      ${If} $R2 == ""
        ; The helper gave no answer. Fall back to the by-name check, which only sees throng.exe -- and
        ; the processes holding a machine-wide copy open can be another account's node.exe. So where
        ; nobody can be asked (silent), an unanswered question is treated as "another account may be
        ; using it": carry on, terminate nothing, finish at the next restart (exit 3010). Never "free".
        ${nsProcess::FindProcess} "throng.exe" $R9
        ${nsProcess::Unload}
        ${If} $R9 == 0
          StrCpy $R2 "own-"
        ${ElseIf} ${Silent}
          StrCpy $throngInUseOthers "1"
          StrCpy $R2 "free"
        ${Else}
          StrCpy $R2 "free"
        ${EndIf}
      ${EndIf}
      ${If} $R2 == "free"
        ${Break}
      ${ElseIf} $R2 == "othe"
        ${If} ${Silent}
          StrCpy $throngInUseOthers "1"
          ${Break}
        ${EndIf}
        StrCpy $R4 $R1 "" 7
        MessageBox MB_OK|MB_ICONSTOP "$R4"
        SetErrorLevel 2
        Quit
      ${Else}
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION \
          "throng is currently running and must be closed before installing.$\n$\nClose throng now -- if \
any terminals have live processes, throng will ask whether to leave them running, terminate them, or \
cancel. Then click Retry.$\n$\nClick Cancel to abort and leave your current installation untouched." \
          /SD IDCANCEL IDRETRY +3
        SetErrorLevel 2
        Quit
      ${EndIf}
    ${Loop}
  ${EndIf}
!macroend

; Reboot-time completion (FR-016a). Unattended and another account still using throng: exit 3010.
; The functions below use defines the template creates AFTER this file is included
; (UNINSTALL_FILENAME, isUpdated), so they are defined from customHeader, which the template expands
; once everything it provides is in place.
!macro customHeader
!ifndef BUILD_UNINSTALLER
  Function .onInstFailed
    !insertmacro throngSetupLog "install failed"
  FunctionEnd

  Function .onInstSuccess
    !insertmacro throngSetupLog "install succeeded"
    ${If} $throngInUseOthers == "1"
      SetErrorLevel 3010
    ${EndIf}
  FunctionEnd
!endif

!ifdef BUILD_UNINSTALLER
  ; Remove everything under $R0 that can be removed now. A file another account has open cannot be
  ; deleted, but a running image can be RENAMED: move it aside, then have Windows delete the renamed
  ; copy at the next restart. Nothing is registered against the original path, so a replacement
  ; installed there in the meantime is never deleted at boot.
  Function un.throngSweep
    Exch $R0
    Push $R1
    Push $R2
    Push $R3
    FindFirst $R1 $R2 "$R0\*.*"
    ${DoWhile} $R2 != ""
      ${If} $R2 != "."
      ${AndIf} $R2 != ".."
        StrCpy $R3 "$R0\$R2"
        ${If} ${FileExists} "$R3\*.*"
          Push $R3
          Call un.throngSweep
        ${Else}
          ClearErrors
          Delete "$R3"
          ${If} ${Errors}
          ${AndIf} $R2 != "${UNINSTALL_FILENAME}"
            ClearErrors
            Rename "$R3" "$R3.throng-old"
            ${If} ${Errors}
              Delete /REBOOTOK "$R3"
            ${Else}
              Delete /REBOOTOK "$R3.throng-old"
            ${EndIf}
            SetRebootFlag true
          ${EndIf}
        ${EndIf}
      ${EndIf}
      FindNext $R1 $R2
    ${Loop}
    FindClose $R1
    ${If} ${isUpdated}
      RMDir "$R0"
    ${Else}
      RMDir /REBOOTOK "$R0"
    ${EndIf}
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
  FunctionEnd

  Function un.onUninstSuccess
    ${IfNot} ${isUpdated}
    ${AndIf} ${RebootFlag}
      SetErrorLevel 3010
    ${EndIf}
  FunctionEnd
!endif
!macroend

; File removal. When another account is using the copy (unattended), sweep with rename-aside and
; restart-time deletion; otherwise it is the template's own removal, reproduced unchanged.
!macro customRemoveFiles
  ${If} $throngInUseOthers == "1"
    SetOutPath $TEMP
    Push $INSTDIR
    Call un.throngSweep
  ${Else}
    ${if} ${isUpdated}
      CreateDirectory "$PLUGINSDIR\old-install"

      Push ""
      Call un.atomicRMDir
      Pop $R0

      ${if} $R0 != 0
        DetailPrint "File is busy, aborting: $R0"

        # Attempt to restore previous directory
        Push ""
        Call un.restoreFiles
        Pop $R0

        Abort `Can't rename "$INSTDIR" to "$PLUGINSDIR\old-install".`
      ${endif}

    ${endif}

    # Move out of $INSTDIR so it can be removed
    SetOutPath $TEMP
    # Remove all files (or remaining shallow directories from the block above)
    RMDir /r $INSTDIR
  ${EndIf}
!macroend

; UNINSTALL data retention (020 FR-021, 058 FR-016): the opt-in "also delete my data" prompt.
; `IfSilent` skips the prompt entirely in a silent (/S) uninstall -- the SAFE DEFAULT is retain, so an
; unattended uninstall never blocks and never deletes any account's data; only an interactive "Yes"
; removes it, and only the data of the account performing the uninstall. A machine-wide uninstall
; runs in the all-users shell context, where $APPDATA is the machine's shared folder, so the deletion
; switches to the current account's context and puts the scope back afterwards. (A MessageBox is used
; instead of a custom nsDialogs page, which trips NSIS warning 6020 in electron-builder's two-pass build.)
!macro customUnInstall
  IfSilent un_keep_data
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "throng has been removed.$\n$\nYour projects, settings and themes are KEPT by default so you can \
reinstall without losing anything.$\n$\nAlso delete that data now? This cannot be undone." \
    IDNO un_keep_data
    SetShellVarContext current
    RMDir /r "$APPDATA\throng"
    RMDir /r "$PROFILE\.throng"
    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}
  un_keep_data:
!macroend
