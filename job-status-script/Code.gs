/**
 * Main Line Auto Works: Job Status
 * Paste this whole file into Extensions > Apps Script in your "Job Status" Google Sheet.
 *
 * Sheets it uses (created for you by setup()):
 *   Jobs     : one row per car. Code, Vehicle, Services, Ready date, Stage, plus private
 *              customer name and email that never reach the website.
 *   Updates  : one row per update, filled in by the "Job update" Google Form.
 *
 *   Requests : one row per estimate form sent from the website (created automatically).
 *
 * The website asks this script for ONE job at a time by its code, so the sheet stays private.
 * The website's estimate forms post here too: each one is emailed to INBOX with the photos attached.
 *
 * After pasting a new version: Deploy > Manage deployments > pencil icon > Version: New version > Deploy.
 * (Keep the same deployment so the website address doesn't change.)
 */

const STAGES = ['Checked in', 'Prep & inspection', 'Install', 'Curing & finishing', 'Final inspection', 'Ready for pick-up'];
const JOBS = 'Jobs';
const UPDATES = 'Updates';
const SITE = 'https://mainlineautoworks.com/track/';
const SHOP = 'Main Line Auto Works';
const INBOX = 'info@mainlineautoworks.com';           // where website estimate forms are sent
const REQUESTS = 'Requests';
const UPLOADS = 'Website form photos';                 // Google Drive folder for uploaded photos
const WEBSITE = 'https://mainlineautoworks.com/';

/* ---------- one-time setup ---------- */

function setup() {
  const ss = SpreadsheetApp.getActive();
  // already set up: never build a second form (that's what makes "Form Responses 2, 3, 4...")
  if (ss.getSheetByName(UPDATES)) {
    repairTriggers();
    Logger.log('Already set up. Nothing new was created; automatic tasks were checked.');
    return;
  }
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
  squareMenu_();
  SpreadsheetApp.getUi().createMenu('Job Status')
    .addItem('New job…', 'newJob')
    .addItem('Show update form link', 'showFormLink')
    .addSeparator()
    .addItem('Set up the phone "New job" form', 'setupNewJobForm')
    .addItem('Show "New job" form link', 'showNewJobFormLink')
    .addSeparator()
    .addItem('Repair automatic tasks', 'repairTriggersMenu')
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

/* ---------- "New job" form: start a job from your phone ----------
 * Run once from the menu: Job Status > Set up the phone "New job" form.
 * Each submission adds the job with a random code, posts "Checked in",
 * emails the customer (if you gave an email) and emails YOU a one-tap
 * "Text the customer" button that opens Messages with the link filled in.
 */

const NEW_JOB_SERVICES = ['Vinyl Wrap', 'Caliper Painting', 'PPF', 'Ceramic Coating', 'Window Tint', 'Detailing'];
const NEW_JOB_FIRST_NOTE = 'Checked in. We’ll post updates here as we go.';

function setupNewJobForm() {
  const ui = SpreadsheetApp.getUi(), props = PropertiesService.getScriptProperties();
  let form, id = props.getProperty('NEW_JOB_FORM_ID');
  try { form = id ? FormApp.openById(id) : null; } catch (err) { form = null; }
  const isNew = !form;
  if (isNew) form = FormApp.create('New job · ' + SHOP);
  form.setDescription('Starts a job on the website. The license plate becomes the customer’s tracking code, and you get a one-tap text with their link.')
    .setConfirmationMessage('Job created. Check your email for the “Text the customer” button.');
  buildNewJobItems_(form);
  props.setProperties({ NEW_JOB_FORM_ID: form.getId(), SHEET_ID: SpreadsheetApp.getActive().getId() });
  repairTriggers();
  ui.alert(isNew ? '“New job” form is ready' : '“New job” form updated (same link as before)',
    'Bookmark this on your phone (or add it to your Home Screen):\n\n' + form.getPublishedUrl(), ui.ButtonSet.OK);
}

// License plate first, then the car, the work, the pick-up time, then the customer
function buildNewJobItems_(form) {
  form.getItems().forEach(i => form.deleteItem(i));
  form.addTextItem().setTitle('License plate').setHelpText('Becomes the customer’s tracking code. Spaces don’t matter.').setRequired(true);
  form.addTextItem().setTitle('Vehicle').setHelpText('Year, make, model, color, e.g. 2023 BMW X5, white').setRequired(true);
  form.addCheckboxItem().setTitle('Services').setChoiceValues(NEW_JOB_SERVICES).showOtherOption(true).setRequired(true);
  form.addDateTimeItem().setTitle('Estimated pick-up').setHelpText('Date and time you expect it to be ready');
  form.addTextItem().setTitle('Customer name').setRequired(true);
  form.addTextItem().setTitle('Customer phone').setHelpText('For the text with their tracking link').setRequired(true);
  form.addTextItem().setTitle('Customer email').setHelpText('Optional. They’ll also get each update by email.');
  form.addParagraphTextItem().setTitle('First note for the customer').setHelpText('Leave blank for: ' + NEW_JOB_FIRST_NOTE);
}

function cleanCode_(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9-]/g, ''); }

