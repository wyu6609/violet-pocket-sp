# Violet Pocket
Extract this folder and open index.html in a modern browser. Click Start to unlock 44.1 kHz stereo audio, then Load ROM. Select an uncompressed GBA cartridge up to 32 MiB. No BIOS or commercial ROM is included. ROM data stays local.

For predictable persistent storage, serve the folder with `python -m http.server 8000` and open http://localhost:8000. For phones, upload the three app files together to any HTTPS static host. A network connection is needed to load the pinned core.

The core is [mGBA](https://github.com/mgba-emu/mgba) via [wasm-gaming/mGBA-wasm](https://github.com/wasm-gaming/mGBA-wasm), MPL-2.0. The loader and core URLs are https://cdn.jsdelivr.net/npm/@wasm-gaming/mgba-wasm@0.3.1/dist/mgba/mgba.js and https://cdn.jsdelivr.net/npm/@wasm-gaming/mgba-wasm@0.3.1/dist/mgba/mgba.wasm .

Each ROM has one manual save-state slot, keyed by SHA-256. Saving replaces the previous slot. Reload the same ROM and choose Load State. Storage limits or private browsing may prevent persistence. 2× advances twice as many frames and accelerates audio. Backgrounding the page pauses playback.
The first import keeps the last cartridge in IndexedDB. On your next visit to the same origin, click Start to reopen it and restore its last manual save. Import your own FireRed .gba once to use this flow. Clearing site data removes both the stored cartridge and its state.
