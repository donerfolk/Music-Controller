# Apple Music shuffle/repeat — toggles playback bar buttons via UI Automation.
# Usage: apple-music-playback.ps1 shuffle | repeat

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('shuffle', 'repeat')]
    [string]$Action
)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Get-PlaybackBar {
    $proc = Get-Process -Name 'AppleMusic', 'Music' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $proc -or $proc.MainWindowHandle -eq [IntPtr]::Zero) {
        [Console]::Error.WriteLine('[apple-music-playback] Apple Music not found')
        exit 1
    }

    $root = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
    $skipCond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty, 'Skip Forward')
    $skip = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $skipCond)
    if ($null -eq $skip) {
        [Console]::Error.WriteLine('[apple-music-playback] Playback bar not found')
        exit 1
    }

    return [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($skip)
}

function Invoke-Element($element) {
    try {
        $toggle = $element.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
        if ($null -ne $toggle) {
            $toggle.Toggle()
            return $true
        }
    } catch {}

    try {
        $invoke = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        if ($null -ne $invoke) {
            $invoke.Invoke()
            return $true
        }
    } catch {}

    return $false
}

function Invoke-BarButton([string]$NamePattern) {
    $bar = Get-PlaybackBar
    $children = $bar.FindAll(
        [System.Windows.Automation.TreeScope]::Children,
        [System.Windows.Automation.Condition]::TrueCondition)

    foreach ($child in $children) {
        if ($child.Current.ControlType.ProgrammaticName -ne 'ControlType.Button') { continue }
        $name = $child.Current.Name
        if ($name -notmatch $NamePattern) { continue }

        if (Invoke-Element $child) { return }

        [Console]::Error.WriteLine("[apple-music-playback] Button '$name' could not be activated")
        exit 1
    }

    [Console]::Error.WriteLine("[apple-music-playback] No button matching '$NamePattern'")
    exit 1
}

switch ($Action) {
    'shuffle' { Invoke-BarButton '^Shuffle$' }
    'repeat'  { Invoke-BarButton 'Repeat' }
}
