(function () {
  'use strict';

  const RANGE_START = '2026-09-28';
  const RANGE_END_EXCLUSIVE = '2026-10-01';
  const DAY_DATES = ['2026-09-28', '2026-09-29', '2026-09-30'];
  const POLL_INTERVAL_MS = 10000;
  const BANNER_POLL_MS = 15000;
  const CLOCK_TICK_MS = 1000;
  const T = window.I18N.t;

  const el = (id) => document.getElementById(id);
  const grid = el('signageGrid');
  const calendars = new Map();

  // Shows "today" if it falls inside the managed window, otherwise the
  // first day of the range (e.g. before the event starts, or after it ends
  // the board still shows something meaningful rather than a blank error).
  function activeDate() {
    const todayStr = new Date().toISOString().slice(0, 10);
    return DAY_DATES.includes(todayStr) ? todayStr : DAY_DATES[0];
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function hexToFill(hex) {
    const clean = (hex || '#1c1b18').replace('#', '');
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, 0.09)`;
  }

  function classifyEvent(m) {
    const now = new Date();
    const start = new Date(m.start_time);
    const end = new Date(m.end_time);
    if (end <= now) return 'past';
    if (start <= now && now < end) return 'ongoing';
    return 'upcoming';
  }

  const state = { rooms: [], meetings: [] };

  async function api(path) {
    const res = await fetch('/api' + path);
    return res.json();
  }

  function renderClock() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    el('signageClock').textContent = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}  ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}  SGT`;
  }

  function renderNowBadges() {
    calendars.forEach((cal, roomId) => {
      const container = document.querySelector(`[data-room-id="${roomId}"] .signage-col-body`);
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

  function renderGrid() {
    calendars.forEach((cal) => cal.destroy());
    calendars.clear();
    grid.innerHTML = '';

    if (!state.rooms.length) {
      grid.innerHTML = `<div class="signage-empty">${T('admin.calendars.emptyNoRooms')}</div>`;
      return;
    }

    const fcLocale = window.I18N.getLang() === 'zh' ? 'zh-cn' : 'en';
    const hostLabel = window.I18N.getLang() === 'zh' ? '主持：' : 'Host: ';
    const date = activeDate();

    state.rooms.forEach((room) => {
      const col = document.createElement('div');
      col.className = 'signage-col';
      col.dataset.roomId = room.id;
      col.innerHTML = `
        <div class="signage-col-header">
          <span class="room-swatch" style="background:${escapeHtml(room.color)}"></span>
          <span class="name">${escapeHtml(room.name)}</span>
        </div>
        <div class="signage-col-body"></div>
      `;
      grid.appendChild(col);

      const body = col.querySelector('.signage-col-body');
      const events = state.meetings
        .filter((m) => m.room_id === room.id)
        .map((m) => ({ id: String(m.id), title: m.topic, start: m.start_time, end: m.end_time, extendedProps: m }));

      const cal = new FullCalendar.Calendar(body, {
        initialView: 'timeGridDay',
        initialDate: date,
        validRange: { start: RANGE_START, end: RANGE_END_EXCLUSIVE },
        headerToolbar: false,
        slotMinTime: '08:00:00',
        slotMaxTime: '20:00:00',
        slotDuration: '00:30:00',
        allDaySlot: false,
        nowIndicator: true,
        height: '100%',
        expandRows: true,
        locale: fcLocale,
        firstDay: 1,
        selectable: false,
        editable: false,
        eventStartEditable: false,
        eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
        slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
        events,
        eventContent: (arg) => {
          const m = arg.event.extendedProps;
          const fmt = (d) => d.toTimeString().slice(0, 5);
          const wrap = document.createElement('div');
          const cls = classifyEvent(m);
          wrap.className = 'event-card' + (cls === 'past' ? ' ev-past' : '') + (cls === 'ongoing' ? ' ev-ongoing' : '');
          const cardColor = m.card_color || room.color;
          wrap.style.setProperty('--card-accent', cardColor);
          wrap.style.setProperty('--card-fill', hexToFill(cardColor));
          wrap.innerHTML = `
            <div class="ev-time">${fmt(arg.event.start)} – ${fmt(arg.event.end)}${cls === 'ongoing' ? ' · ' + T('signage.ongoing') : ''}</div>
            <div class="ev-topic">${escapeHtml(m.topic)}</div>
            <div class="ev-host">${hostLabel}${escapeHtml(m.host)}</div>
          `;
          return { domNodes: [wrap] };
        },
        eventDidMount: () => setTimeout(renderNowBadges, 0),
      });
      cal.render();
      calendars.set(room.id, cal);
    });
    setTimeout(renderNowBadges, 30);
  }

  async function loadAll(silent) {
    try {
      state.rooms = await api('/rooms');
      state.meetings = await api('/meetings');
      renderGrid();
    } catch (err) { /* signage is unattended — fail silently, retry on next poll */ }
  }

  async function pollAnnouncement() {
    try {
      const data = await api('/admin/announcement');
      const bar = el('announcementBanner');
      if (data.message) {
        el('announcementText').textContent = data.message;
        bar.classList.add('show');
      } else {
        bar.classList.remove('show');
      }
    } catch (err) { /* best-effort */ }
  }

  async function boot() {
    window.I18N.applyStaticI18n(document);
    renderClock();
    setInterval(renderClock, CLOCK_TICK_MS);
    await loadAll();
    pollAnnouncement();
    setInterval(() => loadAll(true), POLL_INTERVAL_MS);
    setInterval(pollAnnouncement, BANNER_POLL_MS);
    setInterval(renderNowBadges, 30000);
  }

  boot();
})();
