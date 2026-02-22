param(
    [string[]]$Roots = @("game", "public", "server.js"),
    [string[]]$Extensions = @(".js", ".json", ".html", ".css", ".md")
)

$ErrorActionPreference = "Stop"

function New-Pattern([int[]]$codes) {
    return -join ($codes | ForEach-Object { [char]$_ })
}

$utf8Strict = [System.Text.UTF8Encoding]::new($false, $true)
$replacementChar = [char]0xFFFD

# Typical mojibake prefixes (UTF-8 interpreted as CP1252/Latin-1).
$patterns = @(
    @{ Name = "A-tilde prefix"; Pattern = New-Pattern @(0x00C3) },
    @{ Name = "Euro-prefix mojibake"; Pattern = New-Pattern @(0x00E2, 0x20AC) },
    @{ Name = "NBSP prefix"; Pattern = New-Pattern @(0x00C2, 0x00A0) },
    @{ Name = "Space prefix"; Pattern = New-Pattern @(0x00C2, 0x0020) }
)

$errors = @()

foreach ($root in $Roots) {
    if (-not (Test-Path $root)) { continue }

    $items = @()
    if ((Get-Item $root).PSIsContainer) {
        $items = Get-ChildItem -Path $root -Recurse -File | Where-Object { $Extensions -contains $_.Extension }
    } else {
        $items = @(Get-Item $root)
    }

    foreach ($item in $items) {
        $bytes = [System.IO.File]::ReadAllBytes($item.FullName)
        $text = $null

        try {
            $text = $utf8Strict.GetString($bytes)
        } catch {
            $errors += ("{0} is not valid UTF-8 ({1})" -f $item.FullName, $_.Exception.Message)
            continue
        }

        if ($text.Contains($replacementChar)) {
            $errors += ("{0} contains replacement chars (U+FFFD)" -f $item.FullName)
            continue
        }

        foreach ($entry in $patterns) {
            if ($text.Contains($entry.Pattern)) {
                $errors += ("{0} contains suspicious sequence [{1}] ({2})" -f $item.FullName, $entry.Pattern, $entry.Name)
                break
            }
        }
    }
}

if ($errors.Count -gt 0) {
    Write-Host "[MOJIBAKE-CHECK] FAILED" -ForegroundColor Red
    $errors | ForEach-Object { Write-Host (" - {0}" -f $_) -ForegroundColor Red }
    exit 1
}

Write-Host "[MOJIBAKE-CHECK] OK" -ForegroundColor Green
exit 0