// Make sure each automatic task exists exactly once (safe to run any time)
function repairTriggers() {
  const ss = SpreadsheetApp.getActive(), props = PropertiesService.getScriptProperties();
  const have = name => ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === name);
  const once = (name, make) => { const t = have(name); t.slice(1).forEach(x => ScriptApp.deleteTrigger(x)); if (!t.length) make(); };
  once('onUpdate', () => ScriptApp.newTrigger('onUpdate').forSpreadsheet(ss).onFormSubmit().create());
  const nj = props.getProperty('NEW_JOB_FORM_ID');
  if (nj) once('onNewJob', () => ScriptApp.newTrigger('onNewJob').forForm(FormApp.openById(nj)).onFormSubmit().create());
  if (props.getProperty('SQ_TOKEN')) once('refreshSquare', () => ScriptApp.newTrigger('refreshSquare').timeBased().everyDays(7).create());
  return ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction());
}

function repairTriggersMenu() {
  const list = repairTriggers();
  SpreadsheetApp.getUi().alert('Automatic tasks are set', list.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

function showNewJobFormLink() {
  const id = PropertiesService.getScriptProperties().getProperty('NEW_JOB_FORM_ID');
  SpreadsheetApp.getUi().alert(id ? 'Bookmark this on your phone:\n\n' + FormApp.openById(id).getPublishedUrl()
    : 'Run Job Status > Set up the phone "New job" form first.');
}

function onNewJob(e) {
  const a = {};
  e.response.getItemResponses().forEach(ir => { a[ir.getItem().getTitle()] = ir.getResponse(); });
  const name = String(a['Customer name'] || '').trim(), first = name.split(/\s+/)[0] || 'there';
  const phone = String(a['Customer phone'] || '').trim(), email = String(a['Customer email'] || '').trim();
  const vehicle = String(a['Vehicle'] || '').trim();
  const services = [].concat(a['Services'] || []).join(', ');
  const ready = String(a['Estimated pick-up'] || a['Ready date'] || '');   // "yyyy-mm-dd HH:mm" or "yyyy-mm-dd"
  const plate = cleanCode_(a['License plate']);
  const note = String(a['First note for the customer'] || '').trim() || NEW_JOB_FIRST_NOTE;

  const sheet = (SpreadsheetApp.getActive() || SpreadsheetApp.openById(SHEET_ID_())).getSheetByName(JOBS);
  if (sheet.getRange(1, 9).getValue() === '') sheet.getRange(1, 9).setValue('Customer phone (private)').setFontWeight('bold');
  const existing = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat().map(String) : [];
  const taken = c => existing.some(x => cleanCode_(x) === c);
  let code;
  if (plate.length >= 2) { code = plate; for (let n = 2; taken(code); n++) code = plate + '-' + n; }   // repeat customer: PLATE-2, PLATE-3
  else { do { code = 'MLA-' + randomCode(4); } while (taken(code)); }
  const link = SITE + '?job=' + code;
  sheet.appendRow([code, vehicle, services, ready, STAGES[0], name, email, link, phone]);
  if (/\d:\d/.test(ready)) sheet.getRange(sheet.getLastRow(), 4).setNumberFormat('yyyy-mm-dd h:mm am/pm');
  addUpdate(code, 0, note, '');

  const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const when = ready ? niceWhen_(ready) : '';
  const text = 'Hi ' + first + ', your ' + vehicle + ' is checked in at ' + SHOP + '.' + (when ? ' Estimated pick-up: ' + when + '.' : '') +
    ' Follow along with photos and progress here: ' + link;
  const tel = e164_(phone) || phone.replace(/[^\d+]/g, '');
  const sms = 'sms:' + tel + '?&body=' + encodeURIComponent(text);

  // to you: one tap opens Messages with the text filled in
  const me = Session.getEffectiveUser().getEmail() || INBOX;
  MailApp.sendEmail({
    to: me, name: SHOP + ' Job Status',
    subject: 'New job ' + code + ' · ' + name + ' · ' + vehicle,
    htmlBody: '<div style="font-family:Arial,sans-serif;font-size:16px;color:#1D2125">' +
      '<p style="margin:0 0 6px"><b>' + esc(name) + '</b> · ' + esc(vehicle) + '</p>' +
      '<p style="margin:0 0 18px;color:#5b636a">' + esc(services) + (when ? ' · pick-up ' + esc(when) : '') + ' · code <b>' + code + '</b></p>' +
      '<p><a href="' + sms + '" style="display:inline-block;background:#C8102E;color:#fff;text-decoration:none;font-weight:bold;padding:14px 22px;border-radius:6px">Text ' + esc(first) + ' the tracking link</a></p>' +
      '<p style="margin-top:18px;color:#5b636a;font-size:14px">If the button doesn’t open Messages, copy this text:</p>' +
      '<p style="background:#F2F3F4;padding:12px;border-radius:6px">' + esc(text) + '</p>' +
      '<p style="font-size:14px"><a href="' + link + '">Open their Job Status page</a>' + (email ? ' · They were also emailed the link.' : '') + '</p></div>'
  });

  // to the customer, if you entered an email
  if (email) {
    MailApp.sendEmail({
      to: email, replyTo: INBOX, name: SHOP,
      subject: 'Your ' + vehicle + ' is checked in',
      htmlBody: '<div style="font-family:Arial,sans-serif;font-size:15px;color:#1D2125"><p>Hi ' + esc(first) + ',</p>' +
        '<p>Your ' + esc(vehicle) + ' is checked in at ' + SHOP + '. We’ll post photos and progress as we go.' + (when ? ' Estimated pick-up: <b>' + esc(when) + '</b>.' : '') + '</p>' +
        '<p><a href="' + link + '">Follow your car here</a> (tracking code <b>' + code + '</b>)</p>' +
        '<p>' + SHOP + ' · (484) 574-1628</p></div>'
    });
  }
}

// "2026-11-15 14:30" -> "Sat, Nov 15 at 2:30 PM"
function niceWhen_(v) {
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/); if (!m) return String(v);
  const d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), m[4] ? "EEE, MMM d 'at' h:mm a" : 'EEE, MMM d');
}

