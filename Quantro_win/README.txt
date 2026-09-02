═══════════════════════════════════════════════════════
  QUANTRO — Windows Setup & Start Guide
═══════════════════════════════════════════════════════

PREREQUISITES (install once)
─────────────────────────────
1. Java 17+
   Download: https://adoptium.net/
   After install, open CMD and verify:  java -version

2. PostgreSQL 14+
   Download: https://www.postgresql.org/download/windows/
   Create a database (e.g. "examportal") and note your username/password.

3. nginx for Windows
   Download: https://nginx.org/en/download.html  (Stable version, .zip)
   Extract to e.g.  C:\nginx-1.30.0\
   Note the full path to nginx.exe.


FIRST-TIME SETUP (do once)
───────────────────────────
1. Open this folder in Explorer.

2. Copy the template:
      Right-click .env.template → Copy → Paste → rename to .env

3. Open .env in Notepad (or any text editor) and fill in:

      DB_URL          = jdbc:postgresql://127.0.0.1:5432/YOUR_DB_NAME
      DB_USERNAME     = your_postgres_username
      DB_PASSWORD     = your_postgres_password
      JWT_SECRET      = (any long random string, 64+ chars)
      NGINX_BIN       = C:\nginx-1.30.0\nginx.exe   ← full path

   Everything else has sensible defaults and can be left as-is.


START THE APP (every time)
───────────────────────────
   Double-click:  run.bat

   Or from PowerShell:
      powershell -ExecutionPolicy Bypass -File .\start.ps1

   Wait ~20 seconds for the backend to initialise, then open:
      http://localhost/          ← on this machine
      http://<LAN-IP>/           ← from other machines on the same network


STOP THE APP
─────────────
   Double-click:  stop.bat

   Or from PowerShell:
      powershell -ExecutionPolicy Bypass -File .\stop.ps1


CONFIGURING FEATURES (no rebuild needed)
──────────────────────────────────────────
All feature flags and proctoring settings are in .env:

   FEATURE_PROCTOR=true        # set false to disable browser proctoring
   FEATURE_PDF=true            # set false to disable PDF result download
   FEATURE_EMAIL=false         # set true only if SMTP is configured
   FEATURE_AI=false            # reserved for future AI integration

   PROCTOR_MAX_VIOLATIONS=1    # hard violations before auto-submit
   PROCTOR_MAX_FULLSCREEN_EXITS=1
   PROCTOR_GRACE_SECONDS=10    # fullscreen return grace period

Changes take effect on the next  run.bat  start.


IMAGE CACHING (how it works)
──────────────────────────────
Question images are stored in PostgreSQL as binary data.
Without caching, every student viewing an image triggers a database read.

With nginx proxy caching enabled:
  - First request for an image → backend fetches from DB → nginx saves to disk
  - All subsequent requests → served from disk (cache/images/) in ~1-5 ms
  - Cache lives 30 days; auto-refreshed if backend responds
  - Response header  X-Cache-Status: HIT  confirms cache is working
  - Cache folder can be safely deleted to force re-fetch from DB

Cache is stored at:   cache\images\   (relative to this folder)


PREFETCH ON EXAM PUBLISH (automatic)
────────────────────────────────────
When you publish an exam, the backend will prefetch all question images for
that exam through nginx. This warms cache\images\ and reduces DB load spikes.

Settings in .env:
   PREFETCH_ENABLED=true
   PREFETCH_BASE_URL=http://localhost:8081


IMAGE CACHE PREFETCH (warm cache before exam)
────────────────────────────────────────────
Use this 5-10 minutes before the exam to pull all question images once.
It fills the nginx cache so student requests are instant and DB load is low.

1. Start Quantro (run.bat) and wait until it is fully running.
2. Double-click:  prefetch.bat
3. Enter an ADMIN or TEACHER login when prompted.

Optional: If you are not using the default port 8081:
   powershell -ExecutionPolicy Bypass -File .\prefetch-images.ps1 -BaseUrl http://localhost

Notes:
   - Prefetch calls /subjects and /questions/subject/{id}, then downloads:
         /questions/{id}/image
         /questions/{id}/combined-option-image
         /questions/{id}/option-image/{index}
   - This uses the nginx cache (cache\images\), not your browser cache.
   - You can safely rerun prefetch any time.


RUNNING TWO BACKEND INSTANCES (optional)
──────────────────────────────────────────
For larger exam cohorts (100+ concurrent students):

1. In .env, uncomment and set:
      INSTANCES=2
      BASE_PORT=18080

2. In nginx\nginx.windows.conf, uncomment:
      server 127.0.0.1:18081 max_fails=3 fail_timeout=20s;

3. Run run.bat — two Java processes will start on ports 18080 and 18081,
   nginx load-balances between them automatically.


LOGS
─────
   logs\backend-18080.log      — Java stdout (Spring Boot output)
   logs\backend-18080.err.log  — Java stderr (startup errors)
   logs\nginx.access.log       — nginx request log
   logs\nginx.error.log        — nginx errors


TROUBLESHOOTING
────────────────
  "nginx failed to start"
    → Check logs\nginx.error.log
    → Ensure port 80 is free (no IIS or other web server running)
    → Run: netstat -ano | findstr :80

  "Backend not starting / blank page"
    → Check logs\backend-18080.err.log for database connection errors
    → Verify DB_URL, DB_USERNAME, DB_PASSWORD in .env
    → Ensure PostgreSQL is running: services.msc → find postgresql

  "Images not loading"
    → The image cache is at cache\images\ — check it exists and has files
    → Check nginx\logs or logs\nginx.error.log for proxy errors

  PowerShell execution policy error
    → Open PowerShell as Administrator and run:
         Set-ExecutionPolicy RemoteSigned -Scope CurrentUser

═══════════════════════════════════════════════════════
