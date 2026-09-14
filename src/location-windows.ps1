$ErrorActionPreference = 'Stop'
$locationWatcher = $null
try {
    Add-Type -AssemblyName System.Device
    $locationWatcher = New-Object System.Device.Location.GeoCoordinateWatcher
    $locationDeadline = [DateTime]::UtcNow.AddSeconds(15)
    $started = $locationWatcher.TryStart($false, [TimeSpan]::FromSeconds(15))
    # Starting the service can succeed before its first position is available.
    while ($started -and $locationWatcher.Permission -ne 'Denied' -and $locationWatcher.Position.Location.IsUnknown -and [DateTime]::UtcNow -lt $locationDeadline) {
        Start-Sleep -Milliseconds 200
    }
    if ($locationWatcher.Permission -eq 'Denied') {
        @{ status = 'denied' } | ConvertTo-Json -Compress
    } elseif ($started -and -not $locationWatcher.Position.Location.IsUnknown) {
        $point = $locationWatcher.Position.Location
        $accuracy = $null
        if (-not [double]::IsNaN($point.HorizontalAccuracy) -and -not [double]::IsInfinity($point.HorizontalAccuracy)) { $accuracy = $point.HorizontalAccuracy }
        @{ status = 'available'; lat = $point.Latitude; lon = $point.Longitude; accuracy = $accuracy } | ConvertTo-Json -Compress
    } else {
        @{ status = 'unavailable' } | ConvertTo-Json -Compress
    }
} catch {
    @{ status = 'unavailable' } | ConvertTo-Json -Compress
} finally {
    if ($null -ne $locationWatcher) { $locationWatcher.Stop(); $locationWatcher.Dispose() }
}
