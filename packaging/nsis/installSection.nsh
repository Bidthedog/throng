!include installer.nsh

InitPluginsDir

${IfNot} ${Silent}
  SetDetailsPrint none
${endif}

StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
!insertmacro throngSetupLog "section: INSTDIR=$INSTDIR mode=$installMode"

# must be called before uninstallOldVersion
!insertmacro setLinkVars
!insertmacro throngSetupLog "section: links set"

# 058 FR-017b — the scope is part of every label this copy owns (research D4). The template names
# the Apps entry and the shortcuts the same in both scopes, so two copies would be indistinguishable.
${if} $installMode == "all"
  StrCpy $throngScopeLabel "all users"
${else}
  StrCpy $throngScopeLabel "per-user"
${endIf}
StrCpy $newDesktopLink "$DESKTOP\${SHORTCUT_NAME} ($throngScopeLabel).lnk"
!ifdef MENU_FILENAME
  StrCpy $newStartMenuLink "$SMPROGRAMS\${MENU_FILENAME}\${SHORTCUT_NAME} ($throngScopeLabel).lnk"
!else
  StrCpy $newStartMenuLink "$SMPROGRAMS\${SHORTCUT_NAME} ($throngScopeLabel).lnk"
!endif

# 058 FR-015, FR-022 — refuse to replace THIS scope's copy with an older version. This used to live
# in customInit, which runs before the scope is chosen and so only ever read HKCU; here SHELL_CONTEXT
# is the chosen scope's hive. Exit code 2 is the contract's "refusal" (contracts/install-switches.md).
ReadRegStr $R0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
!insertmacro throngSetupLog "section: installed version read"
${If} $R0 != ""
  ${VersionCompare} "$R0" "${VERSION}" $R1
  # $R1 == 1 -> installed ($R0) is NEWER than this installer (${VERSION}) -> downgrade.
  ${If} $R1 == 1
    !insertmacro throngSetupLog "refused: installed $R0 is newer than ${VERSION}"
    MessageBox MB_OK|MB_ICONSTOP \
      "A newer version of throng ($R0) is already installed.$\n$\nInstalling this older version \
in place is not supported. Uninstall the current version first (your projects and settings are kept \
by default), then run this installer again." /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
${EndIf}

!ifdef ONE_CLICK
  !ifdef HEADER_ICO
    File /oname=$PLUGINSDIR\installerHeaderico.ico "${HEADER_ICO}"
  !endif
  ${IfNot} ${Silent}
    !ifdef HEADER_ICO
      SpiderBanner::Show /MODERN /ICON "$PLUGINSDIR\installerHeaderico.ico"
    !else
      SpiderBanner::Show /MODERN
    !endif

    FindWindow $0 "#32770" "" $hwndparent
    FindWindow $0 "#32770" "" $hwndparent $0
    GetDlgItem $0 $0 1000
    SendMessage $0 ${WM_SETTEXT} 0 "STR:$(installing)"

    StrCpy $1 $hwndparent
		System::Call 'user32::ShutdownBlockReasonCreate(${SYSTYPE_PTR}r1, w "$(installing)")'
  ${endif}
  !insertmacro throngSetupLog "section: before the running-app check"
  !insertmacro CHECK_APP_RUNNING
  !insertmacro throngSetupLog "section: after the running-app check"
!else
  # 058: the template skips this in the elevated inner process, because it ran the check in the outer
  # one. Throng's check (customCheckAppRunning) runs here, in the process that actually installs --
  # the outer process of a machine-wide install exits at the scope page and never reaches this point.
  !insertmacro throngSetupLog "section: before the running-app check"
  !insertmacro CHECK_APP_RUNNING
  !insertmacro throngSetupLog "section: after the running-app check"
!endif

Var /GLOBAL keepShortcuts
StrCpy $keepShortcuts "false"
!insertMacro setIsTryToKeepShortcuts
${if} $isTryToKeepShortcuts == "true"
  ReadRegStr $R1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" KeepShortcuts

  ${if} $R1 == "true"
  ${andIf} ${FileExists} "$appExe"
    StrCpy $keepShortcuts "true"
  ${endIf}
${endif}

!insertmacro throngSetupLog "section: before replacing the old version"
!insertmacro uninstallOldVersion SHELL_CONTEXT
!insertmacro throngSetupLog "section: after replacing the old version"
!insertmacro handleUninstallResult SHELL_CONTEXT

# 058 FR-017 — upstream also runs the PER-USER copy's uninstaller here when installing machine-wide
# (`uninstallOldVersion HKEY_CURRENT_USER`). Installing one copy must never remove another, so it is
# gone: each scope replaces only its own.

SetOutPath $INSTDIR

!ifdef UNINSTALLER_ICON
  File /oname=uninstallerIcon.ico "${UNINSTALLER_ICON}"
!endif

!insertmacro installApplicationFiles
!insertmacro throngSetupLog "section: application files installed"
!insertmacro registryAddInstallInfo
# 058 FR-017b — the Apps entry and the remembered shortcut name carry the scope (research D4). The
# uninstaller and the next upgrade find this copy's shortcuts through the remembered name.
WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayName "${UNINSTALL_DISPLAY_NAME} ($throngScopeLabel)"
WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" ShortcutName "${SHORTCUT_NAME} ($throngScopeLabel)"
!insertmacro addStartMenuLink $keepShortcuts
!insertmacro addDesktopLink $keepShortcuts

${if} ${FileExists} "$newStartMenuLink"
  StrCpy $launchLink "$newStartMenuLink"
${else}
  StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
${endIf}

!ifmacrodef registerFileAssociations
  !insertmacro registerFileAssociations
!endif

!ifmacrodef customInstall
  !insertmacro customInstall
!endif

!macro doStartApp
  # otherwise app window will be in background
  HideWindow
  !insertmacro StartApp
!macroend

!ifdef ONE_CLICK
  # https://github.com/electron-userland/electron-builder/pull/3093#issuecomment-403734568
  !ifdef RUN_AFTER_FINISH
    ${ifNot} ${Silent}
    ${orIf} ${isForceRun}
      !insertmacro doStartApp
    ${endIf}
  !else
    ${if} ${isForceRun}
      !insertmacro doStartApp
    ${endIf}
  !endif
  !insertmacro quitSuccess
!else
  # for assisted installer run only if silent, because assisted installer has run after finish option
  ${if} ${isForceRun}
  ${andIf} ${Silent}
    !insertmacro doStartApp
  ${endIf}
!endif
