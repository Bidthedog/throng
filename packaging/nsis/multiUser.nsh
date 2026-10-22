; Forwarding shim, not a vendored copy (058 research D3).
;
; packaging/installer.nsh makes makensis look in THIS folder first so the template's two vendored
; files are found here. But NSIS searches its own Include directory before any `!addincludedir`, and
; it ships a different `MultiUser.nsh` (names compare case-insensitively on Windows) -- so without
; this file the template's `!include "multiUser.nsh"` would silently pick up NSIS's stock one instead.
; The template's own file, unchanged, is included by absolute path.
!include "${__FILEDIR__}\..\..\node_modules\app-builder-lib\templates\nsis\multiUser.nsh"
