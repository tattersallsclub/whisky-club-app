"""
Takes the file export_state.py produced and posts it straight into a
new, empty backend via bulkSeed. No transformation happens here on
purpose, getState and bulkSeed use the same shape.

bulkSeed needs two things on the backend. A normal login token, like
any other action, and the separate admin secret on top of it. This
script asks for both, the PIN first to log in, then the secret.
"""

import getpass
import json
import sys
import urllib.request

if len(sys.argv) < 3:
    print("Usage: python migrate_to_new_backend.py <exported_state.json> <new apps script url>")
    sys.exit(1)

STATE_FILE = sys.argv[1]
NEW_WEB_APP_URL = sys.argv[2]


def post(body):
    request = urllib.request.Request(
        NEW_WEB_APP_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "text/plain;charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read())


pin = getpass.getpass("PIN for the NEW backend: ")
login_result = post({"action": "login", "payload": {"pin": pin}})
if login_result.get("error"):
    print("Login failed:", login_result["error"])
    sys.exit(1)
token = login_result["token"]

admin_secret = getpass.getpass("Admin secret for the NEW backend: ")

with open(STATE_FILE, encoding="utf-8") as f:
    state = json.load(f)

result = post({"action": "bulkSeed", "payload": state, "token": token, "adminSecret": admin_secret})

if result.get("error"):
    print("Import failed:", result["error"])
    print("Nothing was reported as written. Do not retry before checking the message above.")
    sys.exit(1)

print("Import finished:", result)
print(f"Sent from the file: {len(state.get('members', []))} members, "
      f"{len(state.get('rangeMemberships', []))} range memberships, "
      f"{len(state.get('whiskeySlots', []))} whiskey slots.")
