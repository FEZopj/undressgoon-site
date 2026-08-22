$ErrorActionPreference = 'Stop'

$siteRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$assetRoot = Join-Path $siteRoot 'assets'
$sources = @(
    'site.css',
    'scenes.css',
    'lp2.css',
    'conversion-r7.css'
)

$output = New-Object System.Text.StringBuilder
foreach ($source in $sources) {
    $path = Join-Path $assetRoot $source
    [void]$output.AppendLine("/* bundled from $source */")
    [void]$output.AppendLine([System.IO.File]::ReadAllText($path))
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText(
    (Join-Path $assetRoot 'landing.css'),
    $output.ToString(),
    $utf8NoBom
)
