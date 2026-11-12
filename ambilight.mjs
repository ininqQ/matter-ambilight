#!/usr/bin/env node
/**
 * Ambilight for Matter lamps: captures the screen, computes a color per zone and sends it to
 * Matter lamps directly from this PC (as an additional Matter admin — lamps stay in your smart home app).
 * Optionally shows a "glow" on a second monitor. Run without arguments for help.
 */
import os from "node:os";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { Monitor } from "node-screenshots";
import { t, setLanguage, getLanguage, isYes, zoneName } from "./lib/i18n.mjs";
import { ROOT, loadConfig, saveConfig, zoneRect, ZONE_MENU, DEFAULT_ZONES } from "./lib/config.mjs";
import { swatch } from "./lib/color.mjs";
import { startCapture, pickMonitor, findFfmpeg } from "./lib/capture.mjs";
import { startGlow, findBrowser } from "./lib/glow.mjs";
import {
    loadMatter, startController, openLamps, commissionLamp, parsePairingCode,
    applyTarget, colorChanged, levelChanged, snapshot, restore, showColor,
} from "./lib/lamps.mjs";

setLanguage(process.env.AMBILIGHT_LANG ?? loadConfig().language);

/** Ctrl+C, closing the console window (SIGHUP) and Ctrl+Break all go through the same handler. */
function onExitSignal(handler) {
    for (const sig of ["SIGINT", "SIGHUP", "SIGBREAK"]) process.on(sig, handler);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- start: lamps + glow

async function cmdStart() {
    let cfg = loadConfig();
    if (!cfg.lamps.length) {
        console.log(t("run.noLamps"));
        const started = await cmdSetup([], { offerStart: false });
        cfg = loadConfig();
        if (!cfg.lamps.length || started === false) return;
    }
    const controller = await startController(cfg);
    const lamps = await openLamps(controller, cfg);
    if (!lamps.length) throw new Error(t("run.noneConnected"));
    const snaps = lamps.map(l => snapshot(l.light));
    await Promise.all(lamps.map(l => l.light.onOff.on().catch(() => {})));

    const minInterval = 1000 / cfg.maxUpdatesPerSecond;
    const transitionTime = Math.max(0, Math.round(cfg.transition * 10));
    const state = lamps.map(() => ({ inFlight: false, pending: null, last: null, lastAt: 0, sent: 0, errors: 0 }));
    let exiting = false;

    // Per lamp: one command in flight at a time, always sending the latest target (never a backlog).
    const pump = async i => {
        const st = state[i];
        if (exiting || st.inFlight || !st.pending) return;
        if (!lamps[i].node.isConnected) return; // matter.js reconnects by itself; a later frame retries
        const wait = minInterval - (Date.now() - st.lastAt);
        if (wait > 0) return void setTimeout(() => pump(i), wait);
        const target = st.pending;
        st.pending = null;
        st.inFlight = true;
        st.lastAt = Date.now();
        try {
            st.last = await applyTarget(lamps[i].light, target, transitionTime, st.last);
            st.sent++;
        } catch (e) {
            if (st.errors++ % 20 === 0) console.warn(t("lamps.sendError", lamps[i].name, e.message));
        } finally {
            st.inFlight = false;
            pump(i);
        }
    };

    const glow = await startGlow(cfg.glow, pickMonitor(cfg.monitor), ROOT).catch(e => {
        console.warn(t("glow.failed", e.message));
        return null;
    });
    const stopCapture = startCapture(
        cfg,
        lamps.map(l => zoneRect(l.zone)),
        res => {
            if (exiting) return;
            res.forEach((r, i) => {
                const st = state[i];
                if (st.pending || colorChanged(r.target, st.last ?? undefined) || levelChanged(r.target, st.last ?? undefined)) {
                    st.pending = r.target;
                    pump(i);
                }
            });
            const status = res.map((r, i) => `${lamps[i].name}: ${swatch(r.color)} ${lamps[i].node.isConnected ? state[i].sent : t("lamps.offline")}`);
            process.stdout.write(`\r${status.join("   ")}      `);
        },
        glow?.onRaw,
    );
    console.log(t("run.started"));

    onExitSignal(async () => {
        if (exiting) process.exit(1);
        exiting = true;
        setTimeout(() => process.exit(0), 10_000).unref(); // never hang on exit, even if a lamp is silent
        stopCapture();
        glow?.stop();
        // let in-flight commands finish so they don't overwrite the restored light
        for (let i = 0; i < 20 && state.some(s => s.inFlight); i++) await sleep(50);
        console.log(t("run.restoring"));
        await Promise.all(lamps.map((l, i) => restore(l.light, snaps[i])));
        await controller.close().catch(() => {});
        process.exit(0);
    });
}

// ---------------------------------------------------------------- setup wizard

async function cmdSetup(_args, { offerStart = true } = {}) {
    const cfg = loadConfig();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    let controller;
    rl.on("SIGINT", async () => {
        rl.close();
        await controller?.close().catch(() => {});
        process.exit(0);
    });
    // Line queue instead of rl.question(): works the same for typed and piped input.
    // At end of input every answer is "" (defaults) and `eof` stops us from auto-starting.
    const lines = [];
    let waiter = null, eof = false;
    rl.on("line", l => (waiter ? (waiter(l), (waiter = null)) : lines.push(l)));
    rl.on("close", () => ((eof = true), waiter?.(""), (waiter = null)));
    const ask = async q => {
        process.stdout.write(q);
        const line = lines.length ? lines.shift() : eof ? "" : await new Promise(r => (waiter = r));
        if (!process.stdin.isTTY) process.stdout.write(line + "\n");
        return line.trim();
    };

    try {
        console.log(t("setup.title"));
        console.log(t("setup.intro"));
        if (cfg.lamps.length) console.log(t("setup.existing", cfg.lamps.length));
        await loadMatter(cfg);

        // --- lamps
        while (true) {
            const code = await ask(t("setup.askCode"));
            if (!code) break;
            try {
                parsePairingCode(code);
            } catch {
                console.log(t("setup.badCode"));
                continue;
            }
            controller ??= await startController(cfg);
            let added;
            try {
                added = await commissionLamp(controller, code);
            } catch (e) {
                console.log(t("setup.failed", e.message));
                continue;
            }
            await showColor(added.light, 85).catch(() => {}); // green
            console.log(t("setup.added"));

            const n = cfg.lamps.length + 1;
            const name = (await ask(t("setup.askName", t("setup.defaultName", n)))) || t("setup.defaultName", n);
            console.log(t("setup.zoneMenu"));
            const defZone = ZONE_MENU.indexOf(DEFAULT_ZONES[(n - 1) % DEFAULT_ZONES.length]) + 1;
            const pick = parseInt(await ask(t("setup.askZone", defZone)), 10);
            const zone = ZONE_MENU[(pick >= 1 && pick <= ZONE_MENU.length ? pick : defZone) - 1];
            cfg.lamps.push({ nodeId: added.nodeId, name, zone, endpoint: added.light.endpoint });
            saveConfig(cfg);
            console.log(t("setup.saved", name, zoneName(zone)));
        }

        if (!cfg.lamps.length) {
            console.log(t("setup.none"));
            return false;
        }

        // --- monitor (only asked when there's a choice)
        const monitors = Monitor.all();
        if (monitors.length > 1) {
            console.log(t("setup.askMonitor"));
            monitors.forEach((m, i) => console.log(t("setup.monitorRow", i + 1, m.name(), m.width(), m.height(), m.isPrimary())));
            const current = pickMonitor(cfg.monitor);
            const def = monitors.findIndex(m => m.id() === current.id()) + 1;
            const pick = parseInt(await ask(t("setup.askNumber", def)), 10);
            const chosen = monitors[(pick >= 1 && pick <= monitors.length ? pick : def) - 1];
            cfg.monitor = chosen.isPrimary() ? "primary" : chosen.name();
            saveConfig(cfg);
            console.log(t("setup.glowNote"));
        }

        // --- ffmpeg (optional, much lower CPU)
        if (!findFfmpeg(cfg)) {
            console.log(t("setup.ffmpegMissing"));
            const answer = await ask(t("setup.askFfmpeg"));
            if (!eof && isYes(answer)) {
                spawnSync("winget", ["install", "--id", "Gyan.FFmpeg", "-e", "--accept-source-agreements", "--accept-package-agreements"], {
                    stdio: "inherit",
                });
            }
        }

        console.log("\n" + t("setup.done"));
        if (offerStart && !eof && isYes(await ask(t("setup.askStart"))) && !eof) {
            rl.close();
            await controller?.close().catch(() => {});
            controller = null;
            await cmdStart();
            return true;
        }
        return true;
    } finally {
        rl.close();
        await controller?.close().catch(() => {});
    }
}

// ---------------------------------------------------------------- small commands

async function cmdPair([code, name, zone]) {
    if (!code) throw new Error(t("pair.usage"));
    const cfg = loadConfig();
    await loadMatter(cfg);
    const controller = await startController(cfg);
    try {
        const { nodeId, light } = await commissionLamp(controller, code);
        const idx = cfg.lamps.length;
        const lamp = {
            nodeId,
            name: name ?? t("setup.defaultName", idx + 1),
            zone: zone ?? DEFAULT_ZONES[idx % DEFAULT_ZONES.length],
            endpoint: light.endpoint,
        };
        zoneRect(lamp.zone); // validate
        cfg.lamps.push(lamp);
        saveConfig(cfg);
        console.log(t("pair.done", lamp.name, nodeId, zoneName(lamp.zone)));
        await showColor(light, 85).catch(() => {});
        console.log(t("pair.green"));
    } finally {
        await controller.close();
    }
}

async function cmdList() {
    const cfg = loadConfig();
    if (!cfg.lamps.length) return console.log(t("list.empty"));
    for (const l of cfg.lamps) console.log(t("list.row", l));
}

async function cmdUnpair([who]) {
    const cfg = loadConfig();
    const lamp = cfg.lamps.find(l => l.nodeId === who || l.name === who);
    if (!lamp) throw new Error(t("unpair.notFound", who));
    const m = await loadMatter(cfg);
    const controller = await startController(cfg);
    try {
        await controller.removeNode(m.NodeId(BigInt(lamp.nodeId)), true);
    } catch (e) {
        console.warn(t("unpair.noAnswer", e.message));
    }
    cfg.lamps = cfg.lamps.filter(l => l !== lamp);
    saveConfig(cfg);
    await controller.close();
    console.log(t("unpair.done", lamp.name));
}

async function cmdTest() {
    const cfg = loadConfig();
    const controller = await startController(cfg);
    const lamps = await openLamps(controller, cfg);
    const names = t("test.colors"), hues = [0, 85, 170, 42, 200];
    const snaps = lamps.map(l => snapshot(l.light));
    for (const [i, l] of lamps.entries()) {
        console.log(t("test.row", l.name, zoneName(l.zone), names[i % names.length]));
        await showColor(l.light, hues[i % hues.length]).catch(e => console.warn(e.message));
    }
    console.log(t("test.hold"));
    await sleep(8000);
    await Promise.all(lamps.map((l, i) => restore(l.light, snaps[i])));
    await controller.close();
}

async function cmdPreview() {
    const cfg = loadConfig();
    const zones = cfg.lamps.length ? cfg.lamps.map(l => l.zone) : DEFAULT_ZONES;
    const names = cfg.lamps.length ? cfg.lamps.map(l => l.name) : zones.map(zoneName);
    console.log(t("preview.title"));
    let frames = 0;
    const t0 = Date.now();
    startCapture(cfg, zones.map(zoneRect), res => {
        frames++;
        const fps = ((frames * 1000) / (Date.now() - t0)).toFixed(1);
        const line = res.map(
            (r, i) => `${names[i]}: ${swatch(r.color)} h${String(r.target.hue).padStart(3)} s${String(r.target.sat).padStart(3)} l${String(r.target.level).padStart(3)}`,
        );
        process.stdout.write(`\r${line.join("   ")}   ${fps} fps   `);
    });
}

async function cmdGlow() {
    const cfg = loadConfig();
    const glow = await startGlow({ ...cfg.glow, enabled: true }, pickMonitor(cfg.monitor), ROOT);
    if (!glow) return;
    const stopCapture = startCapture(cfg, [], () => {}, glow.onRaw);
    console.log(t("glow.started"));
    onExitSignal(() => (stopCapture(), glow.stop(), process.exit(0)));
}

async function cmdDoctor() {
    const cfg = loadConfig();
    console.log(t("doctor.title"));
    console.log(t("doctor.node", process.version));
    console.log(t("doctor.lang", getLanguage()));
    console.log(t("doctor.monitors"));
    const capture = pickMonitor(cfg.monitor);
    Monitor.all().forEach((m, i) =>
        console.log(t("doctor.monitorRow", i, m.name(), m.width(), m.height(), m.x(), m.y(), m.isPrimary(), m.id() === capture.id())),
    );
    console.log(t("doctor.ffmpeg", findFfmpeg(cfg)));
    console.log(t("doctor.browser", findBrowser()));
    const nets = Object.entries(os.networkInterfaces())
        .map(([name, addrs]) => [name, addrs.find(a => a.family === "IPv4" && !a.internal)?.address])
        .filter(([, ip]) => ip)
        .map(([name, ip]) => `${name} ${ip}`);
    console.log(t("doctor.net", nets.join(", "), cfg.networkInterface));
    console.log(t("doctor.lamps", cfg.lamps.length));
    for (const l of cfg.lamps) console.log("  " + t("list.row", l));
}

// ---------------------------------------------------------------- main

const commands = {
    start: cmdStart,
    run: cmdStart, // alias
    setup: cmdSetup,
    pair: cmdPair,
    list: cmdList,
    unpair: cmdUnpair,
    test: cmdTest,
    preview: cmdPreview,
    glow: cmdGlow,
    doctor: cmdDoctor,
};
const [cmd, ...args] = process.argv.slice(2);
const fn = commands[cmd];
if (!fn) {
    console.log(t("help"));
    process.exit(cmd && cmd !== "help" ? 1 : 0);
}
fn(args).catch(e => {
    console.error(t("error", e.message));
    if (process.env.DEBUG) console.error(e);
    process.exit(1);
});
