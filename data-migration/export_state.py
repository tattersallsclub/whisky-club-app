"""
Logs in with the OLD backend's PIN first, exactly like the app itself
does, since getState now requires a token, then saves everything to a
local file. This file is the real, inspectable snapshot the rest of the
migration works from, not a live pipe straight from the old backend to
the new one.
"""

import getpass
import json
import sys
import urllib.request

if len(sys.argv) < 2:
    print("Usage: python export_state.py <old-apps-script-web-app-url> [output-file.json]")
    sys.exit(1)

OLD_WEB_APP_URL = sys.argv[1]
OUTPUT_FILE = sys.argv[2] if len(sys.argv) > 2 else "exported_state.json"


def post(action, payload):
    body = json.dumps({"action": action, "payload": payload}).encode("utf-8")
    request = urllib.request.Request(
        OLD_WEB_APP_URL,
        data=body,
        headers={"Content-Type": "text/plain;charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read())


def get(action, token):
    url = f"{OLD_WEB_APP_URL}?action={action}&token={token}"
    with urllib.request.urlopen(url) as response:
        return json.loads(response.read())


pin = getpass.getpass("PIN for the OLD backend: ")
login_result = post("login", {"pin": pin})
if login_result.get("error"):
    print("Login failed:", login_result["error"])
    sys.exit(1)
token = login_result["token"]

state = get("getState", token)

with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    json.dump(state, f, indent=2, ensure_ascii=False)

print(f"Saved to {OUTPUT_FILE}")
print(f"Members: {len(state.get('members', []))}")
print(f"Range memberships: {len(state.get('rangeMemberships', []))}")
print(f"Whiskey slots: {len(state.get('whiskeySlots', []))}")
