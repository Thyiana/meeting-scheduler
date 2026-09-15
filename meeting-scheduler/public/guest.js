(function () {
  'use strict';

  const DAYS = [
    { date: '2026-09-28', label: '9/28 周一' },
    { date: '2026-09-29', label: '9/29 周二' },
    { date: '2026-09-30', label: '9/30 周三' },
    { date: '2026-10-01', label: '10/1 周四' },
  ];
  const RANGE_START = '2026-09-28';
  const RANGE_END_EXCLUSIVE = '2026-10-02';

  const state = {
    rooms: [],
    meetings: [],
    activeRoomId: null,
    activeDate: DAYS[0].date,
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

  function roomFill(roomId) {
    return hexToFill(roomColor(roomId));
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
      const err = new Error((data && data.error) || `请求失败 (${res.status})`);
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
    DAYS.forEach((day) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'guest-tab' + (day.date === state.activeDate ? ' active' : '');
      tab.textContent = day.label;
      tab.addEventListener('click', () => {
        state.activeDate = day.date;
        renderDayTabs();
        if (calendar) calendar.gotoDate(day.date);
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
      container.innerHTML = '<div class="legend-hint" style="padding:30px 4px;">暂无会议室，请联系管理员添加</div>';
      return;
    }
    container.innerHTML = '';

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
      locale: 'zh-cn',
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
          <div class="ev-host">主持：${escapeHtml(m.host)}</div>
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

  function openBookModal(prefillRange) {
    bookForm.reset();
    bookError.classList.remove('show');
    renderRoomSelect();
    if (state.activeRoomId) el('guestRoom').value = state.activeRoomId;
    if (prefillRange) {
      el('guestStart').value = fmtLocalInput(toLocalIsoNoZone(prefillRange.start));
      el('guestEnd').value = fmtLocalInput(toLocalIsoNoZone(prefillRange.end));
    }
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
    };
    try {
      await api('/meetings', { method: 'POST', body: JSON.stringify(payload) });
      toast('预约成功');
      closeBookModal();
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
      : '（无）';
    el('guestViewBody').innerHTML = `
      <div class="guest-view-row"><span class="k">会议室</span><span class="v">${escapeHtml(m.room_name)}</span></div>
      <div class="guest-view-row"><span class="k">主题</span><span class="v">${escapeHtml(m.topic)}</span></div>
      <div class="guest-view-row"><span class="k">主持人</span><span class="v">${escapeHtml(m.host)}</span></div>
      <div class="guest-view-row"><span class="k">时间</span><span class="v">${m.start_time.replace('T', ' ')} – ${m.end_time.replace('T', ' ')}</span></div>
      <div class="guest-view-row"><span class="k">参会名单</span><span class="v">${linkHtml}</span></div>
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

  el('guestViewDeleteBtn').addEventListener('click', async () => {
    if (!viewingMeetingId) return;
    if (!confirm('确定取消该预约吗？此操作无法撤销。')) return;
    try {
      await api(`/meetings/${viewingMeetingId}`, { method: 'DELETE' });
      toast('预约已取消');
      closeViewModal();
      await loadMeetings();
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  async function boot() {
    renderDayTabs();
    if (!window.FullCalendar) {
      el('guestCalendar').innerHTML = '<div class="legend-hint" style="padding:30px 4px;">日历组件加载失败，请检查网络</div>';
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
