import re
import sys
import subprocess
from pathlib import Path

def validate_index_html():
    html_path = Path("index.html")
    if not html_path.exists():
        print("FAIL: index.html not found")
        return False

    content = html_path.read_text(encoding="utf-8")

    required_strings = [
        'lang="he"',
        'dir="rtl"',
        'aria-valuetext=',
        'aria-pressed=',
        'for="',
        'id="range"',
        'id="playBtn"'
    ]

    missing = [s for s in required_strings if s not in content]
    if missing:
        print(f"FAIL: index.html missing required elements/attributes: {missing}")
        return False

    print("PASS: index.html structural checks succeeded")
    return True

def validate_backend_tests():
    backend_dir = Path("backend")
    if not backend_dir.exists():
        print("FAIL: backend directory not found")
        return False

    res = subprocess.run(["pytest"], cwd=backend_dir, capture_output=True, text=True)
    if res.returncode != 0:
        print("FAIL: Pytest tests failed:")
        print(res.stdout)
        print(res.stderr)
        return False

    print("PASS: Backend pytest tests passed")
    return True

if __name__ == "__main__":
    ok_html = validate_index_html()
    ok_backend = validate_backend_tests()
    if not (ok_html and ok_backend):
        sys.exit(1)
    print("ALL VALIDATION CHECKS PASSED SUCCESSFULLY")
