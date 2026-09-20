# Servidor estático de reserva, para máquinas sin Node.
#
# El visor NO se puede abrir haciendo doble clic en index.html: usa módulos ES y
# fetch, y el navegador los bloquea sobre file://. Hace falta servirlo por HTTP.
# Lo normal es usar herramientas/servidor.mjs con Node; esto es lo mismo escrito
# con lo que ya trae Windows, para que el proyecto se pueda abrir en un equipo
# donde no haya nada instalado.
#
# Uso:  powershell -ExecutionPolicy Bypass -File herramientas\servidor.ps1 [puerto]

param([int]$Puerto = 5173)

$ErrorActionPreference = 'Stop'
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

$Tipos = @{
  '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'; '.geojson' = 'application/json; charset=utf-8'
  '.md' = 'text/markdown; charset=utf-8'; '.txt' = 'text/plain; charset=utf-8'
  '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'
  '.gif' = 'image/gif'; '.webp' = 'image/webp'; '.svg' = 'image/svg+xml'
  '.webm' = 'video/webm'; '.mp4' = 'video/mp4'; '.woff2' = 'font/woff2'
}

# Mismo proxy acotado que el servidor de Node: aviationweather.gov no manda
# cabeceras CORS, así que la página no puede consultarla por su cuenta. Solo estas
# tres rutas y solo contra ese host.
$ApiAwc = 'https://aviationweather.gov/api/data'

function Get-UrlApi($ruta, $consulta) {
  $q = [System.Web.HttpUtility]::ParseQueryString($consulta)
  switch ($ruta) {
    '/api/sigmet' {
      $u = "$ApiAwc/isigmet?format=json"
      if ($q['date']) { $u += '&date=' + [uri]::EscapeDataString($q['date']) }
      if ($q['hours']) { $u += '&hours=' + [uri]::EscapeDataString($q['hours']) }
      return $u
    }
    '/api/metar' {
      $h = $q['hours']; if (-not $h) { $h = '3' }
      return "$ApiAwc/metar?ids=" + [uri]::EscapeDataString([string]$q['ids']) + "&format=json&hours=" + [uri]::EscapeDataString($h)
    }
    '/api/taf' {
      return "$ApiAwc/taf?ids=" + [uri]::EscapeDataString([string]$q['ids']) + "&format=json"
    }
  }
  return $null
}

Add-Type -AssemblyName System.Web | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$oyente = New-Object System.Net.HttpListener
$oyente.Prefixes.Add("http://localhost:$Puerto/")
try {
  $oyente.Start()
} catch {
  Write-Host ''
  Write-Host "  No se pudo abrir el puerto $Puerto." -ForegroundColor Red
  Write-Host '  Puede que ya haya algo escuchando ahí. Prueba con otro:'
  Write-Host "     powershell -ExecutionPolicy Bypass -File herramientas\servidor.ps1 5174"
  Write-Host ''
  exit 1
}

Write-Host ''
Write-Host '  Visor de teledetección en marcha (servidor de PowerShell)'
Write-Host "  ->  http://localhost:$Puerto"
Write-Host ''
Write-Host '  Cierra esta ventana para detenerlo.'
Write-Host ''

while ($oyente.IsListening) {
  $ctx = $oyente.GetContext()
  $pet = $ctx.Request
  $res = $ctx.Response
  try {
    $rel = [uri]::UnescapeDataString($pet.Url.AbsolutePath)
    if ($rel -eq '/') { $rel = '/index.html' }

    if ($rel.StartsWith('/api/')) {
      $url = Get-UrlApi $rel $pet.Url.Query
      if (-not $url) {
        $res.StatusCode = 404
        $b = [Text.Encoding]::UTF8.GetBytes('{"error":"Ruta de API no permitida"}')
        $res.ContentType = 'application/json; charset=utf-8'
        $res.OutputStream.Write($b, 0, $b.Length)
      } else {
        try {
          $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 15 -UserAgent 'proyecto-teledeteccion/1.0'
          $b = [Text.Encoding]::UTF8.GetBytes($r.Content)
          $res.StatusCode = 200
          $res.ContentType = 'application/json; charset=utf-8'
          $res.OutputStream.Write($b, 0, $b.Length)
          Write-Host "  API  $rel -> 200"
        } catch {
          # Que falle la consulta en vivo no rompe el visor: se queda con lo
          # congelado en datos/ y lo rotula como tal.
          $res.StatusCode = 502
          $b = [Text.Encoding]::UTF8.GetBytes('{"error":"sin conexion"}')
          $res.ContentType = 'application/json; charset=utf-8'
          $res.OutputStream.Write($b, 0, $b.Length)
          Write-Host "  API  $rel -> sin conexion"
        }
      }
    } else {
      $destino = [IO.Path]::GetFullPath((Join-Path $Raiz $rel.TrimStart('/')))
      if (-not $destino.StartsWith($Raiz)) {
        $res.StatusCode = 403
      } elseif (Test-Path -LiteralPath $destino -PathType Leaf) {
        $ext = [IO.Path]::GetExtension($destino).ToLower()
        $tipo = $Tipos[$ext]
        if (-not $tipo) { $tipo = 'application/octet-stream' }
        $datos = [IO.File]::ReadAllBytes($destino)
        $res.StatusCode = 200
        $res.ContentType = $tipo
        $res.Headers.Add('Cache-Control', 'no-cache')
        $res.OutputStream.Write($datos, 0, $datos.Length)
      } else {
        $res.StatusCode = 404
      }
    }
  } catch {
    try { $res.StatusCode = 500 } catch {}
  } finally {
    try { $res.OutputStream.Close() } catch {}
  }
}
