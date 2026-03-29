// Diagonal Thinking CRM — Google Apps Script backend
// Deploy as a Web App: Execute as Me, Anyone (even anonymous) can access.
//
// Sheet name: "Contacts" (the script will create it if missing)
// Column order (A–S):
//   id | company | contactName | email | phone | type | services |
//   projectedValue | notes | source | dateAdded | lastUpdated |
//   AI Advantage Course | AI Agent Course | AI Consultancy | AI Talk | AI Action Day |
//   AI Retainer | Non-AI Work

// API key — must match SHEETS_API_KEY in the React app
var API_KEY = "DT-6256e0bc9c94c6998f5d206ebe4eb385";

var SHEET_NAME = "Contacts";
var HEADERS = [
  "id", "company", "contactName", "email", "phone", "type", "services",
  "projectedValue", "notes", "source", "dateAdded", "lastUpdated",
  "AI Advantage Course", "AI Agent Course", "AI Consultancy", "AI Talk", "AI Action Day",
  "AI Retainer", "Non-AI Work"
];
var SERVICE_COLS = [
  "AI Advantage Course", "AI Agent Course", "AI Consultancy", "AI Talk",
  "AI Action Day", "AI Retainer", "Non-AI Work"
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function buildResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function rowToRecord(row) {
  var record = {};
  HEADERS.forEach(function(col, i) {
    record[col] = row[i] !== undefined ? row[i] : "";
  });
  // services: reconstruct array from comma-separated field (primary source)
  var servicesStr = String(record["services"] || "");
  var services = servicesStr ? servicesStr.split(",").map(function(s) { return s.trim(); }).filter(Boolean) : [];
  // also pick up any boolean columns that are set but missing from the CSV string
  SERVICE_COLS.forEach(function(col) {
    if (record[col] === "Yes" && services.indexOf(col) === -1) {
      services.push(col);
    }
  });
  record.services = services;
  record.projectedValue = Number(record.projectedValue) || 0;
  // remove the individual boolean columns from the JSON output — the app uses the array
  SERVICE_COLS.forEach(function(col) { delete record[col]; });
  return record;
}

function recordToRow(record) {
  var services = Array.isArray(record.services) ? record.services : [];
  var row = [
    record.id || "",
    record.company || "",
    record.contactName || "",
    record.email || "",
    record.phone || "",
    record.type || "",
    services.join(", "),
    Number(record.projectedValue) || 0,
    record.notes || "",
    record.source || "",
    record.dateAdded || "",
    record.lastUpdated || ""
  ];
  SERVICE_COLS.forEach(function(col) {
    row.push(services.indexOf(col) !== -1 ? "Yes" : "");
  });
  return row;
}

function findRowById(sheet, id) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) return i + 1; // 1-indexed sheet row
  }
  return -1;
}

// ---------------------------------------------------------------------------
// GET — return all contacts as JSON array
// ---------------------------------------------------------------------------

function checkKey(e) {
  var key = (e.parameter && e.parameter.key) || "";
  return key === API_KEY;
}

function doGet(e) {
  if (!checkKey(e)) {
    return buildResponse({ error: "Unauthorised" });
  }
  try {
    var sheet = getSheet();
    var data = sheet.getDataRange().getValues();
    var records = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][0]) continue; // skip rows with no id
      records.push(rowToRecord(data[i]));
    }
    return buildResponse(records);
  } catch (err) {
    return buildResponse({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// POST — upsert or delete
// Body (text/plain or application/json): JSON string
//   { action: "upsert", record: {...} }
//   { action: "delete", id: "..." }
// ---------------------------------------------------------------------------

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (!body.key || body.key !== API_KEY) {
      return buildResponse({ error: "Unauthorised" });
    }
    var sheet = getSheet();

    if (body.action === "upsert") {
      var record = body.record;
      if (!record || !record.id) {
        return buildResponse({ error: "upsert requires record.id" });
      }
      var existingRow = findRowById(sheet, record.id);
      var newRow = recordToRow(record);
      if (existingRow === -1) {
        sheet.appendRow(newRow);
        return buildResponse({ result: "inserted", id: record.id });
      } else {
        sheet.getRange(existingRow, 1, 1, newRow.length).setValues([newRow]);
        return buildResponse({ result: "updated", id: record.id });
      }
    }

    if (body.action === "delete") {
      var id = body.id;
      if (!id) return buildResponse({ error: "delete requires id" });
      var rowToDelete = findRowById(sheet, id);
      if (rowToDelete !== -1) {
        sheet.deleteRow(rowToDelete);
      }
      return buildResponse({ result: "deleted", id: id });
    }

    return buildResponse({ error: "Unknown action: " + body.action });
  } catch (err) {
    return buildResponse({ error: err.message });
  }
}
