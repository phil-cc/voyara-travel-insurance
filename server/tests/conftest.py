from datetime import UTC, date, datetime, timedelta

import pytest

from voyara.quotes import QuoteService

NOW = datetime(2026, 11, 6, 9, 0, tzinfo=UTC)
APRIL_START = date(2027, 4, 1)
APRIL_END = date(2027, 4, 21)  # 21 days inclusive


class FakeClock:
    def __init__(self, now: datetime = NOW):
        self.now = now

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kwargs) -> None:
        self.now += timedelta(**kwargs)


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def service(clock) -> QuoteService:
    return QuoteService(clock=clock)


def story1_inputs(**overrides) -> dict:
    inputs = {
        "destination_region": "asia",
        "start_date": APRIL_START,
        "end_date": APRIL_END,
        "traveller_ages": [27],
        "tier": "explorer",
        "packs": ["adventure"],
    }
    inputs.update(overrides)
    return inputs
