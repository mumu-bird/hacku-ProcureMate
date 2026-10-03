"""Anonymous full-file verification of release attachments, using validated HTTP ranges."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import sys
from urllib.request import Request, urlopen

version = sys.argv[1] if len(sys.argv)>1 else "v0.2.0"
expected_commit = sys.argv[2] if len(sys.argv)>2 else None
repo = "https://github.com/mumu-bird/hacku-ProcureMate"
manifest = json.loads(Path("artifacts/media-validation.json").read_text())["files"]
base_source = sys.argv[3] if len(sys.argv)>3 else f"{repo}/releases/download/{version}"
resources = []
def get(url):
    with urlopen(Request(url,headers={"User-Agent":"ProcureMate-anonymous-release-verifier"}),timeout=25) as response:
        return response.status,response.read()
status, body = get("https://api.github.com/repos/mumu-bird/hacku-ProcureMate/commits/main")
commit = json.loads(body)["sha"]
if expected_commit and commit != expected_commit:
    raise SystemExit("Public main does not match the intended commit.")
resources.append({"resource":"public-main","status":status,"commit":commit,"authentication":"none"})
chunk_size = 131072
for name in ["ProcureMate-demo.webm","ProcureMate-pitch.pdf","demo-evidence.json","demo-study-state.json"]:
    url = f"{base_source}/{name}"
    expected = manifest[name]
    try:
        size = expected["bytes"]
        output = bytearray(size)
        def chunk(start):
            end = min(size-1,start+chunk_size-1)
            # Unique query avoids an intermediate cache reusing a different byte range.
            request = Request(f"{url}?verifyRange={start}-{end}",headers={"User-Agent":"ProcureMate-anonymous-release-verifier","Range":f"bytes={start}-{end}"})
            last = None
            for attempt in range(2):
                try:
                    with urlopen(request,timeout=25) as response:
                        data = response.read()
                        if response.status == 200 and start == 0 and len(data) == size:
                            return 0,data
                        match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)",response.headers.get("Content-Range", ""))
                        if response.status != 206 or not match or tuple(map(int,match.groups())) != (start,end,size) or len(data) != end-start+1:
                            raise ValueError("Response does not prove the requested file range")
                        return start,data
                except Exception as error:
                    last = error
            raise last
        with ThreadPoolExecutor(max_workers=8) as pool:
            jobs=[pool.submit(chunk,start) for start in range(0,size,chunk_size)]
            complete=0
            for job in as_completed(jobs):
                start,data=job.result();output[start:start+len(data)]=data;complete+=1
                if complete % 16 == 0:print(f"{name}: {complete}/{len(jobs)} validated ranges",flush=True)
        digest=sha256(output).hexdigest()
        if digest != expected["sha256"]:raise ValueError("Complete artifact digest mismatch")
        resources.append({"resource":name,"url":url,"authentication":"none","fullFileVerified":True,"bytes":size,"sha256":digest,"method":"all validated HTTP byte ranges assembled and hashed"})
        print(f"{name}: complete anonymous checksum verified",flush=True)
    except Exception as error:
        resources.append({"resource":name,"url":url,"authentication":"none","fullFileVerified":False,"errorType":type(error).__name__})
        print(f"{name}: failed ({type(error).__name__})",flush=True)
report={"observedAt":datetime.now(timezone.utc).isoformat(),"release":version,"repositoryVisibility":"public","artifactBaseUrl":base_source,"resources":resources,"allFullFilesVerified":all(r.get("fullFileVerified",True) for r in resources)}
Path("artifacts/public-access-validation.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
if not report["allFullFilesVerified"]:raise SystemExit(1)
