# Apple Music shuffle/repeat — keyboard access keys (SMTC does not support these).
# Usage: apple-music-playback.ps1 shuffle | repeat

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('shuffle', 'repeat')]
    [string]$Action
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class AppleMusicWin32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

function Send-AppleMusicAccessKey([string]$Key) {
    $proc = Get-Process -Name 'AppleMusic', 'Music' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $proc -or $proc.MainWindowHandle -eq [IntPtr]::Zero) {
        [Console]::Error.WriteLine('[apple-music-playback] Apple Music not found')
        exit 1
    }

    [void][AppleMusicWin32]::ShowWindow($proc.MainWindowHandle, 5)
    [void][AppleMusicWin32]::SetForegroundWindow($proc.MainWindowHandle)
    Start-Sleep -Milliseconds 120

    # Access keys: Alt, L, then S (shuffle) or R (repeat)
    [System.Windows.Forms.SendKeys]::SendWait('%')
    Start-Sleep -Milliseconds 40
    [System.Windows.Forms.SendKeys]::SendWait('l')
    Start-Sleep -Milliseconds 40
    [System.Windows.Forms.SendKeys]::SendWait($Key)
}

switch ($Action) {
    'shuffle' { Send-AppleMusicAccessKey 's' }
    'repeat'  { Send-AppleMusicAccessKey 'r' }
}
