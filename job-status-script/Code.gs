/**
 * Main Line Auto Works: Job Status
 * Paste this whole file into Extensions > Apps Script in your "Job Status" Google Sheet.
 *
 * Sheets it uses (created for you by setup()):
 *   Jobs     : one row per car. Code, Vehicle, Services, Ready date, Stage, plus private
 *              customer name and email that never reach the website.
 *   Updates  : one row per update, filled in by the "Job update" Google Form.
 *
 * The website asks this script for ONE job at a time by its code, so the sheet stays private.
 */

const STAGES = ['Checked in', 'Prep & inspection', 'Install', 'Curing & finishing', 'Final inspection', 'Ready for pick-up'];
const JOBS = 'Jobs';
const UPDATES = 'Updates';
const SITE = 'https://mainlineautoworks.com/track/';   // change if the site address changes
const SHOP = 'Main Line Auto Works';

/* ---------- one-time setup ---------- */

function setup() {
  const ss = SpreadsheetApp.getActive();
  let jobs = ss.getSheetByName(JOBS);
  if (!jobs) {
    jobs = ss.getSheets()[0].setName(JOBS);
    jobs.getRange(1, 1, 1, 8).setValues([[
      'Code', 'Vehicle', 'Services (comma separated)', 'Ready date', 'Stage',
      'Customer name (private)', 'Customer email (private, optional)', 'Link to text the customer'
    ]]).setFontWeight('bold');
    jobs.setFrozenRows(1);
    jobs.setColumnWidths(1, 8, 180);
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(STAGES, true).build();
    jobs.getRange('E2:E1000').setDataValidation(rule);
    jobs.getRange('D2:D1000').setNumberFormat('yyyy-mm-dd');
  }
  // the form people fill in from their phones
  const form = FormApp.create('Job update · ' + SHOP)
    .setDescription('Post an update to a customer’s Job Status page.')
    .setConfirmationMessage('Update posted. The customer can see it now.');
  form.addTextItem().setTitle('Tracking code').setHelpText('e.g. MLA-7K3Q').setRequired(true);
  form.addListItem().setTitle('Stage').setChoiceValues(STAGES).setRequired(true);
  form.addParagraphTextItem().setTitle('Note for the customer').setHelpText('Keep it short and friendly.');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  SpreadsheetApp.flush();
  // rename the responses tab the form just created
  const resp = ss.getSheets().find(s => s.getFormUrl && s.getFormUrl());
  if (resp && !ss.getSheetByName(UPDATES)) resp.setName(UPDATES);
  // run onUpdate every time the form is submitted
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onUpdate').forSpreadsheet(ss).onFormSubmit().create();
  Logger.log('Form to bookmark on your phone: ' + form.getPublishedUrl());
  Logger.log('Edit the form (to add the Photo question): ' + form.getEditUrl());
}

/* ---------- menu: create a new job with a random code ---------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Job Status')
    .addItem('New job…', 'newJob')
    .addItem('Show update form link', 'showFormLink')
    .addToUi();
}

function newJob() {
  const ui = SpreadsheetApp.getUi();
  const v = ui.prompt('New job', 'Vehicle (e.g. 2023 BMW M3, white):', ui.ButtonSet.OK_CANCEL);
  if (v.getSelectedButton() !== ui.Button.OK) return;
  const s = ui.prompt('New job', 'Services, separated by commas:', ui.ButtonSet.OK_CANCEL);
  if (s.getSelectedButton() !== ui.Button.OK) return;
  const sheet = SpreadsheetApp.getActive().getSheetByName(JOBS);
  const existing = sheet.getRange(2, 1, Math.max(1, sheet.getLastRow() - 1), 1).getValues().flat().map(String);
  let code;
  do { code = 'MLA-' + randomCode(4); } while (existing.indexOf(code) >= 0);
  const link = SITE + '?job=' + code;
  sheet.appendRow([code, v.getResponseText(), s.getResponseText(), '', STAGES[0], '', '', link]);
  addUpdate(code, 0, 'Checked in. We’ll post updates here as we go.', '');
  ui.alert('Job created', 'Code: ' + code + '\n\nText the customer this link:\n' + link, ui.ButtonSet.OK);
}

function showFormLink() {
  const url = SpreadsheetApp.getActive().getFormUrl();
  SpreadsheetApp.getUi().alert(url ? 'Bookmark this on your phone:\n' + url.replace('/edit', '/viewform') : 'Run setup() first.');
}

/* ---------- when the form is submitted ---------- */

