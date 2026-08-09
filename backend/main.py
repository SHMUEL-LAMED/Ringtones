import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

app = FastAPI(title="Ringtones AI", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://shmuel-lamed.github.io",
        "https://tzilzulim.o0534169095.chatgpt.site",
    ],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

MAX_BYTES = 30 * 1024 * 1024
ALLOWED = {".mp3", ".wav", ".m4a", ".ogg", ".flac"}

@app.get("/")
def health():
    return {"status": "ok", "engine": "demucs-htdemucs"}

@app.post("/separate")
async def separate(file: UploadFile = File(...)):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED:
        raise HTTPException(400, "סוג הקובץ אינו נתמך")

    work = Path(tempfile.mkdtemp(prefix="ringtones-"))
    source = work / ("input" + suffix)
    total = 0
    try:
        with source.open("wb") as target:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_BYTES:
                    raise HTTPException(413, "הקובץ גדול מ-30MB")
                target.write(chunk)

        output = work / "output"
        subprocess.run(
            [
                "python", "-m", "demucs",
                "--two-stems=vocals",
                "-n", "htdemucs",
                "--out", str(output),
                str(source),
            ],
            check=True,
            timeout=850,
        )
        result = output / "htdemucs" / "input" / "no_vocals.wav"
        if not result.exists():
            raise RuntimeError("Demucs did not create the output")
        return FileResponse(
            result,
            media_type="audio/wav",
            filename="instrumental.wav",
            background=BackgroundTask(shutil.rmtree, work, ignore_errors=True),
        )
    except HTTPException:
        shutil.rmtree(work, ignore_errors=True)
        raise
    except subprocess.TimeoutExpired:
        shutil.rmtree(work, ignore_errors=True)
        raise HTTPException(504, "העיבוד ארך יותר מדי זמן")
    except Exception as exc:
        shutil.rmtree(work, ignore_errors=True)
        raise HTTPException(500, f"ההפרדה נכשלה: {type(exc).__name__}")