function SHEET_ID_() { return PropertiesService.getScriptProperties().getProperty('SHEET_ID'); }

/* ---------- when the form is submitted ---------- */

function onUpdate(e) {
  const r = e.namedValues;
  const code = cleanCode_((r['Tracking code'] || [''])[0]);
  const stage = stageIndex_((r['Stage'] || r['Progress'] || [''])[0]);
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
  const p = (e && e.parameter) || {};
  const out = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  if (p.code && p.state) return squareCallback_(p);                       // Square sends you back here after "Connect Square"
  if (p.action === 'slots') {
    try { return out(slotsFor_(p)); }
    catch (err) { return out({ ok: false, error: err.message === 'not_connected' ? 'not_connected' : String(err.message) }); }
  }
  const code = cleanCode_(p.job);
  if (!/^[A-Z0-9-]{2,20}$/.test(code)) return out({ error: 'not_found' });
  const row = findJobRow(code);
  if (!row) return out({ error: 'not_found' });
  const j = SpreadsheetApp.getActive().getSheetByName(JOBS).getRange(row, 1, 1, 5).getValues()[0];
  const tz = Session.getScriptTimeZone();
  const ready = j[3] instanceof Date
    ? Utilities.formatDate(j[3], tz, (j[3].getHours() || j[3].getMinutes()) ? "yyyy-MM-dd'T'HH:mm" : 'yyyy-MM-dd')
    : String(j[3] || '');
  return out({
    code: code,
    vehicle: String(j[1] || ''),
    services: String(j[2] || '').split(',').map(s => s.trim()).filter(String),
    stage: Math.max(0, stageIndex_(j[4])),
    ready: ready,
    updates: updatesFor(code)
  });
}

/* ---------- helpers ---------- */

function findJobRow(code) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(JOBS); if (!sheet) return 0;
  const n = sheet.getLastRow() - 1; if (n < 1) return 0;
  const codes = sheet.getRange(2, 1, n, 1).getValues().flat().map(cleanCode_);
  const i = codes.indexOf(code); return i < 0 ? 0 : i + 2;
}

function updatesFor(code) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(UPDATES); if (!sheet) return [];
  const data = sheet.getDataRange().getValues(); if (data.length < 2) return [];
  const head = data[0].map(String), col = name => head.indexOf(name);
  const cT = col('Timestamp'), cC = col('Tracking code'), cS = col('Stage') >= 0 ? col('Stage') : col('Progress'), cN = col('Note for the customer'), cP = col('Photo');
  const tz = Session.getScriptTimeZone();
  return data.slice(1)
    .filter(r => cleanCode_(r[cC]) === code)
    .map(r => {
      const id = cP >= 0 ? (String(r[cP]).match(/[-\w]{25,}/) || [''])[0] : '';
      return {
        date: r[cT] instanceof Date ? Utilities.formatDate(r[cT], tz, 'MMM d, h:mm a') : String(r[cT]),
        stage: Math.max(0, stageIndex_(r[cS])),
        note: cN >= 0 ? String(r[cN] || '') : '',
        photo: id ? 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1200' : ''
      };
    })
    .reverse();
}

function addUpdate(code, stageIndex, note, photo) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(UPDATES); if (!sheet) return;
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const row = head.map(h => h === 'Timestamp' ? new Date() : h === 'Tracking code' ? code : (h === 'Stage' || h === 'Progress') ? STAGES[stageIndex] : h === 'Note for the customer' ? note : h === 'Photo' ? photo : '');
  sheet.appendRow(row);
}

// Match a stage however it's worded in the form or sheet ("Prep & Inspection", "Install / Detailing", ...)
function stageIndex_(text) {
  const t = String(text || '').toLowerCase();
  const keys = ['checked', 'prep', 'install', 'curing', 'final', 'ready'];
  const exact = STAGES.findIndex(s => s.toLowerCase() === t.trim());
  if (exact >= 0) return exact;
  const i = keys.findIndex(k => t.indexOf(k) >= 0);
  return i;
}

