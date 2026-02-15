# PyThaiNLP Integration Plan สำหรับ JellyCore

> **สถานะ:** วิเคราะห์แล้ว — พร้อม implement  
> **คำตอบสั้น:** ใช่ ควรนำ PyThaiNLP มาใช้ใน Oracle V2 อย่างยิ่ง  
> **เหตุผลหลัก:** JellyCore ใช้ภาษาไทย ~90% แต่ไม่มี Thai NLP ใดๆ เลย — ทุก text processing ทำแบบ naïve (split by space/newline) ซึ่งใช้ไม่ได้กับภาษาไทย

---

## 📊 สรุปผลการศึกษา PyThaiNLP

| ด้าน | รายละเอียด |
|------|-----------|
| **Version** | 5.2.0 (stable, actively maintained) |
| **License** | Apache 2.0 — ใช้ commercial/personal ได้เต็มที่ |
| **ภาษา** | Python 3.9+ |
| **Stars** | 1,100+ / 59 contributors |
| **ขนาด** | `pip install pythainlp` (compact: ~50MB, full: ~500MB) |

### ความสามารถที่เกี่ยวข้องกับ JellyCore

| Feature | Module | ใช้ที่ไหน | ความสำคัญ |
|---------|--------|----------|----------|
| **Word Tokenization** | `pythainlp.tokenize.word_tokenize` | Oracle search, FTS5 indexing | ★★★★★ |
| **Sentence Tokenization** | `pythainlp.tokenize.sent_tokenize` | Document chunking | ★★★★★ |
| **Spell Correction** | `pythainlp.spell.correct` | Search query preprocessing | ★★★★☆ |
| **Stop Words** | `pythainlp.corpus.thai_stopwords` | Search relevance, keyword extraction | ★★★★☆ |
| **Text Normalization** | `pythainlp.util.normalize` | Index preprocessing | ★★★★☆ |
| **Custom Dictionary** | `pythainlp.tokenize.Tokenizer` | Domain-specific terms | ★★★☆☆ |
| **Keyboard Correction** | `pythainlp.util.eng_to_thai` | Mistyped queries | ★★★☆☆ |
| **Soundex** | `pythainlp.soundex` | Phonetic fuzzy matching | ★★☆☆☆ |
| **Word Vectors** | `pythainlp.word_vector` | Semantic expansion | ★★☆☆☆ |
| **Synonyms** | `pythainlp.corpus.thai_synonyms` | Query expansion | ★★☆☆☆ |

---

## 🔍 ปัญหาปัจจุบันที่ PyThaiNLP แก้ได้

### ปัญหา 1: FTS5 ไม่เข้าใจภาษาไทย

Oracle V2 ใช้ SQLite FTS5 สำหรับ full-text search แต่:

```
Query: "อยากกินข้าวผัดกุ้ง"
FTS5 มองเป็นก้อนเดียว: "อยากกินข้าวผัดกุ้ง"
→ ไม่ match กับ document ที่มีคำว่า "ข้าวผัด" หรือ "กุ้ง" แยกกัน
```

**PyThaiNLP แก้ได้:**
```python
from pythainlp.tokenize import word_tokenize

word_tokenize("อยากกินข้าวผัดกุ้ง", engine="newmm")
# output: ['อยาก', 'กิน', 'ข้าวผัด', 'กุ้ง']
```

→ Index เป็น segmented text ใน FTS5: `"อยาก กิน ข้าวผัด กุ้ง"` → FTS5 MATCH ทำงานได้จริง

### ปัญหา 2: Document Chunking ไม่รู้จักประโยคไทย

Oracle V2 ตัด chunk โดยใช้ `###` headers + bullet points แต่ข้อความที่ไม่มี formatting จะกลายเป็นก้อนยาว บรรทัดเดียวอาจเป็นทั้งย่อหน้า (ภาษาไทยไม่ขึ้นบรรทัดใหม่ทุกประโยค)

