"""
Thai NLP Sidecar — FastAPI service wrapping PyThaiNLP

Provides Thai text processing endpoints:
- /tokenize  — word segmentation (newmm engine)
- /normalize — Thai text normalization
- /spellcheck — spell correction
- /chunk     — sentence-aware document chunking
- /stopwords — stop word filtering
- /health    — health check

Designed for JellyCore Oracle V2 integration.
Graceful: if any PyThaiNLP function fails, returns input unchanged.
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
import time
import pythainlp

app = FastAPI(
    title="Thai NLP Sidecar",
    description="PyThaiNLP wrapper for JellyCore",
    version="0.1.0",
)

# ── Lazy-loaded modules (heavy imports deferred to first use) ──

_tokenize = None
_normalize_func = None
_correct_func = None
_sent_tokenize = None
_stopwords = None


def get_tokenize():
    global _tokenize
    if _tokenize is None:
        from pythainlp.tokenize import word_tokenize
        _tokenize = word_tokenize
    return _tokenize


def get_normalize():
    global _normalize_func
    if _normalize_func is None:
        from pythainlp.util import normalize
        _normalize_func = normalize
    return _normalize_func


def get_correct():
    global _correct_func
    if _correct_func is None:
        from pythainlp.spell import correct
        _correct_func = correct
    return _correct_func


def get_sent_tokenize():
    global _sent_tokenize
    if _sent_tokenize is None:
        from pythainlp.tokenize import sent_tokenize
        _sent_tokenize = sent_tokenize
    return _sent_tokenize


def get_stopwords():
    global _stopwords
    if _stopwords is None:
        from pythainlp.corpus import thai_stopwords
        _stopwords = thai_stopwords()
    return _stopwords


# ── Request / Response Models ──


class TextRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=100_000)


class TokenizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=100_000)
    engine: str = Field(default="newmm", description="Tokenizer engine: newmm, longest, icu")


class TokenizeResponse(BaseModel):
    tokens: list[str]
    segmented: str
    engine: str
    elapsed_ms: float


class NormalizeResponse(BaseModel):
    normalized: str
    changed: bool
    elapsed_ms: float


class SpellcheckResponse(BaseModel):
    corrected: str
    changed: bool
    elapsed_ms: float


class ChunkRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=500_000)
    max_tokens: int = Field(default=300, ge=50, le=2000)
    overlap: int = Field(default=50, ge=0, le=200)


class ChunkResponse(BaseModel):
    chunks: list[str]
    count: int
    elapsed_ms: float


class StopwordsRequest(BaseModel):
    tokens: list[str]


class StopwordsResponse(BaseModel):
    filtered: list[str]
    removed: list[str]
    elapsed_ms: float


class HealthResponse(BaseModel):
    status: str
    pythainlp_version: str
    uptime_seconds: float


# ── State ──

_start_time = time.time()


# ── Endpoints ──


@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check + version info."""
    return HealthResponse(
        status="ok",
        pythainlp_version=pythainlp.__version__,
        uptime_seconds=round(time.time() - _start_time, 1),
    )


@app.post("/tokenize", response_model=TokenizeResponse)
async def tokenize(req: TokenizeRequest):
    """
    Word segmentation using PyThaiNLP.
    Default engine: newmm (dictionary-based, TCC-constrained, thread-safe).
    Returns tokens list and space-separated segmented string for FTS5.
    """
    t0 = time.time()
    try:
        word_tokenize = get_tokenize()
        tokens = word_tokenize(req.text, engine=req.engine, keep_whitespace=False)
        # Filter out empty tokens
        tokens = [t for t in tokens if t.strip()]
        segmented = " ".join(tokens)
        elapsed = (time.time() - t0) * 1000
        return TokenizeResponse(
            tokens=tokens,
            segmented=segmented,
            engine=req.engine,
            elapsed_ms=round(elapsed, 2),
        )
    except Exception as e:
        # Graceful degradation: return original text split by whitespace
        elapsed = (time.time() - t0) * 1000
        fallback_tokens = req.text.split()
        return TokenizeResponse(
            tokens=fallback_tokens,
            segmented=req.text,
            engine="fallback",
            elapsed_ms=round(elapsed, 2),
        )


