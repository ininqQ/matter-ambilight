/**
 * Matter side: a commissioning controller on this PC that joins lamps as an additional admin
 * (multi-admin), so lamps stay in Apple Home / Google Home / etc.
 */
import { t } from "./i18n.mjs";
import { STORAGE_PATH } from "./config.mjs";

let matter; // loaded lazily so `preview` and `glow` work without starting Matter

export async function loadMatter(cfg) {
    if (matter) return matter;
    const main = await import("@matter/main");
    const clusters = await import("@matter/main/clusters");
    const types = await import("@matter/main/types");
    const { CommissioningController } = await import("@project-chip/matter.js");
    const { NodeStates } = await import("@project-chip/matter.js/device");
    main.Logger.level = process.env.MATTER_LOG ?? "error";
    // matter.js tries a device's IPv6 addresses first and waits 45 s on each. When IPv6 doesn't work
    // on the LAN (VPN clients often block it), connecting takes minutes. Put IPv4 first; IPv6 stays as a fallback.
    if (cfg?.preferIpv4 !== false) {
        const orig = main.ServerAddress.selectionPreferenceOf;
        main.ServerAddress.selectionPreferenceOf = a => {
            const p = orig(a);
            return p === 3 /* IPV4 */ ? -1 : p;
        };
    }
    matter = { ...main, ...clusters, ...types, CommissioningController, NodeStates };
    return matter;
}

export async function startController(cfg) {
    const m = await loadMatter(cfg);
    const environment = m.Environment.default;
    environment.vars.set("storage.path", STORAGE_PATH);
    // We handle Ctrl+C ourselves: restore the lamps first, then close connections
    environment.vars.set("runtime.signals", false);
    if (cfg.networkInterface) environment.vars.set("mdns.networkInterface", cfg.networkInterface);
    const controller = new m.CommissioningController({
        environment: { environment, id: "ambilight-controller" },
        autoConnect: false,
        adminFabricLabel: "Ambilight PC",
    });
    await controller.start();
    return controller;
}

export function withTimeout(promise, ms, what) {
    let timer;
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise((_, rej) => (timer = setTimeout(() => rej(new Error(t("timeout", what))), ms))),
    ]);
}

/** Connect to a node and wait for a live session (a busy lamp may ask us to retry later). */
export async function connectNode(controller, nodeId, timeoutMs = 120_000) {
    const node = await controller.getNode(matter.NodeId(BigInt(nodeId)));
    const connected = new Promise(res => {
        node.events.initializedFromRemote.once(() => res());
        node.events.stateChanged.on(s => s === matter.NodeStates.Connected && res());
    });
    node.connect();
    if (!node.isConnected) await withTimeout(connected, timeoutMs, t("lamps.connectWhat", nodeId));
    return node;
}

/** Find the light endpoint (ColorControl + LevelControl + OnOff) on a node. */
export async function findLight(node, preferredEndpoint) {
    const flat = [];
    const walk = eps => eps.forEach(ep => (flat.push(ep), walk(ep.getChildEndpoints?.() ?? [])));
    walk(node.getDevices());
    const candidates = flat.filter(ep => ep.getClusterClient(matter.ColorControl.Complete));
    const ep = candidates.find(e => e.getNumber() === preferredEndpoint) ?? candidates[0];
    if (!ep) throw new Error(t("lamps.notColor", node.nodeId));
    const color = ep.getClusterClient(matter.ColorControl.Complete);
    const features = color.supportedFeatures ?? (await color.getFeatureMapAttribute?.()) ?? {};
    return {
        endpoint: ep.getNumber(),
        color,
        level: ep.getClusterClient(matter.LevelControl.Complete),
        onOff: ep.getClusterClient(matter.OnOff.Complete),
        useHs: !!features.hueSaturation || !features.xy,
    };
}

const NO_OPTS = { optionsMask: {}, optionsOverride: {} };

const hueDist = (a, b) => Math.min(Math.abs(a - b), 254 - Math.abs(a - b));
export const colorChanged = (tg, last) =>
    !last || ((tg.sat > 25 || last.sat > 25) && hueDist(tg.hue, last.hue) > 2) || Math.abs(tg.sat - last.sat) > 5;
export const levelChanged = (tg, last) => !last || Math.abs(tg.level - last.level) > 3;

/**
 * Send only what changed: color and/or level (each command takes a lamp ~80 ms).
 * Returns what the lamp now has, tracked per part so small drifts aren't lost.
 */
export async function applyTarget(light, tg, transitionTime, last) {
    const sendColor = colorChanged(tg, last), sendLevel = levelChanged(tg, last);
    const cmds = [];
    if (sendColor)
        cmds.push(
            light.useHs
                ? light.color.moveToHueAndSaturation({ hue: tg.hue, saturation: tg.sat, transitionTime, ...NO_OPTS })
                : light.color.moveToColor({
                      colorX: Math.round(tg.xy.x * 65536),
                      colorY: Math.round(tg.xy.y * 65536),
                      transitionTime,
                      ...NO_OPTS,
                  }),
        );
    if (sendLevel) cmds.push(light.level?.moveToLevelWithOnOff({ level: tg.level, transitionTime, ...NO_OPTS }));
    await Promise.all(cmds);
    return {
        hue: sendColor ? tg.hue : last.hue,
        sat: sendColor ? tg.sat : last.sat,
        xy: sendColor ? tg.xy : last.xy,
        level: sendLevel ? tg.level : last.level,
    };
}

