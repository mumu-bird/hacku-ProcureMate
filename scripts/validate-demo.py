"""Verify media and the actual recorded procurement evidence before a release."""
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

ffmpeg = os.environ.get("FFMPEG_PATH") or shutil.which("ffmpeg") or "/Users/pomelo/Library/Caches/ms-playwright/ffmpeg-1011/ffmpeg-mac"
movie = "artifacts/ProcureMate-demo.webm"
decoded = subprocess.run([ffmpeg,"-i",movie,"-an","-vf","scale=144:108","-c:v","png","-f","image2","-update","1","-y",os.devnull], capture_output=True,text=True,timeout=120)
if decoded.returncode:
    raise SystemExit("Full video decode failed; do not publish.")
frames = int(re.findall(r"frame=\s*(\d+)",decoded.stderr)[-1])
assert frames == 4500, frames
assert "Duration: 00:03:00.00" in decoded.stderr
assert not re.search(r"Stream.*Audio:",decoded.stderr)
assert "1440x1080" in decoded.stderr
layout=json.loads(Path("artifacts/deck-layout-check.json").read_text())
assert layout["slides"]==7 and not layout["issues"]
assert len(re.findall(rb"/Type /Page\b",Path("artifacts/ProcureMate-pitch.pdf").read_bytes()))==7
core=Path("artifacts/core-test-results.txt").read_text()
assert re.search(r"fail 0\b",core)
core_count=int(re.search(r"pass (\d+)",core)[1])
browser=json.loads(Path("artifacts/browser-results.json").read_text())["stats"]
assert not any(browser[k] for k in ["unexpected","flaky","skipped"])
e=json.loads(Path("artifacts/demo-evidence.json").read_text())
received=[o for o in e["orders"] if o["quote"]["scenario"]=="event" and o["status"]=="received"]
assert len(received)==1 and received[0]["quote"]["need"]["minCapacityMl"]==500
assert received[0]["quote"]["need"]["requiresInsulated"]
assert received[0]["quote"]["lines"][0]["quantity"]==10
stopped=[o for o in e["orders"] if o["status"]=="blocked"]
assert len(stopped)==1 and stopped[0]["quote"]["totalCents"]==24800 and not stopped[0].get("paymentId")
stop_log=next(a for a in e["audit"] if a["target"]==stopped[0]["id"] and a["action"]=="PURCHASE_BLOCKED")
assert stop_log["detail"]["paymentCalled"] is False
assert any(c["code"]=="CAP" and not c["pass"] for c in stop_log["detail"]["checks"])
assert not any(a["target"]==stopped[0]["id"] and a["action"]=="PAYMENT_AUTHORIZE" for a in e["audit"])
replenishment=[o for o in e["orders"] if o["quote"]["scenario"]=="replenishment"]
assert len(replenishment)==2 and sorted(o["status"] for o in replenishment)==["paid","received"]
stock=next(i for i in e["inventory"] if i["productId"]==replenishment[0]["quote"]["lines"][0]["productId"])
assert stock["quantity"]==4 and stock["inTransit"]==16
assert not e["measurements"]
study=json.loads(Path("artifacts/demo-study-state.json").read_text())
assert study["participants"]==0 and not study["sessions"]
files={}
for name in ["ProcureMate-demo.webm","ProcureMate-pitch.pdf","demo-evidence.json","demo-study-state.json"]:
    b=Path("artifacts",name).read_bytes();files[name]={"bytes":len(b),"sha256":sha256(b).hexdigest()}
normal=json.loads(Path("artifacts/video-raw/normalization.json").read_text()) if Path("artifacts/video-raw/normalization.json").exists() else None
report={"verifiedAt":datetime.now(timezone.utc).isoformat(),"release":"v0.2.0","videoSeconds":180,"videoSize":[1440,1080],"frameRate":25,"decodedFrames":frames,"audio":False,"normalization":normal,"coreTests":core_count,"browserTests":browser["expected"],"pdfSlides":7,"recordedClosure":{"eventReceived":True,"minCapacityMl":500,"shippingStopWithoutPayment":True,"secondReplenishmentPaid":True,"demoHumanParticipants":0},"disclosure":"Rules and simulated payments. Study tooling is demonstrated empty; no human study or real model/Stripe integration is claimed.","files":files}
Path("artifacts/media-validation.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
print(json.dumps({"decodedFrames":frames,"videoSeconds":180,"coreTests":core_count,"browserTests":browser["expected"],"pdfSlides":7,"videoBytes":files["ProcureMate-demo.webm"]["bytes"]}))
