/**
 * Tiny i18n: English + Russian. Language comes from config ("auto" | "en" | "ru");
 * "auto" picks Russian when the system locale is Russian, English otherwise.
 */

let lang = "en";

export function setLanguage(pref) {
    if (pref === "en" || pref === "ru") lang = pref;
    else {
        const loc = Intl.DateTimeFormat().resolvedOptions().locale || process.env.LANG || "";
        lang = /^ru\b|^ru[-_]/i.test(loc) ? "ru" : "en";
    }
    return lang;
}

export const getLanguage = () => lang;

/** Translate a key; values may be strings or functions of the arguments. */
export function t(key, ...args) {
    const entry = M[key];
    if (!entry) return key;
    const v = entry[lang] ?? entry.en;
    return typeof v === "function" ? v(...args) : v;
}

/** "y"/"yes"/"д"/"да" or empty (default yes) → true. */
export const isYes = answer => /^(y|yes|д|да)?$/i.test(answer.trim());

const ZONE_NAMES = {
    en: { left: "left", right: "right", center: "center", all: "whole screen", top: "top", bottom: "bottom" },
    ru: { left: "слева", right: "справа", center: "центр", all: "весь экран", top: "верх", bottom: "низ" },
};
export const zoneName = z => (typeof z === "string" ? (ZONE_NAMES[lang][z] ?? z) : JSON.stringify(z));

