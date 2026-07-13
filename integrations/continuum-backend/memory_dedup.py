"""
Punctuation-agnostic memory deduplication (matches mobile src/utils/memoryDedup.js).

Used by memory consolidation cron and deep_clean_memories.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Callable, Iterable, Sequence, TypeVar

T = TypeVar("T")

_NON_ALNUM = re.compile(r"[^a-z0-9\s]")
_MULTI_SPACE = re.compile(r"\s+")


def normalize_memory_content(text: str) -> str:
    lowered = str(text or "").lower()
    stripped = _NON_ALNUM.sub(" ", lowered)
    return _MULTI_SPACE.sub(" ", stripped).strip()


def memory_content_fingerprint(text: str, max_len: int = 160) -> str:
    normalized = normalize_memory_content(text)
    return normalized[:max_len] if normalized else ""


def _row_timestamp(row: dict) -> str:
    return str(row.get("created_at") or row.get("timestamp") or "")


def sort_rows_newest_first(rows: Sequence[dict]) -> list[dict]:
    return sorted(rows, key=_row_timestamp, reverse=True)


def find_duplicate_groups(
    rows: Iterable[dict],
    content_getter: Callable[[dict], str],
) -> list[list[dict]]:
    buckets: dict[str, list[dict]] = {}
    for row in rows:
        fp = memory_content_fingerprint(content_getter(row))
        if not fp:
            continue
        buckets.setdefault(fp, []).append(row)
    return [group for group in buckets.values() if len(group) > 1]


def pick_duplicate_removals(
    group: Sequence[dict],
    *,
    keep_newest: bool = True,
) -> list[dict]:
    ordered = sort_rows_newest_first(list(group))
    if len(ordered) <= 1:
        return []
    return ordered[1:] if keep_newest else ordered[:-1]


def layer_content_getter(layer: str) -> Callable[[dict], str]:
    if layer == "l4":
        return lambda row: str(row.get("event_description") or row.get("content") or "")
    if layer == "l5":
        source = lambda row: str(row.get("source") or "").strip()
        content = lambda row: str(row.get("content") or "").strip()
        return lambda row: f"{source(row)}: {content(row)}".strip(": ")
    return lambda row: str(row.get("content") or row.get("text") or "")


def shannon_entropy_bits(text: str) -> float:
    """Rough character-distribution entropy in bits (PRD noise filter)."""
    cleaned = str(text or "").strip()
    if not cleaned:
        return 0.0
    counts: dict[str, int] = {}
    for ch in cleaned.lower():
        counts[ch] = counts.get(ch, 0) + 1
    total = len(cleaned)
    import math

    entropy = 0.0
    for count in counts.values():
        p = count / total
        entropy -= p * math.log2(p)
    return entropy


NOISE_FILLER = re.compile(
    r"^(hi|hello|hey|test|thanks|thank you|ok|okay|yes|no|anyone there)[\s!.?]*$",
    re.I,
)


def is_conversational_noise(text: str) -> bool:
    cleaned = str(text or "").strip()
    if len(cleaned) < 15 and NOISE_FILLER.match(cleaned):
        return True
    if len(cleaned) < 15 and shannon_entropy_bits(cleaned) < 2.5:
        return True
    if shannon_entropy_bits(cleaned) < 2.5 and len(cleaned) < 40:
        return True
    return False


def ebbinghaus_retention(
    *,
    created_at: datetime | None,
    mention_count: int = 1,
    importance_score: float = 5.0,
    now: datetime | None = None,
) -> float:
    """
    R = e^{-t/S}; S = mentions * importance * base_delay (Engineering_Design §3.4).
    Returns retention probability in [0, 1].
    """
    import math

    if created_at is None:
        return 1.0
    ref = now or datetime.utcnow()
    if created_at.tzinfo:
        ref = ref.replace(tzinfo=created_at.tzinfo)
    age_days = max(0.0, (ref - created_at).total_seconds() / 86400.0)
    stability = max(1.0, float(mention_count) * max(1.0, importance_score) * 7.0)
    return math.exp(-age_days / stability)
