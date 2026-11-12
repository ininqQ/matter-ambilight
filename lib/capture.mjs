/** Screen capture: ffmpeg Desktop Duplication (fast) with a node-screenshots fallback. */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { Monitor } from "node-screenshots";
import { t } from "./i18n.mjs";
import { analyze, toLampTarget } from "./color.mjs";

export function pickMonitor(sel) {
    const all = Monitor.all();
    if (sel === "primary" || sel === undefined || sel === null) return all.find(m => m.isPrimary()) ?? all[0];
    if (typeof sel === "number") return all[sel] ?? all[0];
    return all.find(m => m.name().toLowerCase().includes(String(sel).toLowerCase())) ?? all[0];
}

/** ffmpeg lookup: config.ffmpegPath → PATH → winget package folder (a fresh install isn't on PATH yet). */
export function findFfmpeg(cfg = {}) {
    if (cfg.ffmpegPath && fs.existsSync(cfg.ffmpegPath)) return cfg.ffmpegPath;
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
        const p = path.join(dir, "ffmpeg.exe");
        if (dir && fs.existsSync(p)) return p;
    }
    const wg = path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Packages");
    try {
        for (const pkg of fs.readdirSync(wg).filter(d => d.startsWith("Gyan.FFmpeg"))) {
            for (const sub of fs.readdirSync(path.join(wg, pkg))) {
                const p = path.join(wg, pkg, sub, "bin", "ffmpeg.exe");
                if (fs.existsSync(p)) return p;
            }
        }
    } catch {}
    return null;
}

/** DXGI output index (for ddagrab) whose resolution matches the chosen monitor. */
function findDdaOutput(ffmpeg, monitor) {
    const want = `${monitor.width()}x${monitor.height()}`;
    for (let idx = 0; idx < 6; idx++) {
        const r = spawnSync(
            ffmpeg,
            ["-hide_banner", "-f", "lavfi", "-i", `ddagrab=output_idx=${idx}:framerate=5`, "-frames:v", "1", "-f", "null", "-"],
            { encoding: "utf8", timeout: 5000 },
        );
        const size = /Video: [^\n]*?(\d{3,5}x\d{3,5})/.exec(r.stderr ?? "")?.[1];
        if (!size) break;
        if (size === want) return idx;
    }
    return 0;
}

const FW = 192, FH = 80; // analysis frame size — plenty for zone colors

/**
 * ffmpeg ddagrab (Desktop Duplication API): the GPU hands over the frame, ffmpeg shrinks it to 192×80.
 * ~10–15% of one core at 20 fps, versus ~1.5–2 cores for full-resolution screenshots of a 3440×1440 screen.
 */
function ffmpegSource(cfg, monitor, ffmpeg, onRaw) {
    const idx = cfg.ddaOutput ?? findDdaOutput(ffmpeg, monitor);
    const vf = [
        `ddagrab=output_idx=${idx}:framerate=${cfg.fps}:draw_mouse=0`,
        "hwdownload",
        "format=bgra",
        `scale=${FW * 2}:${FH * 2}:flags=neighbor`,
        `scale=${FW}:${FH}:flags=area`,
        "format=rgba",
    ].join(",");
    const frameBytes = FW * FH * 4;
    let proc, stopped = false, buf = Buffer.alloc(0), restarts = 0;
    const start = () => {
        proc = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", vf, "-f", "rawvideo", "pipe:1"], {
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        let err = "";
        proc.stderr.on("data", d => (err = (err + d).slice(-500)));
        proc.stdout.on("data", chunk => {
            buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
            while (buf.length >= frameBytes) {
                const frame = buf.subarray(0, frameBytes);
                buf = buf.subarray(frameBytes);
                restarts = 0;
                onRaw(frame, FW, FH);
            }
        });
        proc.on("exit", code => {
            if (stopped) return;
            // ddagrab exits on resolution changes, UAC prompts, exclusive fullscreen switches — just restart
            if (restarts++ % 10 === 0) console.warn(t("capture.restart", code, err.trim().split("\n").at(-1) ?? ""));
            buf = Buffer.alloc(0);
            setTimeout(start, Math.min(5000, 500 * restarts));
        });
    };
    start();
    process.on("exit", () => ((stopped = true), proc?.kill()));
    console.log(t("capture.gpu", monitor.name(), monitor.width(), monitor.height(), idx));
    return () => ((stopped = true), proc?.kill());
}

/** Fallback without ffmpeg: full-resolution screenshots (heavier on the CPU). */
function screenshotSource(cfg, monitor, onRaw) {
    console.log(t("capture.cpu", monitor.name(), monitor.width(), monitor.height()));
    let stopped = false, busy = false;
    const timer = setInterval(async () => {
        if (busy || stopped) return;
        busy = true;
        try {
            const img = await monitor.captureImage();
            onRaw(await img.toRaw(), img.width, img.height);
        } catch (e) {
            console.warn(t("capture.error", e.message));
        } finally {
            busy = false;
        }
    }, 1000 / Math.min(cfg.fps, 12));
    return () => ((stopped = true), clearInterval(timer));
}

/**
 * Capture loop: frame → zone colors → temporal smoothing → onFrame([{color, target}]).
 * onRawFrame (optional) receives every raw frame too (used by the glow).
 * Returns a stop function.
 */
export function startCapture(cfg, rects, onFrame, onRawFrame) {
    const monitor = pickMonitor(cfg.monitor);
    const smooth = rects.map(() => null);
    const a = 1 - Math.min(0.95, Math.max(0, cfg.smoothing));
    const onRaw = (raw, w, h) => {
        onRawFrame?.(raw, w, h);
        analyze(raw, w, h, rects).forEach((c, i) => {
            const s = smooth[i];
            smooth[i] = s
                ? {
                      r: s.r + (c.r - s.r) * a,
                      g: s.g + (c.g - s.g) * a,
                      b: s.b + (c.b - s.b) * a,
                      brightness: s.brightness + (c.brightness - s.brightness) * a,
                  }
                : c;
        });
        onFrame(smooth.map(c => ({ color: c, target: toLampTarget(c, cfg) })));
    };
    const ffmpeg = cfg.capture === "screenshots" ? null : findFfmpeg(cfg);
    return ffmpeg ? ffmpegSource(cfg, monitor, ffmpeg, onRaw) : screenshotSource(cfg, monitor, onRaw);
}
