# ============================================================================
# Tadori AI relay  (Pure PowerShell, no Python)
# ============================================================================
#
# ブラウザ (Tadori bookmarklet) から社内 AI ゲートウェイ / Azure OpenAI 互換
# エンドポイントを、オンプレ プロキシ経由で呼び出すための、ローカルで動く
# 小さな HTTP リレー。Spira の spira-ai-relay.ps1 から AI 中継部分のみを
# 流用（Outlook COM 操作は Tadori では不要なので除外）。
#
# なぜ必要か
# ----------
# ブラウザの fetch() は環境変数 HTTP_PROXY / HTTPS_PROXY を読まないし、
# Fetch API の仕様でプロキシを per-request で指定する方法もない。よって
# bookmarklet から「社内 AI ゲートウェイには必ず社内プロキシ経由で行く」
# というルーティングを直接表現できない。
#
#   Tadori (browser) --HTTP--> http://127.0.0.1:18080 --HTTPS via proxy--> gateway
#
# ブラウザは loopback には到達できる (プロキシ判定はループバックを除外)。
# PS 側は HttpClient で proxy を指定できる。
#
# 使い方
# ------
#   PS> Copy-Item tadori-ai-relay.env.example tadori-ai-relay.env
#   PS> notepad tadori-ai-relay.env       # 値を編集
#   PS> .\tadori-ai-relay.ps1
#
#   # または引数で個別に上書き:
#   PS> .\tadori-ai-relay.ps1 -Target 'https://...' -Proxy 'http://...:8080'
#
# 設定の優先順位:
#   1. コマンドライン引数 (-Target / -Proxy / -Port)
#   2. プロセス環境変数 (TADORI_AI_TARGET 等)
#   3. tadori-ai-relay.env ファイル (同じフォルダ)
#   4. デフォルト値 (port = 18080)
#
# 埋め込み呼び出し例 (Tadori runtime / PoC からはこの localhost を叩く):
#   POST http://localhost:18080/openai/deployments/text-embedding-3-small/embeddings?api-version=2024-02-01
#   ヘッダ: api-key: <サブスクリプションキー>
#
# 必要環境: Windows PowerShell 5.1 以上 / PowerShell 7+。Python 不要。
# 注: HttpListener が 127.0.0.1 で listen するので管理者権限は不要。
# ============================================================================

[CmdletBinding()]
param(
    [string]$Target,
    [string]$Proxy,
    [int]$Port,
    [switch]$NoProxy,
    # 社内ゲートウェイが自己署名証明書の場合 (要セキュリティ承認)
    [switch]$SkipCertCheck,
    # 環境設定ファイルのパス (既定: スクリプトと同じフォルダの tadori-ai-relay.env)
    [string]$EnvFile
)

$ErrorActionPreference = 'Stop'

# ─── Load .env file ─────────────────────────────────────────────────────────
# 同じフォルダの `tadori-ai-relay.env` を読み、まだ設定されていない
# `$env:TADORI_AI_*` だけセットする。引数 / 既存 env を優先 (上書きしない)。
# `.env` 書式は KEY=VALUE。`#` 始まりと空行は無視。前後クォートは剥がす。

function Import-EnvFile {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    try {
        $lines = Get-Content -LiteralPath $Path -Encoding UTF8 -ErrorAction Stop
    } catch {
        Write-Warning ".env ファイルを読めませんでした: $Path ($($_.Exception.Message))"
        return $false
    }
    foreach ($raw in $lines) {
        $line = $raw.Trim()
        if (-not $line) { continue }
        if ($line.StartsWith('#')) { continue }
        $eq = $line.IndexOf('=')
        if ($eq -lt 1) { continue }
        $key = $line.Substring(0, $eq).Trim()
        $val = $line.Substring($eq + 1).Trim()
        if ($val -notmatch '^["'']') {
            $hashIdx = $val.IndexOf(' #')
            if ($hashIdx -ge 0) { $val = $val.Substring(0, $hashIdx).TrimEnd() }
        }
        if (($val.StartsWith('"') -and $val.EndsWith('"')) -or
            ($val.StartsWith("'") -and $val.EndsWith("'"))) {
            $val = $val.Substring(1, $val.Length - 2)
        }
        if (-not [Environment]::GetEnvironmentVariable($key)) {
            [Environment]::SetEnvironmentVariable($key, $val)
        }
    }
    return $true
}