function randomCode(n) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O or 1/I/L, so codes are easy to read over the phone
  let s = ''; for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)]; return s;
}


/* ---------- website estimate forms post here ---------- */

function doPost(e) {
  const out = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (d.action === 'book') {
      if (d.website || (d.ms && d.ms < 3000)) return out({ ok: false, error: 'slot_gone' });
      const lock = LockService.getScriptLock(); lock.waitLock(20000);
      try { return out(book_(d)); } finally { lock.releaseLock(); }
    }
    if (d.action !== 'intake') return out({ ok: false, error: 'unknown' });
    if (d.website || (d.ms && d.ms < 3000)) return out({ ok: true });            // bots fill the hidden field or submit instantly
    const clip = (v, n) => String(v == null ? '' : v).slice(0, n || 2000);
    const fields = (Array.isArray(d.fields) ? d.fields : []).slice(0, 40).map(f => [clip(f[0], 80), clip(f[1])]);
    const get = label => (fields.find(f => f[0] === label) || ['', ''])[1].trim();
    const formName = clip(d.form, 60) || 'Website';
    const name = (get('First name') + ' ' + get('Last name')).trim();
    const email = get('Email'), phone = get('Phone'), vehicle = get('Vehicle');
    if (!name || !phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return out({ ok: false, error: 'missing' });

    // photos: attach to the email and keep a copy in Drive
    const blobs = (Array.isArray(d.photos) ? d.photos : []).slice(0, 5).map((p, i) =>
      Utilities.newBlob(Utilities.base64Decode(String(p.data || '')), 'image/jpeg',
        (name.replace(/[^\w]+/g, '-') + '-' + (i + 1) + '.jpg')));
    const links = [];
    if (blobs.length) {
      const it = DriveApp.getFoldersByName(UPLOADS);
      const folder = it.hasNext() ? it.next() : DriveApp.createFolder(UPLOADS);
      blobs.forEach(b => links.push(folder.createFile(b.copyBlob()).getUrl()));
    }

    // add the person to Square's customer list, with the request saved as a note
    const skip = ['First name', 'Last name', 'Phone', 'Email', 'Vehicle'];
    const details = fields.filter(f => f[1] && skip.indexOf(f[0]) < 0).map(f => f[0] + ': ' + f[1]).join('\n');
    let inSquare = false;
    try { if (sqToken_()) inSquare = saveLeadToSquare_(get('First name'), get('Last name'), email, phone, formName, vehicle, details); } catch (err) {}

    const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    const rows = fields.filter(f => f[1]).map(f =>
      '<tr><td style="padding:6px 14px 6px 0;color:#5b636a;vertical-align:top;white-space:nowrap">' + esc(f[0]) +
      '</td><td style="padding:6px 0;font-weight:600">' + esc(f[1]) + '</td></tr>').join('');
    const tel = phone.replace(/[^\d+]/g, '');
    const html = '<div style="font-family:Arial,sans-serif;font-size:15px;color:#1D2125">' +
      '<h2 style="margin:0 0 4px">' + esc(formName) + ' request</h2>' +
      '<p style="margin:0 0 16px;color:#5b636a">From the website · <a href="tel:' + tel + '">Call</a> · <a href="sms:' + tel + '">Text</a> · Reply to this email to answer ' + esc(name.split(' ')[0]) + '</p>' +
      '<table style="border-collapse:collapse">' + rows + '</table>' +
      (blobs.length ? '<p style="margin-top:16px">' + blobs.length + ' photo' + (blobs.length > 1 ? 's' : '') + ' attached.</p>' : '') +
      (inSquare ? '<p style="margin-top:16px;color:#2e7d32">✓ Saved to your Square customers, with this request in their notes.</p>' : '') +
      '<p style="margin-top:16px;color:#8C959D;font-size:12px">Sent from ' + esc(clip(d.page, 300)) + '</p></div>';
    MailApp.sendEmail({
      to: INBOX, replyTo: email, name: SHOP + ' website',
      subject: formName + ' request: ' + name + (vehicle ? ' · ' + vehicle : ''),
      htmlBody: html, attachments: blobs
    });

    // "we got it" email to the customer
    try {
      const mine = fields.filter(f => f[1] && ['First name', 'Last name', 'Phone', 'Email'].indexOf(f[0]) < 0);
      const first = esc(get('First name'));
      MailApp.sendEmail({
        to: email, replyTo: INBOX, name: SHOP,
        subject: 'We got your request · ' + SHOP,
        htmlBody: '<div style="font-family:Arial,sans-serif;font-size:15px;color:#1D2125;max-width:560px">' +
          '<p>Hi ' + first + ',</p>' +
          '<p>Thanks for reaching out. We got your <b>' + esc(formName) + '</b> request and will get back to you soon with a price.</p>' +
          '<p style="margin:20px 0 6px;color:#5b636a">Here\'s what you sent:</p>' +
          '<table style="border-collapse:collapse">' + mine.map(f =>
            '<tr><td style="padding:4px 14px 4px 0;color:#5b636a;vertical-align:top;white-space:nowrap">' + esc(f[0]) +
            '</td><td style="padding:4px 0">' + esc(f[1]) + '</td></tr>').join('') + '</table>' +
          (blobs.length ? '<p style="color:#5b636a">Plus ' + blobs.length + ' photo' + (blobs.length > 1 ? 's' : '') + '.</p>' : '') +
          '<p style="margin-top:20px">Need us sooner? Call or text <a href="tel:+14845741628">(484) 574-1628</a>, or just reply to this email.</p>' +
          '<p style="margin-top:24px;color:#5b636a;font-size:13px">' + SHOP + '<br>1444 Phoenixville Pike, West Chester, PA 19380<br>' +
          '<a href="' + WEBSITE + '">' + WEBSITE.replace(/^https:\/\//, '').replace(/\/$/, '') + '</a></p></div>'
      });
    } catch (err) {}

    // log it
    const ss = SpreadsheetApp.getActive();
    let sh = ss.getSheetByName(REQUESTS);
    if (!sh) {
      sh = ss.insertSheet(REQUESTS);
      sh.getRange(1, 1, 1, 9).setValues([['Received', 'Form', 'Name', 'Phone', 'Email', 'Vehicle', 'Details', 'Photos', 'Status']]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    sh.appendRow([new Date(), formName, name, phone, email, vehicle, details, links.join('\n'), 'New']);
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, error: String(err && err.message || err) });
  }
}

/* =====================================================================
 * SQUARE ONE-STEP BOOKING
 * The website's detailing builder asks here for open times and books the
 * appointment straight into Square Appointments.
 *
 * One-time setup (Sheet menu: Square booking > Connect Square…):
 *   1. developer.squareup.com > Create an app (any name) > switch to Production
 *   2. OAuth page: paste the Redirect URL the menu shows you; copy the
 *      Application ID and Application secret into the menu prompts
 *   3. Click the link the menu gives you and approve
 * The access is limited to "customer booking" permissions, which is what
 * lets this work on Square's free Appointments plan.
 * Keys are stored only in this script's private properties.
 * ===================================================================== */

const SQ = 'https://connect.squareup.com';
const SQ_VERSION = '2024-12-18';
const SQ_LOCATION = 'L55RAA17AA9Y0';
const SQ_TZ = 'America/New_York';
const SQ_SCOPES = ['APPOINTMENTS_READ', 'APPOINTMENTS_WRITE', 'APPOINTMENTS_ALL_READ', 'APPOINTMENTS_BUSINESS_SETTINGS_READ',
  'CUSTOMERS_READ', 'CUSTOMERS_WRITE', 'ITEMS_READ', 'MERCHANT_PROFILE_READ'];

// Website package / extra  ->  the Square service it books
const SQ_PACKAGES = {
  quick: 'Express Detail', exterior: 'Exterior Detail', interior: 'Interior Detail', full: 'Full Vehicle Detail',
  supercar: 'Super Car Premium Package Detail', moto: 'Motorcycle Detail', 'moto-chain': 'Motorcycle Detail',
  // window tint (tint page)
  'tint-strip': 'Windshield Sun Banner', 'tint-front2': '2 Front Windows Tinted', 'tint-sedan': 'Sedan Full Vehicle Tinting',
  'tint-suv': 'Truck / SUV Full Vehicle Tinting', 'tint-windshield': 'Full Windshield Tinted', 'tint-removal': 'Window Tint Removal'
};
const SQ_EXTRAS = {
  shampoo: 'Carpet & Upholstery Shampoo', leather: 'Multi-Stage Leather Conditioning', odor: 'Odor Elimination',
  headlight: 'Headlight Restoration', engine: 'Engine Bay Detail', trim: 'Complete Trim Restoration',
  clay: '"Decon" + Clay Bar', windshield: 'Windshield Ceramic Coating'
  // floor mats have no Square service; they go in the booking note
};
// Website vehicle size -> words to look for in a Square service variation name
const SQ_SIZES = {
  moto: ['motorcycle', 'bike'], '1': ['coupe', '2 door', '2-door', 'car'], '2': ['sedan', '4 door', '4-door', 'car'],
  '3': ['mid', 'suv', 'crossover'], '4': ['large', 'truck', 'full-size', 'xl', 'suv']
};

function squareMenu_() {
  SpreadsheetApp.getUi().createMenu('Square booking')
    .addItem('Connect Square…', 'connectSquare')
    .addItem('Check Square booking', 'checkSquare')
    .addToUi();
}

// The same web app address the website uses. Square must send you back to exactly this address.
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbx8Sn6HCIIp_OTcchfsYQ0iToENevinNXVJ2sY2JXbneoX_sZ_59M7P2fbvEreDIJqTrA/exec';
function webAppUrl_() { return WEB_APP_URL || ScriptApp.getService().getUrl(); }

function connectSquare() {
  const ui = SpreadsheetApp.getUi(), props = PropertiesService.getScriptProperties();
  const url = webAppUrl_();
  if (!url) { ui.alert('Deploy the script as a web app first (Deploy > New deployment).'); return; }
  ui.alert('Step 1 of 3', 'In developer.squareup.com, open your app > Production > OAuth, and set the Redirect URL to:\n\n' + url + '\n\nThen click OK.', ui.ButtonSet.OK);
  const id = ui.prompt('Step 2 of 3', 'Paste the Production Application ID (starts with sq0idp-):', ui.ButtonSet.OK_CANCEL);
  if (id.getSelectedButton() !== ui.Button.OK) return;
  const secret = ui.prompt('Step 2 of 3', 'Paste the Production Application secret (starts with sq0csp-):', ui.ButtonSet.OK_CANCEL);
  if (secret.getSelectedButton() !== ui.Button.OK) return;
  const state = Utilities.getUuid();
  props.setProperties({ SQ_APP_ID: id.getResponseText().trim(), SQ_APP_SECRET: secret.getResponseText().trim(), SQ_STATE: state });
  const link = SQ + '/oauth2/authorize?client_id=' + encodeURIComponent(id.getResponseText().trim()) +
    '&scope=' + SQ_SCOPES.join('+') + '&session=false&state=' + state;
  const html = HtmlService.createHtmlOutput('<p style="font-family:Arial">Step 3 of 3: <a href="' + link + '" target="_blank">Click here to approve in Square</a>.</p>' +
    '<p style="font-family:Arial;color:#666">After you approve, you\'ll see “Square connected”. Then run Square booking > Check Square booking.</p>').setWidth(420).setHeight(160);
  ui.showModalDialog(html, 'Connect Square');
}

function squareCallback_(p) {
  const props = PropertiesService.getScriptProperties();
  const page = msg => HtmlService.createHtmlOutput('<div style="font-family:Arial;padding:40px;text-align:center"><h2>' + msg + '</h2><p>You can close this tab.</p></div>');
  if (!p.state || p.state !== props.getProperty('SQ_STATE')) return page('That link expired. Run Connect Square again.');
  if (p.error) return page('Square said: ' + String(p.error_description || p.error).replace(/</g, ''));
  const res = UrlFetchApp.fetch(SQ + '/oauth2/token', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'Square-Version': SQ_VERSION },
    payload: JSON.stringify({ client_id: props.getProperty('SQ_APP_ID'), client_secret: props.getProperty('SQ_APP_SECRET'),
      code: p.code, grant_type: 'authorization_code', redirect_uri: webAppUrl_() })
  });
  const t = JSON.parse(res.getContentText() || '{}');
  if (!t.access_token) return page('Square didn’t connect: ' + String((t.errors && t.errors[0] && t.errors[0].detail) || t.message || res.getResponseCode()).replace(/</g, ''));
  props.setProperties({ SQ_TOKEN: t.access_token, SQ_REFRESH: t.refresh_token || '', SQ_EXPIRES: t.expires_at || '' });
  if (!ScriptApp.getProjectTriggers().some(tr => tr.getHandlerFunction() === 'refreshSquare'))
    ScriptApp.newTrigger('refreshSquare').timeBased().everyDays(7).create();
  props.deleteProperty('SQ_STATE');
  CacheService.getScriptCache().remove('sq_catalog');
  return page('Square connected ✓');
}

