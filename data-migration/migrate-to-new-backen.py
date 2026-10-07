"""
This copies data between two backends, not within one, which is why it
takes an exported JSON file rather than talking to the old backend
directly. Doing it in two explicit steps (export, then import) means you
get a real, inspectable snapshot of exactly what is about to move,
instead of a live pipe between two Google accounts where a mistake in
either direction is much harder to catch before it happens.

getState() already returns members, whiskeySlots, and rangeMemberships
in exactly the shape bulkSeed expects, so this script does no
transformation at all, it only reads the file and posts it straight
through. If it ever needs to do more than that, that is a sign the two
backends' schemas have drifted apart and should be reconciled first.

Since login was added, exporting the old state by opening
?action=getState directly in a browser no longer works on its own, that
endpoint now requires a valid token. Log in through the actual app first,
open the browser's dev tools, and copy the token it is holding in
sessionStorage, or add a temporary export step that calls login first.
"""

import getpass
import json
import sys
import urllib.request

if len(sys.argv) < 3:
    print("Usage: python migrate_to_new_backend.py <exported_state.json> <new-apps-script-url>")
    sys.exit(1)

STATE_FILE = sys.argv[1]
NEW_WEB_APP_URL = sys.argv[2]
ADMIN_SECRET = getpass.getpass("Admin secret for the NEW backend: ")

with open(STATE_FILE, encoding="utf-8") as f:
    state = json.load(f)

body = json.dumps({"action": "bulkSeed", "payload": state, "adminSecret": ADMIN_SECRET}).encode("utf-8")
request = urllib.request.Request(
    NEW_WEB_APP_URL,
    data=body,
    headers={"Content-Type": "text/plain;charset=utf-8"},
    method="POST",
)

with urllib.request.urlopen(request) as response:
    result = json.loads(response.read())
    print(result)

print(f"Members: {len(state.get('members', []))}")
print(f"Range memberships: {len(state.get('rangeMemberships', []))}")
print(f"Whiskey slots: {len(state.get('whiskeySlots', []))}")