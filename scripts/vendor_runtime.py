"""Rebuild the local browser runtime from exact npm package releases."""
import base64
import hashlib
import io
import json
from pathlib import Path
import tarfile
import urllib.request

OUT = Path(__file__).resolve().parents[1] / 'vendor'
PACKAGES = {
    ('react','18.3.1'): {'umd/react.production.min.js':'react.js'},
    ('react-dom','18.3.1'): {'umd/react-dom.production.min.js':'react-dom.js'},
    ('fflate','0.8.2'): {'umd/index.js':'fflate.js'},
    ('@wasm-gaming/mgba-wasm','0.3.1'): {'dist/mgba/mgba.js':'mgba.js', 'dist/mgba/mgba.wasm':'mgba.wasm'},
}
OUT.mkdir(exist_ok=True)
for (name,version), files in PACKAGES.items():
    meta=json.load(urllib.request.urlopen(f'https://registry.npmjs.org/{name}/{version}',timeout=60))['dist']
    archive=urllib.request.urlopen(meta['tarball'],timeout=90).read()
    algo,digest=meta['integrity'].split('-',1)
    if base64.b64encode(hashlib.new(algo,archive).digest()).decode()!=digest:
        raise ValueError(f'Integrity mismatch for {name}')
    with tarfile.open(fileobj=io.BytesIO(archive),mode='r:gz') as tar:
        for member in tar.getnames():
            if member.rsplit('/',1)[-1].lower().startswith(('license','copying','notice')) and tar.getmember(member).isfile():
                label=member.removeprefix('package/').replace('/','-')
                target=name.rsplit('/',1)[-1]+'-'+label
                (OUT/target).write_bytes(tar.extractfile(member).read())
        for source,dest in files.items():
            (OUT/dest).write_bytes(tar.extractfile('package/'+source).read())
    print(name,version)
