$ErrorActionPreference='Stop'
$request=[Console]::In.ReadToEnd() | ConvertFrom-Json
$original=[IO.Path]::GetFullPath($request.originalPath)
$originalFolder=[IO.Path]::GetDirectoryName($original)
$originalName=[IO.Path]::GetFileName($original)
$storageFixture=$originalFolder -match '\\vacuum-storage-proof-[^\\]+\\temp$'
$browserFixture=($originalFolder -match '\\vacuum-browser-proof-[^\\]+\\local\\(?:Google\\Chrome|Microsoft\\Edge)\\User Data\\Default\\Cache\\Cache_Data$') -and $originalName -eq 'vacuum-browser-cache-proof.bin'
if (-not ($storageFixture -or $browserFixture)) { throw 'This verification helper only accepts its isolated proof fixture.' }
$shell=New-Object -ComObject Shell.Application
$bin=$shell.Namespace(10)
$match=$null
foreach($item in $bin.Items()) {
  if ($item.ExtendedProperty('System.Recycle.DeletedFrom') -ne $originalFolder) { continue }
  if ($item.Name -ne $originalName -and $item.ExtendedProperty('System.FileName') -ne $originalName) { continue }
  if ($null -ne $match) { throw 'Ambiguous recycled fixture; nothing restored.' }
  $match=$item
}
if($null -eq $match) { throw 'The exact fixture was not found in Windows Recycle Bin.' }
$recycledPath=$match.Path
if($request.action -eq 'restore') {
  if([IO.File]::Exists($original)) { throw 'The original path is occupied. Nothing overwritten.' }
  $match.InvokeVerb('undelete')
  $deadline=[DateTime]::UtcNow.AddSeconds(8)
  while(-not [IO.File]::Exists($original) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
  if(-not [IO.File]::Exists($original)) { throw 'Windows has not restored the fixture.' }
}
@{recycledPath=$recycledPath;restored=($request.action -eq 'restore')} | ConvertTo-Json -Compress