if (-not $EnvFile) {
    $EnvFile = Join-Path $PSScriptRoot 'tadori-ai-relay.env'
}
$loaded = Import-EnvFile -Path $EnvFile
if ($loaded) {
    Write-Host "[config] loaded: $EnvFile" -ForegroundColor DarkGray
}

# 引数 → 環境変数 → デフォルト の順で確定
if (-not $Target) { $Target = $env:TADORI_AI_TARGET }
if (-not $Proxy)  { $Proxy  = $env:TADORI_AI_PROXY }
if (-not $Port)   {
    $Port = if ($env:TADORI_AI_PORT) { [int]$env:TADORI_AI_PORT } else { 18080 }
}
if (-not $SkipCertCheck -and $env:TADORI_AI_SKIP_CERT_CHECK -eq '1') {
    $SkipCertCheck = [switch]$true
}

# ─── Pre-flight checks ──────────────────────────────────────────────────────

if (-not $Target) {
    Write-Host 'エラー: AI gateway URL (-Target / TADORI_AI_TARGET) が未指定です。' -ForegroundColor Red
    Write-Host '  Tadori relay は AI 中継専用です。tadori-ai-relay.env に TADORI_AI_TARGET を設定してください。'
    exit 1
}

if (-not $NoProxy -and -not $Proxy) {
    Write-Host '警告: プロキシが未指定です。直接接続を試みます (社内環境では失敗する可能性が高いです)。' -ForegroundColor Yellow
}

# ─── HttpClient setup ───────────────────────────────────────────────────────

Add-Type -AssemblyName System.Net.Http | Out-Null

$handler = New-Object System.Net.Http.HttpClientHandler
$handler.AllowAutoRedirect = $true
$handler.AutomaticDecompression = [System.Net.DecompressionMethods]::None  # SSE のため未解凍で流す

if (-not $NoProxy -and $Proxy) {
    $handler.Proxy = New-Object System.Net.WebProxy($Proxy, $true)  # bypassOnLocal=true
    $handler.UseProxy = $true
}
else {
    $handler.UseProxy = $false
}

if ($SkipCertCheck) {
    # ⚠ 本番運用では不可。検証用のみ。
    $handler.ServerCertificateCustomValidationCallback =
        [System.Net.Http.HttpClientHandler]::DangerousAcceptAnyServerCertificateValidator
}

$client = New-Object System.Net.Http.HttpClient($handler)
$client.Timeout = [TimeSpan]::FromMinutes(10)

# ─── Target URL parsing ─────────────────────────────────────────────────────

$Target = $Target.TrimEnd('/')
$targetUri = [Uri]$Target
$targetPath = $targetUri.AbsolutePath
if ($targetPath -eq '/') { $targetPath = '' }

# ─── HttpListener setup ─────────────────────────────────────────────────────

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
try {
    $listener.Start()
}
catch {
    Write-Host ''
    Write-Host "エラー: ポート $Port を listen できませんでした。" -ForegroundColor Red
    Write-Host "  - 別プロセスが同じポートを使っている可能性 (Get-NetTCPConnection -LocalPort $Port)"
    Write-Host '  - または別ポートを -Port 引数で指定してください'
    Write-Host "詳細: $($_.Exception.Message)"
    exit 1
}

$baseUrlShort  = "http://localhost:$Port"
$baseUrlMirror = if ($targetPath) { "$baseUrlShort$targetPath" } else { $baseUrlShort }

