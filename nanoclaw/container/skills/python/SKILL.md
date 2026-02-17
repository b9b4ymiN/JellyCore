---
name: python
description: Write and run Python scripts for data scraping, analysis, file processing, HTTP requests, and automation tasks. Python 3 is pre-installed with requests, beautifulsoup4, lxml, and playwright.
allowed-tools: Bash(python*:*)
---

# Python Environment

Python 3 is available in this container with pre-installed packages.

## Pre-installed packages

- **requests** — HTTP client (GET, POST, APIs)
- **beautifulsoup4** + **lxml** — HTML/XML parsing & web scraping
- **playwright** — Browser automation (shares system Chromium, no extra download)
- **json**, **csv**, **sqlite3**, **re**, **datetime** — standard library

## Usage patterns

### Quick one-liner
```bash
python3 -c "import requests; r = requests.get('https://example.com'); print(r.status_code)"
```

### Write and run script
```bash
cat > /tmp/scrape.py << 'EOF'
import requests
from bs4 import BeautifulSoup

resp = requests.get('https://example.com')
soup = BeautifulSoup(resp.text, 'lxml')
print(soup.title.string)
EOF
python3 /tmp/scrape.py
```

### Web scraping with BeautifulSoup
```python
import requests
from bs4 import BeautifulSoup

url = 'https://www.set.or.th/th/market/product/stock/quote/SET/price'
headers = {'User-Agent': 'Mozilla/5.0'}
resp = requests.get(url, headers=headers)
soup = BeautifulSoup(resp.text, 'lxml')

# Extract data from tables
for row in soup.select('table tr'):
    cells = [td.text.strip() for td in row.select('td')]
    if cells:
        print(cells)
```

### Playwright browser automation (for JavaScript-rendered pages)
```python
from playwright.sync_api import sync_playwright
import os

with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH', '/usr/bin/chromium'),
        headless=True,
        args=['--no-sandbox', '--disable-gpu']
    )
    page = browser.new_page()
    page.goto('https://example.com')
    page.wait_for_load_state('networkidle')
    content = page.content()
    browser.close()
```

### HTTP API calls
```python
import requests
import json

# GET with JSON response
data = requests.get('https://api.example.com/data').json()

# POST with payload
resp = requests.post('https://api.example.com/submit',
    json={'key': 'value'},
    headers={'Authorization': 'Bearer TOKEN'}
)
```

### CSV/JSON file processing
```python
import csv
import json

# Read CSV
with open('data.csv') as f:
    reader = csv.DictReader(f)
    for row in reader:
        print(row)

# Write JSON
with open('output.json', 'w') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
```

## Installing additional packages at runtime

If you need a package not pre-installed:
```bash
pip3 install --break-system-packages pandas numpy
python3 script.py
```

Note: Runtime-installed packages are lost when this container exits.
Pre-installed packages persist across runs.

## Important notes

- Scripts should write output files to `/workspace/group/` (persistent) not `/tmp/` (lost on exit)
- For Playwright: always use `headless=True` and `--no-sandbox` args
- The system Chromium is shared between agent-browser and Playwright
- Prefer `requests` + `BeautifulSoup` for static pages (faster, lighter)
- Use Playwright only for JavaScript-heavy pages that need rendering
