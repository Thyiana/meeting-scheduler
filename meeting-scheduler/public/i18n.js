// Shared bilingual (中文 / English) dictionary + helpers, used by both the
// admin page (app.js) and the guest page (guest.js). Kept dependency-free
// so it can be dropped into either page with a single <script> tag.
window.I18N = (function () {
  'use strict';

  const STORAGE_KEY = 'ms_lang';

  const dict = {
    zh: {
      // ---- shared / common ----
      'common.cancel': '取消',
      'common.save': '保存',
      'common.close': '关闭',
      'common.delete': '删除',
      'common.copy': '复制',
      'common.confirm': '确定',
      'common.none': '（无）',
      'common.loading': '加载中…',

      // ---- admin: sidebar ----
      'admin.brandTitle': '会议室排期',
      'admin.rooms.heading': '会议室',
      'admin.rooms.addPlaceholder': '新增会议室名称',
      'admin.rooms.addBtn': '添加',
      'admin.rooms.hint': '勾选可在看板中筛选显示对应会议室；点击左侧色块可自定义该会议室的显示颜色',
      'admin.rooms.renamePrompt': '重命名会议室',
      'admin.rooms.deleteConfirm': '确定删除「{name}」？该会议室下的所有预约也会被一并删除。',
      'admin.data.heading': '数据',
      'admin.data.addMeeting': '+ 新建预约',
      'admin.data.export': '导出当前排期 (.xlsx)',
      'admin.invite.heading': '邀请嘉宾预约',
      'admin.invite.btn': '生成邀请二维码',
      'admin.invite.hint': '嘉宾用手机扫码即可查看排期并自助预约会议室，无需安装任何东西；不能管理会议室或导入导出数据。',
      'admin.ical.heading': '第三方日历同步',
      'admin.ical.sourceName': '同步源名称',
      'admin.ical.sourceNamePlaceholder': '例如：行政部日历',
      'admin.ical.url': 'iCal (.ics) URL',
      'admin.ical.targetRoom': '写入到会议室',
      'admin.ical.addBtn': '添加同步源',
      'admin.ical.hint': '系统每 15 分钟自动异步同步一次，超时或出错会自动降级，不影响预约功能。',
      'admin.ical.empty': '暂无同步源',
      'admin.ical.notSynced': '尚未同步',
      'admin.ical.syncNow': '立即同步',
      'admin.ical.deleteBtn': '删除',
      'admin.ical.deleteConfirm': '删除同步源「{name}」？',
      'admin.ical.syncStarted': '已在后台开始同步，稍后刷新查看结果',
      'admin.ical.added': '同步源已添加',

      // ---- admin: toolbar ----
      'admin.toolbar.title': '日程看板 · 00:00 – 24:00',
      'admin.calendars.emptyFiltered': '所有会议室均已被筛选隐藏，请在左侧勾选要显示的会议室',
      'admin.calendars.emptyNoRooms': '暂无会议室，请先在左侧添加',

      // ---- admin: meeting modal ----
      'admin.meeting.titleNew': '新建预约',
      'admin.meeting.titleEdit': '编辑预约',
      'admin.meeting.room': '会议室',
      'admin.meeting.topic': '会议主题',
      'admin.meeting.host': '主持人 / 负责人',
      'admin.meeting.start': '开始时间',
      'admin.meeting.end': '结束时间',
      'admin.meeting.link': '参会人员名单链接',
      'admin.meeting.linkPlaceholder': 'Excel / 文档 URL（选填）',
      'admin.meeting.color': '卡片颜色',
      'admin.meeting.colorCustomTitle': '点击自定义这场会议卡片的颜色',
      'admin.meeting.colorCustom': '已自定义颜色',
      'admin.meeting.colorDefault': '跟随会议室默认颜色',
      'admin.meeting.colorReset': '恢复会议室默认色',
      'admin.meeting.delete': '删除该预约',
      'admin.meeting.deleteConfirm': '确定删除该预约？',
      'admin.meeting.created': '预约已创建',
      'admin.meeting.updated': '预约已更新',
      'admin.meeting.deleted': '预约已删除',

      // ---- admin: export ----
      'admin.export.noData': '暂无预约数据可导出',
      'admin.export.done': '已导出：总览 + 各会议室独立分表',
      'admin.export.notLoaded': '导出组件加载失败，请检查网络',
      'admin.export.sheetOverview': '总览',
      'admin.export.col.no': '序号',
      'admin.export.col.date': '日期',
      'admin.export.col.weekday': '星期',
      'admin.export.col.room': '会议室',
      'admin.export.col.start': '开始时间',
      'admin.export.col.end': '结束时间',
      'admin.export.col.topic': '主题',
      'admin.export.col.host': '主持人',
      'admin.export.col.link': '名单链接',

      // ---- admin: invite modal ----
      'admin.inviteModal.title': '邀请嘉宾扫码预约',
      'admin.inviteModal.addressLabel': '选择本机在局域网中的地址',
      'admin.inviteModal.linkLabel': '嘉宾预约链接',
      'admin.inviteModal.hint': '嘉宾手机需连接同一个 Wi-Fi / 局域网才能扫码打开。该页面只能查看排期和新建预约，不能管理会议室或导入导出数据。',
      'admin.inviteModal.qrFailed': '二维码组件加载失败，可直接复制下方链接发送给嘉宾',
      'admin.inviteModal.copied': '链接已复制',

      // ---- admin: room list ----
      'admin.room.added': '会议室已添加',
      'admin.room.updated': '会议室已更新',
      'admin.room.deleted': '会议室已删除',
      'admin.room.colorPickTitle': '点击选择该会议室的显示颜色',

      // ---- weekday (short) ----
      'weekday.0': '周日', 'weekday.1': '周一', 'weekday.2': '周二',
      'weekday.3': '周三', 'weekday.4': '周四', 'weekday.5': '周五', 'weekday.6': '周六',

      // ---- guest page ----
      'guest.title': '会议室预约',
      'guest.addBtn': '+ 新建预约',
      'guest.bookTitleNew': '新建预约',
      'guest.bookTitleEdit': '编辑预约',
      'guest.saveNew': '提交预约',
      'guest.saveEdit': '保存修改',
      'guest.room': '会议室',
      'guest.topic': '会议主题',
      'guest.host': '姓名 / 主持人',
      'guest.start': '开始时间',
      'guest.end': '结束时间',
      'guest.link': '参会人员名单链接',
      'guest.color': '卡片颜色',
      'guest.colorCustomTitle': '点击自定义这场会议卡片的颜色',
      'guest.colorCustom': '已自定义颜色',
      'guest.colorDefault': '跟随会议室默认颜色',
      'guest.colorReset': '恢复会议室默认色',
      'guest.linkPlaceholder': 'Excel / 文档 URL（选填）',
      'guest.viewTitle': '预约详情',
      'guest.viewRoom': '会议室',
      'guest.viewTopic': '主题',
      'guest.viewHost': '主持人',
      'guest.viewTime': '时间',
      'guest.viewLink': '参会名单',
      'guest.editBtn': '编辑',
      'guest.deleteBtn': '取消该预约',
      'guest.deleteConfirm': '确定取消该预约吗？此操作无法撤销。',
      'guest.deleted': '预约已取消',
      'guest.created': '预约成功',
      'guest.updated': '预约已更新',
      'guest.calendarLoadFailed': '日历组件加载失败，请检查网络',
      'guest.noRooms': '暂无会议室，请联系管理员添加',

      // ---- generic errors (fallback if backend didn't send a known code) ----
      'errors.generic': '请求失败，请稍后再试',
      'errors.ROOM_NAME_REQUIRED': '会议室名称不能为空',
      'errors.ROOM_DUPLICATE': '已存在同名会议室',
      'errors.ROOM_NOT_FOUND': '会议室不存在',
      'errors.ROOM_COLOR_INVALID': '颜色格式不正确，应为 #RRGGBB',
      'errors.MEETING_ROOM_REQUIRED': '请选择会议室',
      'errors.MEETING_TOPIC_REQUIRED': '请输入会议主题',
      'errors.MEETING_HOST_REQUIRED': '请输入主持人/负责人',
      'errors.MEETING_TIME_INVALID': '开始/结束时间格式不正确',
      'errors.MEETING_END_BEFORE_START': '结束时间必须晚于开始时间',
      'errors.MEETING_OUT_OF_RANGE': '会议时间需在 2026-09-28 至 2026-10-01 排期区间内',
      'errors.MEETING_ROOM_NOT_FOUND': '所选会议室不存在',
      'errors.MEETING_COLOR_INVALID': '卡片颜色格式不正确，应为 #RRGGBB',
      'errors.MEETING_CONFLICT': '该会议室在此时间段已有预约，存在时间冲突',
      'errors.MEETING_NOT_FOUND': '预约不存在',
      'errors.ICAL_FIELDS_REQUIRED': '请填写名称和 iCal URL',
      'errors.ICAL_NOT_FOUND': '同步源不存在',
    },
    en: {
      'common.cancel': 'Cancel',
      'common.save': 'Save',
      'common.close': 'Close',
      'common.delete': 'Delete',
      'common.copy': 'Copy',
      'common.confirm': 'Confirm',
      'common.none': 'None',
      'common.loading': 'Loading…',

      'admin.brandTitle': 'Room Scheduler',
      'admin.rooms.heading': 'Rooms',
      'admin.rooms.addPlaceholder': 'New room name',
      'admin.rooms.addBtn': 'Add',
      'admin.rooms.hint': 'Check to show/hide a room on the board; click the color swatch to customize that room\'s color',
      'admin.rooms.renamePrompt': 'Rename room',
      'admin.rooms.deleteConfirm': 'Delete "{name}"? All its bookings will be deleted too.',
      'admin.data.heading': 'Data',
      'admin.data.addMeeting': '+ New booking',
      'admin.data.export': 'Export schedule (.xlsx)',
      'admin.invite.heading': 'Invite guests',
      'admin.invite.btn': 'Generate invite QR code',
      'admin.invite.hint': 'Guests can scan on their phone to view the schedule and book a room themselves — no install needed; they can\'t manage rooms or import/export data.',
      'admin.ical.heading': 'Third-party calendar sync',
      'admin.ical.sourceName': 'Source name',
      'admin.ical.sourceNamePlaceholder': 'e.g. Admin team calendar',
      'admin.ical.url': 'iCal (.ics) URL',
      'admin.ical.targetRoom': 'Write into room',
      'admin.ical.addBtn': 'Add sync source',
      'admin.ical.hint': 'Syncs automatically every 15 minutes in the background; timeouts or errors degrade gracefully and never block bookings.',
      'admin.ical.empty': 'No sync sources yet',
      'admin.ical.notSynced': 'Not synced yet',
      'admin.ical.syncNow': 'Sync now',
      'admin.ical.deleteBtn': 'Delete',
      'admin.ical.deleteConfirm': 'Delete sync source "{name}"?',
      'admin.ical.syncStarted': 'Sync started in the background, refresh shortly to see results',
      'admin.ical.added': 'Sync source added',

      'admin.toolbar.title': 'Schedule Board · 00:00 – 24:00',
      'admin.calendars.emptyFiltered': 'All rooms are hidden by the filter — check a room on the left to show it',
      'admin.calendars.emptyNoRooms': 'No rooms yet — add one on the left',

      'admin.meeting.titleNew': 'New booking',
      'admin.meeting.titleEdit': 'Edit booking',
      'admin.meeting.room': 'Room',
      'admin.meeting.topic': 'Topic',
      'admin.meeting.host': 'Host / Organizer',
      'admin.meeting.start': 'Start time',
      'admin.meeting.end': 'End time',
      'admin.meeting.link': 'Attendee list link',
      'admin.meeting.linkPlaceholder': 'Excel / doc URL (optional)',
      'admin.meeting.color': 'Card color',
      'admin.meeting.colorCustomTitle': 'Click to customize this booking\'s card color',
      'admin.meeting.colorCustom': 'Custom color set',
      'admin.meeting.colorDefault': 'Following room\'s default color',
      'admin.meeting.colorReset': 'Reset to room default',
      'admin.meeting.delete': 'Delete this booking',
      'admin.meeting.deleteConfirm': 'Delete this booking?',
      'admin.meeting.created': 'Booking created',
      'admin.meeting.updated': 'Booking updated',
      'admin.meeting.deleted': 'Booking deleted',

      'admin.export.noData': 'No bookings to export yet',
      'admin.export.done': 'Exported: overview + one sheet per room',
      'admin.export.notLoaded': 'Export component failed to load, please check your network',
      'admin.export.sheetOverview': 'Overview',
      'admin.export.col.no': 'No.',
      'admin.export.col.date': 'Date',
      'admin.export.col.weekday': 'Weekday',
      'admin.export.col.room': 'Room',
      'admin.export.col.start': 'Start',
      'admin.export.col.end': 'End',
      'admin.export.col.topic': 'Topic',
      'admin.export.col.host': 'Host',
      'admin.export.col.link': 'Attendee link',

      'admin.inviteModal.title': 'Invite guests to book via QR code',
      'admin.inviteModal.addressLabel': 'Select this machine\'s LAN address',
      'admin.inviteModal.linkLabel': 'Guest booking link',
      'admin.inviteModal.hint': 'Guests\' phones need to be on the same Wi-Fi / LAN to open this by scanning. This page can only view the schedule and create bookings — no room management or import/export.',
      'admin.inviteModal.qrFailed': 'QR component failed to load — you can copy the link below and send it to guests directly',
      'admin.inviteModal.copied': 'Link copied',

      'admin.room.added': 'Room added',
      'admin.room.updated': 'Room updated',
      'admin.room.deleted': 'Room deleted',
      'admin.room.colorPickTitle': 'Click to pick this room\'s display color',

      'weekday.0': 'Sun', 'weekday.1': 'Mon', 'weekday.2': 'Tue',
      'weekday.3': 'Wed', 'weekday.4': 'Thu', 'weekday.5': 'Fri', 'weekday.6': 'Sat',

      'guest.title': 'Room Booking',
      'guest.addBtn': '+ New booking',
      'guest.bookTitleNew': 'New booking',
      'guest.bookTitleEdit': 'Edit booking',
      'guest.saveNew': 'Submit booking',
      'guest.saveEdit': 'Save changes',
      'guest.room': 'Room',
      'guest.topic': 'Topic',
      'guest.host': 'Your name / host',
      'guest.start': 'Start time',
      'guest.end': 'End time',
      'guest.link': 'Attendee list link',
      'guest.color': 'Card color',
      'guest.colorCustomTitle': 'Click to customize this booking\'s card color',
      'guest.colorCustom': 'Custom color set',
      'guest.colorDefault': 'Following room\'s default color',
      'guest.colorReset': 'Reset to room default',
      'guest.linkPlaceholder': 'Excel / doc URL (optional)',
      'guest.viewTitle': 'Booking details',
      'guest.viewRoom': 'Room',
      'guest.viewTopic': 'Topic',
      'guest.viewHost': 'Host',
      'guest.viewTime': 'Time',
      'guest.viewLink': 'Attendee list',
      'guest.editBtn': 'Edit',
      'guest.deleteBtn': 'Cancel booking',
      'guest.deleteConfirm': 'Cancel this booking? This can\'t be undone.',
      'guest.deleted': 'Booking cancelled',
      'guest.created': 'Booking confirmed',
      'guest.updated': 'Booking updated',
      'guest.calendarLoadFailed': 'Calendar failed to load, please check your network',
      'guest.noRooms': 'No rooms yet — please contact an admin',

      'errors.generic': 'Something went wrong, please try again',
      'errors.ROOM_NAME_REQUIRED': 'Room name is required',
      'errors.ROOM_DUPLICATE': 'A room with this name already exists',
      'errors.ROOM_NOT_FOUND': 'Room not found',
      'errors.ROOM_COLOR_INVALID': 'Invalid color format, should be #RRGGBB',
      'errors.MEETING_ROOM_REQUIRED': 'Please select a room',
      'errors.MEETING_TOPIC_REQUIRED': 'Please enter a topic',
      'errors.MEETING_HOST_REQUIRED': 'Please enter a host / organizer',
      'errors.MEETING_TIME_INVALID': 'Start/end time format is invalid',
      'errors.MEETING_END_BEFORE_START': 'End time must be after start time',
      'errors.MEETING_OUT_OF_RANGE': 'Booking time must be within 2026-09-28 to 2026-10-01',
      'errors.MEETING_ROOM_NOT_FOUND': 'Selected room does not exist',
      'errors.MEETING_COLOR_INVALID': 'Invalid card color format, should be #RRGGBB',
      'errors.MEETING_CONFLICT': 'This room already has a booking in that time slot',
      'errors.MEETING_NOT_FOUND': 'Booking not found',
      'errors.ICAL_FIELDS_REQUIRED': 'Please fill in both name and iCal URL',
      'errors.ICAL_NOT_FOUND': 'Sync source not found',
    },
  };

  let lang = (function () {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'zh' || saved === 'en') return saved;
    } catch (e) { /* localStorage unavailable, fall through */ }
    return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'zh';
    // Default to zh regardless of browser locale — this app's primary
    // audience is Chinese-speaking; English is opt-in via the toggle.
  })();

  function t(key, vars) {
    let str = (dict[lang] && dict[lang][key]) || dict.zh[key] || key;
    if (vars) {
      Object.keys(vars).forEach((k) => { str = str.replace(`{${k}}`, vars[k]); });
    }
    return str;
  }

  function errorText(errOrCode) {
    const code = typeof errOrCode === 'string' ? errOrCode : (errOrCode && errOrCode.code);
    if (code && dict[lang][`errors.${code}`]) return t(`errors.${code}`);
    // Fall back to whatever message the server sent (usually Chinese),
    // or a generic translated message if we have nothing at all.
    if (errOrCode && errOrCode.message) return errOrCode.message;
    return t('errors.generic');
  }

  function applyStaticI18n(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((elm) => {
      elm.textContent = t(elm.getAttribute('data-i18n'));
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((elm) => {
      elm.setAttribute('placeholder', t(elm.getAttribute('data-i18n-placeholder')));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach((elm) => {
      elm.setAttribute('title', t(elm.getAttribute('data-i18n-title')));
    });
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    scope.querySelectorAll('[data-i18n-lang-label]').forEach((elm) => {
      elm.textContent = lang === 'zh' ? 'EN' : '中文'; // shows the language you'd switch TO
    });
  }

  function setLang(newLang) {
    lang = newLang === 'en' ? 'en' : 'zh';
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
    applyStaticI18n(document);
    document.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang } }));
  }

  function getLang() { return lang; }

  function toggle() { setLang(lang === 'zh' ? 'en' : 'zh'); }

  return { t, errorText, applyStaticI18n, setLang, getLang, toggle };
})();
