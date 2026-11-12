# Matter Ambilight

**English** · [Русский](README.ru.md)

Your room lights follow the colors on your screen — like Philips Hue Sync, but for **any color Matter lamp**, straight from a Windows PC. No bridge, no Home Assistant, no cloud.

- 🎬 **Screen-synced lamps** — each lamp follows its own part of the screen (left / right / center / whole screen), ~10 updates per second.
- 🖥️ **Second-monitor glow** — an extra monitor shows a soft, blurred continuation of the movie's edge, like one more big lamp.
- 🏠 **Lamps stay in your smart home** — the PC joins as an *additional* Matter controller (multi-admin). Apple Home, Google Home, Siri etc. keep working.
- ↩️ **Restores your light** — stop the sync and every lamp returns to the color and brightness it had before.
- ⚡ **Light on the CPU** — GPU screen capture via ffmpeg, about half a CPU core in total.
- 🇬🇧🇷🇺 English and Russian interface (picked automatically).

<!-- Demo: add a short GIF of the room + screen here, e.g. docs/demo.gif -->

## Requirements

- Windows 10/11
- Color Matter lamps (Wi-Fi). Thread lamps should work too if your PC can reach them over IPv6 through a Thread border router.
- Lamps already set up in some Matter app (Apple Home, Google Home, Alexa, SmartThings…) — you'll need a pairing code from it.
- [Node.js](https://nodejs.org) 20+ — the launcher offers to install it for you.
- Optional: ffmpeg (for low CPU usage) — the setup wizard offers to install it.
- Optional: a second monitor and Microsoft Edge or Google Chrome for the glow.

## Quick start

1. Download the latest release from the [**Releases**](https://github.com/ininqQ/matter-ambilight/releases/latest) page (**Source code (zip)**) and unzip it anywhere — or `git clone` the repository.
2. Double-click **`Ambilight.bat`**. On the first launch it installs everything it needs and starts the setup wizard.
3. In the wizard, enter a pairing code for each lamp (see below), pick where the lamp is and which monitor you watch movies on.
4. Done. From now on just double-click **`Ambilight.bat`**. To stop, press **Ctrl+C** or close the window — the lamps return to their previous light.

To add more lamps later, run **`Add lamp.bat`**.

### Getting a pairing code

The lamp keeps working in its current app — you're only *sharing* it with this PC.

| App | Where |
|---|---|
| Apple Home | lamp → settings (scroll down) → **Turn On Pairing Mode** |
| Google Home | lamp → settings → **Linked Matter apps & services** → **Link apps & services** |
| Others | look for "share with other apps / services" or "pairing mode" in the lamp settings |

The code is 11 digits (e.g. `1234-567-8901`) and is valid for about 15 minutes. Each lamp needs its own code.

## Commands

`Ambilight.bat` and `Add lamp.bat` cover everyday use. Everything else is available from a terminal in the project folder:

| Command | What it does |
|---|---|
| `node ambilight.mjs start` | Sync lamps + glow (runs setup if no lamps yet) |
| `node ambilight.mjs setup` | Setup wizard: add lamps, choose the monitor |
| `node ambilight.mjs pair <code> [name] [zone]` | Add a lamp without questions |
| `node ambilight.mjs list` | List lamps |
| `node ambilight.mjs test` | Light each lamp in its own color for 8 s (find which is which) |
| `node ambilight.mjs preview` | Show zone colors in the terminal, no lamps needed |
| `node ambilight.mjs glow` | Second-monitor glow only |
| `node ambilight.mjs unpair <id\|name>` | Remove a lamp from this PC (it stays in your other apps) |
| `node ambilight.mjs doctor` | Diagnostics: monitors, ffmpeg, browser, network, lamps |

While sync is running it overrides any change you make in your smart home app. Stop it and the lamps are fully yours again.

## Settings — `config.json`

Created by the setup wizard; see [`config.example.json`](config.example.json). Changes apply on the next start.

| Setting | Default | Meaning |
|---|---|---|
| `language` | `"auto"` | `"auto"`, `"en"` or `"ru"` (or set the `AMBILIGHT_LANG` environment variable) |
| `monitor` | `"primary"` | Monitor to capture: `"primary"`, an index (`0`, `1`) or part of its name |
| `fps` | 20 | Screen analysis rate |
| `maxUpdatesPerSecond` | 10 | Max updates per lamp. The real rate is limited by how fast the lamp answers (~7–11/s for typical Wi-Fi lamps) |
| `transition` | 0.1 | Fade inside the lamp, seconds. `0.4` for a calmer look |
| `smoothing` | 0.15 | 0 = instant, 0.8 = very calm. `0.35` for a calmer look |
| `saturationBoost` | 1.5 | Boosts colors (screen colors are usually pale) |
| `minBrightness` / `maxBrightness` | 3 / 100 | Lamp brightness (%) in dark / bright scenes |
| `brightnessGamma` | 0.7 | < 1 makes mid-bright scenes brighter |
| `networkInterface` | `null` | Network interface for device discovery, e.g. `"Ethernet"`; `null` = all |
| `preferIpv4` | `true` | Connect over IPv4 first (see Troubleshooting) |
| `capture` | `"auto"` | `"auto"` uses ffmpeg when available; `"screenshots"` forces the slower fallback |
| `ffmpegPath` / `ddaOutput` | — | Path to ffmpeg and its monitor index, if they aren't detected automatically |
| `lamps[].zone` | — | `left`, `right`, `center`, `all`, `top`, `bottom` or a custom area `{"x":0,"y":0,"w":0.2,"h":1}` (fractions of the screen) |

### Glow on a second monitor — `glow` section

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `true` | `false` turns the glow off |
| `monitor` | `"auto"` | Any monitor other than the captured one, or part of a monitor name |
| `edge` | 0.3 | Fraction of the main screen width (at the shared edge) to mirror |
| `blur` | 45 | Blur, px |
| `brightness` / `saturation` | 1.0 / 1.3 | Glow brightness and saturation |
| `fade` | 0.85 | How dark the far side of the glow monitor gets (0 = no fade, 1 = black) |
| `smoothing` | 0.3 | Temporal smoothing |

The glow window opens *behind* other windows — minimize whatever is on that monitor before the movie.

## Troubleshooting

- **The lamp isn't found when adding it.** Turn pairing mode on again (the code expires) and enter the code right away. The PC and the lamp must be on the same network.
- **Connecting takes a minute or more, or lamps drop out.** VPN clients on the PC often block IPv6 on the local network. Keep `preferIpv4: true` (default). Run `node ambilight.mjs doctor` to see your network interfaces; if discovery picks the wrong one, set `networkInterface` (e.g. `"Ethernet"`).
- **Lamps lag or stutter.** Lower `maxUpdatesPerSecond` and raise `transition` / `smoothing`.
- **Streaming services (Netflix etc.) give black.** Protected (DRM) video can't be captured — this affects every screen-capture tool. Local players (VLC, mpv) and most websites are fine.
- **High CPU usage.** Install ffmpeg: `winget install Gyan.FFmpeg`. The doctor command shows whether it's found.
- **After Ctrl+C the window asks "Terminate batch job (Y/N)?"** That's Windows' batch-file prompt — just close the window.
- **Detailed logs:** `set MATTER_LOG=info` and `set DEBUG=1` before running `node ambilight.mjs start`.

## How it works

```
 screen ──ffmpeg ddagrab (GPU)──▶ 192×80 frame ──▶ color per zone ──▶ Matter commands ──▶ lamps
                                       │
                                       └──▶ mirrored edge strip ──SSE──▶ fullscreen Edge on monitor 2 (CSS blur)
```

- **Matter:** [matter.js](https://github.com/project-chip/matter.js) runs a commissioning controller on the PC. Lamps are added through the standard multi-admin flow, so they're in two "homes" at once. Credentials are stored in `.matter-storage/` (excluded from git — keep it private).
- **Speed:** each lamp gets at most one command in flight and always the newest color — no backlog. Color and brightness are sent only when they actually changed.
- **Capture:** ffmpeg's `ddagrab` (Desktop Duplication API) grabs the frame on the GPU and scales it down; without ffmpeg the app falls back to full-resolution screenshots via [node-screenshots](https://github.com/nashaofu/node-screenshots).
- **Restore:** the lamps' state is remembered at start and written back on Ctrl+C or when the window is closed.

## Limitations

- Windows only (screen capture and the glow window rely on Windows APIs).
- The PC acts as a Matter controller with the test vendor ID (as hobby/DIY controllers do). Lamps tested: Yandex Bulb E27 (Wi-Fi Matter); other color Matter lamps should work but aren't verified.
- Protected (DRM) video can't be captured.

## License

[MIT](LICENSE)
