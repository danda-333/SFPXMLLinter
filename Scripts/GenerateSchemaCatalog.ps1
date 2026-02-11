param(
  [string]$SchemasDir = "Docs/Schemas"
)

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
  if ($PSScriptRoot) {
    return Split-Path -Path $PSScriptRoot -Parent
  }

  return (Get-Location).Path
}

function Get-SafeNamespaceFilePart {
  param([string]$Namespace)

  $safe = $Namespace -replace "^https?://", ""
  $safe = $safe -replace "[^A-Za-z0-9]+", "_"
  $safe = $safe.Trim("_").ToLowerInvariant()
  if ([string]::IsNullOrWhiteSpace($safe)) {
    return "namespace"
  }

  return $safe
}

$repoRoot = Get-RepoRoot
$schemasPath = Join-Path $repoRoot $SchemasDir
if (-not (Test-Path $schemasPath)) {
  throw "Schemas directory was not found: $schemasPath"
}

$generatedPath = Join-Path $schemasPath "_generated"
New-Item -ItemType Directory -Path $generatedPath -Force | Out-Null

# Clean previously generated namespace bundles.
Get-ChildItem -Path $generatedPath -Filter "ns-*.xsd" -File -ErrorAction SilentlyContinue | Remove-Item -Force

$xsdFiles = Get-ChildItem -Path $schemasPath -Filter "*.xsd" -File | Sort-Object Name
$groupedByNamespace = @{}

foreach ($xsd in $xsdFiles) {
  $raw = Get-Content -Path $xsd.FullName -Raw
  if ($raw -match 'targetNamespace\s*=\s*"([^"]+)"') {
    $ns = $matches[1]
    if (-not $groupedByNamespace.ContainsKey($ns)) {
      $groupedByNamespace[$ns] = New-Object System.Collections.ArrayList
    }

    [void]$groupedByNamespace[$ns].Add($xsd.Name)
  }
}

$entries = @()
$index = 1
foreach ($namespace in ($groupedByNamespace.Keys | Sort-Object)) {
  $filesForNamespace = @($groupedByNamespace[$namespace] | Sort-Object)
  $safePart = Get-SafeNamespaceFilePart -Namespace $namespace
  $bundleName = ("ns-{0:D2}-{1}.xsd" -f $index, $safePart)
  $bundlePath = Join-Path $generatedPath $bundleName

  $lines = New-Object System.Collections.Generic.List[string]
  [void]$lines.Add('<?xml version="1.0" encoding="utf-8"?>')
  [void]$lines.Add('<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"')
  [void]$lines.Add(("           targetNamespace=""{0}""" -f $namespace))
  [void]$lines.Add(("           xmlns=""{0}""" -f $namespace))
  [void]$lines.Add('           elementFormDefault="qualified">')
  [void]$lines.Add("")
  [void]$lines.Add("  <!-- Auto-generated aggregate schema for namespace imports -->")
  foreach ($schemaFile in $filesForNamespace) {
    [void]$lines.Add(("  <xs:include schemaLocation=""../{0}"" />" -f $schemaFile))
  }
  [void]$lines.Add("")
  [void]$lines.Add("</xs:schema>")
  [void]$lines.Add("")

  Set-Content -Path $bundlePath -Value $lines -Encoding UTF8

  $entries += [pscustomobject]@{
    Namespace = $namespace
    File = $bundleName
    IncludedSchemas = $filesForNamespace.Count
  }

  $index++
}

$catalogPath = Join-Path $schemasPath "catalog.xml"
$catalogLines = New-Object System.Collections.Generic.List[string]
[void]$catalogLines.Add('<?xml version="1.0" encoding="UTF-8"?>')
[void]$catalogLines.Add('<catalog xmlns="urn:oasis:names:tc:entity:xmlns:xml:catalog">')
[void]$catalogLines.Add("  <!-- Auto-generated for XML by Red Hat (LemMinX). -->")
foreach ($entry in $entries) {
  [void]$catalogLines.Add(("  <uri name=""{0}"" uri=""_generated/{1}""/>" -f $entry.Namespace, $entry.File))
}
[void]$catalogLines.Add("</catalog>")
[void]$catalogLines.Add("")

Set-Content -Path $catalogPath -Value $catalogLines -Encoding UTF8

Write-Host ("Generated {0} namespace bundles in {1}" -f $entries.Count, $generatedPath)
Write-Host ("Updated catalog: {0}" -f $catalogPath)
foreach ($entry in $entries) {
  Write-Host (" - {0} -> {1} ({2} files)" -f $entry.Namespace, $entry.File, $entry.IncludedSchemas)
}
