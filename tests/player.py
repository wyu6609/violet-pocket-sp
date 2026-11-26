import functools
import tempfile
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]

def boot(page, url):
    page.goto(url)
    page.locator('#start').click()
    expect(page.locator('#cart')).to_contain_text('.gba', timeout=90000)
    expect(page.locator('#pause')).to_be_enabled(timeout=30000)
    page.wait_for_function('!awaitingFirstFrame && !paused', timeout=30000)

def check_saves(page, url):
    page.click('#save')
    expect(page.locator('#status')).to_have_text('Manual state saved.')
    key = page.evaluate('cartridge')
    state = page.evaluate("""async () => {
      const rec=await Saves.get(cartridge);
      if(!Saves.valid(rec,core._mgbawasm_state_size()))throw Error('invalid manual state');
      let data='';
      for(let i=0;i<rec.bytes.length;i+=8192)data+=String.fromCharCode(...rec.bytes.subarray(i,i+8192));
      localStorage.setItem(cartridge,rec.time+'|'+btoa(data));
      await Saves.transaction('readwrite',s=>s.delete(cartridge));
      localStorage.setItem(cartridge+':auto','bad!');
      return {time:rec.time,crc:rec.crc};
    }""")
    # Use a second tab so no lifecycle autosave from the first can replace the fixture.
    second=page.context.new_page()
    boot(second,url)
    expect(second.locator('#status')).to_have_text('Manual save restored.')
    copied=second.evaluate("""async () => {
      const r=await Saves.get(cartridge);
      return {time:r.time,crc:r.crc,valid:Saves.valid(r,core._mgbawasm_state_size()),
        legacy:localStorage.getItem(cartridge),bad:localStorage.getItem(cartridge+':auto')};
    }""")
    assert copied == {**state,'valid':True,'legacy':None,'bad':'bad!'}, copied
    second.evaluate("localStorage.removeItem(cartridge+':auto')")
    second.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide'))")
    expect(second.locator('#status')).to_contain_text('Paused.')
    assert second.evaluate("async()=>Saves.valid(await Saves.get(cartridge+':auto'),core._mgbawasm_state_size())")
    assert second.evaluate('cartridge') == key
    expect(second.locator('#last-save')).to_contain_text('Last saved')
    second.close()
    print('PASS binary IndexedDB, exact legacy bytes and timestamp, invalid legacy retained, background save.',flush=True)

def download(page,button,directory):
    with page.expect_download(timeout=20000) as event:
        page.click(button)
    download=event.value
    path=Path(directory)/download.suggested_filename
    download.save_as(str(path))
    return path.read_bytes()

def import_file(page,name,content,accept=True):
    page.once('dialog', lambda d:d.accept() if accept else d.dismiss())
    page.locator('#save-file').set_input_files({'name':name,'mimeType':'application/octet-stream','buffer':content})

def check_transfers(page):
    page.evaluate("pause(true,'test')")
    page.locator('summary',has_text='Transfer saves').click()
    regs="()=>Array.from(captureState().slice(32,96))"
    original=page.evaluate(regs)
    with tempfile.TemporaryDirectory() as tmp:
        state=download(page,'#export-state',tmp)
        page.evaluate("pause(false,'test')")
        page.wait_for_function("before=>JSON.stringify(Array.from(captureState().slice(32,96)))!==JSON.stringify(before)",arg=original)
        page.evaluate("pause(true,'test')")
        import_file(page,'game.vpspsave',state)
        expect(page.locator('#status')).to_have_text('Checkpoint imported.')
        assert page.evaluate(regs)==original, 'CPU registers did not rewind'
        assert page.evaluate('paused')
        corrupt=bytearray(state)
        corrupt[-1]^=1
        page.locator('#save-file').set_input_files({'name':'bad.vpspsave','mimeType':'application/octet-stream','buffer':bytes(corrupt)})
        expect(page.locator('#status')).to_contain_text('checksum')
        assert page.evaluate(regs)==original
        # Raw GBA saves have no wrapper. Verify all bytes through the real mGBA core.
        native_size=page.evaluate('readBattery()?.length||131072')
        raw=bytes((i*7+3)%256 for i in range(native_size))
        import_file(page,'FireRed.sav',raw)
        expect(page.locator('#status')).to_contain_text('Game save imported')
        assert download(page,'#export-battery',tmp)==raw
        imported=page.evaluate("async()=>{const r=await Saves.get(cartridge+':auto');return r.battery?.length}")
        assert imported==len(raw)
    print('PASS checkpoint file rewound real CPU registers, corrupt import preserved progress, and raw .sav round-tripped byte for byte.',flush=True)

def check_offline(page,url,engine,host):
    expect(page.locator('#offline-status')).to_have_text('Ready offline',timeout=90000)
    page.click('#save')
    expect(page.locator('#status')).to_have_text('Manual state saved.')
    page.goto('about:blank')
    if engine=='webkit':
        host.shutdown()
        host.server_close()
    else:
        page.context.set_offline(True)
    boot(page,url+'?offline-relaunch')
    expect(page.locator('#offline-status')).to_have_text('Ready offline')
    expect(page.locator('#status')).to_contain_text('restored')
    print('PASS fresh offline navigation, local core, cartridge and recovered checkpoint.',flush=True)

def main():
    engine=sys.argv[1] if len(sys.argv)>1 else 'chromium'
    handler=functools.partial(SimpleHTTPRequestHandler,directory=ROOT)
    host=ThreadingHTTPServer(('127.0.0.1',0),handler)
    threading.Thread(target=host.serve_forever,daemon=True).start()
    url='http://127.0.0.1:%d/' % host.server_port
    with sync_playwright() as p:
        if engine=='webkit':
            browser=p.webkit.launch()
            ctx=browser.new_context(**p.devices['iPhone 13'])
        else:
            browser=p.chromium.launch(channel='chrome',args=['--autoplay-policy=no-user-gesture-required'])
            ctx=browser.new_context(accept_downloads=True)
        page=ctx.new_page()
        page.on('pageerror',lambda e:print('Browser error:',str(e),flush=True))
        page.on('requestfailed',lambda req:print('Request failed:',req.url,req.failure,flush=True))
        try:
            boot(page,url)
            check_saves(page,url)
            check_transfers(page)
            check_offline(page,url,engine,host)
        finally:
            print('Player status:',page.locator('#status').all_text_contents(),flush=True)
            browser.close()
            host.shutdown()

if __name__=='__main__':
    main()
