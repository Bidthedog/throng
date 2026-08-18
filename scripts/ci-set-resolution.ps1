<#
.SYNOPSIS
  Set the CI runner's virtual desktop to 1920x1080 before an E2E run.

.DESCRIPTION
  GitHub's Windows runners boot their virtual desktop at 1024x768. throng's window does not fit
  usefully in that, and several specs assert layout that only holds at a realistic size — a pane
  that collapses, a tab strip that overflows, a status bar that wraps. The failures look like
  product defects and are not.

  There is no supported PowerShell cmdlet for this, hence the P/Invoke: EnumDisplaySettings fills a
  DEVMODE from the current mode, the two size fields are overwritten, and ChangeDisplaySettings
  applies it. `dmFields` names WHICH fields were set (DM_PELSWIDTH | DM_PELSHEIGHT) — without it the
  call succeeds and changes nothing, which is the failure mode worth knowing about here.

  Extracted from .github/workflows/ci.yml when release.yml gained its own full-suite E2E job (034
  FR-056). Thirty lines of marshalling copied into a second workflow is thirty lines that drift.

.NOTES
  Non-fatal by design: it reports the return code and does not throw. A run at the wrong resolution
  produces legible spec failures; a run that never starts because the resolution step threw produces
  nothing at all.
#>
[CmdletBinding()]
param(
  [int] $Width = 1920,
  [int] $Height = 1080
)

Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Disp {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmDeviceName;
    public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
    public int dmFields, dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
    public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmFormName;
    public short dmLogPixels; public int dmBitsPerPel, dmPelsWidth, dmPelsHeight;
    public int dmDisplayFlags, dmDisplayFrequency, dmICMMethod, dmICMIntent, dmMediaType, dmDitherType;
    public int dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
  }
  [DllImport("user32.dll")] public static extern int EnumDisplaySettings(string d, int n, ref DEVMODE dm);
  [DllImport("user32.dll")] public static extern int ChangeDisplaySettings(ref DEVMODE dm, int f);
  public static int Set(int w, int h) {
    DEVMODE dm = new DEVMODE();
    dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
    if (EnumDisplaySettings(null, -1, ref dm) == 0) return -1;
    dm.dmPelsWidth = w; dm.dmPelsHeight = h;
    dm.dmFields = 0x80000 | 0x100000; // DM_PELSWIDTH | DM_PELSHEIGHT
    return ChangeDisplaySettings(ref dm, 0);
  }
}
'@

$rc = [Disp]::Set($Width, $Height)
Write-Host "ChangeDisplaySettings ${Width}x${Height} -> $rc (0 = success)"
