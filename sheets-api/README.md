# Diagonal Thinking CRM — Google Sheets Backend

## Overview

`Code.gs` is a Google Apps Script web app that sits in front of a Google Sheet
and provides a simple REST API for the CRM. Phil uses the React app; Claude can
read and write contacts directly via the Sheets API URL.

---

## Google Sheet column layout

| Col | Field | Notes |
|-----|-------|-------|
| A | id | UUID, primary key |
| B | company | |
| C | contactName | |
| D | email | |
| E | phone | |
| F | type | Client / Warm Lead / Cold Lead / Mailing List |
| G | services | Comma-separated array (e.g. `AI Talk, AI Retainer`) |
| H | projectedValue | Number (GBP) |
| I | notes | Free text, may contain newlines |
| J | source | Invoices / Income & Expenditure / Gmail / Squarespace / Manual |
| K | dateAdded | ISO 8601 timestamp |
| L | lastUpdated | ISO 8601 timestamp |
| M | AI Advantage Course | Yes or blank |
| N | AI Consultancy | Yes or blank |
| O | AI Talk | Yes or blank |
| P | AI Action Day | Yes or blank |
| Q | AI Retainer | Yes or blank |
| R | Non-AI Work | Yes or blank |

Row 1 is a frozen header row. Data starts at row 2.

The boolean columns (M–R) mirror the `services` array and make it easy to filter
in Sheets without parsing the comma-separated string in column G.

---

## Deployment (one-time setup)

### 1. Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet.
2. Name it **"Diagonal Thinking CRM"** (or anything you like — the script targets
   a tab named `Contacts`, which it creates automatically on first run).

### 2. Open the Apps Script editor

1. In the spreadsheet, go to **Extensions → Apps Script**.
2. Delete the placeholder `function myFunction() {}`.
3. Paste the full contents of `Code.gs` into the editor.
4. Save (Ctrl/Cmd + S) and name the project (e.g. `CRM API`).

### 3. Deploy as a Web App

1. Click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set:
   - **Description**: `CRM API v1`
   - **Execute as**: `Me`
   - **Who has access**: `Anyone` (no sign-in required — the URL acts as the secret)
4. Click **Deploy**.
5. Click **Authorize access** and grant the requested permissions (Sheets read/write).
6. Copy the **Web app URL** — it looks like:
   ```
   https://script.google.com/macros/s/AKfycb.../exec
   ```

### 4. Wire up the React app

Open `src/App.jsx` and set the constant at the top:

```js
const SHEETS_API_URL = "https://script.google.com/macros/s/AKfycb.../exec";
```

Rebuild/redeploy the React app. From that point:
- On load it fetches all contacts from Sheets instead of localStorage.
- Every save and delete is synced to Sheets in the background.
- The dot in the top-right of the header shows sync status (grey = local, amber = syncing, green = synced, red = error).

### 5. Load initial data

Run the Node loader to push the 379 contacts from `crm-import-data.json`:

```bash
cd diagonal-thinking-crm/sheets-api
node load-initial-data.js "https://script.google.com/macros/s/AKfycb.../exec"
```

This POSTs each record one at a time. Expect it to take ~2–3 minutes for 379 records
(Apps Script has a ~30 req/s quota; the script throttles to 5 req/s to be safe).

---

## API reference

### GET `<web-app-url>`

Returns all contacts as a JSON array.

```json
[
  {
    "id": "...",
    "company": "Acme Ltd",
    "contactName": "Jane Smith",
    "email": "jane@acme.com",
    "phone": "",
    "type": "Warm Lead",
    "services": ["AI Consultancy", "AI Talk"],
    "projectedValue": 5000,
    "notes": "",
    "source": "Manual",
    "dateAdded": "2025-01-15T10:00:00.000Z",
    "lastUpdated": "2025-03-01T09:30:00.000Z"
  }
]
```

### POST `<web-app-url>` — upsert

Body (send as `Content-Type: text/plain` from browser, `application/json` from Node):

```json
{ "action": "upsert", "record": { "id": "...", "company": "...", ... } }
```

Inserts a new row if the `id` is not found; overwrites the existing row if it is.

Response:
```json
{ "result": "inserted", "id": "..." }
{ "result": "updated",  "id": "..." }
```

### POST `<web-app-url>` — delete

```json
{ "action": "delete", "id": "uuid-here" }
```

Response:
```json
{ "result": "deleted", "id": "..." }
```

---

## Updating the deployment

After any change to `Code.gs`:

1. **Deploy → Manage deployments**.
2. Click the pencil icon on your active deployment.
3. Change **Version** to **New version**.
4. Click **Deploy**.

The URL stays the same.

---

## Claude direct access

Claude can read and write contacts by calling the same API URL with fetch/curl.
The `id` field is the stable primary key — always include it on upsert so the
script can find and overwrite the correct row.