@app.post("/normalize", response_model=NormalizeResponse)
async def normalize(req: TextRequest):
    """
    Thai text normalization:
    - Remove zero-width characters
    - Fix duplicate spaces
    - Reorder misplaced vowels/tone marks
    """
    t0 = time.time()
    try:
        normalize_text = get_normalize()
        result = normalize_text(req.text)
        elapsed = (time.time() - t0) * 1000
        return NormalizeResponse(
            normalized=result,
            changed=(result != req.text),
            elapsed_ms=round(elapsed, 2),
        )
    except Exception:
        elapsed = (time.time() - t0) * 1000
        return NormalizeResponse(
            normalized=req.text,
            changed=False,
            elapsed_ms=round(elapsed, 2),
        )


@app.post("/spellcheck", response_model=SpellcheckResponse)
async def spellcheck(req: TextRequest):
    """
    Thai spell correction.
    Tokenizes text, corrects each token, returns corrected text.
    """
    t0 = time.time()
    try:
        word_tokenize = get_tokenize()
        correct = get_correct()
        tokens = word_tokenize(req.text, engine="newmm", keep_whitespace=True)
        corrected_tokens = []
        for token in tokens:
            stripped = token.strip()
            if stripped and any("\u0e01" <= c <= "\u0e4f" for c in stripped):
                # Only spell-check Thai tokens
                corrected_tokens.append(correct(stripped))
            else:
                corrected_tokens.append(token)
        result = "".join(corrected_tokens)
        elapsed = (time.time() - t0) * 1000
        return SpellcheckResponse(
            corrected=result,
            changed=(result != req.text),
            elapsed_ms=round(elapsed, 2),
        )
    except Exception:
        elapsed = (time.time() - t0) * 1000
        return SpellcheckResponse(
            corrected=req.text,
            changed=False,
            elapsed_ms=round(elapsed, 2),
        )


@app.post("/chunk", response_model=ChunkResponse)
async def chunk(req: ChunkRequest):
    """
    Sentence-aware document chunking for better embeddings.
    Splits by Thai sentence boundaries, then groups into chunks
    of approximately max_tokens words with overlap.
    """
    t0 = time.time()
    try:
        sent_tok = get_sent_tokenize()
        word_tok = get_tokenize()

        sentences = sent_tok(req.text)
        if not sentences:
            elapsed = (time.time() - t0) * 1000
            return ChunkResponse(chunks=[req.text], count=1, elapsed_ms=round(elapsed, 2))

        chunks: list[str] = []
        current_sentences: list[str] = []
        current_token_count = 0

        for sent in sentences:
            sent = sent.strip()
            if not sent:
                continue
            sent_tokens = word_tok(sent, engine="newmm", keep_whitespace=False)
            sent_token_count = len(sent_tokens)

            if current_token_count + sent_token_count > req.max_tokens and current_sentences:
                # Flush current chunk
                chunks.append(" ".join(current_sentences))

                # Overlap: keep last N tokens worth of sentences
                if req.overlap > 0:
                    overlap_sents: list[str] = []
                    overlap_count = 0
                    for s in reversed(current_sentences):
                        s_tc = len(word_tok(s, engine="newmm", keep_whitespace=False))
                        if overlap_count + s_tc > req.overlap:
                            break
                        overlap_sents.insert(0, s)
                        overlap_count += s_tc
                    current_sentences = overlap_sents
                    current_token_count = overlap_count
                else:
                    current_sentences = []
                    current_token_count = 0

            current_sentences.append(sent)
            current_token_count += sent_token_count

        # Flush remaining
        if current_sentences:
            chunks.append(" ".join(current_sentences))

        elapsed = (time.time() - t0) * 1000
        return ChunkResponse(
            chunks=chunks,
            count=len(chunks),
            elapsed_ms=round(elapsed, 2),
        )
    except Exception:
        elapsed = (time.time() - t0) * 1000
        return ChunkResponse(chunks=[req.text], count=1, elapsed_ms=round(elapsed, 2))


@app.post("/stopwords", response_model=StopwordsResponse)
async def filter_stopwords(req: StopwordsRequest):
    """
    Filter Thai stop words from a token list.
    """
    t0 = time.time()
    try:
        sw = get_stopwords()
        filtered = [t for t in req.tokens if t not in sw]
        removed = [t for t in req.tokens if t in sw]
        elapsed = (time.time() - t0) * 1000
        return StopwordsResponse(
            filtered=filtered,
            removed=removed,
            elapsed_ms=round(elapsed, 2),
        )
    except Exception:
        elapsed = (time.time() - t0) * 1000
        return StopwordsResponse(
            filtered=req.tokens,
            removed=[],
            elapsed_ms=round(elapsed, 2),
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
