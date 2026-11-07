'use strict';
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const readline = require('readline');

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*'
} | Select-Object -First 1
function Await($op, [Type]$t) {
  $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op))
  [void]$task.Wait(5000)
  return $task.Result
}
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
# reads a cover image stream (called through reflection - see the art code below)
$asStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))
$T = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$mgr = Await ($T::RequestAsync()) $T

# the current media session - never Hyperfocus itself
function Pick() {
  $cur = $mgr.GetCurrentSession()
  if ($cur -and $cur.SourceAppUserModelId -notmatch 'hyperfocus') { return $cur }
  $all = @($mgr.GetSessions() | Where-Object { $_.SourceAppUserModelId -notmatch 'hyperfocus' })
  $playing = $all | Where-Object { [string]$_.GetPlaybackInfo().PlaybackStatus -eq 'Playing' } | Select-Object -First 1
  if ($playing) { return $playing }
  return ($all | Select-Object -First 1)
}

# commands from the launcher (a real async reader - Console.In would block)
$stdin = New-Object System.IO.StreamReader ([Console]::OpenStandardInput())
$pending = $stdin.ReadLineAsync()
$lastArt = $null
$lastKey = ''
$lastSent = [DateTime]::MinValue

while ($true) {
  $force = $false
  while ($pending.IsCompleted) {
    $cmd = $pending.Result
    if ($null -eq $cmd) { exit }   # the launcher went away
    try {
      $s = Pick
      if ($s) {
        switch ($cmd.Trim()) {
          'playpause' { [void](Await ($s.TryTogglePlayPauseAsync()) ([bool])) }
          'next' { [void](Await ($s.TrySkipNextAsync()) ([bool])) }
          'prev' { [void](Await ($s.TrySkipPreviousAsync()) ([bool])) }
        }
      }
    } catch {}
    $pending = $stdin.ReadLineAsync()
    $force = $true
    Start-Sleep -Milliseconds 250   # let the player catch up before we look again
  }

  $o = [ordered]@{ active = $false }
  try {
    $s = Pick
    if ($s) {
      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $pb = $s.GetPlaybackInfo()
      $tl = $s.GetTimelineProperties()
      $o.active = $true
      $o.app = [string]$s.SourceAppUserModelId
      $o.status = [string]$pb.PlaybackStatus
      $o.title = [string]$p.Title
      $o.artist = [string]$p.Artist
      $o.album = [string]$p.AlbumTitle
      $o.position = [math]::Round($tl.Position.TotalSeconds, 1)
      $o.duration = [math]::Round(($tl.EndTime - $tl.StartTime).TotalSeconds, 1)
      $o.updatedAt = $tl.LastUpdatedTime.ToUnixTimeMilliseconds()
      $o.canPrev = [bool]$pb.Controls.IsPreviousEnabled
      $o.canNext = [bool]$pb.Controls.IsNextEnabled
      $o.canToggle = [bool]$pb.Controls.IsPlayPauseToggleEnabled
      $o.artKey = $o.app + '|' + $o.title + '|' + $o.artist + '|' + $o.album
      if ($o.artKey -ne $lastArt) {   # the cover only travels when the song changes
        $lastArt = $o.artKey
        $o.art = ''
        if ($p.Thumbnail) {
          try {
            # PowerShell 5 can't see the stream's own members (it's a bare COM object),
            # so everything goes through reflection, which does the interface cast for us
            $stream = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
            $ctype = [string][Windows.Storage.Streams.IContentTypeProvider].GetProperty('ContentType').GetValue($stream)
            if (-not $ctype) { $ctype = 'image/png' }
            $net = $asStreamForRead.Invoke($null, @($stream))
            $ms = New-Object System.IO.MemoryStream
            $net.CopyTo($ms)
            if ($ms.Length -gt 0 -and $ms.Length -lt 4MB) {
              $o.art = 'data:' + $ctype + ';base64,' + [Convert]::ToBase64String($ms.ToArray())
            }
            $net.Dispose()
            $ms.Dispose()
          } catch { $o.art = '' }
        }
      }
    }
  } catch { $o = [ordered]@{ active = $false; error = [string]$_.Exception.Message } }

  $line = $o | ConvertTo-Json -Compress
  $key = ($line -replace '"position":[-0-9.]+,', '') -replace '"updatedAt":[-0-9]+,', ''
  # send when something changed, after a command, or every few seconds (keeps the bar honest)
  if ($force -or $o.Contains('art') -or $key -ne $lastKey -or ([DateTime]::Now - $lastSent).TotalSeconds -ge 4) {
    [Console]::Out.WriteLine($line)
    [Console]::Out.Flush()
    $lastKey = $key
    $lastSent = [DateTime]::Now
  }
  for ($i = 0; $i -lt 10 -and -not $pending.IsCompleted; $i++) { Start-Sleep -Milliseconds 100 }
}
`;
const ENCODED = Buffer.from(SCRIPT, 'utf16le').toString('base64');

class MediaControls extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.wanted = false;
    this.state = { active: false };
    this.art = { key: '', url: '' };
    this.fails = 0;
    this.retry = null;
  }
  start() {
    this.wanted = true;
    if (this.proc || process.platform !== 'win32') return;
    clearTimeout(this.retry);
    const p = this.proc = spawn('powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', ENCODED],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    p.on('error', () => {});
    p.stdin.on('error', () => {});
    readline.createInterface({ input: p.stdout }).on('line', line => this.onLine(line));
    p.on('exit', () => {
      if (this.proc !== p) return;
      this.proc = null;
      if (this.wanted && this.fails++ < 5) this.retry = setTimeout(() => this.start(), 3000);
    });
  }
  stop() {
    this.wanted = false;
    clearTimeout(this.retry);
    const p = this.proc;
    this.proc = null;
    if (!p) return;
    try { p.stdin.end(); } catch {}
    setTimeout(() => { try { p.kill(); } catch {} }, 1500);
  }
  onLine(line) {
    let s;
    try { s = JSON.parse(line); } catch { return; }
    this.fails = 0;
    if (s.active) {
      if (typeof s.art === 'string') this.art = { key: s.artKey, url: s.art };
      s.art = this.art.key === s.artKey ? this.art.url : '';
      delete s.artKey;
    }
    this.state = s;
    this.emit('update', s);
  }
  command(cmd) {
    if (!['playpause', 'next', 'prev'].includes(cmd) || !this.proc) return false;
    try { this.proc.stdin.write(`${cmd}\n`); return true; } catch { return false; }
  }
}

module.exports = { MediaControls };