**PyThaiNLP แก้ได้:**
```python
from pythainlp.tokenize import sent_tokenize

text = "ฉันไปประชุมเมื่อวานข้าราชการได้รับการหมุนเวียนเป็นระยะและเขาได้รับมอบหมายให้ประจำในระดับภูมิภาค"
sent_tokenize(text, engine="crfcut")
# output: ['ฉันไปประชุมเมื่อวาน', 'ข้าราชการได้รับการหมุนเวียนเป็นระยะ', 'และเขาได้รับมอบหมายให้ประจำในระดับภูมิภาค']
```

→ ใช้ `sent_tokenize` ร่วมกับ overlap chunking (~400 tokens, 80 token overlap) ได้

### ปัญหา 3: Search Query ผิด/สะกดผิด → ไม่เจอ

ภาษาไทยสะกดผิดบ่อย (ไม่มี spell check built-in) และ FTS5 ต้องการ exact match:

```
Query: "เหตการณ" (ขาด ุ กับ ์)
FTS5: ไม่ match "เหตุการณ์"
```

**PyThaiNLP แก้ได้:**
```python
from pythainlp.spell import correct

correct("เหตการณ")
# output: 'เหตุการณ์'

correct("สังเกตุ")
# output: 'สังเกต'
```

### ปัญหา 4: Embedding ไม่ดีเพราะ input ไม่ segmented

ChromaDB ใช้ `all-MiniLM-L6-v2` (English-first model) — embedding quality สำหรับภาษาไทยต่ำ เพราะ:
1. Model tokenizer ไม่รู้จักภาษาไทย → แตก character-level
2. ข้อความไม่ได้ segmented → meaning representation ไม่ดี

**PyThaiNLP ช่วยบางส่วน:**
- Pre-segment text ก่อนส่ง embedding model → ช่วย model ที่รองรับ multilingual
- ลบ stop words + normalize → ลด noise ใน embedding

> **Note:** ปัญหานี้แก้เต็มที่ต้องเปลี่ยน embedding model ด้วย (→ Phase 1: multilingual-e5-large)

---

## 🏗️ Architecture: PyThaiNLP เป็น Sidecar Service

### ทำไมไม่ embed ตรงใน Oracle V2?

| ข้อพิจารณา | เหตุผล |
|------------|--------|
| Oracle V2 เป็น Bun/TypeScript | PyThaiNLP เป็น Python — ไม่มี native JS port |
| Performance | Python process cold start ~2s, แต่ warm process = fast |
| Isolation | พังแยกกัน — Oracle ยังทำงานได้ถ้า PyThaiNLP down |
| Docker | เพิ่ม container ง่าย ใส่ `docker-compose.yml` |

### Design: `thai-nlp-sidecar`

```
┌─────────────────────────────────────────────────────┐
│                    JellyCore                         │
│                                                     │
│  ┌─────────────┐    HTTP/JSON    ┌───────────────┐  │
│  │  Oracle V2   │ ◄────────────► │ thai-nlp      │  │
│  │  (Bun)       │                │ sidecar       │  │
│  │              │                │ (Python/Flask) │  │
│  │ • FTS5 index │  /tokenize     │               │  │
│  │ • ChromaDB   │  /normalize    │ • PyThaiNLP   │  │
│  │ • Search     │  /spellcheck   │ • FastAPI     │  │
│  │ • Learn      │  /chunk        │ • ~50MB RAM   │  │
│  └─────────────┘                 └───────────────┘  │
│         ▲                               ▲           │
│         │                               │           │
│  ┌──────┴───────┐                       │           │
│  │  NanoClaw     │ (query-router ไม่ต้อง │           │
│  │  (Node.js)    │  ไปถึง sidecar)       │           │
│  └──────────────┘                                   │
└─────────────────────────────────────────────────────┘
```

### API Endpoints ของ Sidecar

