"""Normalize a completed continuous recording; no outcomes are edited or fabricated."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

ffmpeg = os.environ.get("FFMPEG_PATH") or shutil.which("ffmpeg") or "/Users/pomelo/Library/Caches/ms-playwright/ffmpeg-1011/ffmpeg-mac"
source = Path("artifacts/video-raw/ProcureMate-source.webm")
if not source.exists():
    raise SystemExit("Completed recording missing; do not publish failed recording fragments.")
probe = subprocess.run([ffmpeg, "-i", str(source)], capture_output=True, text=True)
match = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", probe.stderr)
if not match:
    raise SystemExit("Unable to verify source duration.")
seconds = int(match[1])*3600+int(match[2])*60+float(match[3])
if not 178 <= seconds <= 220:
    raise SystemExit(f"Unexpected recording duration {seconds}; inspect delays before publishing.")
scale = 180 / seconds
subprocess.run([ffmpeg, "-y", "-itsscale", str(scale), "-i", str(source), "-an", "-r", "25", "-t", "180", "-c:v", "libvpx", "-b:v", "350k", "-crf", "18", "-qmin", "8", "-qmax", "32", "-deadline", "realtime", "-cpu-used", "6", "-threads", "4", "artifacts/ProcureMate-demo.webm"], check=True)
for moment, name in [(38,"spec"),(62,"payment"),(102,"stop"),(168,"study"),(179,"ending")]:
    subprocess.run([ffmpeg,"-y","-ss",str(moment),"-i","artifacts/ProcureMate-demo.webm","-frames:v","1",f"artifacts/demo-{name}-frame.png"], check=True, capture_output=True)
Path("artifacts/video-raw/normalization.json").write_text(json.dumps({"sourceSeconds":seconds,"timestampScale":scale,"speed":seconds/180,"targetSeconds":180,"bitrateTarget":"350k; qmax32 preserves text legibility","source":"continuous real prototype UI recording","editing":"uniform timestamp scaling only; no transaction outcomes modified"},indent=2)+"\n")
print(json.dumps({"sourceSeconds":seconds,"targetSeconds":180,"outputBytes":Path("artifacts/ProcureMate-demo.webm").stat().st_size}))
