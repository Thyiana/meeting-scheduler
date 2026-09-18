(function () {
  'use strict';

  const RANGE_START = '2026-09-28';
  const RANGE_END_EXCLUSIVE = '2026-10-01'; // FullCalendar validRange end is exclusive
  const FALLBACK_COLOR = '#1c1b18'; // used only if a room's color is somehow missing
  const POLL_INTERVAL_MS = 10000; // silent background refresh -> conflict-avoidance
  const CLOCK_TICK_MS = 30000; // redraw the now-line / past-greyout / ongoing-pulse
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
    selectedRoomIds: new Set(), // empty set = show all
    editingMeetingId: null,
    fullDay: false,
    searchQuery: '',
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

  function fmtLocalInput(isoLike) {
    // "2026-09-28T09:00:00" -> "2026-09-28T09:00" for <input type=datetime-local>
    return (isoLike || '').slice(0, 16);
  }

  function fullDateLabel(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return window.I18N.getLang() === 'zh'
      ? `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function classifyEvent(m) {
    const now = new Date();
    const start = new Date(m.start_time);
    const end = new Date(m.end_time);
    if (end <= now) return 'past';
    if (start <= now && now < end) return 'ongoing';
    return 'upcoming';
  }

  function showBufferWarning(warning) {
    if (!warning) return;
    const key = warning.code === 'BUFFER_TOO_SHORT_AFTER' ? 'buffer.warningAfter' : 'buffer.warningBefore';
    setTimeout(() => toast(T(key, { minutes: warning.minutes, topic: warning.topic })), 3400);
  }

  let offline = false;
  function setOffline(isOffline) {
    if (offline === isOffline) return;
    offline = isOffline;
    el('statusHint').textContent = isOffline
      ? (window.I18N.getLang() === 'zh' ? '网络已断开，正在离线显示上次缓存的数据' : 'Offline — showing last cached data')
      : '';
  }

  async function api(path, options) {
    const res = await fetch('/api' + path, {
      headers: options && options.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' } : undefined,
      ...options,
    }).catch((networkErr) => {
      setOffline(true);
      throw networkErr;
    });
    setOffline(false);
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error(ERR({ code: data && data.code, message: data && data.error }));
      err.status = res.status;
      err.code = data && data.code;
      err.data = data;
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
    if (typeof renderRoomBannerSelect === 'function') renderRoomBannerSelect();
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
    [el('meetingRoom')].forEach((select) => {
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
  async function loadMeetings(silent) {
    try {
      state.meetings = await api('/meetings');
      renderCalendars();
    } catch (err) {
      if (!silent) toast(err.message, true);
    }
  }

  function matchesSearch(m) {
    if (!state.searchQuery) return true;
    const q = state.searchQuery.toLowerCase();
    return (m.topic || '').toLowerCase().includes(q) || (m.host || '').toLowerCase().includes(q);
  }

  function eventsForRoom(roomId) {
    return state.meetings
      .filter((m) => m.room_id === roomId && matchesSearch(m))
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

  // Repositions the "now" time-label badge next to FullCalendar's built-in
  // red line, for every visible room column.
  function renderNowBadges() {
    roomCalendars.forEach((cal, roomId) => {
      const container = calendarsContainer.querySelector(`[data-room-id="${roomId}"] .room-col-body`);
      if (!container) return;
      const line = container.querySelector('.fc-timegrid-now-indicator-line');
      if (!line) return;
      let badge = container.querySelector('.now-badge');
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'now-badge';
        line.parentElement.appendChild(badge);
      }
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      badge.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      badge.style.top = line.style.top;
    });
  }

  // Rebuild the room columns. Called whenever the room list, meeting data,
  // language, search query, 24H toggle, or the visible-rooms filter changes.
  // Instances are destroyed and recreated each time — dataset is small so
  // this stays instant, and it keeps the per-room filtering logic in one
  // place.
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

    if (state.searchQuery && !state.meetings.some(matchesSearch)) {
      const empty = document.createElement('div');
      empty.className = 'calendars-empty';
      empty.textContent = T('admin.calendars.emptySearch', { query: state.searchQuery });
      calendarsContainer.appendChild(empty);
    }

    const fcLocale = window.I18N.getLang() === 'zh' ? 'zh-cn' : 'en';
    const hostLabel = window.I18N.getLang() === 'zh' ? '主持：' : 'Host: ';
    const linkLabel = window.I18N.getLang() === 'zh' ? '参会名单 ↗' : 'Attendee list ↗';

    visibleRooms.forEach((room) => {
      const col = document.createElement('div');
      col.className = 'room-calendar-col';
      col.dataset.roomId = room.id;

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
        views: { fourDay: { type: 'timeGrid', duration: { days: 3 } } },
        headerToolbar: { left: '', center: '', right: '' },
        dayHeaderContent: (arg) => fullDateLabel(arg.date.toISOString().slice(0, 10)) + ' ' + T(`weekday.${arg.date.getDay()}`),
        slotMinTime: state.fullDay ? '00:00:00' : '08:00:00',
        slotMaxTime: state.fullDay ? '24:00:00' : '20:00:00',
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
          const cls = classifyEvent(m);
          wrap.className = 'event-card'
            + (compactIds.has(m.id) ? ' compact' : '')
            + (cls === 'past' ? ' ev-past' : '')
            + (cls === 'ongoing' ? ' ev-ongoing' : '');
          const cardColor = m.card_color || roomColor(room.id);
          wrap.style.setProperty('--card-accent', cardColor);
          wrap.style.setProperty('--card-fill', hexToFill(cardColor));
          const linkHtml = m.attendee_link
            ? `<a class="ev-link" href="${escapeHtml(m.attendee_link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${linkLabel}</a>`
            : '';
          wrap.innerHTML = `
            <div class="ev-time">${fmt(arg.event.start)} – ${fmt(arg.event.end)}${cls === 'ongoing' ? ' · ' + T('signage.ongoing') : ''}</div>
            <div class="ev-topic">${escapeHtml(m.topic)}</div>
            <div class="ev-host">${hostLabel}${escapeHtml(m.host)}</div>
            ${linkHtml}
          `;
          return { domNodes: [wrap] };
        },
        eventDidMount: () => setTimeout(renderNowBadges, 0),
      });
      cal.render();
      roomCalendars.set(room.id, cal);
    });
    setTimeout(renderNowBadges, 30);
  }

  el('fullDayToggle').addEventListener('change', (e) => {
    state.fullDay = e.target.checked;
    renderCalendars();
  });

  let searchDebounce = null;
  el('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.searchQuery = e.target.value.trim();
      renderCalendars();
    }, 200);
  });

  // Scrolls every visible room column to "now" (or, if nothing is
  // scheduled around now, the first meeting of the range) so the operator
  // doesn't have to hunt through a long day.
  el('jumpNowBtn').addEventListener('click', () => {
    const now = new Date();
    const inRange = now >= new Date(RANGE_START) && now < new Date(RANGE_END_EXCLUSIVE);
    let target = inRange ? now : null;
    if (!target) {
      const firstMeeting = state.meetings.slice().sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
      target = firstMeeting ? new Date(firstMeeting.start_time) : new Date(RANGE_START + 'T09:00:00');
    }
    roomCalendars.forEach((cal) => cal.scrollToTime({ hours: target.getHours(), minutes: target.getMinutes() }));
  });

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
  let editingUpdatedAt = null;

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
      editingUpdatedAt = m.updated_at || null;
      el('meetingModalTitle').textContent = T('admin.meeting.titleEdit');
      el('meetingId').value = m.id;
      el('meetingRoom').value = m.room_id;
      el('meetingTopic').value = m.topic;
      el('meetingHost').value = m.host;
      el('meetingStart').value = fmtLocalInput(m.start_time);
      el('meetingEnd').value = fmtLocalInput(m.end_time);
      el('meetingLink').value = m.attendee_link || '';
      el('meetingContact').value = m.contact || '';
      el('meetingDeleteBtn').style.display = '';
      state.colorTouched = !!m.card_color;
      syncCardColorUI(m.card_color || roomColor(m.room_id), state.colorTouched);
    } else {
      editingUpdatedAt = null;
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
      contact: el('meetingContact').value.trim(),
      card_color: state.colorTouched ? el('meetingCardColor').value : '',
    };
    const id = el('meetingId').value;
    if (id && editingUpdatedAt) payload.expected_updated_at = editingUpdatedAt;
    try {
      let result;
      if (id) {
        result = await api(`/meetings/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast(T('admin.meeting.updated'));
      } else {
        result = await api('/meetings', { method: 'POST', body: JSON.stringify(payload) });
        toast(T('admin.meeting.created'));
      }
      closeMeetingModal();
      await loadMeetings();
      showBufferWarning(result && result.warning);
    } catch (err) {
      formError.innerHTML = escapeHtml(err.message) + renderConflictSuggestion(err);
      formError.classList.add('show');
      if (err.code === 'MEETING_STALE') await loadMeetings(true);
    }
  });

  // Renders "距离最近的空闲时段是 X" / "其他空闲会议室：A、B" as extra lines
  // under the plain error message, so a 409 conflict leaves the organizer
  // with something actionable instead of just a dead end. Returns an empty
  // string for any error that isn't a conflict, or a conflict with nothing
  // useful to suggest (fully booked day, single-room setup, etc).
  function renderConflictSuggestion(err) {
    if (err.code !== 'MEETING_CONFLICT' || !err.data) return '';
    const parts = [];
    const slot = err.data.nextFreeSlot;
    if (slot) {
      const fmt = (iso) => iso.slice(5, 16).replace('T', ' ');
      parts.push(`<div class="conflict-suggestion">${T('admin.meeting.suggestSlot', { start: fmt(slot.start_time), end: fmt(slot.end_time) })}</div>`);
    }
    if (err.data.freeRooms && err.data.freeRooms.length) {
      parts.push(`<div class="conflict-suggestion">${T('admin.meeting.suggestRooms', { rooms: err.data.freeRooms.map(escapeHtml).join('、') })}</div>`);
    }
    return parts.join('');
  }

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

  // Column order matches the requested export spec: 日期 | 会议室 | 开始时间 |
  // 结束时间 | 会议主题 | 主持人/主讲人 | 联系电话/备注 (attendee link kept as an
  // extra trailing column since it's still useful and nothing asked to drop it).
  function meetingRow(m, idx, includeRoom) {
    const start = splitDateTime(m.start_time);
    const end = splitDateTime(m.end_time);
    const row = { [T('admin.export.col.no')]: idx + 1, [T('admin.export.col.date')]: start.date, [T('admin.export.col.weekday')]: start.weekday };
    if (includeRoom) row[T('admin.export.col.room')] = m.room_name;
    row[T('admin.export.col.start')] = start.time;
    row[T('admin.export.col.end')] = end.time;
    row[T('admin.export.col.topic')] = m.topic;
    row[T('admin.export.col.host')] = m.host;
    row[T('admin.export.col.contact')] = m.contact || '';
    row[T('admin.export.col.link')] = m.attendee_link || '';
    return row;
  }

  function buildSheet(rows, includeRoom) {
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = includeRoom
      ? [{ wch: 6 }, { wch: 12 }, { wch: 7 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 26 }, { wch: 14 }, { wch: 18 }, { wch: 32 }]
      : [{ wch: 6 }, { wch: 12 }, { wch: 7 }, { wch: 10 }, { wch: 10 }, { wch: 26 }, { wch: 14 }, { wch: 18 }, { wch: 32 }];
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
    // to scan the whole window at a glance.
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
  // Emergency banner (global + per-room)
  // ---------------------------------------------------------------------
  let lastAnnouncements = { global: '', rooms: {} };

  async function loadAnnouncements() {
    try {
      lastAnnouncements = await api('/admin/announcements');
      el('bannerText').value = lastAnnouncements.global || '';
      renderRoomBannerSelect();
    } catch (err) { /* best-effort */ }
  }

  function renderRoomBannerSelect() {
    const select = el('roomBannerRoomSelect');
    const prev = select.value;
    select.innerHTML = '';
    state.rooms.forEach((room) => {
      const opt = document.createElement('option');
      opt.value = room.id;
      opt.textContent = room.name;
      select.appendChild(opt);
    });
    if (prev && state.rooms.some((r) => String(r.id) === prev)) select.value = prev;
    syncRoomBannerText();
  }

  function syncRoomBannerText() {
    const roomId = el('roomBannerRoomSelect').value;
    el('roomBannerText').value = (lastAnnouncements.rooms || {})[roomId] || '';
  }
  el('roomBannerRoomSelect').addEventListener('change', syncRoomBannerText);

  el('bannerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = el('bannerText').value.trim();
    try {
      await api('/admin/announcements/global', { method: 'PUT', body: JSON.stringify({ message }) });
      lastAnnouncements.global = message;
      toast(T('admin.banner.published'));
    } catch (err) {
      toast(err.message, true);
    }
  });

  el('bannerClearBtn').addEventListener('click', async () => {
    el('bannerText').value = '';
    try {
      await api('/admin/announcements/global', { method: 'PUT', body: JSON.stringify({ message: '' }) });
      lastAnnouncements.global = '';
      toast(T('admin.banner.cleared'));
    } catch (err) {
      toast(err.message, true);
    }
  });

  el('roomBannerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const roomId = el('roomBannerRoomSelect').value;
    if (!roomId) return;
    const message = el('roomBannerText').value.trim();
    try {
      await api(`/admin/announcements/room/${roomId}`, { method: 'PUT', body: JSON.stringify({ message }) });
      lastAnnouncements.rooms = { ...lastAnnouncements.rooms, [roomId]: message };
      toast(T('admin.banner.published'));
    } catch (err) {
      toast(err.message, true);
    }
  });

  el('roomBannerClearBtn').addEventListener('click', async () => {
    const roomId = el('roomBannerRoomSelect').value;
    if (!roomId) return;
    el('roomBannerText').value = '';
    try {
      await api(`/admin/announcements/room/${roomId}`, { method: 'PUT', body: JSON.stringify({ message: '' }) });
      lastAnnouncements.rooms = { ...lastAnnouncements.rooms, [roomId]: '' };
      toast(T('admin.banner.cleared'));
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---------------------------------------------------------------------
  // Backups (manual snapshot + the list of everything on disk, including
  // the ones auto-generated right before a reset)
  // ---------------------------------------------------------------------
  async function loadBackups() {
    try {
      const backups = await api('/admin/backups');
      renderBackupList(backups);
    } catch (err) { /* best-effort */ }
  }

  function renderBackupList(backups) {
    const wrap = el('backupList');
    wrap.innerHTML = '';
    if (!backups.length) {
      wrap.innerHTML = `<div class="legend-hint">${T('admin.backups.empty')}</div>`;
      return;
    }
    backups.forEach((b) => {
      const row = document.createElement('a');
      row.className = 'backup-row';
      row.href = `/api/admin/backups/${encodeURIComponent(b.filename)}`;
      row.download = b.filename;
      const when = new Date(b.created_at);
      const pad = (n) => String(n).padStart(2, '0');
      row.innerHTML = `
        <span class="backup-time">${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}</span>
        <span class="backup-dl">${T('admin.backups.download')}</span>
      `;
      wrap.appendChild(row);
    });
  }

  el('btnBackupNow').addEventListener('click', async () => {
    try {
      const result = await api('/admin/backups', { method: 'POST' });
      toast(T('admin.backups.created', { count: result.meetingCount }));
      await loadBackups();
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---------------------------------------------------------------------
  // One-click reset (danger zone) — double-confirmed: a plain confirm(),
  // then a prompt() requiring the operator to type RESET, so a single
  // careless tap can never wipe the board seconds before doors open.
  // ---------------------------------------------------------------------
  el('btnReset').addEventListener('click', async () => {
    if (!confirm(T('admin.reset.confirm1'))) return;
    const typed = prompt(T('admin.reset.confirm2'));
    if (typed !== T('admin.reset.confirmWord')) {
      toast(T('admin.reset.cancelled'));
      return;
    }
    try {
      const result = await api('/admin/reset', { method: 'POST', body: JSON.stringify({ confirm: 'RESET' }) });
      toast(T('admin.reset.done', { count: result.deleted }));
      await loadMeetings();
      await loadBackups();
      // The backup this just triggered is the safety net for what was
      // about to be wiped — auto-download it immediately rather than
      // making the operator remember to come back for it afterwards.
      if (result.backupFile) {
        const a = document.createElement('a');
        a.href = `/api/admin/backups/${encodeURIComponent(result.backupFile)}`;
        a.download = result.backupFile;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        toast(T('admin.reset.backupFailed'), true);
      }
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---------------------------------------------------------------------
  // Import from Excel — reuses the same header row the manual export
  // writes, but tolerant of missing optional columns. Each row goes
  // through the same server-side validation + conflict check as a normal
  // create, so a bad row is reported rather than silently corrupting data.
  // ---------------------------------------------------------------------
  const COLUMN_ALIASES = {
    room: ['会议室', 'Room'],
    date: ['日期', 'Date'],
    start: ['开始时间', 'Start'],
    end: ['结束时间', 'End'],
    topic: ['会议主题', 'Topic', 'Subject'],
    host: ['主持人/主讲人', '主持人', 'Host'],
    contact: ['联系电话/备注', '联系电话', 'Contact'],
    link: ['参会名单链接', '名单链接', 'Link'],
  };

  function pickColumn(row, key) {
    for (const alias of COLUMN_ALIASES[key]) {
      if (row[alias] !== undefined) return row[alias];
    }
    return '';
  }

  // Accepts a date cell as either "2026-09-28" text or an Excel serial date
  // number (SheetJS parses date-formatted cells as numbers by default
  // unless cellDates is set) — normalizing both here means the import
  // works regardless of how the source spreadsheet had its date column
  // formatted.
  function normalizeDateCell(value) {
    if (typeof value === 'number') {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (!parsed) return '';
      const pad = (n) => String(n).padStart(2, '0');
      return `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}`;
    }
    return String(value || '').trim();
  }

  function normalizeTimeCell(value) {
    if (typeof value === 'number') {
      const totalMinutes = Math.round(value * 24 * 60);
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(Math.floor(totalMinutes / 60) % 24)}:${pad(totalMinutes % 60)}`;
    }
    return String(value || '').trim();
  }

  el('btnImport').addEventListener('click', () => el('importFileInput').click());

  el('importFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // allow re-selecting the same file next time
    if (!file || !window.XLSX) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      // Use the first non-empty sheet — an export made by this same app has
      // "总览" first, which is exactly the one we want anyway.
      const sheetName = wb.SheetNames.find((n) => XLSX.utils.sheet_to_json(wb.Sheets[n]).length > 0) || wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
      if (!rows.length) { toast(T('admin.import.empty'), true); return; }

      const meetings = rows.map((row) => {
        const date = normalizeDateCell(pickColumn(row, 'date'));
        const start = normalizeTimeCell(pickColumn(row, 'start'));
        const end = normalizeTimeCell(pickColumn(row, 'end'));
        return {
          room_name: String(pickColumn(row, 'room') || '').trim(),
          topic: String(pickColumn(row, 'topic') || '').trim(),
          host: String(pickColumn(row, 'host') || '').trim(),
          start_time: date && start ? `${date} ${start}` : '',
          end_time: date && end ? `${date} ${end}` : '',
          contact: String(pickColumn(row, 'contact') || '').trim(),
          attendee_link: String(pickColumn(row, 'link') || '').trim(),
        };
      });

      const result = await api('/meetings/bulk', { method: 'POST', body: JSON.stringify({ meetings }) });
      await loadMeetings();
      if (result.failed > 0) {
        const firstError = result.results.find((r) => !r.ok);
        toast(T('admin.import.partial', { imported: result.imported, failed: result.failed, reason: firstError.error }), true);
      } else {
        toast(T('admin.import.done', { imported: result.imported }));
      }
    } catch (err) {
      toast(T('admin.import.parseFailed'), true);
    }
  });

  // ---------------------------------------------------------------------
  // Invite guest (QR code) — optionally scoped to a single room via
  // ?room=<id>, which locks that link's guest page to only that room.
  // ---------------------------------------------------------------------
  const inviteOverlay = el('inviteModalOverlay');
  let qrInstance = null;

  function buildInviteUrl(address) {
    const port = state.serverPort || location.port || '3000';
    const base = `http://${address}:${port}/guest`;
    const roomId = el('inviteRoomSelect').value;
    return roomId ? `${base}?room=${roomId}` : base;
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

  function renderInviteRoomSelect() {
    const select = el('inviteRoomSelect');
    const prev = select.value;
    select.innerHTML = `<option value="" data-i18n="admin.inviteModal.roomAll">${T('admin.inviteModal.roomAll')}</option>`;
    state.rooms.forEach((room) => {
      const opt = document.createElement('option');
      opt.value = room.id;
      opt.textContent = room.name;
      select.appendChild(opt);
    });
    if (prev) select.value = prev;
  }

  async function openInviteModal() {
    inviteOverlay.classList.add('open');
    renderInviteRoomSelect();
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
  el('inviteRoomSelect').addEventListener('change', () => renderInviteQr(el('inviteAddressSelect').value));
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
    el('brandRange').textContent = `${fullDateLabel(RANGE_START)} — ${fullDateLabel('2026-09-30')}`;
    renderRoomList();
    renderCalendars();
  });

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  async function boot() {
    window.I18N.applyStaticI18n(document);
    el('brandRange').textContent = `${fullDateLabel(RANGE_START)} — ${fullDateLabel('2026-09-30')}`;
    if (!window.FullCalendar) {
      el('statusHint').textContent = window.I18N.getLang() === 'zh'
        ? 'FullCalendar 加载失败，请检查网络或 CDN 是否被拦截'
        : 'FullCalendar failed to load — check your network or CDN access';
      return;
    }
    window.addEventListener('online', () => setOffline(false));
    window.addEventListener('offline', () => setOffline(true));
    try {
      await loadRooms();
      await loadMeetings();
      await loadAnnouncements();
      await loadBackups();
    } catch (err) {
      toast(err.message, true);
    }
    setInterval(() => loadMeetings(true), POLL_INTERVAL_MS); // silent conflict-avoidance refresh
    setInterval(renderNowBadges, CLOCK_TICK_MS);
  }

  boot();
})();
