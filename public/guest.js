(function () {
  'use strict';

  const DAY_DATES = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'];
  const RANGE_START = '2026-09-28';
  const RANGE_END_EXCLUSIVE = '2026-10-02';
  const T = window.I18N.t;
  const ERR = window.I18N.errorText;

  function dayLabel(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getMonth() + 1}/${d.getDate()} ${T(`weekday.${d.getDay()}`)}`;
  }

  const state = {
    rooms: [],
    meetings: [],
    activeRoomId: null,
    activeDate: DAY_DATES[0],
  };

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

  async function api(path, options) {
    const res = await fetch('/api' + path, {
      headers: options && options.body ? { 'Content-Type': 'application/json' } : undefined,
      ...options,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error(ERR({ code: data && data.code, message: data && data.error }));
      throw err;
    }
    return data;
  }

  // ---------------------------------------------------------------------
  // Rooms & tabs
  // ---------------------------------------------------------------------
  async function loadRooms() {
    state.rooms = await api('/rooms');
    if (!state.activeRoomId && state.rooms.length) state.activeRoomId = state.rooms[0].id;
    renderRoomTabs();
    renderRoomSelect();
  }

  function renderRoomTabs() {
    const wrap = el('guestRoomTabs');
    wrap.innerHTML = '';
    state.rooms.forEach((room) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'guest-tab' + (room.id === state.activeRoomId ? ' active' : '');
      tab.innerHTML = `<span class="dot" style="background:${escapeHtml(room.color)}"></span>${escapeHtml(room.name)}`;
      tab.addEventListener('click', () => {
        state.activeRoomId = room.id;
        renderRoomTabs();
        renderCalendar();
      });
      wrap.appendChild(tab);
    });
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
    state.rooms.forEach((room) => {
      const opt = document.createElement('option');
      opt.value = room.id;
      opt.textContent = room.name;
      select.appendChild(opt);
    });
    if (prev) select.value = prev;
    else if (state.activeRoomId) select.value = state.activeRoomId;
  }

  // ---------------------------------------------------------------------
  // Meetings & calendar
  // ---------------------------------------------------------------------
  async function loadMeetings() {
    state.meetings = await api('/meetings');
    renderCalendar();
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
      slotMinTime: '00:00:00',
      slotMaxTime: '24:00:00',
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
        wrap.className = 'event-card';
        const cardColor = m.card_color || roomColor(state.activeRoomId);
        wrap.style.setProperty('--card-accent', cardColor);
        wrap.style.setProperty('--card-fill', hexToFill(cardColor));
        wrap.innerHTML = `
          <div class="ev-time">${fmt(arg.event.start)} – ${fmt(arg.event.end)}</div>
          <div class="ev-topic">${escapeHtml(m.topic)}</div>
          <div class="ev-host">${hostLabel}${escapeHtml(m.host)}</div>
        `;
        return { domNodes: [wrap] };
      },
    });
    calendar.render();
  }

  // ---------------------------------------------------------------------
  // Booking modal
  // ---------------------------------------------------------------------
  const bookOverlay = el('guestBookModalOverlay');
  const bookForm = el('guestBookForm');
  const bookError = el('guestFormError');
  let colorTouched = false;

  function syncCardColorUI(hex, touched) {
    el('guestCardColor').value = hex;
    el('guestCardColorSwatch').style.background = hex;
    el('guestCardColorText').textContent = touched ? T('guest.colorCustom') : T('guest.colorDefault');
  }

  function openBookModal(prefillRange) {
    bookForm.reset();
    bookError.classList.remove('show');
    renderRoomSelect();
    el('guestMeetingId').value = '';
    el('guestBookModalTitle').textContent = T('guest.bookTitleNew');
    el('guestSaveBtn').textContent = T('guest.saveNew');
    if (state.activeRoomId) el('guestRoom').value = state.activeRoomId;
    if (prefillRange) {
      el('guestStart').value = fmtLocalInput(toLocalIsoNoZone(prefillRange.start));
      el('guestEnd').value = fmtLocalInput(toLocalIsoNoZone(prefillRange.end));
    }
    colorTouched = false;
    syncCardColorUI(roomColor(Number(el('guestRoom').value)), false);
    bookOverlay.classList.add('open');
    setTimeout(() => el('guestTopic').focus(), 30);
  }

  // Reused for "编辑" from the view-only modal — same form, pre-filled with
  // the existing meeting, submitting as an update (PUT) instead of a create.
  function openEditModal(meeting) {
    bookForm.reset();
    bookError.classList.remove('show');
    renderRoomSelect();
    el('guestMeetingId').value = meeting.id;
    el('guestBookModalTitle').textContent = T('guest.bookTitleEdit');
    el('guestSaveBtn').textContent = T('guest.saveEdit');
    el('guestRoom').value = meeting.room_id;
    el('guestTopic').value = meeting.topic;
    el('guestHost').value = meeting.host;
    el('guestStart').value = fmtLocalInput(meeting.start_time);
    el('guestEnd').value = fmtLocalInput(meeting.end_time);
    el('guestLink').value = meeting.attendee_link || '';
    colorTouched = !!meeting.card_color;
    syncCardColorUI(meeting.card_color || roomColor(meeting.room_id), colorTouched);
    bookOverlay.classList.add('open');
    setTimeout(() => el('guestTopic').focus(), 30);
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

  bookForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    bookError.classList.remove('show');
    const payload = {
      room_id: el('guestRoom').value,
      topic: el('guestTopic').value.trim(),
      host: el('guestHost').value.trim(),
      start_time: el('guestStart').value,
      end_time: el('guestEnd').value,
      attendee_link: el('guestLink').value.trim(),
      card_color: colorTouched ? el('guestCardColor').value : '',
    };
    const editId = el('guestMeetingId').value;
    try {
      if (editId) {
        await api(`/meetings/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast(T('guest.updated'));
      } else {
        await api('/meetings', { method: 'POST', body: JSON.stringify(payload) });
        toast(T('guest.created'));
      }
      closeBookModal();
      closeViewModal();
      await loadMeetings();
    } catch (err) {
      bookError.textContent = err.message;
      bookError.classList.add('show');
    }
  });

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
      <div class="guest-view-row"><span class="k">${T('guest.viewTime')}</span><span class="v">${m.start_time.replace('T', ' ')} – ${m.end_time.replace('T', ' ')}</span></div>
      <div class="guest-view-row"><span class="k">${T('guest.viewLink')}</span><span class="v">${linkHtml}</span></div>
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
  // Language toggle
  // ---------------------------------------------------------------------
  el('langToggleBtn').addEventListener('click', () => window.I18N.toggle());
  document.addEventListener('i18n:change', () => {
    renderDayTabs();
    renderRoomTabs();
    renderCalendar();
  });

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  async function boot() {
    window.I18N.applyStaticI18n(document);
    renderDayTabs();
    if (!window.FullCalendar) {
      el('guestCalendar').innerHTML = `<div class="legend-hint" style="padding:30px 4px;">${T('guest.calendarLoadFailed')}</div>`;
      return;
    }
    try {
      await loadRooms();
      await loadMeetings();
    } catch (err) {
      toast(err.message, true);
    }
  }

  boot();
})();