```
POST /tokenize
  Body: { "text": "...", "engine": "newmm" }
  Response: { "tokens": ["...", "..."], "segmented": "... ..." }

POST /normalize
  Body: { "text": "..." }
  Response: { "normalized": "...", "changes": [...] }

POST /spellcheck
  Body: { "text": "...", "auto_correct": true }
  Response: { "corrected": "...", "suggestions": [...] }

POST /chunk
  Body: { "text": "...", "max_tokens": 400, "overlap": 80 }
  Response: { "chunks": ["...", "..."], "count": N }

POST /stopwords
  Body: { "tokens": ["...", "..."] }
  Response: { "filtered": ["...", "..."], "removed": ["...", "..."] }

POST /keyboard-fix
  Body: { "text": "Tok8kicsj'xitgmLwmp" }
  Response: { "fixed": "ธนาคารแห่งประเทศไทย", "was_mistyped": true }

GET /health
  Response: { "status": "ok", "pythainlp_version": "5.2.0" }
```

### Sidecar Implementation (Lightweight)

```python
# thai_nlp_sidecar/main.py
from fastapi import FastAPI
from pythainlp.tokenize import word_tokenize, sent_tokenize, Tokenizer
from pythainlp.spell import correct
from pythainlp.util import normalize
from pythainlp.corpus import thai_stopwords

app = FastAPI(title="Thai NLP Sidecar", version="1.0.0")
STOPWORDS = thai_stopwords()

@app.post("/tokenize")
def tokenize(text: str, engine: str = "newmm"):
    tokens = word_tokenize(text, engine=engine, keep_whitespace=False)
    return {"tokens": tokens, "segmented": " ".join(tokens)}

@app.post("/normalize")
def normalize_text(text: str):
    result = normalize(text)
    return {"normalized": result}

@app.post("/spellcheck")
def spellcheck(text: str, auto_correct: bool = True):
    tokens = word_tokenize(text, keep_whitespace=False)
    corrected = [correct(t) if auto_correct else t for t in tokens]
    return {"corrected": " ".join(corrected), "tokens": corrected}

@app.post("/chunk")
def chunk_text(text: str, max_tokens: int = 400, overlap: int = 80):
    sentences = sent_tokenize(text, engine="crfcut")
    # overlap chunking logic here
    chunks = _overlap_chunk(sentences, max_tokens, overlap)
    return {"chunks": chunks, "count": len(chunks)}

@app.post("/stopwords")
def filter_stopwords(tokens: list[str]):
    filtered = [t for t in tokens if t not in STOPWORDS]
    removed = [t for t in tokens if t in STOPWORDS]
    return {"filtered": filtered, "removed": removed}

@app.get("/health")
def health():
    import pythainlp
    return {"status": "ok", "pythainlp_version": pythainlp.__version__}
```

### Docker Compose Addition

```yaml
# docker-compose.yml (เพิ่ม)
thai-nlp:
  build: ./thai-nlp-sidecar
  restart: unless-stopped
  ports:
    - "47780:8000"
  environment:
    - PYTHAINLP_DATA_DIR=/data/pythainlp
  volumes:
    - ./data/pythainlp:/data/pythainlp
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
    interval: 30s
    timeout: 5s
    retries: 3
  deploy:
    resources:
      limits:
        memory: 256M
```

---

## 📍 Integration Points (จุดที่ต้องแก้ code)

### จุดที่ 1: Oracle V2 — Search Query Preprocessing

**File:** `oracle-v2/src/server/handlers.ts` → `handleSearch()`  
**ปัจจุบัน:**
```typescript
const safeQuery = query.replace(/[?*+\-()^~"':]/g, ' ').replace(/\s+/g, ' ').trim();
```

**เปลี่ยนเป็น:**
```typescript
// Step 1: Normalize + spell check via sidecar
const { normalized } = await thaiNlp.normalize(query);
const { corrected } = await thaiNlp.spellcheck(normalized);

// Step 2: Tokenize for FTS5
const { segmented } = await thaiNlp.tokenize(corrected);
const safeQuery = segmented.replace(/[?*+\-()^~"':]/g, ' ').trim();
```

**ผลลัพธ์:**
- Query `"อยากกินขาวผัดกุง"` → normalize → spell correct `"อยากกินข้าวผัดกุ้ง"` → tokenize `"อยาก กิน ข้าวผัด กุ้ง"` → FTS5 match ได้

