$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class VacuumTaskbar {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string name, string title);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[VacuumTaskbar]::SetProcessDPIAware() | Out-Null
$vacuumHandle = [VacuumTaskbar]::FindWindow('Shell_TrayWnd', $null)
if ($vacuumHandle -eq [IntPtr]::Zero) { throw 'Taskbar unavailable' }
$vacuumRect = New-Object VacuumTaskbar+RECT
[VacuumTaskbar]::GetWindowRect($vacuumHandle, [ref]$vacuumRect) | Out-Null
$vacuumRoot = [System.Windows.Automation.AutomationElement]::FromHandle($vacuumHandle)
$vacuumCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'StartButton')
$vacuumStart = $vacuumRoot.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $vacuumCondition)
if ($null -eq $vacuumStart) {
  $vacuumButtons = $vacuumRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($vacuumButton in $vacuumButtons) {
    if ($vacuumButton.Current.AutomationId -match '^Start' -or $vacuumButton.Current.Name -in @('Start', 'Pradžia')) { $vacuumStart=$vacuumButton; break }
  }
}
$vacuumStartRect = $null
if ($null -ne $vacuumStart) { $vacuumBounds=$vacuumStart.Current.BoundingRectangle; $vacuumStartRect=@{x=$vacuumBounds.X;y=$vacuumBounds.Y;width=$vacuumBounds.Width;height=$vacuumBounds.Height} }
@{taskbar=@{x=$vacuumRect.Left;y=$vacuumRect.Top;width=$vacuumRect.Right-$vacuumRect.Left;height=$vacuumRect.Bottom-$vacuumRect.Top};start=$vacuumStartRect} | ConvertTo-Json -Compress
