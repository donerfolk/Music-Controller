# Apple Music shuffle/repeat — UI Automation for playback bar buttons.
# Usage: apple-music-playback.ps1 shuffle | repeat | query

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('shuffle', 'repeat', 'query')]
    [string]$Action
)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct POINT { public int X; public int Y; }
public struct RECT { public int Left, Top, Right, Bottom; }
[StructLayout(LayoutKind.Sequential)]
public struct WINDOWPLACEMENT {
    public int length;
    public int flags;
    public int showCmd;
    public POINT ptMinPosition;
    public POINT ptMaxPosition;
    public RECT rcNormalPosition;
}
public class MusicWin32 {
    public const int SW_MINIMIZE = 6;
    public const uint SWP_NOSIZE = 0x0001;
    public const uint SWP_NOACTIVATE = 0x0010;
    public const uint SWP_NOZORDER = 0x0004;
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);
    [DllImport("user32.dll")] public static extern bool SetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr zero);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
}
"@

function Get-AppleMusicProcess {
    return Get-Process -Name 'AppleMusic', 'Music' -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Restore-ForegroundWindow([IntPtr]$hwnd) {
    if ($hwnd -eq [IntPtr]::Zero) { return }

    $fg = [MusicWin32]::GetForegroundWindow()
    if ($fg -eq $hwnd) { return }

    $fgThread = [MusicWin32]::GetWindowThreadProcessId($fg, [IntPtr]::Zero)
    $targetThread = [MusicWin32]::GetWindowThreadProcessId($hwnd, [IntPtr]::Zero)
    $attached = $false
    if ($fgThread -ne $targetThread) {
        $attached = [MusicWin32]::AttachThreadInput($fgThread, $targetThread, $true)
    }

    [void][MusicWin32]::SetForegroundWindow($hwnd)

    if ($attached) {
        [void][MusicWin32]::AttachThreadInput($fgThread, $targetThread, $false)
    }
}

function Invoke-WithoutWindowFlash([scriptblock]$Action) {
    $proc = Get-AppleMusicProcess
    if ($null -eq $proc -or $proc.MainWindowHandle -eq [IntPtr]::Zero) {
        & $Action
        return
    }

    $hwnd = $proc.MainWindowHandle
    $wasMinimized = [MusicWin32]::IsIconic($hwnd)
    $prevForeground = [MusicWin32]::GetForegroundWindow()
    $wasForeground = ($prevForeground -eq $hwnd)

    $placement = New-Object WINDOWPLACEMENT
    $placement.length = [System.Runtime.InteropServices.Marshal]::SizeOf($placement)
    [void][MusicWin32]::GetWindowPlacement($hwnd, [ref]$placement)

    # ponytail: UIA Toggle() restores the window; move off-screen first so nothing flashes on screen
    $posFlags = [MusicWin32]::SWP_NOSIZE -bor [MusicWin32]::SWP_NOACTIVATE -bor [MusicWin32]::SWP_NOZORDER
    [void][MusicWin32]::SetWindowPos($hwnd, [IntPtr]::Zero, -32000, -32000, 0, 0, $posFlags)

    try {
        & $Action
    } finally {
        [void][MusicWin32]::SetWindowPlacement($hwnd, [ref]$placement)
        if (-not $wasForeground -and -not $wasMinimized) {
            Restore-ForegroundWindow $prevForeground
        }
    }
}

function Get-PlaybackBar {
    $proc = Get-AppleMusicProcess
    if ($null -eq $proc -or $proc.MainWindowHandle -eq [IntPtr]::Zero) {
        return $null
    }

    $root = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
    $skipCond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty, 'Skip Forward')
    $skip = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $skipCond)
    if ($null -eq $skip) {
        return $null
    }

    return [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($skip)
}

function Find-BarButton([string]$NamePattern) {
    $bar = Get-PlaybackBar
    if ($null -eq $bar) { return $null }

    $children = $bar.FindAll(
        [System.Windows.Automation.TreeScope]::Children,
        [System.Windows.Automation.Condition]::TrueCondition)

    foreach ($child in $children) {
        if ($child.Current.ControlType.ProgrammaticName -ne 'ControlType.Button') { continue }
        $name = $child.Current.Name
        if ($name -notmatch $NamePattern) { continue }
        return $child
    }

    return $null
}

function Get-ToggleOn($element) {
    try {
        $toggle = $element.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
        if ($null -ne $toggle) {
            return $toggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On
        }
    } catch {}

    return $false
}

function Get-RepeatMode($element) {
    $name = $element.Current.Name
    if ($name -match 'one') { return 'one' }
    if ($name -match 'all') { return 'all' }
    if (Get-ToggleOn $element) { return 'all' }
    return 'off'
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
    $btn = Find-BarButton $NamePattern
    if ($null -eq $btn) {
        [Console]::Error.WriteLine("[apple-music-playback] No button matching '$NamePattern'")
        exit 1
    }

    if (Invoke-Element $btn) { return }

    [Console]::Error.WriteLine("[apple-music-playback] Button '$($btn.Current.Name)' could not be activated")
    exit 1
}

function Get-PlaybackState {
    $shuffle = $false
    $repeat = 'off'

    $shuffleBtn = Find-BarButton '^Shuffle$'
    if ($null -ne $shuffleBtn) { $shuffle = Get-ToggleOn $shuffleBtn }

    $repeatBtn = Find-BarButton 'Repeat|Do Not Repeat'
    if ($null -ne $repeatBtn) { $repeat = Get-RepeatMode $repeatBtn }

    return @{ shuffle = $shuffle; repeat = $repeat }
}

switch ($Action) {
    'shuffle' { Invoke-WithoutWindowFlash { Invoke-BarButton '^Shuffle$' } }
    'repeat'  { Invoke-WithoutWindowFlash { Invoke-BarButton 'Repeat|Do Not Repeat' } }
    'query'   {
        $state = Get-PlaybackState
        $state | ConvertTo-Json -Compress
    }
}
