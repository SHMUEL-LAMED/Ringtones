import os
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel, Field

load_dotenv(Path(__file__).resolve().parents[1] / ".env.local")

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

class SongRequest(BaseModel):
    topic: str = Field(min_length=3, max_length=300)
    style: str = Field(default="מרגש", max_length=80)
    language: str = Field(default="עברית", max_length=30)
    duration: int = Field(default=90, ge=45, le=180)

@app.post("/generate-song")
def generate_song(request: SongRequest):
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(503, "מפתח OpenAI אינו מוגדר בשרת")
    client = OpenAI()
    prompt = f"""צור תכנון לשיר מקורי לחלוטין.
נושא: {request.topic}
סגנון מוזיקלי כללי: {request.style}
שפה: {request.language}
אורך מבוקש: {request.duration} שניות

כתוב מילים חדשות בלבד, ללא ציטוט או חיקוי של שיר או אמן קיים. שמור על תוכן נקי ומתאים לכל המשפחה.
החזר JSON בלבד במבנה הזה:
{{"title":"...","lyrics":"[בית א]\\n...\\n\\n[פזמון]\\n...","bpm":100,"key":"Am","mood":"...","progression":["Am","F","C","G"]}}
ה-BPM חייב להיות מספר 70–150. הסולם חייב להיות אחד מ-C,Dm,Em,F,G,Am. progression חייב להכיל בדיוק 4 אקורדים מתוך C,Dm,Em,F,G,Am.
"""
    try:
        response = client.responses.create(
            model=os.getenv("OPENAI_TEXT_MODEL", "gpt-5.6"),
            instructions="אתה כותב ומלחין שירים מקוריים. החזר תמיד JSON תקין בלבד.",
            input=prompt,
            reasoning={"effort": "low"},
            store=False,
        )
        raw = response.output_text.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
        data = json.loads(raw)
        required = {"title", "lyrics", "bpm", "key", "mood", "progression"}
        if not required.issubset(data) or len(data["progression"]) != 4:
            raise ValueError("invalid song structure")
        return data
    except json.JSONDecodeError:
        raise HTTPException(502, "ה-AI החזיר מבנה שיר לא תקין")
    except Exception as exc:
        raise HTTPException(502, f"יצירת השיר נכשלה: {type(exc).__name__}")

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
