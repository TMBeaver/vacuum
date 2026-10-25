$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$request=[Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class VacuumStartupCommand {
  [DllImport("shell32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CommandLineToArgvW(string command,out int count);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
  public static string[] Parse(string command) {
    int count;IntPtr memory=CommandLineToArgvW(command,out count);
    if(memory==IntPtr.Zero)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    try {var args=new string[count];for(int i=0;i<count;i++)args[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(memory,i*IntPtr.Size));return args;}
    finally{LocalFree(memory);}
  }
}
'@
$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Run')
$commands=@()
try{
  if($key){foreach($name in $request.names){
    $value=$key.GetValue([string]$name)
    if($value -isnot [string] -or [string]::IsNullOrWhiteSpace($value)){continue}
    $arguments=[VacuumStartupCommand]::Parse($value)
    if($arguments.Length -eq 0){continue}
    $tail=@();if($arguments.Length -gt 1){$tail=@($arguments[1..($arguments.Length-1)])}
    $commands+=@{name=$name;path=$arguments[0];args=$tail}
  }}
}finally{if($key){$key.Dispose()}}
@{commands=$commands} | ConvertTo-Json -Depth 6 -Compress
