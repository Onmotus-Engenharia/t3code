@echo off
rem CodexSessionRuntime always prepends the app-server subcommand.
set "SCRIPT_DIR=%~dp0"
shift
node "%SCRIPT_DIR%codexCollabMockPeer.mjs" %*