function sqToken_() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('SQ_TOKEN');
  if (!token) return '';
  const exp = Date.parse(props.getProperty('SQ_EXPIRES') || '');
  if (exp && exp - Date.now() < 7 * 864e5 && props.getProperty('SQ_REFRESH')) {
    const res = UrlFetchApp.fetch(SQ + '/oauth2/token', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'Square-Version': SQ_VERSION },
      payload: JSON.stringify({ client_id: props.getProperty('SQ_APP_ID'), client_secret: props.getProperty('SQ_APP_SECRET'),
        grant_type: 'refresh_token', refresh_token: props.getProperty('SQ_REFRESH') })
    });
    const t = JSON.parse(res.getContentText() || '{}');
    if (t.access_token) {
      token = t.access_token;
      props.setProperties({ SQ_TOKEN: token, SQ_EXPIRES: t.expires_at || '', SQ_REFRESH: t.refresh_token || props.getProperty('SQ_REFRESH') });
    }
  }
  return token;
}

// keeps the connection fresh even if nobody books for a while (setup adds a weekly trigger)
function refreshSquare() { sqToken_(); }

function sq_(method, path, body) {
  const token = sqToken_();
  if (!token) throw new Error('not_connected');
  const res = UrlFetchApp.fetch(SQ + '/v2' + path, {
    method: method, contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, 'Square-Version': SQ_VERSION },
    payload: body ? JSON.stringify(body) : undefined
  });
  const j = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() >= 300) {
    const e = (j.errors && j.errors[0]) || {};
    const err = new Error(e.detail || e.code || ('HTTP ' + res.getResponseCode()));
    err.code = e.code; throw err;
  }
  return j;
}

