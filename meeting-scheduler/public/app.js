(function () {
  'use strict';

  const RANGE_START = '2026-09-28';
  const RANGE_END_EXCLUSIVE = '2026-10-02'; // FullCalendar validRange end is exclusive
  const FALLBACK_COLOR = '#1c1b18'; // used only if a room's color is somehow missing
  const T = window.I18N.t;
  const ERR = window.I18N.errorText;

  // If the next meeting in the same room starts less than this many minutes
  // after the current one starts, the current (earlier / "upper") card
  // doesn't have enough vertical room to show its full content without
  // visually overlapping the next card, so it renders collapsed instead.
  const COMPACT_GAP_THRESHOLD_MIN = 60;

  const state = {
    rooms: [],
    meetings: [],
    icalSources: [],
    selectedRoomIds: new Set(), // empty set = show all
    editingMeetingId: null,
  };

  const el = (id) => document.getElementById(id);
  const calendarsContainer = el('calendarsContainer');
  const roomCalendars = new Map(); // roomId -> FullCalendar instance
  let activeCalendar = null; // whichever instance most recently handled a select/click, used by the modal

  // ---------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------
  function toast(message, isError) {
    const t = el('toast');
    t.textContent = message;
    t.style.background = isError ? '#7a2222' : '#141414';
    t.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  function roomColor(roomId) {
    const room = state.rooms.find((r) => r.id === roomId);
    return (room && room.color) || FALLBACK_COLOR;
  }

  function hexToFill(hex) {
    const clean = (hex || '#1c1b18').replace('#', '');
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, 0.09)`;
  }

  function roomFill(roomId) {
    return hexToFill(roomColor(roomId));
  }

  function fmtLocalInput(isoLike) {
    // "2026-09-28T09:00:00" -> "2026-09-28T09:00" for <input type=datetime-local>
    return (isoLike || '').slice(0, 16);
  }

  async function api(path, options) {
    const res = await fetch('/api' + path, {
      headers: options && options.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' } : undefined,
      ...options,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error(ERR({ code: data && data.code, message: data && data.error }));
      err.status = res.status;
      err.code = data && data.code;
      throw err;
    }
    return data;
  }

  // ---------------------------------------------------------------------
  // Rooms
  // ---------------------------------------------------------------------
  async function loadRooms() {
    state.rooms = await api('/rooms');
    renderRoomList();
    renderRoomSelects();
    renderCalendars();
  }

  function renderRoomList() {
    const list = el('roomList');
    list.innerHTML = '';
    state.rooms.forEach((room) => {
      const row = document.createElement('div');
      row.className = 'room-row';

      const swatchLabel = document.createElement('label');
      swatchLabel.className = 'room-swatch-label';
      swatchLabel.title = T('admin.room.colorPickTitle');

      const swatch = document.createElement('span');
      swatch.className = 'room-swatch';
      swatch.style.background = roomColor(room.id);

      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.className = 'room-color-input';
      colorInput.value = roomColor(room.id);
      colorInput.addEventListener('input', () => {
        swatch.style.background = colorInput.value; // live preview while dragging
      });
      colorInput.addEventListener('change', async () => {
        const newColor = colorInput.value;
        try {
          await api(`/rooms/${room.id}`, { method: 'PUT', body: JSON.stringify({ color: newColor }) });
          room.color = newColor;
          renderCalendars();
        } catch (err) {
          toast(err.message, true);
          swatch.style.background = roomColor(room.id); // revert preview on failure
        }
      });

      swatchLabel.append(colorInput, swatch);

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !state.selectedRoomIds.has(room.id);
      checkbox.id = `room-chk-${room.id}`;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) state.selectedRoomIds.delete(room.id);
        else state.selectedRoomIds.add(room.id);
        renderCalendars();
      });

      const label = document.createElement('label');
      label.htmlFor = checkbox.id;
      label.textContent = room.name;

      const editBtn = document.createElement('button');
      editBtn.className = 'icon-btn';
      editBtn.title = T('admin.rooms.renamePrompt');
      editBtn.textContent = '✎';
      editBtn.type = 'button';
      editBtn.addEventListener('click', () => renameRoom(room));

      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn';
      delBtn.title = T('common.delete');
      delBtn.textContent = '✕';
      delBtn.type = 'button';
      delBtn.addEventListener('click', () => deleteRoom(room));

      row.append(checkbox, swatchLabel, label, editBtn, delBtn);
      list.appendChild(row);
    });
  }

  function renderRoomSelects() {
    [el('meetingRoom'), el('icalRoomSelect')].forEach((select) => {
      const prevValue = select.value;
      select.innerHTML = '';
      state.rooms.forEach((room) => {
        const opt = document.createElement('option');
        opt.value = room.id;
        opt.textContent = room.name;
        select.appendChild(opt);
      });
      if (prevValue) select.value = prevValue;
    });
  }

  async function renameRoom(room) {
    const name = prompt(T('admin.rooms.renamePrompt'), room.name);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === room.name) return;
    try {
      await api(`/rooms/${room.id}`, { method: 'PUT', body: JSON.stringify({ name: trimmed }) });
      await loadRooms();
      await loadMeetings();
      toast(T('admin.room.updated'));
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function deleteRoom(room) {
    if (!confirm(T('admin.rooms.deleteConfirm', { name: room.name }))) return;
    try {
      await api(`/rooms/${room.id}`, { method: 'DELETE' });
      await loadRooms();
      await loadMeetings();
      toast(T('admin.room.deleted'));
    } catch (err) {
      toast(err.message, true);
    }
  }

  el('addRoomForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = el('newRoomName');
    const name = input.value.trim();
    if (!name) return;
    try {
      await api('/rooms', { method: 'POST', body: JSON.stringify({ name }) });
      input.value = '';
      await loadRooms();
      toast(T('admin.room.added'));
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---------------------------------------------------------------------
  // Meetings / Calendar
  // ---------------------------------------------------------------------
  async function loadMeetings() {
    state.meetings = await api('/meetings');
    renderCalendars();
  }

  function eventsForRoom(roomId) {
    return state.meetings
      .filter((m) => m.room_id === roomId)
      .map((m) => ({
        id: String(m.id),
        title: m.topic,
        start: m.start_time,
        end: m.end_time,
        backgroundColor: roomColor(roomId),
        extendedProps: m,
      }));
  }

  // Meetings whose next same-room neighbour starts too soon after them to
  // fit the full card content — these render in the compact one-line form.
  function computeCompactIds(roomId) {
    const list = state.meetings
      .filter((m) => m.room_id === roomId)
      .slice()
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
    const compact = new Set();
    for (let i = 0; i < list.length - 1; i++) {
      const gapMin = (new Date(list[i + 1].start_time) - new Date(list[i].start_time)) / 60000;
      if (gapMin < COMPACT_GAP_THRESHOLD_MIN) compact.add(list[i].id);
    }
    return compact;
  }

  // Rebuild the room columns. Called whenever the room list, meeting data,
  // language, or the visible-rooms filter changes. Instances are destroyed
  // and recreated each time — dataset is small so this stays instant, and
  // it keeps the per-room filtering logic in one place.
  function renderCalendars() {
    roomCalendars.forEach((cal) => cal.destroy());
    roomCalendars.clear();
    calendarsContainer.innerHTML = '';

    const visibleRooms = state.rooms.filter((r) => !state.selectedRoomIds.has(r.id));

    if (!visibleRooms.length) {
      const empty = document.createElement('div');
      empty.className = 'calendars-empty';
      empty.textContent = state.rooms.length
        ? T('admin.calendars.emptyFiltered')
        : T('admin.calendars.emptyNoRooms');
      calendarsContainer.appendChild(empty);
      return;
    }

    const fcLocale = window.I18N.getLang() === 'zh' ? 'zh-cn' : 'en';
    const hostLabel = window.I18N.getLang() === 'zh' ? '主持：' : 'Host: ';
    const linkLabel = window.I18N.getLang() === 'zh' ? '参会名单 ↗' : 'Attendee list ↗';

    visibleRooms.forEach((room) => {
      const col = document.createElement('div');
      col.className = 'room-calendar-col';

      const header = document.createElement('div');
      header.className = 'room-col-header';
      header.innerHTML = `
        <span class="room-swatch" style="background:${roomColor(room.id)}"></span>
        <span class="room-col-name">${escapeHtml(room.name)}</span>
      `;

      const body = document.createElement('div');
      body.className = 'room-col-body';

      col.append(header, body);
      calendarsContainer.appendChild(col);

      const compactIds = computeCompactIds(room.id);

      const cal = new FullCalendar.Calendar(body, {
        initialView: 'fourDay',
        initialDate: RANGE_START,
        validRange: { start: RANGE_START, end: RANGE_END_EXCLUSIVE },
        views: { fourDay: { type: 'timeGrid', duration: { days: 4 } } },
        headerToolbar: { left: '', center: '', right: '' },
        dayHeaderFormat: { month: 'numeric', day: 'numeric', weekday: 'short' },
        slotMinTime: '00:00:00',
        slotMaxTime: '24:00:00',
        slotDuration: '00:30:00',
        slotLabelInterval: '02:00:00',
        allDaySlot: false,
        nowIndicator: true,
        height: 'auto',
        expandRows: true,
        locale: fcLocale,
        firstDay: 1,
        selectable: true,
        selectMirror: true,
        eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
        slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
        events: eventsForRoom(room.id),
        select: (info) => {
          activeCalendar = cal;
          openMeetingModal(null, { start: info.start, end: info.end, roomId: room.id });
        },
        eventClick: (info) => {
          activeCalendar = cal;
          openMeetingModal(Number(info.event.id));
        },
        eventContent: (arg) => {
          const m = arg.event.extendedProps;
          const fmt = (d) => d.toTimeString().slice(0, 5);
          const wrap = document.createElement('div');
          wrap.className = 'event-card' + (compactIds.has(m.id) ? ' compact' : '');
          const cardColor = m.card_color || roomColor(room.id);
          wrap.style.setProperty('--card-accent', cardColor);
          wrap.style.setProperty('--card-fill', hexToFill(cardColor));
          const linkHtml = m.attendee_link
            ? `<a class="ev-link" href="${escapeHtml(m.attendee_link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${linkLabel}</a>`
            : '';
          wrap.innerHTML = `
            <div class="ev-time">${fmt(arg.event.start)} – ${fmt(arg.event.end)}</div>
            <div class="ev-topic">${escapeHtml(m.topic)}</div>
            <div class="ev-host">${hostLabel}${escapeHtml(m.host)}</div>
            ${linkHtml}
          `;
          return { domNodes: [wrap] };
        },
      });
      cal.render();
      roomCalendars.set(room.id, cal);
    });
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---------------------------------------------------------------------
  // Meeting modal
  // ---------------------------------------------------------------------
  const overlay = el('meetingModalOverlay');
  const form = el('meetingForm');
  const formError = el('meetingFormError');

  function syncCardColorUI(hex, touched) {
    el('meetingCardColor').value = hex;
    el('meetingCardColorSwatch').style.background = hex;
    el('meetingCardColorText').textContent = touched ? T('admin.meeting.colorCustom') : T('admin.meeting.colorDefault');
  }

  function openMeetingModal(meetingId, prefillRange) {
    state.editingMeetingId = meetingId || null;
    form.reset();
    formError.classList.remove('show');
    renderRoomSelects();

    if (meetingId) {
      const m = state.meetings.find((x) => x.id === meetingId);
      if (!m) return;
      el('meetingModalTitle').textContent = T('admin.meeting.titleEdit');
      el('meetingId').value = m.id;
      el('meetingRoom').value = m.room_id;
      el('meetingTopic').value = m.topic;
      el('meetingHost').value = m.host;
      el('meetingStart').value = fmtLocalInput(m.start_time);
      el('meetingEnd').value = fmtLocalInput(m.end_time);
      el('meetingLink').value = m.attendee_link || '';
      el('meetingDeleteBtn').style.display = '';
      state.colorTouched = !!m.card_color;
      syncCardColorUI(m.card_color || roomColor(m.room_id), state.colorTouched);
    } else {
      el('meetingModalTitle').textContent = T('admin.meeting.titleNew');
      el('meetingId').value = '';
      el('meetingDeleteBtn').style.display = 'none';
      if (prefillRange) {
        el('meetingStart').value = fmtLocalInput(toLocalIsoNoZone(prefillRange.start));
        el('meetingEnd').value = fmtLocalInput(toLocalIsoNoZone(prefillRange.end));
        if (prefillRange.roomId) el('meetingRoom').value = prefillRange.roomId;
      }
      state.colorTouched = false;
      syncCardColorUI(roomColor(Number(el('meetingRoom').value)), false);
    }
    overlay.classList.add('open');
    setTimeout(() => el('meetingRoom').focus(), 30);
  }

  // While no custom color has been chosen, keep the preview following
  // whichever room is currently selected in the dropdown.
  el('meetingRoom').addEventListener('change', () => {
    if (!state.colorTouched) syncCardColorUI(roomColor(Number(el('meetingRoom').value)), false);
  });

  el('meetingCardColor').addEventListener('input', () => {
    state.colorTouched = true;
    syncCardColorUI(el('meetingCardColor').value, true);
  });

  el('meetingColorResetBtn').addEventListener('click', () => {
    state.colorTouched = false;
    syncCardColorUI(roomColor(Number(el('meetingRoom').value)), false);
  });

  function toLocalIsoNoZone(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
  }

  function closeMeetingModal() {
    overlay.classList.remove('open');
    if (activeCalendar) activeCalendar.unselect();
  }

  el('meetingModalClose').addEventListener('click', closeMeetingModal);
  el('meetingCancelBtn').addEventListener('click', closeMeetingModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeMeetingModal(); });

  el('meetingSaveBtn').addEventListener('click', () => form.requestSubmit());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.classList.remove('show');
    const payload = {
      room_id: el('meetingRoom').value,
      topic: el('meetingTopic').value.trim(),
      host: el('meetingHost').value.trim(),
      start_time: el('meetingStart').value,
      end_time: el('meetingEnd').value,
      attendee_link: el('meetingLink').value.trim(),
      card_color: state.colorTouched ? el('meetingCardColor').value : '',
    };
    const id = el('meetingId').value;
    try {
      if (id) {
        await api(`/meetings/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast(T('admin.meeting.updated'));
      } else {
        await api('/meetings', { method: 'POST', body: JSON.stringify(payload) });
        toast(T('admin.meeting.created'));
      }
      closeMeetingModal();
      await loadMeetings();
    } catch (err) {
      formError.textContent = err.message;
      formError.classList.add('show');
    }
  });

  el('meetingDeleteBtn').addEventListener('click', async () => {
    const id = el('meetingId').value;
    if (!id) return;
    if (!confirm(T('admin.meeting.deleteConfirm'))) return;
    try {
      await api(`/meetings/${id}`, { method: 'DELETE' });
      toast(T('admin.meeting.deleted'));
      closeMeetingModal();
      await loadMeetings();
    } catch (err) {
      toast(err.message, true);
    }
  });

  el('btnAddMeeting').addEventListener('click', () => openMeetingModal(null));

  // Enter-key navigation between form fields.
  function wireEnterNavigation(container) {
    const fields = Array.from(container.querySelectorAll('input, select, textarea'));
    fields.forEach((field, idx) => {
      field.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        if (field.tagName === 'TEXTAREA') return; // allow newline
        e.preventDefault();
        const next = fields[idx + 1];
        if (next) next.focus();
        else if (typeof container.requestSubmit === 'function') container.requestSubmit();
      });
    });
  }
  wireEnterNavigation(form);
  wireEnterNavigation(el('addIcalForm'));

  // ---------------------------------------------------------------------
  // Export to Excel
  // ---------------------------------------------------------------------
  function splitDateTime(isoLike) {
    const d = new Date((isoLike || '').replace(' ', 'T'));
    const pad = (n) => String(n).padStart(2, '0');
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      weekday: T(`weekday.${d.getDay()}`),
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    };
  }

  // Excel sheet names can't contain \ / ? * [ ] : and are capped at 31 chars.
  function sanitizeSheetName(name, fallback) {
    const cleaned = String(name || fallback).replace(/[\\/?*\[\]:]/g, '').slice(0, 31);
    return cleaned || fallback;
  }

  function meetingRow(m, idx, includeRoom) {
    const start = splitDateTime(m.start_time);
    const end = splitDateTime(m.end_time);
    const row = { [T('admin.export.col.no')]: idx + 1, [T('admin.export.col.date')]: start.date, [T('admin.export.col.weekday')]: start.weekday };
    if (includeRoom) row[T('admin.export.col.room')] = m.room_name;
    row[T('admin.export.col.start')] = start.time;
    row[T('admin.export.col.end')] = end.time;
    row[T('admin.export.col.topic')] = m.topic;
    row[T('admin.export.col.host')] = m.host;
    row[T('admin.export.col.link')] = m.attendee_link || '';
    return row;
  }

  function buildSheet(rows, includeRoom) {
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = includeRoom
      ? [{ wch: 6 }, { wch: 12 }, { wch: 7 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 26 }, { wch: 12 }, { wch: 32 }]
      : [{ wch: 6 }, { wch: 12 }, { wch: 7 }, { wch: 10 }, { wch: 10 }, { wch: 26 }, { wch: 12 }, { wch: 32 }];
    // Freeze the header row so it stays visible while scrolling long sheets.
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    return ws;
  }

  el('btnExport').addEventListener('click', () => {
    if (!window.XLSX) { toast(T('admin.export.notLoaded'), true); return; }
    if (!state.meetings.length) { toast(T('admin.export.noData'), true); return; }

    const wb = XLSX.utils.book_new();
    const overviewName = T('admin.export.sheetOverview');

    // Sheet 1: chronological overview across every room — a single index
    // to scan the whole four-day window at a glance.
    const overviewRows = state.meetings
      .slice()
      .sort((a, b) => a.start_time.localeCompare(b.start_time))
      .map((m, idx) => meetingRow(m, idx, true));
    XLSX.utils.book_append_sheet(wb, buildSheet(overviewRows, true), overviewName);

    // One sheet per room, each sorted chronologically within that room —
    // easier to hand a single room's schedule to whoever manages it.
    const usedSheetNames = new Set([overviewName]);
    state.rooms.forEach((room) => {
      const roomMeetings = state.meetings
        .filter((m) => m.room_id === room.id)
        .slice()
        .sort((a, b) => a.start_time.localeCompare(b.start_time));
      if (!roomMeetings.length) return; // skip empty rooms, nothing to show
      const rows = roomMeetings.map((m, idx) => meetingRow(m, idx, false));
      let sheetName = sanitizeSheetName(room.name, `Room${room.id}`);
      while (usedSheetNames.has(sheetName)) sheetName = `${sheetName}_`;
      usedSheetNames.add(sheetName);
      XLSX.utils.book_append_sheet(wb, buildSheet(rows, false), sheetName);
    });

    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const filename = `meeting-schedule_${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}.xlsx`;
    XLSX.writeFile(wb, filename);
    toast(T('admin.export.done'));
  });

  // ---------------------------------------------------------------------
  // iCal sources
  // ---------------------------------------------------------------------
  async function loadIcalSources() {
    state.icalSources = await api('/ical-sources');
    renderIcalList();
  }

  function renderIcalList() {
    const list = el('icalList');
    list.innerHTML = '';
    if (!state.icalSources.length) {
      const empty = document.createElement('div');
      empty.className = 'legend-hint';
      empty.textContent = T('admin.ical.empty');
      list.appendChild(empty);
      return;
    }
    state.icalSources.forEach((src) => {
      const row = document.createElement('div');
      row.className = 'ical-source-row';
      row.innerHTML = `
        <div class="name">${escapeHtml(src.name)}</div>
        <div class="status">${src.last_sync_status ? escapeHtml(src.last_sync_status) : T('admin.ical.notSynced')}</div>
      `;
      const actions = document.createElement('div');
      actions.className = 'row-actions';

      const syncBtn = document.createElement('button');
      syncBtn.className = 'icon-btn';
      syncBtn.textContent = T('admin.ical.syncNow');
      syncBtn.type = 'button';
      syncBtn.addEventListener('click', async () => {
        try {
          await api(`/ical-sources/${src.id}/sync-now`, { method: 'POST' });
          toast(T('admin.ical.syncStarted'));
          setTimeout(() => { loadIcalSources(); loadMeetings(); }, 4000);
        } catch (err) {
          toast(err.message, true);
        }
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn';
      delBtn.textContent = T('admin.ical.deleteBtn');
      delBtn.type = 'button';
      delBtn.addEventListener('click', async () => {
        if (!confirm(T('admin.ical.deleteConfirm', { name: src.name }))) return;
        await api(`/ical-sources/${src.id}`, { method: 'DELETE' });
        await loadIcalSources();
      });

      actions.append(syncBtn, delBtn);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  el('addIcalForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = el('icalName').value.trim();
    const url = el('icalUrl').value.trim();
    const room_id = el('icalRoomSelect').value;
    if (!name || !url) return;
    try {
      await api('/ical-sources', { method: 'POST', body: JSON.stringify({ name, url, room_id }) });
      el('icalName').value = '';
      el('icalUrl').value = '';
      await loadIcalSources();
      toast(T('admin.ical.added'));
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---------------------------------------------------------------------
  // Invite guest (QR code)
  // ---------------------------------------------------------------------
  const inviteOverlay = el('inviteModalOverlay');
  let qrInstance = null;

  function buildInviteUrl(address) {
    const port = state.serverPort || location.port || '3000';
    return `http://${address}:${port}/guest`;
  }

  function renderInviteQr(address) {
    const url = buildInviteUrl(address);
    el('inviteLinkText').value = url;
    const qrWrap = el('inviteQrWrap');
    qrWrap.innerHTML = '';
    if (!window.QRCode) {
      qrWrap.textContent = T('admin.inviteModal.qrFailed');
      return;
    }
    qrInstance = new QRCode(qrWrap, {
      text: url,
      width: 200,
      height: 200,
      colorDark: '#1c1b18',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M,
    });
  }

  async function openInviteModal() {
    inviteOverlay.classList.add('open');
    const select = el('inviteAddressSelect');
    select.innerHTML = `<option>${T('common.loading')}</option>`;
    try {
      const info = await api('/server-info');
      state.serverPort = info.port;
      select.innerHTML = '';
      const addresses = info.addresses && info.addresses.length ? info.addresses : [location.hostname];
      addresses.forEach((addr) => {
        const opt = document.createElement('option');
        opt.value = addr;
        opt.textContent = addr;
        select.appendChild(opt);
      });
      renderInviteQr(select.value);
    } catch (err) {
      select.innerHTML = `<option>${location.hostname}</option>`;
      renderInviteQr(location.hostname);
    }
  }

  el('btnInviteGuest').addEventListener('click', openInviteModal);
  el('inviteModalClose').addEventListener('click', () => inviteOverlay.classList.remove('open'));
  inviteOverlay.addEventListener('click', (e) => { if (e.target === inviteOverlay) inviteOverlay.classList.remove('open'); });
  el('inviteAddressSelect').addEventListener('change', (e) => renderInviteQr(e.target.value));
  el('inviteCopyBtn').addEventListener('click', async () => {
    const text = el('inviteLinkText').value;
    try {
      await navigator.clipboard.writeText(text);
      toast(T('admin.inviteModal.copied'));
    } catch (err) {
      el('inviteLinkText').select();
      document.execCommand('copy');
      toast(T('admin.inviteModal.copied'));
    }
  });

  // ---------------------------------------------------------------------
  // Language toggle
  // ---------------------------------------------------------------------
  el('langToggleBtn').addEventListener('click', () => window.I18N.toggle());
  document.addEventListener('i18n:change', () => {
    renderRoomList();
    renderIcalList();
    renderCalendars();
  });

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  async function boot() {
    window.I18N.applyStaticI18n(document);
    if (!window.FullCalendar) {
      el('statusHint').textContent = window.I18N.getLang() === 'zh'
        ? 'FullCalendar 加载失败，请检查网络或 CDN 是否被拦截'
        : 'FullCalendar failed to load — check your network or CDN access';
      return;
    }
    try {
      await loadRooms();
      await loadMeetings();
      await loadIcalSources();
    } catch (err) {
      toast(err.message, true);
    }
  }

  boot();
})();
