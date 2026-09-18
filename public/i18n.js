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
      'admin.banner.heading': '紧急公告',
      'admin.banner.placeholder': '例如：Cinnamon Room 14:00 议程顺延 15 分钟',
      'admin.banner.publishBtn': '发布公告',
      'admin.banner.clearBtn': '撤下公告',
      'admin.banner.published': '公告已发布，嘉宾端将在数秒内看到',
      'admin.banner.cleared': '公告已撤下',
      'admin.banner.hint': '发布后会悬浮显示在嘉宾预约页顶部，嘉宾端每 15 秒自动检查一次。',
      'admin.reset.heading': '危险操作',
      'admin.reset.btn': '一键清空测试数据 / 重置排期',
      'admin.reset.confirm1': '即将删除全部预约数据（会议室本身不受影响），此操作不可撤销，确定继续吗？',
      'admin.reset.confirm2': '请再次确认：输入 RESET 以执行清空',
      'admin.reset.confirmWord': 'RESET',
      'admin.reset.cancelled': '已取消，未做任何更改',
      'admin.reset.done': '已清空 {count} 条预约数据',
      'admin.reset.hint': '上线前用于秒级清场；会保留已创建的会议室，仅删除全部预约记录。',

      // ---- admin: toolbar ----
      'admin.toolbar.title': '日程看板',
      'admin.toolbar.fullDay': '显示全天 (24H)',
      'admin.toolbar.jumpNow': '跳转到当前时间',
      'admin.toolbar.searchPlaceholder': '按主持人 / 关键词搜索…',
      'admin.toolbar.signageBtn': '门头看板模式 ↗',
      'admin.toolbar.tz': '本会议室所有预约时间均以新加坡时间（SGT）为准',
      'admin.calendars.emptyFiltered': '所有会议室均已被筛选隐藏，请在左侧勾选要显示的会议室',
      'admin.calendars.emptyNoRooms': '暂无会议室，请先在左侧添加',
      'admin.calendars.emptySearch': '没有匹配「{query}」的预约',

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
      'admin.meeting.contact': '联系电话 / 备注',
      'admin.meeting.contactPlaceholder': '例如：138xxxxxxxx（选填）',
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
      'admin.export.col.host': '主持人/主讲人',
      'admin.export.col.link': '名单链接',
      'admin.export.col.contact': '联系电话/备注',

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

      // ---- buffer-time reminder (shown as a non-blocking toast after save) ----
      'buffer.warningBefore': '提示：距离上一场「{topic}」仅 {minutes} 分钟，未满 15 分钟缓冲时间',
      'buffer.warningAfter': '提示：距离下一场「{topic}」仅 {minutes} 分钟，未满 15 分钟缓冲时间',

      // ---- weekday (short) ----
      'weekday.0': '周日', 'weekday.1': '周一', 'weekday.2': '周二',
      'weekday.3': '周三', 'weekday.4': '周四', 'weekday.5': '周五', 'weekday.6': '周六',

      // ---- guest page ----
      'guest.title': '会议室预约',
      'guest.tz': '本会议室所有预约时间均以新加坡时间（SGT）为准',
      'guest.currentRoom': '当前选择：',
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
      'guest.date': '预约日期',
      'guest.startTime': '开始时刻',
      'guest.endTime': '结束时刻',
      'guest.link': '参会人员名单链接',
      'guest.contact': '联系电话 / 备注',
      'guest.contactPlaceholder': '例如：138xxxxxxxx（选填）',
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
      'guest.viewContact': '联系电话/备注',
      'guest.exportIcs': '导出到日历 (.ics)',
      'guest.exportGoogle': '添加到 Google Calendar',
      'guest.editBtn': '编辑',
      'guest.deleteBtn': '取消该预约',
      'guest.deleteConfirm': '确定取消该预约吗？此操作无法撤销。',
      'guest.deleted': '预约已取消',
      'guest.created': '预约成功',
      'guest.updated': '预约已更新',
      'guest.calendarLoadFailed': '日历组件加载失败，请检查网络',
      'guest.noRooms': '暂无会议室，请联系管理员添加',
      'guest.offlineBadge': '离线模式 · 显示的是最近一次缓存的排期',
      'guest.offlineSaveFailed': '当前网络不可用，预约暂无法提交，请稍后重试',

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
      'errors.MEETING_OUT_OF_RANGE': '会议时间需在 2026-09-28 至 2026-09-30 排期区间内',
      'errors.MEETING_ROOM_NOT_FOUND': '所选会议室不存在',
      'errors.MEETING_COLOR_INVALID': '卡片颜色格式不正确，应为 #RRGGBB',
      'errors.MEETING_CONFLICT': '该会议室在此时间段已有预约，存在时间冲突',
      'errors.MEETING_NOT_FOUND': '预约不存在',
      'errors.MEETING_STALE': '该预约已被他人修改，请刷新后重试',
      'errors.RESET_NOT_CONFIRMED': '需要确认才能执行重置',

      // ---- signage (door display) mode ----
      'signage.noMeetings': '本日暂无安排',
      'signage.ongoing': '进行中',
      'signage.upcoming': '即将开始',
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
      'admin.banner.heading': 'Emergency banner',
      'admin.banner.placeholder': 'e.g. Cinnamon Room 14:00 agenda delayed 15 min',
      'admin.banner.publishBtn': 'Publish',
      'admin.banner.clearBtn': 'Clear banner',
      'admin.banner.published': 'Published — guests will see it within seconds',
      'admin.banner.cleared': 'Banner cleared',
      'admin.banner.hint': 'Once published, this floats at the top of the guest page; guests poll for it every 15 seconds.',
      'admin.reset.heading': 'Danger zone',
      'admin.reset.btn': 'Clear test data / reset schedule',
      'admin.reset.confirm1': 'This deletes every booking (rooms themselves are kept). This cannot be undone — continue?',
      'admin.reset.confirm2': 'Type RESET to confirm and wipe all bookings',
      'admin.reset.confirmWord': 'RESET',
      'admin.reset.cancelled': 'Cancelled — nothing was changed',
      'admin.reset.done': 'Cleared {count} booking(s)',
      'admin.reset.hint': 'For a fast wipe right before doors open. Keeps rooms, deletes bookings only.',

      'admin.toolbar.title': 'Schedule Board',
      'admin.toolbar.fullDay': 'Show full day (24H)',
      'admin.toolbar.jumpNow': 'Jump to now',
      'admin.toolbar.searchPlaceholder': 'Search host / keyword…',
      'admin.toolbar.signageBtn': 'Signage mode ↗',
      'admin.toolbar.tz': 'All booking times for this room are in Singapore time (SGT)',
      'admin.calendars.emptyFiltered': 'All rooms are hidden by the filter — check a room on the left to show it',
      'admin.calendars.emptyNoRooms': 'No rooms yet — add one on the left',
      'admin.calendars.emptySearch': 'No bookings match "{query}"',

      'admin.meeting.titleNew': 'New booking',
      'admin.meeting.titleEdit': 'Edit booking',
      'admin.meeting.room': 'Room',
      'admin.meeting.topic': 'Topic',
      'admin.meeting.host': 'Host / Organizer',
      'admin.meeting.start': 'Start time',
      'admin.meeting.end': 'End time',
      'admin.meeting.link': 'Attendee list link',
      'admin.meeting.linkPlaceholder': 'Excel / doc URL (optional)',
      'admin.meeting.contact': 'Contact phone / notes',
      'admin.meeting.contactPlaceholder': 'e.g. +65 xxxx xxxx (optional)',
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
      'admin.export.col.host': 'Host / Speaker',
      'admin.export.col.link': 'Attendee link',
      'admin.export.col.contact': 'Contact / Notes',

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

      'buffer.warningBefore': 'Heads up: only {minutes} min after the previous "{topic}" — under the 15-min buffer',
      'buffer.warningAfter': 'Heads up: only {minutes} min before the next "{topic}" — under the 15-min buffer',

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
      'errors.MEETING_OUT_OF_RANGE': 'Booking time must be within 2026-09-28 to 2026-09-30',
      'errors.MEETING_ROOM_NOT_FOUND': 'Selected room does not exist',
      'errors.MEETING_COLOR_INVALID': 'Invalid card color format, should be #RRGGBB',
      'errors.MEETING_CONFLICT': 'This room already has a booking in that time slot',
      'errors.MEETING_NOT_FOUND': 'Booking not found',
      'errors.MEETING_STALE': 'This booking was just changed by someone else — please refresh and try again',
      'errors.RESET_NOT_CONFIRMED': 'Confirmation required to reset',

      // ---- signage (door display) mode ----
      'signage.noMeetings': 'Nothing scheduled today',
      'signage.ongoing': 'Ongoing',
      'signage.upcoming': 'Upcoming',
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