// All bookable Square services: { normalizedName: { name, variations:[{id, version, name, minutes, price}] } }
function sqCatalog_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('sq_catalog'); if (hit) return JSON.parse(hit);
  const out = {}; let cursor;
  do {
    const j = sq_('post', '/catalog/search-catalog-items', { product_types: ['APPOINTMENTS_SERVICE'], limit: 100, cursor: cursor });
    (j.items || []).forEach(it => {
      const d = it.item_data || {};
      out[norm_(d.name)] = {
        name: d.name,
        variations: (d.variations || []).map(v => {
          const vd = v.item_variation_data || {};
          return { id: v.id, version: v.version, name: vd.name || '', minutes: Math.round((vd.service_duration || 0) / 60000),
            price: vd.price_money ? vd.price_money.amount / 100 : null, bookable: vd.available_for_booking !== false };
        })
      };
    });
    cursor = j.cursor;
  } while (cursor);
  cache.put('sq_catalog', JSON.stringify(out), 6 * 3600);
  return out;
}

function norm_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

function pickVariation_(svc, size) {
  const vs = svc.variations.filter(v => v.bookable);
  if (!vs.length) return null;
  if (vs.length === 1) return vs[0];
  const words = SQ_SIZES[String(size)] || [];
  for (const w of words) { const v = vs.find(x => norm_(x.name).indexOf(norm_(w)) >= 0); if (v) return v; }
  return vs[0];
}

