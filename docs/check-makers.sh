export PATH="/c/Users/hxaka/.workbuddy/binaries/python/versions/3.13.12/Scripts:$PATH"
browser-use <<'PY'
goto_url("https://console.cloud.tencent.com/edgeone/makers")
wait_for_load()
sleep(3)
capture_screenshot()
print("done")
PY
cp "/c/Users/hxaka/.config/browser-harness/tmp/shot.png" "/c/Users/hxaka/WorkBuddy/2026-08-02-14-09-34/ai-radio/docs/cloud1.png"
ls -la "/c/Users/hxaka/WorkBuddy/2026-08-02-14-09-34/ai-radio/docs/cloud1.png"
