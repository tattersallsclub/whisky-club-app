"""
Whiskey names change independently of members and redemption history, a
bottle running out and being swapped has nothing to do with who bought
into which range. Keeping this as its own script, separate from
import_seed.py, means running it can never accidentally touch data that
has nothing to do with the whiskey list.
"""

import json
import sys
import urllib.request

if len(sys.argv) < 2:
    print("Usage: python update_whiskey_names.py <apps-script-web-app-url> [whiskey_names.json]")
    sys.exit(1)

WEB_APP_URL = sys.argv[1]
NAMES_FILE = sys.argv[2] if len(sys.argv) > 2 else "whiskey_names.json"

with open(NAMES_FILE, encoding="utf-8") as f:
    names_by_number = json.load(f)

slots = [{"number": int(number), "name": name} for number, name in names_by_number.items()]

body = json.dumps({"action": "bulkUpdateWhiskeyNames", "payload": slots}).encode("utf-8")
request = urllib.request.Request(
    WEB_APP_URL,
    data=body,
    headers={"Content-Type": "text/plain;charset=utf-8"},
    method="POST",
)

with urllib.request.urlopen(request) as response:
    result = json.loads(response.read())
    print(result)