const M = {
    // ------------------------------------------------------------ general
    error: { en: m => `Error: ${m}`, ru: m => `Ошибка: ${m}` },
    timeout: { en: what => `timed out: ${what}`, ru: what => `таймаут: ${what}` },
    unknownZone: {
        en: (z, list) => `Unknown zone "${z}". Available: ${list} or {x,y,w,h}`,
        ru: (z, list) => `Неизвестная зона "${z}". Доступны: ${list} или {x,y,w,h}`,
    },

    // ------------------------------------------------------------ lamps
    "lamps.connecting": { en: "Connecting to lamps…", ru: "Подключаюсь к лампам…" },
    "lamps.ok": { en: (n, s) => `  "${n}" — connected in ${s} s`, ru: (n, s) => `  «${n}» — ок за ${s} с` },
    "lamps.later": {
        en: n => `  "${n}" — not responding yet, will join in the background`,
        ru: n => `  «${n}» — пока не отвечает, подключится в фоне`,
    },
    "lamps.joined": { en: n => `\n"${n}" connected`, ru: n => `\n«${n}» подключилась` },
    "lamps.error": { en: (n, m) => `  "${n}" — error: ${m}`, ru: (n, m) => `  «${n}» — ошибка: ${m}` },
    "lamps.connectWhat": { en: id => `connecting to lamp ${id}`, ru: id => `подключение к лампе ${id}` },
    "lamps.dataWhat": { en: "reading lamp data", ru: "чтение данных лампы" },
    "lamps.notColor": {
        en: id => `node ${id} has no ColorControl cluster — is it a color light?`,
        ru: id => `у узла ${id} нет кластера ColorControl — это не цветная лампа?`,
    },
    "lamps.restoreWhat": { en: "restoring the light", ru: "возврат света" },
    "lamps.restoreFailed": { en: m => `  could not restore the light: ${m}`, ru: m => `  не удалось вернуть свет: ${m}` },
    "lamps.searching": {
        en: "Looking for the lamp on the network and adding it (up to ~1 minute)…",
        ru: "Ищу лампу в сети и добавляю (до ~1 минуты)…",
    },
    "lamps.offline": { en: "offline", ru: "нет связи" },
    "lamps.sendError": { en: (n, m) => `\n"${n}": ${m}`, ru: (n, m) => `\n«${n}»: ${m}` },

    // ------------------------------------------------------------ capture
    "capture.gpu": {
        en: (n, w, h, i) => `Screen: ${n} ${w}×${h} (GPU capture via ffmpeg, output ${i})`,
        ru: (n, w, h, i) => `Экран: ${n} ${w}×${h} (захват через видеокарту, вывод ${i})`,
    },
    "capture.cpu": {
        en: (n, w, h) => `Screen: ${n} ${w}×${h} (no ffmpeg — higher CPU load; install it: winget install Gyan.FFmpeg)`,
        ru: (n, w, h) => `Экран: ${n} ${w}×${h} (без ffmpeg — выше нагрузка на процессор; установка: winget install Gyan.FFmpeg)`,
    },
    "capture.restart": {
        en: (c, e) => `\nffmpeg capture restarting (code ${c}) ${e}`,
        ru: (c, e) => `\nзахват ffmpeg перезапускается (код ${c}) ${e}`,
    },
    "capture.error": { en: m => `screen capture: ${m}`, ru: m => `захват экрана: ${m}` },

    // ------------------------------------------------------------ glow
    "glow.noMonitor": { en: "Glow: no second monitor — skipped", ru: "Свечение: второго монитора нет — пропускаю" },
    "glow.noBrowser": { en: "Glow: Edge/Chrome not found — skipped", ru: "Свечение: не найден Edge/Chrome — пропускаю" },
    "glow.on": {
        en: (n, w, h, side) => `Glow: ${n} ${w}×${h} (${side === "left" ? "left" : "right"} of the main screen)`,
        ru: (n, w, h, side) => `Свечение: ${n} ${w}×${h} (${side === "left" ? "слева" : "справа"} от основного)`,
    },
    "glow.failed": { en: m => `Glow did not start: ${m}`, ru: m => `Свечение не запустилось: ${m}` },
    "glow.started": { en: "Glow is running. Ctrl+C to exit.", ru: "Свечение запущено. Ctrl+C — выход." },

    // ------------------------------------------------------------ run / preview / test
    "run.noLamps": { en: "No lamps yet — starting setup.\n", ru: "Ламп пока нет — запускаю настройку.\n" },
    "run.noneConnected": { en: "No lamp connected", ru: "Ни одна лампа не подключилась" },
    "run.started": {
        en: "Sync is running. Press Ctrl+C or close this window to stop and restore the light.\n",
        ru: "Синхронизация запущена. Ctrl+C или закрытие окна — остановить и вернуть свет как было.\n",
    },
    "run.restoring": { en: "\nRestoring lamps…", ru: "\nВозвращаю лампы в исходное состояние…" },
    "preview.title": { en: "Zone color preview (Ctrl+C to exit)\n", ru: "Предпросмотр цветов зон (Ctrl+C — выход)\n" },
    "test.colors": {
        en: ["red", "green", "blue", "yellow", "purple"],
        ru: ["красный", "зелёный", "синий", "жёлтый", "фиолетовый"],
    },
    "test.row": { en: (n, z, c) => `"${n}" (${z}) → ${c}`, ru: (n, z, c) => `«${n}» (${z}) → ${c}` },
    "test.hold": { en: "Holding for 8 seconds, then restoring…", ru: "Держу 8 секунд, потом верну как было…" },

    // ------------------------------------------------------------ pair / list / unpair
    "pair.usage": {
        en: "Usage: node ambilight.mjs pair <code> [name] [zone]",
        ru: "Использование: node ambilight.mjs pair <код> [имя] [зона]",
    },
    "pair.done": {
        en: (n, id, z) => `Done: "${n}", node ${id}, zone: ${z}`,
        ru: (n, id, z) => `Готово: «${n}», node ${id}, зона: ${z}`,
    },
    "pair.green": { en: "The lamp should turn green now.", ru: "Лампа должна загореться зелёным." },
    "list.empty": {
        en: 'No lamps yet. Run "Add lamp.bat" (or: node ambilight.mjs setup).',
        ru: "Ламп пока нет. Запустите «Add lamp.bat» (или: node ambilight.mjs setup).",
    },
    "list.row": {
        en: l => `node ${l.nodeId}  "${l.name}"  zone: ${zoneName(l.zone)}`,
        ru: l => `node ${l.nodeId}  «${l.name}»  зона: ${zoneName(l.zone)}`,
    },
    "unpair.notFound": { en: w => `lamp "${w}" not found`, ru: w => `лампа «${w}» не найдена` },
    "unpair.noAnswer": {
        en: m => `The lamp did not answer (${m}); removing it from the config only.`,
        ru: m => `Лампа не ответила (${m}), убираю только из конфига.`,
    },
    "unpair.done": {
        en: n => `"${n}" removed. It stays in your other smart home apps.`,
        ru: n => `«${n}» удалена. В других приложениях умного дома она остаётся.`,
    },

    // ------------------------------------------------------------ setup wizard
    "setup.title": { en: "\n=== Ambilight setup ===\n", ru: "\n=== Настройка Ambilight ===\n" },
    "setup.intro": {
        en: `Lamps are added as a second controller (Matter multi-admin) — they stay in your current app.
Get a pairing code for each lamp:
  • Apple Home: lamp → settings → "Turn On Pairing Mode"
  • Google Home: lamp → settings → "Linked Matter apps & services" → "Link apps & services"
  • Other apps: look for "share with other apps" / "pairing mode" in the lamp settings
`,
        ru: `Лампы добавляются вторым контроллером (Matter multi-admin) — в вашем приложении они остаются.
Получите код сопряжения для каждой лампы:
  • Apple «Дом»: лампа → настройки → «Включить режим создания пары»
  • Google Home: лампа → настройки → «Связанные приложения и сервисы Matter» → «Связать»
  • Другие приложения: ищите «поделиться с другими приложениями» / «режим сопряжения» в настройках лампы
`,
    },
    "setup.existing": { en: n => `Already added: ${n} lamp(s).\n`, ru: n => `Уже добавлено ламп: ${n}.\n` },
    "setup.askCode": { en: "Pairing code (Enter — finish): ", ru: "Код сопряжения (Enter — закончить): " },
    "setup.badCode": {
        en: "That doesn't look like a Matter code (11 or 21 digits, or MT:…). Try again.\n",
        ru: "Это не похоже на код Matter (11 или 21 цифра, либо MT:…). Попробуйте ещё раз.\n",
    },
    "setup.failed": {
        en: m => `Could not add the lamp: ${m}
Check that pairing mode is still on (the code expires in ~15 min), the PC and the lamp are on the same network,
and that a VPN on this PC isn't blocking local devices.\n`,
        ru: m => `Не удалось добавить лампу: ${m}
Проверьте, что режим сопряжения ещё включён (код действует ~15 минут), компьютер и лампа в одной сети,
и VPN на компьютере не блокирует локальные устройства.\n`,
    },
    "setup.added": { en: "Added! The lamp should be green now.", ru: "Добавлена! Лампа должна гореть зелёным." },
    "setup.defaultName": { en: n => `Lamp ${n}`, ru: n => `Лампа ${n}` },
    "setup.askName": { en: d => `Name [${d}]: `, ru: d => `Название [${d}]: ` },
    "setup.zoneMenu": {
        en: `Where is this lamp?
  1) left of the screen       2) right of the screen     3) behind the screen (center)
  4) above you / room light (whole screen)               5) top edge   6) bottom edge`,
        ru: `Где стоит эта лампа?
  1) слева от экрана          2) справа от экрана        3) за экраном (центр)
  4) над вами / общий свет (весь экран)                  5) верх экрана   6) низ экрана`,
    },
    "setup.askZone": { en: d => `Choose 1–6 [${d}]: `, ru: d => `Выберите 1–6 [${d}]: ` },
    "setup.saved": { en: (n, z) => `Saved: "${n}" → ${z}\n`, ru: (n, z) => `Сохранено: «${n}» → ${z}\n` },
    "setup.askMonitor": { en: "Which monitor do you watch movies on?", ru: "На каком мониторе вы смотрите фильмы?" },
    "setup.monitorRow": {
        en: (i, n, w, h, p) => `  ${i}) ${n} ${w}×${h}${p ? " (primary)" : ""}`,
        ru: (i, n, w, h, p) => `  ${i}) ${n} ${w}×${h}${p ? " (основной)" : ""}`,
    },
    "setup.askNumber": { en: d => `Number [${d}]: `, ru: d => `Номер [${d}]: ` },
    "setup.glowNote": {
        en: "The other monitor will show a soft glow continuing the movie's edge while sync runs.\n",
        ru: "На другом мониторе во время синхронизации будет мягкое свечение — продолжение края фильма.\n",
    },
    "setup.ffmpegMissing": {
        en: "\nffmpeg is not installed. With it, screen capture uses ~5× less CPU (optional).",
        ru: "\nffmpeg не установлен. С ним захват экрана нагружает процессор примерно в 5 раз меньше (необязательно).",
    },
    "setup.askFfmpeg": { en: "Install ffmpeg now via winget? [Y/n]: ", ru: "Установить ffmpeg сейчас через winget? [Y/n]: " },
    "setup.none": { en: "No lamps added.", ru: "Лампы не добавлены." },
    "setup.done": {
        en: 'Setup complete. Next time just run "Ambilight.bat".\n',
        ru: "Настройка завершена. В следующий раз просто запускайте «Ambilight.bat».\n",
    },
    "setup.askStart": { en: "Start sync now? [Y/n]: ", ru: "Запустить синхронизацию сейчас? [Y/n]: " },

    // ------------------------------------------------------------ doctor
    "doctor.title": { en: "\n=== Ambilight diagnostics ===\n", ru: "\n=== Диагностика Ambilight ===\n" },
    "doctor.node": { en: v => `Node.js: ${v}`, ru: v => `Node.js: ${v}` },
    "doctor.monitors": { en: "Monitors:", ru: "Мониторы:" },
    "doctor.monitorRow": {
        en: (i, n, w, h, x, y, p, sel) => `  ${i}) ${n} ${w}×${h} at ${x},${y}${p ? " primary" : ""}${sel ? "  ← capture" : ""}`,
        ru: (i, n, w, h, x, y, p, sel) => `  ${i}) ${n} ${w}×${h} в точке ${x},${y}${p ? " основной" : ""}${sel ? "  ← захват" : ""}`,
    },
    "doctor.ffmpeg": {
        en: p => `ffmpeg: ${p ?? "not found (optional: winget install Gyan.FFmpeg)"}`,
        ru: p => `ffmpeg: ${p ?? "не найден (необязательно: winget install Gyan.FFmpeg)"}`,
    },
    "doctor.browser": {
        en: p => `Browser for glow: ${p ?? "not found (glow disabled)"}`,
        ru: p => `Браузер для свечения: ${p ?? "не найден (свечение отключено)"}`,
    },
    "doctor.net": {
        en: (list, sel) => `Network: ${list}  (mDNS interface: ${sel ?? "all"})`,
        ru: (list, sel) => `Сеть: ${list}  (интерфейс mDNS: ${sel ?? "все"})`,
    },
    "doctor.lamps": { en: n => `Lamps in config: ${n}`, ru: n => `Ламп в конфиге: ${n}` },
    "doctor.lang": { en: l => `Language: ${l}`, ru: l => `Язык: ${l}` },

    // ------------------------------------------------------------ help
    help: {
        en: `Ambilight for Matter lamps — screen-synced room lighting.

  Ambilight.bat                         start (runs setup on first launch)
  Add lamp.bat                          add more lamps

  node ambilight.mjs start              sync lamps + glow (Ctrl+C restores the light)
  node ambilight.mjs setup              setup wizard: add lamps, choose monitor
  node ambilight.mjs pair <code> [name] [zone]   add a lamp non-interactively
  node ambilight.mjs list               list lamps
  node ambilight.mjs test               light each lamp in its own color for 8 s
  node ambilight.mjs preview            show zone colors in the terminal (no lamps)
  node ambilight.mjs glow               glow on the second monitor only
  node ambilight.mjs unpair <id|name>   remove a lamp
  node ambilight.mjs doctor             diagnostics`,
        ru: `Ambilight для Matter-ламп — свет в комнате в цвет экрана.

  Ambilight.bat                         запуск (при первом запуске — настройка)
  Add lamp.bat                          добавить ещё лампы

  node ambilight.mjs start              синхронизация ламп и свечения (Ctrl+C возвращает свет)
  node ambilight.mjs setup              мастер настройки: добавить лампы, выбрать монитор
  node ambilight.mjs pair <код> [имя] [зона]    добавить лампу без вопросов
  node ambilight.mjs list               список ламп
  node ambilight.mjs test               зажечь каждую лампу своим цветом на 8 с
  node ambilight.mjs preview            цвета зон в терминале (без ламп)
  node ambilight.mjs glow               только свечение на втором мониторе
  node ambilight.mjs unpair <id|имя>    удалить лампу
  node ambilight.mjs doctor             диагностика`,
    },
};