// Turn the website's choice into the Square variations to book, plus anything that only goes in the note
function resolve_(pkg, size, extras) {
  const cat = sqCatalog_();
  const segs = [], missing = [];
  const main = cat[norm_(SQ_PACKAGES[pkg])];
  if (!main) throw new Error('package_not_found');
  const mv = pickVariation_(main, size); if (!mv) throw new Error('package_not_bookable');
  segs.push({ variation: mv, name: main.name });
  (extras || []).forEach(x => {
    const s = SQ_EXTRAS[x] && cat[norm_(SQ_EXTRAS[x])];
    const v = s && pickVariation_(s, size);
    if (v) segs.push({ variation: v, name: s.name }); else missing.push(x);
  });
  return { segs: segs, missing: missing };
}

function searchSlots_(segs, fromMs, toMs) {
  const j = sq_('post', '/bookings/availability/search', {
    query: { filter: {
      start_at_range: { start_at: new Date(fromMs).toISOString(), end_at: new Date(toMs).toISOString() },
      location_id: SQ_LOCATION,
      segment_filters: segs.map(s => ({ service_variation_id: s.variation.id }))
    } }
  });
  return j.availabilities || [];
}

function slotsFor_(p) {
  const extras = String(p.extras || '').split(',').filter(String);
  let r = resolve_(p.pkg, p.size, extras), avail;
  const from = Math.max(Date.now() + 5 * 60000, Date.parse(p.from) || 0);
  const to = from + 14 * 864e5;
  try { avail = searchSlots_(r.segs, from, to); }
  catch (err) {             // an add-on that can't be booked online: book the package and put the add-ons in the note
    if (r.segs.length < 2) throw err;
    r = { segs: r.segs.slice(0, 1), missing: extras };
    avail = searchSlots_(r.segs, from, to);
  }
  const seen = {}, slots = [];
  avail.forEach(a => { if (!seen[a.start_at]) { seen[a.start_at] = 1; slots.push(a.start_at); } });
  return { ok: true, tz: SQ_TZ, slots: slots, services: r.segs.map(s => s.name), notBooked: r.missing,
    minutes: r.segs.reduce((n, s) => n + s.variation.minutes, 0) };
}

function e164_(phone) {
  const d = String(phone).replace(/\D/g, '');
  return d.length === 10 ? '+1' + d : d.length === 11 && d[0] === '1' ? '+' + d : '';
}

function findOrCreateCustomer_(first, last, email, phone, createdNote) {
  const tryFind = filter => {
    const j = sq_('post', '/customers/search', { limit: 1, query: { filter: filter } });
    return j.customers && j.customers[0] && j.customers[0].id;
  };
  const tel = e164_(phone);
  let id = email && tryFind({ email_address: { exact: email } });
  if (!id && tel) id = tryFind({ phone_number: { exact: tel } });
  if (id) return id;
  const c = sq_('post', '/customers', { idempotency_key: Utilities.getUuid(), given_name: first, family_name: last || undefined,
    email_address: email, phone_number: tel || undefined, note: createdNote || 'Added by the website booking form' });
  return c.customer.id;
}

// Website estimate request -> Square customer, newest request first in their notes
function saveLeadToSquare_(first, last, email, phone, formName, vehicle, details) {
  const id = findOrCreateCustomer_(first, last, email, phone, 'Added from a website estimate request');
  try {
    const c = sq_('get', '/customers/' + id).customer || {};
    const entry = Utilities.formatDate(new Date(), SQ_TZ, 'MMM d, yyyy') + ': website ' + formName + ' request' +
      (vehicle ? ' (' + vehicle + ')' : '') + (details ? '. ' + details.replace(/\n/g, '; ') : '');
    const note = (entry + (c.note ? '\n' + c.note : '')).slice(0, 500);
    sq_('put', '/customers/' + id, { note: note, version: c.version });
  } catch (err) {}
  return true;
}

