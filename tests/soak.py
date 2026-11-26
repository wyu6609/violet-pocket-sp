"""Run real, foreground GBA emulation for two elapsed hours; python tests/soak.py."""
import functools
import os
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright, expect
from player import ROOT, boot

def main():
    duration=int(os.environ.get('SOAK_SECONDS','7200'))
    if duration<30: raise ValueError('Use at least 30 seconds.')
    host=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(SimpleHTTPRequestHandler,directory=ROOT))
    threading.Thread(target=host.serve_forever,daemon=True).start()
    url='http://127.0.0.1:%d/'%host.server_port
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(channel='chrome',args=['--autoplay-policy=no-user-gesture-required'])
            ctx=browser.new_context()
            page=ctx.new_page()
            errors=[]
            page.on('pageerror',lambda err:errors.append(str(err)))
            page.on('crash',lambda _:errors.append('Renderer crashed'))
            page.add_init_script("""const originalInfo=console.info;
              console.info=function(event,...rest){
                if(event==='[Violet Pocket SP] Checkpoint restored')
                  window.restoredRegisters=Array.from(captureState().slice(32,96));
                return originalInfo.call(console,event,...rest);
              };""")
            boot(page,url)
            start=time.monotonic()
            last_frames=last_writes=0
            next_report=0
            while time.monotonic()-start<duration:
                page.wait_for_timeout(min(30000,max(1,int((duration-time.monotonic()+start)*1000))))
                age=time.monotonic()-start
                stats=page.evaluate('Diagnostics.sample()')
                assert not errors and not stats['failures'],(errors,stats)
                assert stats['totalFrames']>last_frames and stats['saves']>=last_writes,(age,stats)
                assert page.evaluate('!paused'), 'Game paused unexpectedly'
                saved_age=page.evaluate("async()=>Date.now()-(await Saves.get(cartridge+':auto')).time")
                assert 0<=saved_age<35000,(age,saved_age)
                last_frames,last_writes=stats['totalFrames'],stats['saves']
                page.keyboard.press(['Enter','KeyZ','ArrowRight','KeyX'][int(age//30)%4])
                if age>=next_report:
                    print(f'{age:.0f}s: {last_frames} frames, {last_writes} writes, last save {saved_age}ms ago',flush=True)
                    next_report=age+295
            page.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide'))")
            expect(page.locator('#status')).to_contain_text('Paused.')
            original=page.evaluate('Array.from(captureState().slice(32,96))')
            page.goto('about:blank')
            ctx.set_offline(True)
            boot(page,url+'?recovery')
            assert page.evaluate('window.restoredRegisters')==original
            assert not errors,errors
            print(f'PASS {duration} elapsed seconds, {last_frames} emulated frames, {last_writes} confirmed writes, final CPU registers restored offline.',flush=True)
            browser.close()
    finally:
        host.shutdown()

if __name__=='__main__':
    main()
