"""fetch_distinct_cycle_numbers: 페이지네이션 시 모든 사이클 번호가 수집되는지 검증."""
from unittest.mock import patch

import pytest

from app.services import cycle_data


class _FakeResp:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    """PostgREST 체인 모사. 정렬된 전체 행에서 range만큼 잘라 반환."""

    def __init__(self, rows: list):
        self._rows = sorted(
            rows, key=lambda r: (r["days_since_peak"], r["cycle_number"])
        )
        self._start = 0
        self._end = -1

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def order(self, *_args, **_kwargs):
        return self

    def range(self, start: int, end: int):
        self._start = start
        self._end = end
        return self

    def execute(self):
        chunk = self._rows[self._start : self._end + 1]
        return _FakeResp(chunk)


class _FakeTable:
    def __init__(self, rows: list):
        self._rows = rows

    def select(self, *args, **kwargs):
        return _FakeQuery(self._rows)


class _FakeClient:
    def __init__(self, rows: list):
        self._rows = rows

    def table(self, _name):
        return _FakeTable(self._rows)

    def rpc(self, _name, _params):
        class _FakeRpcQuery:
            def execute(self_inner):
                return _FakeResp(None)

        return _FakeRpcQuery()


class _FakeClientWithPartialRpc(_FakeClient):
    def rpc(self, _name, _params):
        class _FakeRpcQuery:
            def execute(self_inner):
                return _FakeResp([{"cycle_number": 1}, {"cycle_number": 2}])

        return _FakeRpcQuery()


def _rows_cycles_1_4_many_days_cycle5_late():
    """cycle 5는 days_since_peak가 커서 정렬상 2000행 이후에만 등장 (2페이지 검증용)."""
    rows = []
    for cn in range(1, 5):
        for day in range(1000):
            rows.append({"cycle_number": cn, "days_since_peak": day})
    for day in range(1000, 1100):
        rows.append({"cycle_number": 5, "days_since_peak": day})
    return rows


@patch.object(cycle_data, "get_supabase")
def test_distinct_collects_all_cycles_across_pages(mock_get):
    """배치 크기(2000)보다 총 행이 많을 때, 늦게 나오는 사이클까지 distinct에 포함된다."""
    rows = _rows_cycles_1_4_many_days_cycle5_late()
    mock_get.return_value = _FakeClient(rows)

    out = cycle_data.fetch_distinct_cycle_numbers()
    assert out == [1, 2, 3, 4, 5]


@patch.object(cycle_data, "get_supabase")
def test_distinct_empty_table(mock_get):
    mock_get.return_value = _FakeClient([])
    assert cycle_data.fetch_distinct_cycle_numbers() == []


@patch.object(cycle_data, "get_supabase")
def test_distinct_merges_partial_rpc_with_paginated_result(mock_get):
    rows = _rows_cycles_1_4_many_days_cycle5_late()
    mock_get.return_value = _FakeClientWithPartialRpc(rows)

    out = cycle_data.fetch_distinct_cycle_numbers()
    assert out == [1, 2, 3, 4, 5]
