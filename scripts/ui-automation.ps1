# Drives a Windows dialog through UI Automation, for the hand-test driver (058, verify-hand-tests.mjs).
#
#   powershell -File ui-automation.ps1 -Command <command> [-Title <regex>] [-Pid <n>] [-Name <regex>]
#              [-Path <file>] [-TimeoutSec <n>]
#
# Commands (each prints ONE JSON line, {"ok": true, ...} or {"ok": false, "error": "..."}):
#   windows   top-level windows (title, pid, class), filtered by -Title / -Pid
#   find      the first window matching -Title / -Pid, waiting up to -TimeoutSec
#   text      every piece of text in that window: labels, edits, and the names of its controls
#   controls  every control in that window with its type, name, and state (evidence)
#   click     press the button named -Name (a regex over the name, ignoring '&' accelerators)
#   select    select the radio button named -Name
#   tick      tick the check box named -Name
#   gone      wait until no window matches (the dialog closed)
#   shot      save a full-screen PNG to -Path
#
# A control's name is the text it shows: NSIS and Windows Installer dialogs are ordinary Win32 controls,
# which UI Automation exposes through the legacy accessibility bridge. Accelerator ampersands are
# stripped before matching, so "&Next >" is found by "^Next".
param(
  [Parameter(Mandatory = $true)][string]$Command,
  [string]$Title = '.*',
  [int]$ProcessId = 0,
  [string]$Name = '',
  [string]$Path = '',
  [int]$TimeoutSec = 30
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ThrongMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  public static void Click(int x, int y) { SetCursorPos(x, y); mouse_event(2, 0, 0, 0, UIntPtr.Zero); mouse_event(4, 0, 0, 0, UIntPtr.Zero); }
}
'@

function Out-Json($value) { [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 6)) }
function Clean([string]$text) { if ($null -eq $text) { return '' } ; return ($text -replace '&', '').Trim() }

function Get-Windows {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($w in $all) {
    $current = $w.Current
    if ($ProcessId -ne 0 -and $current.ProcessId -ne $ProcessId) { continue }
    if ((Clean $current.Name) -notmatch $Title) { continue }
    $w
  }
}

