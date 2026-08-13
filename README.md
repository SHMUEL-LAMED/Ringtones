# צלצולים

אתר ליצירת צלצולים מתוך קובצי שמע: העלאת שיר, בחירת קטע,
עריכה והורדה כקובץ WAV.

## הרצה מקומית

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

בפריסה יש להגדיר את `OPENAI_API_KEY` כסוד בסביבת השרת. אין להעלות קובצי סביבה ל-GitHub.
