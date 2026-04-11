"""
테스트에서 쓰는 임시 파일·픽스처는 저장소 루트의 temp/ 아래에 둡니다.
"""

from __future__ import annotations

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
TEST_TEMP_ROOT = REPO_ROOT / "temp"


@pytest.fixture
def test_temp_dir() -> Path:
    """테스트 전용 출력·캐시 경로 (항상 존재하도록 생성)."""
    TEST_TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    return TEST_TEMP_ROOT