function onUpdate(e) {
  const r = e.namedValues;
  const code = String((r['Tracking code'] || [''])[0]).trim().toUpperCase();
  const stage = STAGES.indexOf(String((r['Stage'] || [''])[0]));
  const photo = String((r['Photo'] || [''])[0] || '');
  // make uploaded photos viewable by link, so they show on the customer's page
  (photo.match(/[-\w]{25,}/g) || []).forEach(id => { try { DriveApp.getFileById(id).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (err) {} });
  const row = findJobRow(code);
  if (!row || stage < 0) return;
  const sheet = SpreadsheetApp.getActive().getSheetByName(JOBS);
  sheet.getRange(row, 5).setValue(STAGES[stage]);
  const email = String(sheet.getRange(row, 7).getValue() || '').trim();
  if (email) {
    const vehicle = sheet.getRange(row, 2).getValue();
    MailApp.sendEmail({
      to: email, name: SHOP,
      subject: 'Your ' + vehicle + ': ' + STAGES[stage],
      htmlBody: '<p>Your ' + vehicle + ' just moved to <b>' + STAGES[stage] + '</b>.</p>' +
        ((r['Note for the customer'] || [''])[0] ? '<p>' + (r['Note for the customer'][0]) + '</p>' : '') +
        '<p><a href="' + SITE + '?job=' + code + '">See photos and progress</a></p><p>' + SHOP + ' · (484) 574-1628</p>'
    });
  }
}

/* ---------- the website asks here: ?job=CODE ---------- */

function doGet(e) {
  const code = String((e && e.parameter && e.parameter.job) || '').trim().toUpperCase();
  const out = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  if (!/^[A-Z0-9-]{4,20}$/.test(code)) return out({ error: 'not_found' });
  const row = findJobRow(code);
  if (!row) return out({ error: 'not_found' });
  const j = SpreadsheetApp.getActive().getSheetByName(JOBS).getRange(row, 1, 1, 5).getValues()[0];
  const ready = j[3] instanceof Date ? Utilities.formatDate(j[3], Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(j[3] || '');
  return out({
    code: code,
    vehicle: String(j[1] || ''),
    services: String(j[2] || '').split(',').map(s => s.trim()).filter(String),
    stage: Math.max(0, STAGES.indexOf(String(j[4]))),
    ready: ready,
    updates: updatesFor(code)
  });
}

/* ---------- helpers ---------- */

function findJobRow(code) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(JOBS);
  const n = sheet.getLastRow() - 1; if (n < 1) return 0;
  const codes = sheet.getRange(2, 1, n, 1).getValues().flat().map(c => String(c).trim().toUpperCase());
  const i = codes.indexOf(code); return i < 0 ? 0 : i + 2;
}

function updatesFor(code) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(UPDATES); if (!sheet) return [];
  const data = sheet.getDataRange().getValues(); if (data.length < 2) return [];
  const head = data[0].map(String), col = name => head.indexOf(name);
  const cT = col('Timestamp'), cC = col('Tracking code'), cS = col('Stage'), cN = col('Note for the customer'), cP = col('Photo');
  const tz = Session.getScriptTimeZone();
  return data.slice(1)
    .filter(r => String(r[cC]).trim().toUpperCase() === code)
    .map(r => {
      const id = cP >= 0 ? (String(r[cP]).match(/[-\w]{25,}/) || [''])[0] : '';
      return {
        date: r[cT] instanceof Date ? Utilities.formatDate(r[cT], tz, 'MMM d, h:mm a') : String(r[cT]),
        stage: Math.max(0, STAGES.indexOf(String(r[cS]))),
        note: cN >= 0 ? String(r[cN] || '') : '',
        photo: id ? 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1200' : ''
      };
    })
    .reverse();
}

function addUpdate(code, stageIndex, note, photo) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(UPDATES); if (!sheet) return;
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const row = head.map(h => h === 'Timestamp' ? new Date() : h === 'Tracking code' ? code : h === 'Stage' ? STAGES[stageIndex] : h === 'Note for the customer' ? note : h === 'Photo' ? photo : '');
  sheet.appendRow(row);
}

function randomCode(n) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O or 1/I/L, so codes are easy to read over the phone
  let s = ''; for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)]; return s;
}
