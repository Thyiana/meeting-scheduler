# 会议室排期系统

一个黑白灰极简风格的会议室预约 / 排期管理网页，排期管理区间固定为 **2026-09-28 至 2026-10-01**。

## 功能

- **会议室管理**：动态添加 / 重命名 / 删除会议室，预约下拉菜单与看板颜色实时同步。
- **日程看板（FullCalendar 6）**：4 天时间轴视图，00:00–24:00 全时段展示，按会议室着色，点击/拖拽创建预约，点击事件弹窗编辑或删除。
- **表单 Enter 键跳转**：预约表单与同步源表单中，回车自动跳到下一个输入项，最后一项回车直接提交。
- **批量导入**：上传 `.xlsx` / `.csv` 文件批量写入数据库（支持列名：会议室/room、主题/topic、主持人/host、开始时间/start_time、结束时间/end_time、名单链接/attendee_link），会议室不存在时自动创建，超出排期区间或与现有预约冲突的行会被跳过并在提示中列出原因。
- **导出**：基于 SheetJS（`xlsx.full.min.js`）一键导出当前全部排期为 `.xlsx`，包含序号、会议室、主题、主持人、起止时间、名单链接，文件名按当天日期自动命名。
- **第三方 iCal 同步**：添加任意 `.ics` 日历 URL，系统通过 `node-cron` 每 15 分钟异步抓取一次，写入指定会议室；也可手动"立即同步"。抓取使用 8 秒超时（`AbortController`），任何网络失败/超时都会被捕获并记录状态，**不会阻塞 `/api/meetings` 等主线程接口**。
- **嘉宾扫码预约**：管理端侧边栏点「生成邀请二维码」，会读取本机在局域网中的 IPv4 地址并生成一个指向 `/guest` 的二维码。嘉宾手机连接同一 Wi-Fi 扫码即可打开专门的手机端页面（`public/guest.html`），按会议室 + 日期查看已占用时段、自助提交预约，也能取消自己提交的预约。嘉宾端不包含会议室管理、批量导入导出、iCal 同步等管理功能，界面也是单独按手机屏幕优化过的。

## 技术要点（性能与稳定性）

- **SQLite**：使用 Node.js 22+ 内置的 `node:sqlite` 模块（无需 `better-sqlite3` 等原生编译依赖，Windows 上不用装 Python / C++ 编译工具），启用 `WAL` 日志模式 + `busy_timeout`，进程收到 `SIGINT`/`SIGTERM`/`exit` 时执行 `wal_checkpoint(TRUNCATE)` 后再关闭连接，避免异常退出导致数据库死锁或产生游离的 WAL 文件。
- **iCal 同步解耦**：每次同步都在 `setImmediate` 中触发、用 `AbortController` 限制请求超时、且各同步源之间串行执行，避免并发抓取导致 CPU/网络突增拖慢 HTTP 服务；手动触发接口会立即返回“已在后台开始”，不等待抓取结果。
- **前端依赖走国内 CDN**：FullCalendar 6、SheetJS 默认使用 BootCDN，`index.html` 中同时预留了 jsDelivr 备用地址（注释形式），CDN 不可用时取消注释切换即可。

## 目录结构

```
meeting-scheduler/
├── server/
│   ├── index.js        # Express 入口
│   ├── db.js            # SQLite 初始化 / WAL / 优雅关闭
│   ├── icalSync.js       # 非阻塞 iCal 抓取与解析
│   ├── cron.js            # node-cron 定时任务
│   └── routes/
│       ├── rooms.js        # 会议室 CRUD
│       ├── meetings.js      # 预约 CRUD + 批量导入
│       └── ical.js           # 第三方同步源管理
├── public/
│   ├── index.html        # 管理端（桌面）
│   ├── style.css
│   ├── app.js
│   ├── guest.html         # 嘉宾端（手机端，扫码打开）
│   ├── guest.css
│   └── guest.js
├── data/                # SQLite 数据文件（首次启动自动生成）
└── package.json
```

## 运行方式

> 需要 Node.js **22.5 以上**版本（内置 `node:sqlite`，不需要额外编译原生模块）。运行 `node -v` 确认版本，不够新的话去 https://nodejs.org 更新。

```bash
npm install
npm start
```

默认监听 `http://localhost:3000`，浏览器打开即可使用。首次启动会自动创建 `会议室 A` / `会议室 B` 两个示例会议室，以及 SQLite 数据库文件 `data/scheduler.db`。

如需更换端口：

```bash
PORT=8080 npm start
```

## 部署到公网（以 Render 为例）

推到 GitHub 后连接 Render 会自动部署，但有一点必须注意：

**免费套餐的磁盘不是持久化的** —— 每次你 `git push` 新代码触发重新部署，服务器上的文件（包括 SQLite 数据库 `data/scheduler.db`）都会被清空重置成初始状态。单纯的休眠/唤醒（免费套餐闲置一段时间后自动休眠）不会清数据，只有"重新部署"才会。

如果只是自己测试、不太在意数据保留，可以不用管这条，直接用免费套餐。如果要长期给别人用、不希望数据被清：

1. 升级到 Render 的付费套餐（Starter 起，约 $7/月），然后在服务设置里加一个 **Disk**（持久化磁盘），挂载路径随便起一个，比如 `/var/data`。
2. 在环境变量里加一条 `DATA_DIR=/var/data`（要跟磁盘挂载路径一致）。
3. 重新部署一次。之后数据库文件就存在这个持久化磁盘上，重新部署代码也不会再清空。

代码已经支持读取 `DATA_DIR` 环境变量，不用改代码，只需要在 Render 后台配置好磁盘和环境变量即可。

## 批量导入模板列名

| 会议室 | 主题 | 主持人 | 开始时间 | 结束时间 | 名单链接 |
|---|---|---|---|---|---|
| 会议室 A | 周例会 | 张三 | 2026-09-28 09:00 | 2026-09-28 10:00 | https://... |

时间格式支持 `YYYY-MM-DD HH:mm` 或 `YYYY-MM-DDTHH:mm`，也兼容 Excel 原生日期单元格。