Write-Host ('-' * 72)
Write-Host '  Tadori AI relay (PowerShell)'
Write-Host ('-' * 72)
Write-Host "  listen  : http://127.0.0.1:$Port"
Write-Host "  target  : $Target"
Write-Host "  proxy   : $(if ($NoProxy -or -not $Proxy) { '(直接接続)' } else { $Proxy })"
if ($SkipCertCheck) { Write-Host '  SSL 検証スキップ中 (-SkipCertCheck)' -ForegroundColor Yellow }
Write-Host ('-' * 72)
Write-Host 'エンドポイント:'
Write-Host "  GET  $baseUrlShort/tadori/health   (死活確認)"
Write-Host "  *    $baseUrlShort/...              (上記以外は target へ透過 forward)"
Write-Host ''
Write-Host 'Tadori runtime / PoC のベース URL に下記を入力:'
Write-Host "  A: $baseUrlShort"
if ($baseUrlShort -ne $baseUrlMirror) {
    Write-Host "  B: $baseUrlMirror    (実 URL のパスを保ったまま localhost に置換)"
}
Write-Host ('-' * 72)
Write-Host 'Ctrl+C で終了' -ForegroundColor DarkGray
Write-Host ''

# ─── CORS helper ────────────────────────────────────────────────────────────

function Add-CorsHeaders {
    param([System.Net.HttpListenerResponse]$Response)
    # bookmarklet は SharePoint オリジンから動くので明示許可。listen は
    # loopback だけなので `*` でも外部から到達できず安全。
    $Response.Headers.Add('Access-Control-Allow-Origin', '*')
    $Response.Headers.Add('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    $Response.Headers.Add(
        'Access-Control-Allow-Headers',
        'Content-Type, api-key, Accept, Authorization, X-Requested-With, x-api-key'
    )
    $Response.Headers.Add('Access-Control-Max-Age', '86400')
}

# ─── helpers ────────────────────────────────────────────────────────────────

function Send-Error {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [int]$Status,
        [string]$Code,
        [string]$Detail
    )
    $payload = (@{ error = @{ code = $Code; detail = $Detail } } | ConvertTo-Json -Compress -Depth 4)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
    try {
        $Response.StatusCode = $Status
        Add-CorsHeaders -Response $Response
        $Response.ContentType = 'application/json; charset=utf-8'
        $Response.ContentLength64 = $bytes.Length
        $Response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    catch { }
    finally { try { $Response.OutputStream.Close() } catch { } }
}

function Send-Json {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [int]$Status,
        [object]$Body
    )
    $json  = ($Body | ConvertTo-Json -Compress -Depth 6)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    try {
        $Response.StatusCode    = $Status
        Add-CorsHeaders -Response $Response
        $Response.ContentType   = 'application/json; charset=utf-8'
        $Response.ContentLength64 = $bytes.Length
        $Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch { }
    finally { try { $Response.OutputStream.Close() } catch { } }
}

# ─── Request handler ────────────────────────────────────────────────────────

