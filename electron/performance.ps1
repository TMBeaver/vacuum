$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$request=[Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class VacuumWindows {
  delegate bool EnumProc(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr data);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr window);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint command);
  [DllImport("user32.dll",SetLastError=true)] static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int process);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out long created,out long exited,out long kernel,out long user);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  public static bool StopVerified(int process,string expectedStart) {
    IntPtr handle=OpenProcess(0x101001,false,process);
    if(handle==IntPtr.Zero)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    try {
      long created,exited,kernel,user;
      if(!GetProcessTimes(handle,out created,out exited,out kernel,out user))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      if(DateTime.FromFileTimeUtc(created).Ticks.ToString()!=expectedStart)throw new InvalidOperationException("Process identity changed. Refresh the review.");
      if(HasWindow(process))throw new InvalidOperationException("Use normal Close for apps with a window.");
      if(!TerminateProcess(handle,1))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      return WaitForSingleObject(handle,2000)==0;
    } finally {CloseHandle(handle);}
  }
  public static string OwnerSid(int process) {
    IntPtr handle=OpenProcess(0x1000,false,process),token=IntPtr.Zero;
    if(handle==IntPtr.Zero)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    try {
      if(!OpenProcessToken(handle,8,out token))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      using(var identity=new System.Security.Principal.WindowsIdentity(token))return identity.User.Value;
    } finally { if(token!=IntPtr.Zero)CloseHandle(token);CloseHandle(handle); }
  }
  public static bool HasWindow(int process) {
    bool found=false;
    EnumWindows((window,data)=>{uint owner;GetWindowThreadProcessId(window,out owner);if(owner==process&&IsWindowVisible(window))found=true;return true;},IntPtr.Zero);
    return found;
  }
  public static bool RequestClose(int process) {
    bool sent=false;
    EnumWindows((window,data)=>{uint owner;GetWindowThreadProcessId(window,out owner);if(owner==process&&IsWindowVisible(window)&&IsWindowEnabled(window)&&GetWindow(window,4)==IntPtr.Zero)sent=PostMessage(window,0x0010,IntPtr.Zero,IntPtr.Zero)||sent;return true;},IntPtr.Zero);
    return sent;
  }
}
'@
$modules=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules'
Import-Module (Join-Path $modules 'CimCmdlets\CimCmdlets.psd1') -ErrorAction Stop
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$session=[Diagnostics.Process]::GetCurrentProcess().SessionId
$cim=@{}
foreach($item in @(Get-CimInstance Win32_Process -ErrorAction Stop)){$cim[[int]$item.ProcessId]=$item}
$services=@{}
foreach($service in @(Get-CimInstance Win32_Service -ErrorAction Stop)){if($service.ProcessId -gt 0){$services[[int]$service.ProcessId]=$true}}
$protected=@{}
$protected[$PID]=$true
foreach($seed in $request.protectPids){
  $currentId=[int]$seed
  for($depth=0;$depth -lt 32 -and $currentId -gt 0;$depth++){
    $protected[$currentId]=$true
    if(-not $cim.ContainsKey($currentId)){break}
    $parentId=[int]$cim[$currentId].ParentProcessId
    if($parentId -eq $currentId){break};$currentId=$parentId
  }
}
function Read-SafeProcess([int]$processId){
  $p=[Diagnostics.Process]::GetProcessById($processId)
  if($protected.ContainsKey($processId) -or $p.SessionId -ne $session){throw 'Vacuum, its host and other user sessions are protected.'}
  $info=$cim[$processId]
  if($null -eq $info){throw 'Process identity is unavailable.'}
  $exe=$p.MainModule.FileName
  $windows=[IO.Path]::GetFullPath($env:SystemRoot).TrimEnd('\')+'\'
  if($exe.StartsWith($windows,[StringComparison]::OrdinalIgnoreCase) -or $p.ProcessName -match '^(codex|chatgpt|MsMpEng|SecurityHealthService|SecurityHealthSystray|explorer|dwm|csrss|winlogon|lsass|services|svchost|smss|wininit|sihost|conhost|OpenConsole|WindowsTerminal|RuntimeBroker|SearchHost|StartMenuExperienceHost)$' -or $info.CommandLine -match '(?i)codex|chatgpt'){
    throw 'Windows, security and host processes are protected.'
  }
  $ancestor=$processId
  for($depth=0;$depth -lt 32 -and $ancestor -gt 0;$depth++){
    if($services.ContainsKey($ancestor)){throw 'Windows services and their child processes are protected.'}
    if(-not $cim.ContainsKey($ancestor)){break}
    $parent=[int]$cim[$ancestor].ParentProcessId
    if($parent -eq $ancestor){break};$ancestor=$parent
  }
  if([VacuumWindows]::OwnerSid($processId) -ne $identity){throw 'Only processes owned by the current user are available.'}
  return @{process=$p;exe=$exe;startedTicks=$p.StartTime.ToUniversalTime().Ticks.ToString();name=$p.ProcessName;pid=$processId}
}
if($request.operation -eq 'act'){
  $results=@()
  foreach($entry in $request.entries){
    try{
      $safe=Read-SafeProcess ([int]$entry.pid)
      if($safe.startedTicks -ne $entry.startedTicks -or -not $safe.exe.Equals([string]$entry.exe,[StringComparison]::OrdinalIgnoreCase)){throw 'Process changed since review. Refresh the review.'}
      $p=$safe.process
      if($request.mode -eq 'close'){
        if(-not [VacuumWindows]::RequestClose($safe.pid)){throw 'No enabled app window accepted a normal close request. Check for a save prompt.'}
        $results+=@{id=$entry.id;ok=$true;requested=$true;mode='close'}
      }elseif($request.mode -eq 'stop'){
        if([VacuumWindows]::HasWindow($safe.pid)){throw 'Use normal Close for apps with a window, so they can show save prompts.'}
        $exited=[VacuumWindows]::StopVerified($safe.pid,[string]$entry.startedTicks)
        $results+=@{id=$entry.id;ok=$exited;requested=$true;mode='stop'}
      }else{throw 'Unknown performance action.'}
    }catch{$results+=@{id=$entry.id;ok=$false;reason=$_.Exception.Message}}
  }
  @{results=$results} | ConvertTo-Json -Depth 8 -Compress
  exit
}
if($request.operation -ne 'inspect'){throw 'Unknown performance operation.'}
$cpu=@{}
$watch=[Diagnostics.Stopwatch]::StartNew()
foreach($p in [Diagnostics.Process]::GetProcesses()){
  try{$cpu[$p.Id]=@{value=$p.TotalProcessorTime.TotalMilliseconds;at=$watch.Elapsed.TotalMilliseconds;started=$p.StartTime.ToUniversalTime().Ticks.ToString()}}catch{}
}
Start-Sleep -Milliseconds 500
$cores=[Environment]::ProcessorCount
$processes=@()
$protectedCount=0
foreach($processId in @($cim.Keys)){
  try{
    $safe=Read-SafeProcess $processId
    $p=$safe.process
    $usage=0
    if($cpu.ContainsKey($processId) -and $cpu[$processId].started -eq $safe.startedTicks){$usage=[Math]::Max(0,[Math]::Min(100,($p.TotalProcessorTime.TotalMilliseconds-$cpu[$processId].value)/($watch.Elapsed.TotalMilliseconds-$cpu[$processId].at)/$cores*100))}
    $processes+=@{pid=$processId;name=$safe.name;exe=$safe.exe;commandLine=[string]$cim[$processId].CommandLine;startedTicks=$safe.startedTicks;memoryBytes=$p.WorkingSet64;cpuPercent=[Math]::Round($usage,2);canClose=[VacuumWindows]::HasWindow($processId)}
  }catch{$protectedCount++}
}
$listeners=@()
$networkAvailable=$true
try{
  Import-Module (Join-Path $modules 'NetTCPIP\NetTCPIP.psd1') -ErrorAction Stop
  foreach($port in @(Get-NetTCPConnection -ErrorAction Stop | Where-Object State -eq 'Listen')){
    $listeners+=@{pid=[int]$port.OwningProcess;protocol='TCP';address=[string]$port.LocalAddress;port=[int]$port.LocalPort}
  }
  foreach($port in @(Get-NetUDPEndpoint -ErrorAction Stop)){
    $listeners+=@{pid=[int]$port.OwningProcess;protocol='UDP';address=[string]$port.LocalAddress;port=[int]$port.LocalPort}
  }
}catch{$networkAvailable=$false;$listeners=@()}
$os=Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
$identities=@()
foreach($p in [Diagnostics.Process]::GetProcesses()){
  $ticks=$null;try{$ticks=$p.StartTime.ToUniversalTime().Ticks.ToString()}catch{}
  $identities+=@{pid=$p.Id;startedTicks=$ticks}
}
@{processes=$processes;identities=$identities;listeners=$listeners;networkAvailable=$networkAvailable;protectedCount=$protectedCount;memoryTotal=[long]$os.TotalVisibleMemorySize*1024;memoryAvailable=[long]$os.FreePhysicalMemory*1024;sampledAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 8 -Compress
