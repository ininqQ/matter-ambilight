/**
 * "Glow" on a second monitor: a blurred, mirrored continuation of the main screen's adjacent edge.
 * Node streams the edge strip over Server-Sent Events; a fullscreen Edge/Chrome window on the second
 * monitor upscales and blurs it on the GPU.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { Monitor } from "node-screenshots";
import { t } from "./i18n.mjs";

export const GLOW_DEFAULTS = {
    enabled: true,
    monitor: "auto", // "auto" = any monitor other than the captured one; or part of a monitor name
    edge: 0.3, // fraction of the main screen width (at the shared edge) to mirror
    blur: 45, // px
    brightness: 1.0,
    saturation: 1.3,
    fade: 0.85, // how dark the far side gets (0 = no fade, 1 = to black)
    smoothing: 0.3, // temporal smoothing, 0..0.9
};

const SW = 48, SH = 40; // strip resolution; the browser stretches and blurs it

export function findBrowser() {
    const cands = [
        path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
        path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
    ];
    return cands.find(p => fs.existsSync(p)) ?? null;
}

function pickGlowMonitor(sel, main) {
    const others = Monitor.all().filter(m => m.id() !== main.id());
    if (!others.length) return null;
    if (!sel || sel === "auto") return others[0];
    if (typeof sel === "number") return Monitor.all()[sel] ?? null;
    return others.find(m => m.name().toLowerCase().includes(String(sel).toLowerCase())) ?? null;
}

function page(o) {
    // the side where the glow monitor touches the main one: for a monitor on the left, its right edge
    const gradTo = o.side === "left" ? "to left" : "to right";
    return `<!doctype html><html><head><meta charset="utf-8"><title>Ambilight glow</title><style>
html,body{margin:0;height:100%;background:#000;overflow:hidden;cursor:none}
canvas{position:fixed;left:-${o.blur * 2}px;top:-${o.blur * 2}px;width:calc(100% + ${o.blur * 4}px);height:calc(100% + ${o.blur * 4}px);
filter:blur(${o.blur}px) saturate(${o.saturation}) brightness(${o.brightness});image-rendering:auto}
#fade{position:fixed;inset:0;background:linear-gradient(${gradTo},rgba(0,0,0,0) 0%,rgba(0,0,0,${o.fade * 0.35}) 45%,rgba(0,0,0,${o.fade}) 100%)}
</style></head><body><canvas id="c" width="${SW}" height="${SH}"></canvas><div id="fade"></div><script>
const c=document.getElementById('c'),ctx=c.getContext('2d'),img=ctx.createImageData(${SW},${SH});
const acc=new Float32Array(${SW * SH * 4});let first=true;const a=${1 - Math.min(0.9, Math.max(0, o.smoothing))};
const es=new EventSource('/events');
es.onmessage=e=>{const s=atob(e.data);
 for(let i=0;i<s.length;i++){const v=s.charCodeAt(i);acc[i]=first?v:acc[i]+(v-acc[i])*a;img.data[i]=acc[i];}
 first=false;ctx.putImageData(img,0,0);};
es.onerror=()=>{es.close();setTimeout(()=>location.reload(),2000);};
document.addEventListener('dblclick',()=>document.documentElement.requestFullscreen?.());
</script></body></html>`;
}

/**
 * Start the glow. Returns { onRaw(raw, w, h), stop() }, or null when there's no second monitor or browser.
 * raw is an RGBA frame of the main monitor at any resolution.
 */
export async function startGlow(userOpts, mainMonitor, rootDir) {
    const o = { ...GLOW_DEFAULTS, ...(userOpts ?? {}) };
    if (!o.enabled) return null;
    const mon = pickGlowMonitor(o.monitor, mainMonitor);
    if (!mon) {
        console.log(t("glow.noMonitor"));
        return null;
    }
    const browser = findBrowser();
    if (!browser) {
        console.log(t("glow.noBrowser"));
        return null;
    }

    const mx = mainMonitor.x(), my = mainMonitor.y(), mw = mainMonitor.width(), mh = mainMonitor.height();
    o.side = mon.x() + mon.width() / 2 < mx + mw / 2 ? "left" : "right";
    // the vertical band of the main screen that lines up with the glow monitor
    const y0 = Math.min(0.9, Math.max(0, (mon.y() - my) / mh));
    const y1 = Math.max(y0 + 0.1, Math.min(1, (mon.y() + mon.height() - my) / mh));

    const clients = new Set();
    const html = page(o);
    const server = http.createServer((req, res) => {
        if (req.url === "/events") {
            res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
            res.write("retry: 1000\n\n");
            clients.add(res);
            req.on("close", () => clients.delete(res));
            return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
    });
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${server.address().port}/`;

    // separate browser profile so the user's normal browser is untouched; fullscreen right on the glow monitor
    const proc = spawn(
        browser,
        [
            `--app=${url}`,
            `--user-data-dir=${path.join(rootDir, ".glow-browser")}`,
            `--window-position=${mon.x()},${mon.y()}`,
            `--window-size=${mon.width()},${mon.height()}`,
            "--start-fullscreen",
            "--kiosk",
            "--edge-kiosk-type=fullscreen",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-session-crashed-bubble",
            "--hide-crash-restore-bubble",
            "--disable-features=Translate,msEdgeSidebarV2,msUndersideButton",
        ],
        { stdio: "ignore" },
    );
    console.log(t("glow.on", mon.name(), mon.width(), mon.height(), o.side));

    const strip = Buffer.alloc(SW * SH * 4);
    let lastSent = 0;
    const onRaw = (raw, w, h) => {
        if (!clients.size) return;
        const now = Date.now();
        if (now - lastSent < 40) return; // at most 25 updates/s
        lastSent = now;
        const edgeW = Math.max(2, Math.round(o.edge * w));
        for (let sy = 0; sy < SH; sy++) {
            const y = Math.min(h - 1, Math.floor((y0 + ((sy + 0.5) / SH) * (y1 - y0)) * h));
            for (let sx = 0; sx < SW; sx++) {
                // d = distance from the shared edge: right at the seam we show the main screen's outermost
                // column, further away we show columns deeper inside (a mirror image)
                const d = o.side === "left" ? SW - 1 - sx : sx;
                const off = Math.min(edgeW - 1, Math.floor(((d + 0.5) / SW) * edgeW));
                const x = o.side === "left" ? off : w - 1 - off;
                const si = (y * w + x) * 4, di = (sy * SW + sx) * 4;
                strip[di] = raw[si];
                strip[di + 1] = raw[si + 1];
                strip[di + 2] = raw[si + 2];
                strip[di + 3] = 255;
            }
        }
        const msg = `data: ${strip.toString("base64")}\n\n`;
        for (const c of clients) c.write(msg);
    };

    let stopped = false;
    const stop = () => {
        if (stopped) return;
        stopped = true;
        for (const c of clients) c.end();
        server.close();
        if (proc.pid) spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
    };
    process.on("exit", stop);
    return { onRaw, stop };
}