function book_(d) {
  const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 200);
  const first = clip(d.first, 60), last = clip(d.last, 60), email = clip(d.email, 120), phone = clip(d.phone, 30);
  if (!first || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || String(phone).replace(/\D/g, '').length < 10) return { ok: false, error: 'missing' };
  const start = Date.parse(d.start); if (!start || start < Date.now()) return { ok: false, error: 'slot_gone' };
  const extras = (Array.isArray(d.extras) ? d.extras : []).map(String);
  let r = resolve_(String(d.pkg), String(d.size), extras), avail;
  // re-check the exact time and take Square's own segments for it (staff, durations)
  const find = () => searchSlots_(r.segs, start - 60000, start + 24 * 3600000).find(a => Date.parse(a.start_at) === start);
  try { avail = find(); } catch (err) { if (r.segs.length < 2) throw err; r = { segs: r.segs.slice(0, 1), missing: extras }; avail = find(); }
  if (!avail) return { ok: false, error: 'slot_gone' };

  const customerId = findOrCreateCustomer_(first, last, email, phone);
  const note = [
    'Booked on the website.',
    'Vehicle: ' + clip(d.vehicle, 120) + (d.sizeLabel ? ' (' + clip(d.sizeLabel, 40) + ')' : ''),
    'Package: ' + clip(d.pkgName, 80),
    d.extraNames && d.extraNames.length ? 'Add-ons: ' + d.extraNames.map(x => clip(x, 60)).join(', ') : '',
    d.total ? 'Website price: ' + clip(d.total, 20) : '',
    d.reach ? 'Best way to reach: ' + clip(d.reach, 20) : '',
    d.notes ? 'Notes: ' + clip(d.notes, 1500) : ''
  ].filter(String).join('\n');
  const j = sq_('post', '/bookings', {
    idempotency_key: clip(d.key, 60) || Utilities.getUuid(),
    booking: {
      start_at: avail.start_at, location_id: SQ_LOCATION, customer_id: customerId, customer_note: note,
      appointment_segments: avail.appointment_segments.map(s => ({
        duration_minutes: s.duration_minutes, team_member_id: s.team_member_id,
        service_variation_id: s.service_variation_id, service_variation_version: s.service_variation_version }))
    }
  });
  const b = j.booking || {};
  // log it next to the other website requests
  try {
    const ss = SpreadsheetApp.getActive();
    let sh = ss.getSheetByName(REQUESTS);
    if (!sh) { sh = ss.insertSheet(REQUESTS); sh.getRange(1, 1, 1, 9).setValues([['Received', 'Form', 'Name', 'Phone', 'Email', 'Vehicle', 'Details', 'Photos', 'Status']]).setFontWeight('bold'); sh.setFrozenRows(1); }
    sh.appendRow([new Date(), 'Detail booking', (first + ' ' + last).trim(), phone, email, clip(d.vehicle, 120),
      Utilities.formatDate(new Date(avail.start_at), SQ_TZ, 'EEE MMM d, h:mm a') + '\n' + note, '', 'Booked in Square']);
  } catch (err) {}
  return { ok: true, id: b.id, status: b.status, start: avail.start_at };
}

function checkSquare() {
  const ui = SpreadsheetApp.getUi();
  try {
    CacheService.getScriptCache().remove('sq_catalog');
    const cat = sqCatalog_();
    const lines = [];
    Object.keys(SQ_PACKAGES).forEach(k => {
      const s = cat[norm_(SQ_PACKAGES[k])];
      lines.push((s ? '✓ ' : '✗ ') + k + ' → ' + SQ_PACKAGES[k] + (s ? '  [' + s.variations.map(v => (v.name || 'default') + ' ' + v.minutes + 'm').join(', ') + ']' : '  NOT FOUND'));
    });
    Object.keys(SQ_EXTRAS).forEach(k => { lines.push((cat[norm_(SQ_EXTRAS[k])] ? '✓ ' : '– ') + 'add-on ' + k + ' → ' + SQ_EXTRAS[k]); });
    const test = slotsFor_({ pkg: 'full', size: '2' });
    lines.push('', 'Open times found for a Full Vehicle Detail in the next 2 weeks: ' + test.slots.length);
    let profile = '';
    try { const bp = sq_('get', '/bookings/business-booking-profile'); profile = '\nOnline booking: ' + (bp.business_booking_profile.booking_enabled ? 'on' : 'OFF') + ', acceptance: ' + bp.business_booking_profile.booking_policy; } catch (err) {}
    ui.alert('Square booking check', lines.join('\n') + profile, ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('Square booking check', err.message === 'not_connected' ? 'Not connected yet. Run Square booking > Connect Square… first.' : 'Error: ' + err.message, ui.ButtonSet.OK);
  }
}