### จุดที่ 2: Oracle V2 — Indexing Pipeline

**File:** `oracle-v2/src/server/handlers.ts` → `handleLearn()` + indexing scripts  
**ปัจจุบัน:** Insert raw text ลง FTS5

**เปลี่ยนเป็น:**
```typescript
// Before inserting to FTS5, segment Thai text
const { segmented } = await thaiNlp.tokenize(content);
const { normalized } = await thaiNlp.normalize(segmented);

// Insert segmented text to FTS5 (so MATCH works with Thai)
sqlite.prepare('INSERT INTO oracle_fts (id, content) VALUES (?, ?)').run(id, normalized);
```

**Critical:** ทั้ง index time + query time ต้องใช้ tokenizer เดียวกัน (`newmm`) ไม่งั้น FTS5 MATCH จะไม่ตรงกัน

### จุดที่ 3: Oracle V2 — Document Chunking (ใหม่)

**เพิ่ม chunking pipeline:**
```typescript
// oracle-v2/src/indexer/chunker.ts (ไฟล์ใหม่)
async function chunkDocument(content: string): Promise<string[]> {
  const { chunks } = await thaiNlp.chunk(content, {
    max_tokens: 400,
    overlap: 80
  });
  return chunks;
}
```

**ใช้ที่:** indexing pipeline (re-index command + real-time learn)

### จุดที่ 4: NanoClaw — Query Router Enhancement (Optional)

**File:** `nanoclaw/src/query-router.ts`  
**ปัจจุบัน:** Regex-based pattern matching — ทำงานได้ดีอยู่แล้ว  
**ไม่ต้องเปลี่ยน** — query router ไม่ต้องเข้าถึง PyThaiNLP เพราะ regex patterns ตอนนี้ match Thai+English ได้พอ

> ถ้าอนาคตต้องการ intent classification ที่ซับซ้อนขึ้น → ค่อยพิจารณา

### จุดที่ 5: NanoClaw — Prompt Builder (Optional)

**File:** `nanoclaw/src/prompt-builder.ts`  
**ก็ไม่ต้องเปลี่ยนเช่นกัน** — prompt builder ส่ง query ไป Oracle V2 → Oracle ทำ preprocessing อยู่แล้ว

---

## ⚡ Graceful Degradation

PyThaiNLP sidecar down → Oracle V2 ต้องทำงานได้ต่อ:

