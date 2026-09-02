Param(
    [string]$BaseUrl = "http://localhost:8081",
    [string]$Identifier,
    [string]$Password
)

$ErrorActionPreference = "Stop"

function Read-PasswordPlain {
    $secure = Read-Host "Password" -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

$BaseUrl = $BaseUrl.TrimEnd('/')

if (-not $Identifier) {
    $Identifier = Read-Host "Admin email/enrollment/username"
}
if (-not $Password) {
    $Password = Read-PasswordPlain
}

$loginUri = "$BaseUrl/auth/login"
$loginBody = @{ identifier = $Identifier; password = $Password } | ConvertTo-Json

Write-Host "Logging in..." -ForegroundColor DarkGray
try {
    $loginResp = Invoke-RestMethod -Method Post -Uri $loginUri -ContentType "application/json" -Body $loginBody
} catch {
    Write-Host "ERROR: Login failed at $loginUri" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Yellow
    exit 1
}

$token = $loginResp.data.token
$sessionToken = $loginResp.data.sessionToken
if (-not $token -or -not $sessionToken) {
    Write-Host "ERROR: Login response missing token or sessionToken." -ForegroundColor Red
    exit 1
}

$authHeaders = @{ Authorization = "Bearer $token"; "X-Session-Token" = $sessionToken }

Write-Host "Fetching subjects..." -ForegroundColor DarkGray
try {
    $subjectsResp = Invoke-RestMethod -Method Get -Uri "$BaseUrl/subjects" -Headers $authHeaders
} catch {
    Write-Host "ERROR: Failed to fetch subjects." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Yellow
    exit 1
}

$subjects = $subjectsResp.data
if (-not $subjects -or $subjects.Count -eq 0) {
    Write-Host "No subjects found. Nothing to prefetch." -ForegroundColor Yellow
    exit 0
}

$totalQuestions = 0
$totalImages = 0
$totalFailures = 0

foreach ($subject in $subjects) {
    $subjectId = $subject.id
    if (-not $subjectId) { continue }

    Write-Host "Loading questions for subject $subjectId..." -ForegroundColor DarkGray
    try {
        $qResp = Invoke-RestMethod -Method Get -Uri "$BaseUrl/questions/subject/$subjectId" -Headers $authHeaders
    } catch {
        Write-Host "WARN: Failed to fetch questions for subject $subjectId" -ForegroundColor Yellow
        continue
    }

    $questions = $qResp.data
    if (-not $questions) { continue }

    foreach ($q in $questions) {
        if (-not $q.id) { continue }
        $totalQuestions++

        $urls = @()
        if ($q.hasQuestionImage) {
            $urls += "$BaseUrl/questions/$($q.id)/image"
        }
        if ($q.hasCombinedOptionImage) {
            $urls += "$BaseUrl/questions/$($q.id)/combined-option-image"
        }
        if ($q.optionHasImage) {
            for ($i = 0; $i -lt $q.optionHasImage.Count; $i++) {
                if ($q.optionHasImage[$i]) {
                    $urls += "$BaseUrl/questions/$($q.id)/option-image/$i"
                }
            }
        }

        foreach ($url in $urls) {
            try {
                Invoke-WebRequest -Method Get -Uri $url | Out-Null
                $totalImages++
            } catch {
                $totalFailures++
                Write-Host "WARN: Failed to prefetch $url" -ForegroundColor Yellow
            }
        }
    }
}

Write-Host "" 
Write-Host "Prefetch complete." -ForegroundColor Green
Write-Host "Questions scanned : $totalQuestions" -ForegroundColor DarkGray
Write-Host "Images fetched    : $totalImages" -ForegroundColor DarkGray
Write-Host "Failures          : $totalFailures" -ForegroundColor DarkGray