function Find-Window([int]$seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  do {
    $found = @(Get-Windows | Where-Object { -not $_.Current.IsOffscreen })
    if ($found.Count -gt 0) { return $found[0] }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $null
}

function Descendants($window) {
  $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
}

# The window's own Minimize / Maximize / Close buttons live in its title bar. They are never the
# wizard's buttons, and pressing "Close" there cancels the install.
function In-TitleBar($element) {
  $parent = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($element)
  return ($null -ne $parent -and $parent.Current.ControlType -eq [System.Windows.Automation.ControlType]::TitleBar)
}

function Find-Control($window, [string]$type, [string]$pattern) {
  foreach ($e in (Descendants $window)) {
    $c = $e.Current
    if (In-TitleBar $e) { continue }
    if ($type -and $c.ControlType.ProgrammaticName -ne "ControlType.$type") { continue }
    if ((Clean $c.Name) -match $pattern) { return $e }
  }
  return $null
}

function Press($element) {
  $pattern = $null
  if ($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { $pattern.Invoke(); return 'invoke' }
  if ($element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) { $pattern.Select(); return 'select' }
  # Legacy controls: the default action, else a real click at the control's centre.
  if ($element.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$pattern)) { $pattern.DoDefaultAction(); return 'default-action' }
  $r = $element.Current.BoundingRectangle
  [ThrongMouse]::Click([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2))
  return 'mouse'
}

try {
  switch ($Command) {
    'windows' {
      $rows = @(Get-Windows | ForEach-Object { @{ title = (Clean $_.Current.Name); pid = $_.Current.ProcessId; class = $_.Current.ClassName; offscreen = $_.Current.IsOffscreen } })
      Out-Json @{ ok = $true; windows = $rows }
    }
    'find' {
      $w = Find-Window $TimeoutSec
      if ($null -eq $w) { Out-Json @{ ok = $false; error = "no window matching '$Title' (pid $ProcessId) appeared within ${TimeoutSec}s" } }
      else { Out-Json @{ ok = $true; title = (Clean $w.Current.Name); pid = $w.Current.ProcessId; class = $w.Current.ClassName } }
    }
    'text' {
      $w = Find-Window $TimeoutSec
      if ($null -eq $w) { Out-Json @{ ok = $false; error = "no window matching '$Title'" }; break }
      $parts = @(Clean $w.Current.Name)
      foreach ($e in (Descendants $w)) {
        $c = $e.Current
        $type = $c.ControlType.ProgrammaticName
        if ($type -in 'ControlType.Text', 'ControlType.Edit', 'ControlType.Document') {
          $value = $null
          if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$value)) { $parts += (Clean $value.Current.Value) }
          $parts += (Clean $c.Name)
        }
      }
      Out-Json @{ ok = $true; title = (Clean $w.Current.Name); text = (($parts | Where-Object { $_ } | Select-Object -Unique) -join "`n") }
    }
    'controls' {
      $w = Find-Window $TimeoutSec
      if ($null -eq $w) { Out-Json @{ ok = $false; error = "no window matching '$Title'" }; break }
      $rows = @(foreach ($e in (Descendants $w)) {
        $c = $e.Current
        $state = ''
        $p = $null
        if ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$p)) { $state = "selected=$($p.Current.IsSelected)" }
        elseif ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) { $state = "toggle=$($p.Current.ToggleState)" }
        @{ type = ($c.ControlType.ProgrammaticName -replace '^ControlType\.', ''); name = (Clean $c.Name); enabled = $c.IsEnabled; state = $state; titlebar = (In-TitleBar $e) }
      })
      Out-Json @{ ok = $true; title = (Clean $w.Current.Name); controls = $rows }
    }
    'click' {
      $w = Find-Window $TimeoutSec
      if ($null -eq $w) { Out-Json @{ ok = $false; error = "no window matching '$Title'" }; break }
      $b = Find-Control $w 'Button' $Name
      if ($null -eq $b) { Out-Json @{ ok = $false; error = "no button matching '$Name' in '$(Clean $w.Current.Name)'" }; break }
      if (-not $b.Current.IsEnabled) { Out-Json @{ ok = $false; error = "button '$(Clean $b.Current.Name)' is disabled" }; break }
      Out-Json @{ ok = $true; clicked = (Clean $b.Current.Name); how = (Press $b) }
    }
    'select' {
      $w = Find-Window $TimeoutSec
      if ($null -eq $w) { Out-Json @{ ok = $false; error = "no window matching '$Title'" }; break }
      $r = Find-Control $w 'RadioButton' $Name
      if ($null -eq $r) { Out-Json @{ ok = $false; error = "no radio button matching '$Name' in '$(Clean $w.Current.Name)'" }; break }
      if (-not $r.Current.IsEnabled) { Out-Json @{ ok = $false; error = "radio button '$(Clean $r.Current.Name)' is disabled" }; break }
      $how = Press $r
      # Selecting through the accessibility bridge can move the dot without the dialog hearing a click
      # (the MSI's scope page then ignored the choice). A real click is what a person does, so follow
      # up with one whenever the radio is not selected afterwards, or was only selected, not clicked.
      $sel = $null
      $isSel = $r.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$sel) -and $sel.Current.IsSelected
      if ($how -ne 'mouse') {
        $rect = $r.Current.BoundingRectangle
        [ThrongMouse]::Click([int]($rect.X + 12), [int]($rect.Y + $rect.Height / 2))
        $how = "$how+mouse"
        Start-Sleep -Milliseconds 400
      }
      Out-Json @{ ok = $true; selected = (Clean $r.Current.Name); how = $how; wasSelected = $isSel }
    }
    'tick' {
      $w = Find-Window $TimeoutSec
      if ($null -eq $w) { Out-Json @{ ok = $false; error = "no window matching '$Title'" }; break }
      $c = Find-Control $w 'CheckBox' $Name
      if ($null -eq $c) { Out-Json @{ ok = $false; error = "no check box matching '$Name' in '$(Clean $w.Current.Name)'" }; break }
      $toggle = $null
      $on = $false
      if ($c.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$toggle)) {
        if ($toggle.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::On) { $toggle.Toggle() }
        $on = $toggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On
      } else { Press $c | Out-Null; $on = $true }
      Out-Json @{ ok = $on; ticked = (Clean $c.Current.Name) }
    }
    'gone' {
      $deadline = (Get-Date).AddSeconds($TimeoutSec)
      while ((Get-Date) -lt $deadline) {
        if (@(Get-Windows).Count -eq 0) { Out-Json @{ ok = $true }; return }
        Start-Sleep -Milliseconds 500
      }
      Out-Json @{ ok = $false; error = "a window matching '$Title' (pid $ProcessId) was still showing after ${TimeoutSec}s" }
    }
    'shot' {
      $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
      $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
      $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
      $graphics.Dispose(); $bitmap.Dispose()
      Out-Json @{ ok = $true; path = $Path; width = $bounds.Width; height = $bounds.Height }
    }
    default { Out-Json @{ ok = $false; error = "unknown command '$Command'" } }
  }
} catch {
  Out-Json @{ ok = $false; error = $_.Exception.Message }
  exit 1
}