function Invoke-RelayRequest {
    param([System.Net.HttpListenerContext]$Context)

    $request  = $Context.Request
    $response = $Context.Response
    $method   = $request.HttpMethod.ToUpper()
    $ts       = (Get-Date).ToString('HH:mm:ss')
    Write-Host ("[{0}] {1} {2}" -f $ts, $method, $request.Url.PathAndQuery)

    # ── CORS preflight ──
    if ($method -eq 'OPTIONS') {
        $response.StatusCode = 204
        Add-CorsHeaders -Response $response
        $response.OutputStream.Close()
        return
    }

    # ── ローカル機能: 死活確認 ──
    $path = $request.Url.AbsolutePath
    if ($path -eq '/tadori/health') {
        Send-Json -Response $response -Status 200 -Body @{ ok = $true; relay = 'tadori-ai-relay'; version = 1 }
        return
    }

    # ── Compose upstream URL ──
    # bookmarklet 側で baseUrl に target のパスを含めても含めなくても OK に
    # するため、incoming path 先頭が targetPath と一致したら剥がす。
    $incoming = $request.Url.PathAndQuery
    $rel = $incoming
    if ($targetPath -and $rel.StartsWith($targetPath)) {
        $rel = $rel.Substring($targetPath.Length)
        if (-not $rel) { $rel = '/' }
    }
    $upstreamUrl = $Target + $rel

    # ── Build HttpRequestMessage ──
    $httpMethod = New-Object System.Net.Http.HttpMethod($method)
    $msg = New-Object System.Net.Http.HttpRequestMessage($httpMethod, $upstreamUrl)

    if ($request.HasEntityBody) {
        $ms = New-Object System.IO.MemoryStream
        $request.InputStream.CopyTo($ms)
        $bodyBytes = $ms.ToArray()
        $ms.Dispose()
        $content = New-Object System.Net.Http.ByteArrayContent($bodyBytes, 0, $bodyBytes.Length)
        if ($request.ContentType) {
            try {
                $content.Headers.ContentType =
                    [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse($request.ContentType)
            }
            catch { }
        }
        $msg.Content = $content
    }

    # header forwarding — 認証/コンテンツ系のみ転送 (Host/Connection 等は除外)。
    $forwardKeys = @(
        'api-key', 'x-api-key',
        'accept', 'authorization'
    )
    foreach ($name in $request.Headers.AllKeys) {
        if ($forwardKeys -contains $name.ToLower()) {
            $val = $request.Headers[$name]
            $msg.Headers.TryAddWithoutValidation($name, $val) | Out-Null
        }
    }

    # ── Send upstream (stream-aware) ──
    try {
        $task = $client.SendAsync(
            $msg,
            [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead
        )
        $upstream = $task.GetAwaiter().GetResult()

        $response.StatusCode = [int]$upstream.StatusCode
        Add-CorsHeaders -Response $response
        $ct = $null
        if ($upstream.Content -and $upstream.Content.Headers.ContentType) {
            $ct = $upstream.Content.Headers.ContentType.ToString()
        }
        if ($ct) { $response.ContentType = $ct }
        if ($upstream.Headers.CacheControl) {
            $response.Headers.Add('Cache-Control', $upstream.Headers.CacheControl.ToString())
        }
        $sse = ($ct -and ($ct -like 'text/event-stream*'))
        if ($sse) {
            $response.SendChunked = $true
        }
        elseif ($upstream.Content.Headers.ContentLength) {
            $response.ContentLength64 = $upstream.Content.Headers.ContentLength
        }
        else {
            $response.SendChunked = $true
        }

        $upstreamStream = $upstream.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $buffer = New-Object byte[] 1024
        while ($true) {
            $n = $upstreamStream.Read($buffer, 0, $buffer.Length)
            if ($n -le 0) { break }
            try {
                $response.OutputStream.Write($buffer, 0, $n)
                $response.OutputStream.Flush()
            }
            catch { break }   # ブラウザがキャンセル → サイレントに終了
        }
        $upstreamStream.Dispose()
        $upstream.Dispose()
    }
    catch [System.Net.Http.HttpRequestException] {
        $detail = $_.Exception.Message
        $inner = $_.Exception.InnerException
        if ($inner) { $detail += " — $($inner.Message)" }
        Send-Error -Response $response -Status 502 -Code 'upstream_error' -Detail $detail
    }
    catch {
        Send-Error -Response $response -Status 500 -Code 'relay_failed' -Detail $_.Exception.Message
    }
    finally {
        try { $response.OutputStream.Close() } catch { }
        try { $msg.Dispose() } catch { }
    }
}

# ─── Main loop ──────────────────────────────────────────────────────────────

[Console]::TreatControlCAsInput = $false

try {
    while ($listener.IsListening) {
        $ctx = $null
        try {
            $ctx = $listener.GetContext()
        }
        catch [System.Net.HttpListenerException] {
            break
        }
        if ($ctx) {
            try { Invoke-RelayRequest -Context $ctx }
            catch { Write-Warning "request handler error: $($_.Exception.Message)" }
        }
    }
}
finally {
    Write-Host ''
    Write-Host '[shutdown] stopping listener...' -ForegroundColor DarkGray
    try { $listener.Stop() } catch { }
    try { $listener.Close() } catch { }
    try { $client.Dispose() } catch { }
}
