$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$request=[Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class VacuumAllocation {
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetCompressedFileSizeW(string path,out uint high);
  [DllImport("kernel32.dll")] static extern void SetLastError(uint error);
  public static long Bytes(string path) { SetLastError(0);uint high;uint low=GetCompressedFileSizeW(path,out high);int error=Marshal.GetLastWin32Error();if(low==uint.MaxValue&&error!=0)throw new System.ComponentModel.Win32Exception(error);return checked((long)(((ulong)high<<32)|low)); }
  public static string Hash(string path) { using(var file=System.IO.File.Open(path,System.IO.FileMode.Open,System.IO.FileAccess.Read,System.IO.FileShare.Read)) using(var hash=System.Security.Cryptography.SHA256.Create()) { return BitConverter.ToString(hash.ComputeHash(file)).Replace("-","").ToLowerInvariant(); } }
}
'@
$results=@()
foreach($entry in $request.entries){
  try {
    $file=Get-Item -LiteralPath $entry.path -Force
    if($file.PSIsContainer) { throw 'Only ordinary files can be compacted.' }
    $ancestor=$file
    while($null -ne $ancestor){if(($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0){throw 'Linked files and folders are protected.'};$ancestor=if($ancestor -is [IO.FileInfo]){$ancestor.Directory}else{$ancestor.Parent}}
    $drive=New-Object IO.DriveInfo([IO.Path]::GetPathRoot($file.FullName))
    if($drive.DriveFormat -ne 'NTFS'){throw 'Reversible compression requires a local NTFS drive.'}
    $mtime=([DateTimeOffset]$file.LastWriteTimeUtc).ToUnixTimeMilliseconds()
    if($file.Length -ne $entry.size -or $mtime -ne [Math]::Floor($entry.mtimeMs)){throw 'File changed before compression.'}
    $hashBefore=[VacuumAllocation]::Hash($file.FullName)
    $before=[VacuumAllocation]::Bytes($file.FullName)
    $wasCompressed=($file.Attributes -band [IO.FileAttributes]::Compressed)-ne 0
    $flag=if($request.compress){'/C'}else{'/U'}
    $output=& "$env:SystemRoot\System32\compact.exe" $flag /A /Q $file.FullName 2>&1 | Out-String
    if($LASTEXITCODE -ne 0){throw 'Windows could not change file compression.'}
    $after=[VacuumAllocation]::Bytes($file.FullName)
    $changed=Get-Item -LiteralPath $file.FullName -Force
    $compressed=($changed.Attributes -band [IO.FileAttributes]::Compressed)-ne 0
    if($request.compress -and -not $wasCompressed -and $after -ge $before){
      $null=& "$env:SystemRoot\System32\compact.exe" /U /A /Q $file.FullName 2>&1
      if($LASTEXITCODE -ne 0){throw 'The file did not save space; Windows could not undo the compression automatically.'}
      $after=[VacuumAllocation]::Bytes($file.FullName);$compressed=$false
    }
    $hashAfter=[VacuumAllocation]::Hash($file.FullName)
    if($hashBefore -ne $hashAfter){throw 'Contents changed during the operation. File retained for review.'}
    $results+=@{id=$entry.id;ok=$true;beforeBytes=$before;afterBytes=$after;wasCompressed=$wasCompressed;compressed=$compressed;verified=$true;sha256=$hashAfter.ToLowerInvariant()}
  }catch{$results+=@{id=$entry.id;ok=$false;reason=$_.Exception.Message}}
}
@{files=$results} | ConvertTo-Json -Depth 6 -Compress
