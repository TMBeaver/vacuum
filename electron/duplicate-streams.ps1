$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$vacuumStreamPaths = ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class VacuumStreams {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct StreamData {
    public long Size;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=296)] public string Name;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr FindFirstStreamW(string path, int level, out StreamData data, int flags);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool FindNextStreamW(IntPtr handle, out StreamData data);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool FindClose(IntPtr handle);
  public static void Check(string path) {
    StreamData data;
    IntPtr handle=FindFirstStreamW(path,0,out data,0);
    if(handle==new IntPtr(-1)) {
      if(Marshal.GetLastWin32Error()==38) return;
      throw new Exception("Cannot verify Windows file streams: " + Marshal.GetLastWin32Error() + " at " + path);
    }
    try {
      do {
        if(data.Name!="::$DATA") throw new Exception("Additional Windows data streams are protected.");
      } while(FindNextStreamW(handle,out data));
      if(Marshal.GetLastWin32Error()!=38) throw new Exception("Cannot verify Windows file streams: " + Marshal.GetLastWin32Error() + " at " + path);
    } finally {FindClose(handle);}
  }
}
'@
try {
  foreach ($vacuumStreamPath in $vacuumStreamPaths) { [VacuumStreams]::Check([string]$vacuumStreamPath) }
  @{ok=$true} | ConvertTo-Json -Compress
} catch { @{ok=$false;reason=$_.Exception.Message} | ConvertTo-Json -Compress }
