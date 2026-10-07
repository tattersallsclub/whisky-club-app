"""
This is the last step of unifying id and code. It must run BEFORE
Code.gs is redeployed with the simplified three column Members schema,
because it relies on reading the "code" field that only exists in the
current, not yet updated, getState response, to know which members
already have a real code and which do not.

It reads live state directly from the deployed backend instead of a
local seed.json or exported spreadsheet, on purpose, those have already
drifted out of sync with the real sheet more than once in this project,
reading straight from the source of truth removes that risk entirely.
"""

import json
import sys
import time
import urllib.request

if len(sys.argv) < 2:
    print("Usage: python finalize_ids.py <apps-script-web-app-url>")
    sys.exit(1)

WEB_APP_URL = sys.argv[1]


def get(url):
    with urllib.request.urlopen(url) as response:
        return json.loads(response.read())


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


state = get(f"{WEB_APP_URL}?action=getState")
members = sorted(state["members"], key=lambda m: m["name"])

print(f"Found {len(members)} members.")

no_code_counter = 0
succeeded = 0
skipped = 0
failed = []

for member in members:
    current_id = member["id"]
    code = member.get("code")

    if code:
        target_id = code
    else:
        no_code_counter += 1
        target_id = f"ID-{no_code_counter}"

    if target_id == current_id:
        skipped += 1
        continue

    result = post("updateMemberIdentity", {
        "currentId": current_id,
        "newName": member["name"],
        "newCode": target_id,
    })
    if result.get("error"):
        failed.append((current_id, target_id, result["error"]))
        print(f"  FAILED {current_id} -> {target_id}: {result['error']}")
    else:
        succeeded += 1
        print(f"  {current_id} -> {target_id}")
    time.sleep(0.3)

print()
print(f"Done. {succeeded} converted, {skipped} already correct, {len(failed)} failed.")
if failed:
    print("Review these manually:")
    for current_id, target_id, error in failed:
        print(f"  {current_id} -> {target_id}: {error}")