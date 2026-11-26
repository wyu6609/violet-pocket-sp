import functools
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
        finally:
            print('Player status:',page.locator('#status').all_text_contents(),flush=True)
            browser.close()
            host.shutdown()

if __name__=='__main__':
    main()