/** Remember the lamp state (from the subscription cache) to restore it on exit. */
export function snapshot(light) {
    const get = (cl, name) => {
        try {
            return cl?.[`get${name}AttributeFromCache`]?.();
        } catch {
            return undefined;
        }
    };
    return {
        on: get(light.onOff, "OnOff"),
        level: get(light.level, "CurrentLevel"),
        mode: get(light.color, "ColorMode"),
        hue: get(light.color, "CurrentHue"),
        sat: get(light.color, "CurrentSaturation"),
        x: get(light.color, "CurrentX"),
        y: get(light.color, "CurrentY"),
        ct: get(light.color, "ColorTemperatureMireds"),
    };
}

export function restore(light, s) {
    return withTimeout(restoreInner(light, s), 6000, t("lamps.restoreWhat")).catch(e =>
        console.warn(t("lamps.restoreFailed", e.message)),
    );
}

async function restoreInner(light, s) {
    const transitionTime = 10;
    if (s.mode === 2 && s.ct != null)
        await light.color.moveToColorTemperature({ colorTemperatureMireds: s.ct, transitionTime, ...NO_OPTS });
    else if (s.mode === 1 && s.x != null)
        await light.color.moveToColor({ colorX: s.x, colorY: s.y, transitionTime, ...NO_OPTS });
    else if (s.hue != null)
        await light.color.moveToHueAndSaturation({ hue: s.hue, saturation: s.sat, transitionTime, ...NO_OPTS });
    if (s.level != null) await light.level.moveToLevelWithOnOff({ level: s.level, transitionTime, ...NO_OPTS });
    if (s.on === false) await light.onOff.off();
}

/** Show a solid color (hue 0..254) at the given level. */
export async function showColor(light, hue, level = 200) {
    const { hueToXy } = await import("./color.mjs");
    await applyTarget(light, { hue, sat: 254, level, xy: hueToXy(hue) }, 3);
    await light.onOff.on().catch(() => {});
}

/** Parse an 11/21-digit manual code or an "MT:…" QR payload. Throws on invalid input. */
export function parsePairingCode(code) {
    code = code.trim();
    if (code.toUpperCase().startsWith("MT:")) {
        const { discriminator, passcode } = matter.QrPairingCodeCodec.decode(code)[0];
        return { identifierData: { longDiscriminator: discriminator }, passcode };
    }
    const digits = code.replace(/\D/g, "");
    if (digits.length !== 11 && digits.length !== 21) throw new Error("bad code length");
    const { shortDiscriminator, passcode } = matter.ManualPairingCodeCodec.decode(digits);
    return { identifierData: { shortDiscriminator }, passcode };
}

/** Commission a lamp from a pairing code. Returns { nodeId, light }. */
export async function commissionLamp(controller, code) {
    const { identifierData, passcode } = parsePairingCode(code);
    console.log(t("lamps.searching"));
    const nodeId = await controller.commissionNode({
        commissioning: {
            regulatoryLocation: matter.GeneralCommissioning.RegulatoryLocationType.IndoorOutdoor,
            regulatoryCountryCode: "XX",
        },
        discovery: { identifierData, discoveryCapabilities: { onIpNetwork: true } },
        passcode,
    });
    const node = await connectNode(controller, nodeId);
    const light = await findLight(node);
    return { nodeId: String(nodeId), light };
}

/**
 * Connect all lamps from the config. Waits at most waitMs; lamps that are late keep connecting
 * in the background (matter.js reconnects automatically) and are skipped until they're online.
 */
export async function openLamps(controller, cfg, waitMs = 6000) {
    console.log(t("lamps.connecting"));
    const t0 = Date.now();
    const results = await Promise.all(
        cfg.lamps.map(async lamp => {
            try {
                const node = await controller.getNode(matter.NodeId(BigInt(lamp.nodeId)));
                const connected = new Promise(res => {
                    node.events.initializedFromRemote.once(() => res(true));
                    node.events.stateChanged.on(s => s === matter.NodeStates.Connected && res(true));
                });
                node.connect();
                if (!node.initialized)
                    await withTimeout(new Promise(r => node.events.initialized.once(r)), 120_000, t("lamps.dataWhat"));
                const light = await findLight(node, lamp.endpoint);
                const ok = node.isConnected || (await Promise.race([connected, new Promise(r => setTimeout(() => r(false), waitMs))]));
                if (ok) console.log(t("lamps.ok", lamp.name, ((Date.now() - t0) / 1000).toFixed(0)));
                else {
                    console.log(t("lamps.later", lamp.name));
                    connected.then(() => console.log(t("lamps.joined", lamp.name)));
                }
                return { ...lamp, node, light };
            } catch (e) {
                console.log(t("lamps.error", lamp.name, e.message));
                return null;
            }
        }),
    );
    return results.filter(Boolean);
}
