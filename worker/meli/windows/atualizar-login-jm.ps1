$ErrorActionPreference = 'Stop'
$workerDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envPath = Join-Path $workerDir '.env.local'
if (-not (Test-Path $envPath)) { throw 'Configuracao local ainda nao existe.' }

Write-Host 'Atualizar login do JMRoutes' -ForegroundColor Cyan
$email = Read-Host 'E-mail usado para entrar no site JMRoutes'
$passwordSecure = Read-Host 'Senha do site JMRoutes' -AsSecureString
$passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($passwordSecure)
try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr) }
$passwordBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($password))

$lines = [Collections.Generic.List[string]](Get-Content $envPath)
for ($i = $lines.Count - 1; $i -ge 0; $i--) {
  if ($lines[$i] -match '^WORKER_(EMAIL|PASSWORD|PASSWORD_BASE64)=') { $lines.RemoveAt($i) }
}
$lines.Add("WORKER_EMAIL=$email")
$lines.Add("WORKER_PASSWORD_BASE64=$passwordBase64")
[IO.File]::WriteAllLines($envPath, $lines, (New-Object Text.UTF8Encoding $false))
icacls $envPath /inheritance:r /grant:r "$env:USERNAME`:F" | Out-Null
Write-Host 'Login atualizado.' -ForegroundColor Green
Read-Host 'Pressione ENTER para fechar'