```typescript
// oracle-v2/src/thai-nlp-client.ts

class ThaiNlpClient {
  private baseUrl: string;
  private timeout: number = 2000; // 2s timeout

  async tokenize(text: string): Promise<{ tokens: string[]; segmented: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/tokenize`, {
        method: 'POST',
        body: JSON.stringify({ text }),
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeout)
      });
      return await res.json();
    } catch {
      // Fallback: naive space-based splitting (current behavior)
      const tokens = text.split(/\s+/).filter(Boolean);
      return { tokens, segmented: tokens.join(' ') };
    }
  }

  async normalize(text: string): Promise<{ normalized: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/normalize`, { /* ... */ });
      return await res.json();
    } catch {
      return { normalized: text }; // passthrough
    }
  }

  async spellcheck(text: string): Promise<{ corrected: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/spellcheck`, { /* ... */ });
      return await res.json();
    } catch {
      return { corrected: text }; // passthrough
    }
  }
}
```

→ **Zero downtime** — ถ้า sidecar ไม่อยู่ก็กลับไปทำงานแบบเดิม

---

## 📏 Performance Estimates

| Operation | ปัจจุบัน | + PyThaiNLP | Overhead |
|-----------|---------|-------------|----------|
| Search query preprocessing | ~0ms | ~15-30ms | +15-30ms |
| Document indexing (per doc) | ~5ms | ~20-50ms | +15-45ms |
| Document chunking (per doc) | N/A | ~30-100ms | New |
| Memory (sidecar) | 0 | ~100-200MB | New |

**สรุป:** overhead ~15-50ms per search query — ยอมรับได้เพราะ Oracle search ปกติใช้ ~100-500ms อยู่แล้ว

---

## 🚀 Implementation Phases

### Phase A: Foundation (1-2 วัน)
1. สร้าง `thai-nlp-sidecar/` directory
2. เขียน FastAPI app + Dockerfile
3. เพิ่ม `docker-compose.yml`
4. สร้าง `ThaiNlpClient` class ใน Oracle V2
5. ทดสอบ health check + basic tokenization

### Phase B: Search Enhancement (1-2 วัน)
1. แก้ `handleSearch()` — เพิ่ม normalize + spellcheck + tokenize ก่อน FTS5 MATCH
2. แก้ indexing pipeline — segment Thai text ก่อน insert FTS5
3. **สร้าง re-indexing script** — re-index เอกสารเดิมทั้งหมดด้วย tokenizer ใหม่
4. ทดสอบ search quality เทียบ before/after

### Phase C: Chunking Upgrade (1-2 วัน)
1. เพิ่ม `/chunk` endpoint ใน sidecar
2. สร้าง `chunker.ts` ใน Oracle V2
3. แก้ indexing pipeline — chunk documents ก่อน index
4. Re-index ด้วย chunking ใหม่

### Phase D: Advanced Features (Optional, อนาคต)
1. Custom dictionary สำหรับ domain-specific terms (ชื่อ project, ศัพท์เฉพาะ)
2. Keyboard correction (`eng_to_thai`) สำหรับ mistyped queries
3. Query expansion ด้วย synonyms
4. Soundex-based fuzzy matching

---

## 🤔 สิ่งที่ PyThaiNLP ไม่ได้ช่วย (ต้องทำเอง)

| ต้องการ | ปัญหา | ทางออก |
|--------|--------|--------|
| Thai-optimized embeddings | PyThaiNLP ไม่มี embedding model | เปลี่ยน model → multilingual-e5-large (Phase 1) |
| Intent classification | PyThaiNLP classify ง่ายเกินไป | ใช้ LLM (query router ปัจจุบัน + อนาคต LLM-based) |
| Semantic search quality | Word tokenization ช่วยได้บางส่วน | ต้องเปลี่ยน embedding model ด้วย |
| Conversation summarization | ไม่ใช่ scope ของ PyThaiNLP | ใช้ LLM (มีอยู่แล้ว) |

---

## ✅ คำตัดสินใจ

| คำถาม | คำตอบ | เหตุผล |
|-------|-------|--------|
| ควรใช้ PyThaiNLP ไหม? | **ใช่ อย่างยิ่ง** | Thai-first AI ต้องมี Thai NLP — ไม่มีทางเลี่ยง |
| ใช้ที่ไหน? | **Oracle V2** (search + indexing) | จุดที่ text processing สำคัญที่สุด |
| NanoClaw ต้องแก้ไหม? | **ไม่** (ตอนนี้) | Query router + prompt builder ไม่ต้องเข้าถึง NLP ตรง |
| Deploy แบบไหน? | **Docker sidecar** | แยก Python process, graceful degradation |
| Engine ตัวไหน? | **newmm** (default) | Dictionary-based, thread-safe, best balance accuracy/speed |
| ทำเมื่อไหร่? | **Phase 0-1** | Foundation สำหรับทุก search improvement ที่จะตามมา |

---

## 📚 References

- [PyThaiNLP GitHub](https://github.com/PyThaiNLP/pythainlp) — v5.2.0
- [Tokenizer API](https://pythainlp.org/dev-docs/api/tokenize.html) — word, sentence, subword
- [Spell API](https://pythainlp.org/dev-docs/api/spell.html) — correct, spell, NorvigSpellChecker
- [Corpus API](https://pythainlp.org/dev-docs/api/corpus.html) — thai_stopwords, thai_words, thai_synonyms
- [Util API](https://pythainlp.org/dev-docs/api/util.html) — normalize, eng_to_thai, countthai
- [BEYOND_OPENCLAW.md](./BEYOND_OPENCLAW.md) — JellyCore master improvement plan
