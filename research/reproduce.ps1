# Run from this research directory. Downloads are for static inspection only.
$ErrorActionPreference = 'Stop'
$researchRoot = $PSScriptRoot
$classicZip = Join-Path $researchRoot 'FluentCleaner-Classic-net48.zip'
$bleachZip = Join-Path $researchRoot 'BleachBit-6.0.6-portable.zip'
if (!(Test-Path -LiteralPath $classicZip)) {
    Invoke-WebRequest 'https://github.com/builtbybel/FluentCleaner/releases/download/26.09.01/FluentCleaner-Classic-net48.zip' -OutFile $classicZip
}
if (!(Test-Path -LiteralPath $bleachZip)) {
    Invoke-WebRequest 'https://github.com/bleachbit/bleachbit/releases/download/v6.0.6/BleachBit-6.0.6-portable.zip' -OutFile $bleachZip
}
if ((Get-FileHash -LiteralPath $classicZip).Hash -ne '42703E673CFF81EB9D2EC7F8EACAAF93FA009915FFCA40E54B63BA789D80FE85') { throw 'Classic archive hash mismatch' }
if ((Get-FileHash -LiteralPath $bleachZip).Hash -ne '285A53C01F95CF859250C1B612F27C2FF1247C5AF53EB8E8C6744B374F1ED19E') { throw 'BleachBit archive hash mismatch' }
$classicRoot = Join-Path $researchRoot 'fluent-classic'
if (!(Test-Path -LiteralPath $classicRoot)) { Expand-Archive -LiteralPath $classicZip -DestinationPath $classicRoot }
$corePath = Join-Path $classicRoot 'FluentCleaner-Classic-net48\FluentCleaner.Core.dll'
$exePath = Join-Path $classicRoot 'FluentCleaner-Classic-net48\FluentCleaner.Classic.exe'
rea inspect-managed-artifact $corePath --format json --full-output | Set-Content -Encoding utf8 (Join-Path $researchRoot 'fluent-core-artifact.json')
rea inspect-managed-members $corePath --format json --full-output | Set-Content -Encoding utf8 (Join-Path $researchRoot 'fluent-core-members.json')
rea inspect-managed-members $exePath --format json --full-output | Set-Content -Encoding utf8 (Join-Path $researchRoot 'fluent-classic-members.json')
rea inspect-artifact $bleachZip --format json --full-output | Set-Content -Encoding utf8 (Join-Path $researchRoot 'bleachbit-package.json')
