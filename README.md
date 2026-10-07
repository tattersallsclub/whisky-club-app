# Whisky Club

Whisky club control system, organised by whiskey range (blocks of 10, for
example 1-10, 11-20) instead of by year. The app runs entirely in the
browser, hosted for free on GitHub Pages, and uses a Google Sheet as the
real database, through a free backend (Google Apps Script).

## How the system works

The app is always the one in charge. Every screen talks to the backend,
never directly to the spreadsheet. The spreadsheet works as a readable
mirror and automatic backup, not as the place where business rules live.

Each member can have one or more "memberships", a membership is the
purchase of a specific range (for example, range 11-20), with its own
activation date and payment method. The same member can have bought
several ranges over time, each with its own one year validity window. A
whiskey that has not been redeemed yet stays valid even after that one
year window expires, expiration only affects things outside this app
(like the price charged in the bar's own system).

## Step 1, create the spreadsheet and the backend

1. Create a new, empty Google Sheet on the club's Google account.
2. Go to Extensions > Apps Script.
3. Delete the default content of the `Code.gs` file and paste in the
   content of `apps-script/Code.gs` from this project.
4. At the top of the file, edit the line `const NOTIFICATION_EMAIL = ''`
   and put the email that should receive the new member notice inside
   the quotes. Without this filled in, the email simply does not send.
5. Run the `setupSheets` function once (creates the four sheets the
   backend uses, Members, RangeMemberships, Redemptions, WhiskeySlots).
6. Click Deploy > New deployment, type Web app, execute as Me, access
   Anyone. Copy the generated URL, it ends in `/exec`.

## Step 2, import the historical data

The `seed.json` in `data-migration/` has already been generated from the
old spreadsheet, mapping each old season (2021/2022 through 2025/2026) to
its matching numeric range, since each season always sold exactly one
block of 10 whiskeys.

Two things worth knowing before importing:

- Names that changed between seasons are not merged automatically. For
  example "Airey, Alexis" in the older seasons and "Airey, Lexi" in the
  current one were imported as two different people.
- The activation date of each historical membership was set to February
  1st of that season's first year, since it is a fictional date, the
  real one was never recorded in the old process.

To import, in the terminal, inside `data-migration`:

```
pip install openpyxl
python parse_legacy_excel.py Whisky_Club_2025-26.xlsx
python import_seed.py "APPS_SCRIPT_URL" seed.json
```

## Step 3, configure the app

Open `src/config.js` and replace `APPS_SCRIPT_WEB_APP_URL` with the URL
from step 1, and `APP_PIN` with a simple number the bar staff will use.

## Step 4, test locally

Run `npm install` and then `npm run dev`, open the address that shows up
in the terminal. Test member search, adding a member to a range, ticking
and unticking whiskeys, editing a whiskey name.

## Step 5, publish on GitHub Pages

```
VITE_BASE_PATH=/repository-name/ npm run build
npm run deploy
```

Then enable GitHub Pages in the repository settings, pointing at the
`gh-pages` branch.

## Updating whiskey names without touching members

When the whiskey list changes (a bottle runs out, a name gets corrected),
run the script below. It only touches the WhiskeySlots sheet, never
members, memberships, or redemptions:

```
python update_whiskey_names.py "APPS_SCRIPT_URL" whiskey_names.json
```

The `whiskey_names.json` file has the shape `{"1": "Whiskey name", "2": "..."}`.
Edit that file with the updated names before running the script.

## Step 6, access from the iPad

Open the link directly in Safari, not inside Notion, and use "Add to Home
Screen". A plain link inside Notion (that opens in a new tab) is safe,
only the embedded iframe should be avoided.

## Page structure

- Home, member search, add member button, whiskey search.
- Members, list of active members (and inactive ones, optionally), remove
  and reactivate.
- Whiskeys, full catalog of the 100 slots, grouped by range, editable.
- Ranges, one tab per block of 10 (1-10, 11-20, up to 91-100), showing the
  table of members in that range with the 10 whiskey checklist, and the
  lock member button.
- Add member, form for name, code, range, and payment method (member
  account or cash/credit card). If the code entered already exists, the
  system recognises the member and only adds the new range to their
  account, instead of creating a duplicate member.

## What the app does not do

It does not integrate with the bar's POS system. The 100% discount on the
free whiskey is still applied manually by staff.

## Backup

Besides the Google Sheet itself, which updates on every action, there is
an "Export backup to Excel" button inside the app, available at any time.

## Code structure

```
src/
  data/            Data access layer, isolated from the interface
  domain/          Pure business rules (ranges, expiration, locking)
  context/         State shared across screens
  components/      Interface
apps-script/       Backend that runs inside the Google Sheet
data-migration/    Scripts used once to import the historical data
```
