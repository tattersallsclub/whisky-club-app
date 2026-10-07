"""
Reads live state directly from the backend instead of a local file, on
purpose, this project has been bitten more than once this session by a
local snapshot drifting out of sync with what is actually in the Sheet.
Reuses bulkRenameMembers, already built and already tested for exactly
this kind of batch rename, rather than adding a new backend action for
something the existing one already does.

Both reading and writing now require being logged in, so this starts by
exchanging the PIN for a short lived token, exactly like the app itself
does, rather than a secret living anywhere in this file.
"""

import getpass
import json
import sys
import urllib.request

if len(sys.argv) < 2:
    print("Usage: python reformat_names.py <apps-script-web-app-url>")
    sys.exit(1)

WEB_APP_URL = sys.argv[1]


def post(action, payload, token=None):
    body = {"action": action, "payload": payload}
    if token:
        body["token"] = token
    request = urllib.request.Request(
        WEB_APP_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "text/plain;charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read())


def get(action, token, params=""):
    url = f"{WEB_APP_URL}?action={action}&token={token}{params}"
    with urllib.request.urlopen(url) as response:
        return json.loads(response.read())


def to_first_last(name):
    if "," not in name:
        return name
    last, first = name.split(",", 1)
    return f"{first.strip()} {last.strip()}"


pin = getpass.getpass("PIN: ")
login_result = post("login", {"pin": pin})
if login_result.get("error"):
    print("Login failed:", login_result["error"])
    sys.exit(1)
token = login_result["token"]

state = get("getState", token)
members = state["members"]

renames = []
for member in members:
    new_name = to_first_last(member["name"])
    if new_name != member["name"]:
        renames.append({"id": member["id"], "name": new_name})

if not renames:
    print("No names needed reformatting, nothing to do.")
else:
    print(f"Reformatting {len(renames)} names:")
    for r in renames:
        print(f"  {r['id']}: {r['name']}")
    result = post("bulkRenameMembers", renames, token)
    print(result)