"""
This is a one time cleanup for data that predates the "id equals code"
rule, it converts every member whose id is still an old generated value
like m1 instead of their actual code. It reuses updateMemberIdentity
through the same HTTP action the app itself calls for the "Edit member"
screen, rather than writing a second, separate way to rename a member,
which would be one more place for the two mechanisms to quietly drift
apart from each other.

Run the Airey merge (m86 into m1) BEFORE this script, not after. This
script renames m1 to A213, if the merge has not happened yet, Lexi's
range would be left pointing at an id (m1) that no longer means what it
used to mean once this script runs.
"""

import json
import sys
import time
import urllib.request

if len(sys.argv) < 2:
    print("Usage: python convert_ids_to_codes.py <apps-script-web-app-url> [id_to_code_conversion.json]")
    sys.exit(1)

WEB_APP_URL = sys.argv[1]
CONVERSION_FILE = sys.argv[2] if len(sys.argv) > 2 else "id_to_code_conversion.json"


def post(action, payload):
    body = json.dumps({"action": action, "payload": payload}).encode("utf-8")
    request = urllib.request.Request(
        WEB_APP_URL,
        data=body,
        headers={"Content-Type": "text/plain;charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read())


with open(CONVERSION_FILE, encoding="utf-8") as f:
    conversions = json.load(f)

print(f"Converting {len(conversions)} members...")
succeeded = 0
failed = []

for entry in conversions:
    result = post("updateMemberIdentity", {
        "currentId": entry["currentId"],
        "newName": entry["newName"],
        "newCode": entry["newCode"],
    })
    if result.get("error"):
        failed.append((entry["currentId"], result["error"]))
        print(f"  FAILED {entry['currentId']} -> {entry['newCode']}: {result['error']}")
    else:
        succeeded += 1
    # A short pause avoids overwhelming Apps Script with back to back
    # requests, which otherwise occasionally throttles a long run like
    # this one.
    time.sleep(0.3)

print(f"Done. {succeeded} converted, {len(failed)} failed.")
if failed:
    print("Review these manually, nothing else was skipped because of them:")
    for member_id, error in failed:
        print(f"  {member_id}: {error}")