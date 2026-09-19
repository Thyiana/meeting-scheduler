(function () {
  'use strict';

  const DAY_DATES = ['2026-09-28', '2026-09-29', '2026-09-30'];
  const RANGE_START = '2026-09-28';
  const RANGE_END_EXCLUSIVE = '2026-10-01';
  const POLL_INTERVAL_MS = 10000; // silent background refresh of meetings
  const BANNER_POLL_MS = 15000;
  const CLOCK_TICK_MS = 30000; // redraw the now-line / past-greyout / ongoing-pulse
  const BUFFER_MINUTES = 15;
  const T = window.I18N.t;
  const ERR = window.I18N.errorText;

  function fullDateLabel(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return window.I18N.getLang() === 'zh'
      ? `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${T(`weekday.${d.getDay()}`)}`
      : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} (${T(`weekday.${d.getDay()}`)})`;
  }

  function dayLabel(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getMonth() + 1}/${d.getDate()} ${T(`weekday.${d.getDay()}`)}`;
  }

  const state = {
    rooms: [],
    meetings: [],
    activeRoomId: null,
    activeDate: DAY_DATES[0],
    fullDay: false,
    // If the invite link carried ?room=<id>, the guest is locked to that one
    // room for privacy (they never see other rooms' schedules or even know
    // they exist) — set once rooms have loaded and the id is confirmed valid.
    lockedRoomId: null,
  };

  // Read once at load: a plain query param, e.g. /guest?room=3
  const urlRoomParam = new URLSearchParams(location.search).get('room');

  const el = (id) => document.getElementById(id);
  let calendar = null;

  function toast(message, isError) {
    const t = el('toast');
    t.textContent = message;
    t.style.background = isError ? '#7a2f22' : '#1c1b18';
    t.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function roomColor(roomId) {
    const room = state.rooms.find((r) => r.id === roomId);
    return (room && room.color) || '#1c1b18';
  }

  function hexToFill(hex) {
    const clean = (hex || '#1c1b18').replace('#', '');
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, 0.09)`;
  }

  function fmtLocalInput(isoLike) {
    return (isoLike || '').slice(0, 16);
  }

  function toLocalIsoNoZone(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
  }

  let offline = false;
  function setOffline(isOffline) {
    offline = isOffline;
    el('offlineBadge').classList.toggle('show', isOffline);
  }

  async function api(path, options) {
    const res = await fetch('/api' + path, {
      headers: options && options.body ? { 'Content-Type': 'application/json' } : undefined,
      ...options,
    }).catch((networkErr) => {
      setOffline(true);
      throw new Error(T('guest.offlineSaveFailed'));
    });
    setOffline(false);
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error(ERR({ code: data && data.code, message: data && data.error }));
      err.code = data && data.code;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ---------------------------------------------------------------------
  // Rooms & tabs
  // ---------------------------------------------------------------------
  async function loadRooms() {
    state.rooms = await api('/rooms');
    if (urlRoomParam && !state.lockedRoomId) {
      const match = state.rooms.find((r) => String(r.id) === String(urlRoomParam));
      if (match) state.lockedRoomId = match.id;
      // An unrecognized/stale room id in the URL (room since deleted) just
      // falls through to the normal "pick any room" experience below rather
      // than showing an error — the link degrading gracefully matters more
      // here than surfacing the mismatch.
    }
    if (state.lockedRoomId) {
      state.activeRoomId = state.lockedRoomId;
    } else if (!state.activeRoomId && state.rooms.length) {
      state.activeRoomId = state.rooms[0].id;
    }
    renderRoomTabs();
    renderRoomSelect();
    renderCurrentRoomBanner();
  }

  function renderRoomTabs() {
    const wrap = el('guestRoomTabs');
    // Locked-to-one-room links skip the switcher entirely — the whole point
    // is the guest only ever sees the one room the link was generated for.
    if (state.lockedRoomId) { wrap.innerHTML = ''; wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    wrap.innerHTML = '';
    state.rooms.forEach((room) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'guest-tab' + (room.id === state.activeRoomId ? ' active' : '');
      tab.innerHTML = `<span class="dot" style="background:${escapeHtml(room.color)}"></span>${escapeHtml(room.name)}`;
      tab.addEventListener('click', () => {
        state.activeRoomId = room.id;
        renderRoomTabs();
        renderCurrentRoomBanner();
        renderCalendar();
        pollAnnouncement();
      });
      wrap.appendChild(tab);
    });
  }

  // Highlighted "当前选择：会议室 X" callout, kept in sync with the active
  // tab so it's unmistakable which room's board is being viewed/booked.
  function renderCurrentRoomBanner() {
    const room = state.rooms.find((r) => r.id === state.activeRoomId);
    const box = el('guestCurrentRoom');
    if (!room) { box.style.display = 'none'; return; }
    box.style.display = '';
    box.style.setProperty('--current-room-color', room.color);
    el('guestCurrentRoomName').textContent = room.name;
  }

  function renderDayTabs() {
    const wrap = el('guestDayTabs');
    wrap.innerHTML = '';
    DAY_DATES.forEach((date) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'guest-tab' + (date === state.activeDate ? ' active' : '');
      tab.textContent = dayLabel(date);
      tab.addEventListener('click', () => {
        state.activeDate = date;
        renderDayTabs();
        if (calendar) calendar.gotoDate(date);
      });
      wrap.appendChild(tab);
    });
  }

  function renderRoomSelect() {
    const select = el('guestRoom');
    const prev = select.value;
    select.innerHTML = '';
    const rooms = state.lockedRoomId
      ? state.rooms.filter((r) => r.id === state.lockedRoomId)
      : state.rooms;
    rooms.forEach((room) => {
      const opt = document.createElement('option');
      opt.value = room.id;
      opt.textContent = room.name;
      select.appendChild(opt);
    });
    select.disabled = !!state.lockedRoomId;
    if (prev) select.value = prev;
    else if (state.activeRoomId) select.value = state.activeRoomId;
  }

  // ---------------------------------------------------------------------
  // Meetings & calendar
  // ---------------------------------------------------------------------
  async function loadMeetings(silent) {
    try {
      const data = await api('/meetings');
      state.meetings = data;
      renderCalendar();
    } catch (err) {
      if (!silent) toast(err.message, true);
    }
  }

  function eventsForActiveRoom() {
    return state.meetings
      .filter((m) => m.room_id === state.activeRoomId)
      .map((m) => ({
        id: String(m.id),
        title: m.topic,
        start: m.start_time,
        end: m.end_time,
        extendedProps: m,
      }));
  }

  function classifyEvent(m) {
    const now = new Date();
    const start = new Date(m.start_time);
    const end = new Date(m.end_time);
    if (end <= now) return 'past';
    if (start <= now && now < end) return 'ongoing';
    return 'upcoming';
  }

  // Repositions the "now" time-label badge next to FullCalendar's built-in
  // red line. Full past/ongoing re-classing happens naturally on the next
  // poll-driven renderCalendar() call, so this only needs to move the label.
  function renderNowBadge(containerId) {
    const container = el(containerId);
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
  }

  function renderCalendar() {
    const container = el('guestCalendar');
    if (calendar) { calendar.destroy(); calendar = null; }
    if (!state.activeRoomId) {
      container.innerHTML = `<div class="legend-hint" style="padding:30px 4px;">${T('guest.noRooms')}</div>`;
      return;
    }
    container.innerHTML = '';

    const hostLabel = window.I18N.getLang() === 'zh' ? '主持：' : 'Host: ';

    calendar = new FullCalendar.Calendar(container, {
      initialView: 'timeGridDay',
      initialDate: state.activeDate,
      validRange: { start: RANGE_START, end: RANGE_END_EXCLUSIVE },
      headerToolbar: false,
      slotMinTime: state.fullDay ? '00:00:00' : '08:00:00',
      slotMaxTime: state.fullDay ? '24:00:00' : '20:00:00',
      slotDuration: '00:30:00',
      allDaySlot: false,
      nowIndicator: true,
      height: 'auto',
      expandRows: true,
      locale: window.I18N.getLang() === 'zh' ? 'zh-cn' : 'en',
      firstDay: 1,
      selectable: true,
      selectMirror: true,
      eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      events: eventsForActiveRoom(),
      select: (info) => openBookModal({ start: info.start, end: info.end }),
      eventClick: (info) => openViewModal(Number(info.event.id)),
      eventContent: (arg) => {
        const m = arg.event.extendedProps;
        const fmt = (d) => d.toTimeString().slice(0, 5);
        const wrap = document.createElement('div');
        const state2 = classifyEvent(m);
        wrap.className = 'event-card' + (state2 === 'past' ? ' ev-past' : '') + (state2 === 'ongoing' ? ' ev-ongoing' : '');
        const cardColor = m.card_color || roomColor(state.activeRoomId);
        wrap.style.setProperty('--card-accent', cardColor);
        wrap.style.setProperty('--card-fill', hexToFill(cardColor));
        wrap.innerHTML = `
          <div class="ev-time">${fmt(arg.event.start)} – ${fmt(arg.event.end)}${state2 === 'ongoing' ? ' · ' + T('signage.ongoing') : ''}</div>
          <div class="ev-topic">${escapeHtml(m.topic)}</div>
          <div class="ev-host">${hostLabel}${escapeHtml(m.host)}</div>
        `;
        return { domNodes: [wrap] };
      },
      eventDidMount: () => setTimeout(() => renderNowBadge('guestCalendar'), 0),
    });
    calendar.render();
    setTimeout(() => renderNowBadge('guestCalendar'), 30);
  }

  el('fullDayToggleGuest').addEventListener('change', (e) => {
    state.fullDay = e.target.checked;
    renderCalendar();
  });

  // ---------------------------------------------------------------------
  // Dropdown date / start-time / end-time picker
  // ---------------------------------------------------------------------
  function populateDateSelect() {
    const select = el('guestDate');
    select.innerHTML = '';
    DAY_DATES.forEach((date) => {
      const opt = document.createElement('option');
      opt.value = date;
      opt.textContent = fullDateLabel(date);
      select.appendChild(opt);
    });
  }

  function populateTimeSelects() {
    const opts = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 15) {
        const pad = (n) => String(n).padStart(2, '0');
        opts.push(`${pad(h)}:${pad(m)}`);
      }
    }
    [el('guestStartTime'), el('guestEndTime')].forEach((select) => {
      select.innerHTML = '';
      opts.forEach((t) => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        select.appendChild(opt);
      });
    });
  }

  function setPickerFromDateTime(isoLike) {
    const [datePart, timePart] = fmtLocalInput(isoLike).split('T');
    if (DAY_DATES.includes(datePart)) el('guestDate').value = datePart;
    const rounded = roundTo15(timePart || '09:00');
    return rounded;
  }

  function roundTo15(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const rounded = Math.round(m / 15) * 15;
    const pad = (n) => String(n).padStart(2, '0');
    if (rounded === 60) return `${pad((h + 1) % 24)}:00`;
    return `${pad(h)}:${pad(rounded)}`;
  }

  function pickerValueToIso() {
    const date = el('guestDate').value;
    const start = el('guestStartTime').value;
    const end = el('guestEndTime').value;
    return { start: `${date}T${start}:00`, end: `${date}T${end}:00` };
  }

  // ---------------------------------------------------------------------
  // Booking modal
  // ---------------------------------------------------------------------
  const bookOverlay = el('guestBookModalOverlay');
  const bookForm = el('guestBookForm');
  const bookError = el('guestFormError');
  let colorTouched = false;
  let editingUpdatedAt = null;

  function syncCardColorUI(hex, touched) {
    el('guestCardColor').value = hex;
    el('guestCardColorSwatch').style.background = hex;
    el('guestCardColorText').textContent = touched ? T('guest.colorCustom') : T('guest.colorDefault');
  }

  function openBookModal(prefillRange) {
    bookForm.reset();
    bookError.classList.remove('show');
    renderRoomSelect();
    populateDateSelect();
    populateTimeSelects();
    el('guestMeetingId').value = '';
    editingUpdatedAt = null;
    el('guestBookModalTitle').textContent = T('guest.bookTitleNew');
    el('guestSaveBtn').textContent = T('guest.saveNew');
    if (state.activeRoomId) el('guestRoom').value = state.activeRoomId;
    if (prefillRange) {
      el('guestDate').value = toLocalIsoNoZone(prefillRange.start).slice(0, 10);
      el('guestStartTime').value = roundTo15(toLocalIsoNoZone(prefillRange.start).slice(11, 16));
      el('guestEndTime').value = roundTo15(toLocalIsoNoZone(prefillRange.end).slice(11, 16));
    } else {
      el('guestDate').value = state.activeDate;
      el('guestStartTime').value = '09:00';
      el('guestEndTime').value = '10:00';
    }
    colorTouched = false;
    syncCardColorUI(roomColor(Number(el('guestRoom').value)), false);
    bookOverlay.classList.add('open');
  }

  // Reused for "编辑" from the view-only modal — same form, pre-filled with
  // the existing meeting, submitting as an update (PUT) instead of a create.
  function openEditModal(meeting) {
    bookForm.reset();
    bookError.classList.remove('show');
    renderRoomSelect();
    populateDateSelect();
    populateTimeSelects();
    el('guestMeetingId').value = meeting.id;
    editingUpdatedAt = meeting.updated_at || null;
    el('guestBookModalTitle').textContent = T('guest.bookTitleEdit');
    el('guestSaveBtn').textContent = T('guest.saveEdit');
    el('guestRoom').value = meeting.room_id;
    el('guestTopic').value = meeting.topic;
    el('guestHost').value = meeting.host;
    el('guestDate').value = fmtLocalInput(meeting.start_time).slice(0, 10);
    el('guestStartTime').value = roundTo15(fmtLocalInput(meeting.start_time).slice(11, 16));
    el('guestEndTime').value = roundTo15(fmtLocalInput(meeting.end_time).slice(11, 16));
    el('guestLink').value = meeting.attendee_link || '';
    el('guestContact').value = meeting.contact || '';
    colorTouched = !!meeting.card_color;
    syncCardColorUI(meeting.card_color || roomColor(meeting.room_id), colorTouched);
    bookOverlay.classList.add('open');
  }

  function closeBookModal() {
    bookOverlay.classList.remove('open');
    if (calendar) calendar.unselect();
  }

  el('guestAddBtn').addEventListener('click', () => openBookModal(null));
  el('guestBookModalClose').addEventListener('click', closeBookModal);
  el('guestCancelBtn').addEventListener('click', closeBookModal);
  bookOverlay.addEventListener('click', (e) => { if (e.target === bookOverlay) closeBookModal(); });
  el('guestSaveBtn').addEventListener('click', () => bookForm.requestSubmit());

  // While no custom color has been chosen, the preview follows whichever
  // room is currently selected in the dropdown.
  el('guestRoom').addEventListener('change', () => {
    if (!colorTouched) syncCardColorUI(roomColor(Number(el('guestRoom').value)), false);
  });
  el('guestCardColor').addEventListener('input', () => {
    colorTouched = true;
    syncCardColorUI(el('guestCardColor').value, true);
  });
  el('guestColorResetBtn').addEventListener('click', () => {
    colorTouched = false;
    syncCardColorUI(roomColor(Number(el('guestRoom').value)), false);
  });

  function showBufferWarning(warning) {
    if (!warning) return;
    const key = warning.code === 'BUFFER_TOO_SHORT_AFTER' ? 'buffer.warningAfter' : 'buffer.warningBefore';
    setTimeout(() => toast(T(key, { minutes: warning.minutes, topic: warning.topic })), 3400);
  }

  bookForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    bookError.classList.remove('show');
    const { start, end } = pickerValueToIso();
    const payload = {
      room_id: el('guestRoom').value,
      topic: el('guestTopic').value.trim(),
      host: el('guestHost').value.trim(),
      start_time: start,
      end_time: end,
      attendee_link: el('guestLink').value.trim(),
      contact: el('guestContact').value.trim(),
      card_color: colorTouched ? el('guestCardColor').value : '',
    };
    const editId = el('guestMeetingId').value;
    if (editId && editingUpdatedAt) payload.expected_updated_at = editingUpdatedAt;
    try {
      let result;
      if (editId) {
        result = await api(`/meetings/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast(T('guest.updated'));
      } else {
        result = await api('/meetings', { method: 'POST', body: JSON.stringify(payload) });
        toast(T('guest.created'));
      }
      closeBookModal();
      closeViewModal();
      await loadMeetings();
      showBufferWarning(result && result.warning);
    } catch (err) {
      bookError.innerHTML = escapeHtml(err.message) + renderConflictSuggestion(err);
      bookError.classList.add('show');
      if (err.code === 'MEETING_STALE') await loadMeetings(true);
    }
  });

  // Renders "距离最近的空闲时段是 X" / "其他空闲会议室：A、B" as extra lines
  // under the plain error message on a 409 conflict — mirrors the admin
  // side's version. Returns '' for anything that isn't a conflict, or a
  // conflict with nothing useful to suggest.
  function renderConflictSuggestion(err) {
    if (err.code !== 'MEETING_CONFLICT' || !err.data) return '';
    const parts = [];
    const slot = err.data.nextFreeSlot;
    if (slot) {
      const fmt = (iso) => iso.slice(5, 16).replace('T', ' ');
      parts.push(`<div class="conflict-suggestion">${T('guest.suggestSlot', { start: fmt(slot.start_time), end: fmt(slot.end_time) })}</div>`);
    }
    if (err.data.freeRooms && err.data.freeRooms.length) {
      parts.push(`<div class="conflict-suggestion">${T('guest.suggestRooms', { rooms: err.data.freeRooms.map(escapeHtml).join('、') })}</div>`);
    }
    return parts.join('');
  }

  // Enter-key navigation between form fields.
  function wireEnterNavigation(container) {
    const fields = Array.from(container.querySelectorAll('input, select, textarea'));
    fields.forEach((field, idx) => {
      field.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        if (field.tagName === 'TEXTAREA') return;
        e.preventDefault();
        const next = fields[idx + 1];
        if (next) next.focus();
        else if (typeof container.requestSubmit === 'function') container.requestSubmit();
      });
    });
  }
  wireEnterNavigation(bookForm);

  // ---------------------------------------------------------------------
  // View-only modal
  // ---------------------------------------------------------------------
  const viewOverlay = el('guestViewModalOverlay');
  let viewingMeetingId = null;

  function buildIcs(m) {
    const room = state.rooms.find((r) => r.id === m.room_id);
    const fmt = (iso) => iso.replace(/[-:]/g, '').slice(0, 15) + '00'; // local (SGT) floating time
    const esc = (s) => String(s || '').replace(/[\\,;]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
    return [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Meeting Scheduler//CN',
      'BEGIN:VEVENT',
      `UID:meeting-${m.id}@meeting-scheduler`,
      `DTSTAMP:${fmt(new Date().toISOString())}`,
      `DTSTART;TZID=Asia/Singapore:${fmt(m.start_time)}`,
      `DTEND;TZID=Asia/Singapore:${fmt(m.end_time)}`,
      `SUMMARY:${esc(m.topic)}`,
      `LOCATION:${esc(room ? room.name : '')}`,
      `DESCRIPTION:${esc(`主持人/Host: ${m.host}${m.contact ? ' | ' + m.contact : ''}`)}`,
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
  }

  function downloadIcs(m) {
    const blob = new Blob([buildIcs(m)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${m.topic || 'meeting'}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function googleCalendarUrl(m) {
    const room = state.rooms.find((r) => r.id === m.room_id);
    const fmt = (iso) => iso.replace(/[-:]/g, '').slice(0, 15) + '00Z';
    // Meeting times are floating SGT wall-clock times; Google Calendar's
    // "dates" param wants UTC, so shift by -8h to render the same local
    // clock time in most viewers' default calendar timezone assumption.
    const toUtcIso = (iso) => new Date(new Date(iso).getTime() - 8 * 3600 * 1000).toISOString();
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: m.topic,
      dates: `${fmt(toUtcIso(m.start_time))}/${fmt(toUtcIso(m.end_time))}`,
      details: `主持人/Host: ${m.host}${m.contact ? ' | ' + m.contact : ''}`,
      location: room ? room.name : '',
      ctz: 'Asia/Singapore',
    });
    return `https://www.google.com/calendar/render?${params.toString()}`;
  }

  function openViewModal(meetingId) {
    const m = state.meetings.find((x) => x.id === meetingId);
    if (!m) return;
    viewingMeetingId = meetingId;
    const linkHtml = m.attendee_link
      ? `<a href="${escapeHtml(m.attendee_link)}" target="_blank" rel="noopener">${escapeHtml(m.attendee_link)}</a>`
      : T('common.none');
    el('guestViewBody').innerHTML = `
      <div class="guest-view-row"><span class="k">${T('guest.viewRoom')}</span><span class="v">${escapeHtml(m.room_name)}</span></div>
      <div class="guest-view-row"><span class="k">${T('guest.viewTopic')}</span><span class="v">${escapeHtml(m.topic)}</span></div>
      <div class="guest-view-row"><span class="k">${T('guest.viewHost')}</span><span class="v">${escapeHtml(m.host)}</span></div>
      <div class="guest-view-row"><span class="k">${T('guest.viewTime')}</span><span class="v">${m.start_time.replace('T', ' ')} – ${m.end_time.replace('T', ' ')} SGT</span></div>
      <div class="guest-view-row"><span class="k">${T('guest.viewLink')}</span><span class="v">${linkHtml}</span></div>
      <div class="guest-view-row"><span class="k">${T('guest.viewContact')}</span><span class="v">${escapeHtml(m.contact) || T('common.none')}</span></div>
    `;
    viewOverlay.classList.add('open');
  }

  function closeViewModal() {
    viewOverlay.classList.remove('open');
    viewingMeetingId = null;
  }

  el('guestViewModalClose').addEventListener('click', closeViewModal);
  el('guestViewCloseBtn').addEventListener('click', closeViewModal);
  viewOverlay.addEventListener('click', (e) => { if (e.target === viewOverlay) closeViewModal(); });
  el('guestViewEditBtn').addEventListener('click', () => {
    const m = state.meetings.find((x) => x.id === viewingMeetingId);
    if (!m) return;
    viewOverlay.classList.remove('open');
    openEditModal(m);
  });
  el('guestExportIcsBtn').addEventListener('click', () => {
    const m = state.meetings.find((x) => x.id === viewingMeetingId);
    if (m) downloadIcs(m);
  });
  el('guestExportGoogleBtn').addEventListener('click', () => {
    const m = state.meetings.find((x) => x.id === viewingMeetingId);
    if (m) window.open(googleCalendarUrl(m), '_blank', 'noopener');
  });

  el('guestViewDeleteBtn').addEventListener('click', async () => {
    if (!viewingMeetingId) return;
    if (!confirm(T('guest.deleteConfirm'))) return;
    try {
      await api(`/meetings/${viewingMeetingId}`, { method: 'DELETE' });
      toast(T('guest.deleted'));
      closeViewModal();
      await loadMeetings();
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---------------------------------------------------------------------
  // Emergency banner (polled independently of the meeting data)
  // ---------------------------------------------------------------------
  async function pollAnnouncement() {
    try {
      const data = await api('/admin/announcements');
      const bar = el('announcementBanner');
      if (data.global) {
        el('announcementText').textContent = data.global;
        bar.classList.add('show');
      } else {
        bar.classList.remove('show');
      }

      const roomBar = el('roomAnnouncementBanner');
      const roomMsg = state.activeRoomId ? (data.rooms || {})[state.activeRoomId] : '';
      if (roomMsg) {
        el('roomAnnouncementText').textContent = roomMsg;
        roomBar.classList.add('show');
      } else {
        roomBar.classList.remove('show');
      }
    } catch (err) { /* silent - banner is best-effort */ }
  }

  // ---------------------------------------------------------------------
  // Language toggle
  // ---------------------------------------------------------------------
  el('langToggleBtn').addEventListener('click', () => window.I18N.toggle());
  document.addEventListener('i18n:change', () => {
    el('guestRangeText').textContent = `${fullDateLabel(DAY_DATES[0])} — ${fullDateLabel(DAY_DATES[DAY_DATES.length - 1])}`;
    renderDayTabs();
    renderRoomTabs();
    renderCurrentRoomBanner();
    renderCalendar();
  });

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  async function boot() {
    window.I18N.applyStaticI18n(document);
    el('guestRangeText').textContent = `${fullDateLabel(DAY_DATES[0])} — ${fullDateLabel(DAY_DATES[DAY_DATES.length - 1])}`;
    renderDayTabs();
    fetch('/api/health').then((r) => r.json()).then((d) => {
      if (d.version) el('buildVersion').textContent = 'build ' + d.version;
    }).catch(() => {});
    if (!window.FullCalendar) {
      el('guestCalendar').innerHTML = `<div class="legend-hint" style="padding:30px 4px;">${T('guest.calendarLoadFailed')}</div>`;
      return;
    }
    window.addEventListener('online', () => setOffline(false));
    window.addEventListener('offline', () => setOffline(true));
    try {
      await loadRooms();
      await loadMeetings();
    } catch (err) {
      toast(err.message, true);
    }
    pollAnnouncement();
    setInterval(() => loadMeetings(true), POLL_INTERVAL_MS); // silent conflict-avoidance refresh
    setInterval(pollAnnouncement, BANNER_POLL_MS);
    setInterval(() => renderNowBadge('guestCalendar'), CLOCK_TICK_MS);
  }

  boot();
})();
