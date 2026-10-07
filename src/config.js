// Replace with the URL shown after deploying apps-script/Code.gs as a web app.
// See README.md for the exact deployment steps.
export const APPS_SCRIPT_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzJDGKM8WgsdHeAkaSU7Bn0mfegJa7hMA2r2dYcGf2gmOnngegc-1ms1wUj6T8VVgn61Q/exec'

// There used to be a PIN constant here. There no longer is one, on
// purpose, the real PIN now lives only in the backend's Script
// Properties (Apps Script editor > Project Settings), never in a file
// that gets committed to a public repository. See PinGate.jsx and
// Code.gs's login function for how that works.

// The full whiskey list, with descriptions, lives outside the app
// entirely, as a PDF on Google Drive, not something this project
// generates or maintains, this just links to it.
export const WHISKEY_LIST_PDF_URL =
  'https://drive.google.com/file/d/1zMeWLZtX5N1ydESmNu_J51QrHOXExJZT/view?usp=share_link'