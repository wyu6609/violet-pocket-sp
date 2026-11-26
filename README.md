# Violet Pocket SP

[A browser-based Game Boy Advance SP player](https://wyu6609.github.io/violet-pocket-sp/) with Pokémon FireRed, Metroid Fusion and a local cartridge library. Power on to unlock audio and open the last selected game. Import a .gba cartridge up to 32 MiB or a ZIP containing one cartridge. The player supports keyboard controls, touch, shell colors, volume and 2× speed.

## Saves and recovery

The player writes binary checkpoints to IndexedDB every ten seconds of play, on backgrounding, and before a game switch. It updates **Last saved** after the transaction commits. The manual slot stays separate. On startup it checks the newest valid slot for that cartridge, including the three older autosaves kept at least five minutes apart. Open **Autosave history** to choose a screenshot and timestamp. Older versions' localStorage saves migrate when their cartridge opens. The original remains until the stored copy passes verification.

In **Transfer saves**, **Export checkpoint** captures the exact emulated state and any battery data. Import the .vpspsave with the same cartridge and core to resume. **Export game save (.sav)** gives you the game's raw battery memory for compatible GBA emulators. Save using the in-game menu first. Raw saves have no game ID: select the correct cartridge, import its .sav, and choose Continue in the game after it restarts. Both imports ask before replacing the current autosave.

## Offline play and diagnostics

Open each game online once. **Ready offline** confirms the player, mGBA core and selected cartridge are stored in this browser. Reopen the same site offline and press Power. Clearing browser site data removes local games and saves, so export a backup to keep separately.

**Diagnostics** shows session length, emulated frames per second, completed saves, failures and the latest error. **Copy report** works without desktop developer tools and provides selectable text if clipboard access is unavailable. Browser console events use the prefix `[Violet Pocket SP]`.

## Run and test

Serve the repository with `python -m http.server 8000` and open `http://localhost:8000`. Use HTTPS for hosted play. Browser dependencies are served from `vendor/`; rebuild them with `python scripts/vendor_runtime.py`. The core is [mGBA](https://github.com/mgba-emu/mgba), packaged by [wasm-gaming/mGBA-wasm](https://github.com/wasm-gaming/mGBA-wasm) v0.3.1. License notices are in `vendor/`.

The browser tests use Python Playwright 1.55.0, Google Chrome and Playwright WebKit. Run `python tests/player.py chromium` and `python tests/player.py webkit`. Run `python tests/soak.py` for a two-hour foreground FireRed session with regular inputs, frame and autosave checks, and final offline recovery. GitHub Actions runs the short suite on pushes; choose **GBA player checks → Run workflow** to repeat the full endurance test.
