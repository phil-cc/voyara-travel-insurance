"""Destination allow-list. Free-text destinations are only accepted if they match a known name here."""

DESTINATIONS: dict[str, str] = {
    # Pacific
    "fiji": "pacific", "new zealand": "pacific", "vanuatu": "pacific", "samoa": "pacific",
    "new caledonia": "pacific", "cook islands": "pacific", "tonga": "pacific", "south pacific cruise": "pacific",
    # Asia
    "bali": "asia", "indonesia": "asia", "japan": "asia", "nepal": "asia", "thailand": "asia",
    "vietnam": "asia", "singapore": "asia", "malaysia": "asia", "india": "asia", "china": "asia",
    "south korea": "asia", "philippines": "asia", "sri lanka": "asia", "cambodia": "asia",
    # Worldwide excluding the Americas
    "united kingdom": "worldwide_excl_americas", "france": "worldwide_excl_americas",
    "italy": "worldwide_excl_americas", "greece": "worldwide_excl_americas", "spain": "worldwide_excl_americas",
    "germany": "worldwide_excl_americas", "south africa": "worldwide_excl_americas",
    "united arab emirates": "worldwide_excl_americas", "egypt": "worldwide_excl_americas",
    # Worldwide (includes the Americas)
    "united states": "worldwide", "canada": "worldwide", "mexico": "worldwide", "brazil": "worldwide",
    "peru": "worldwide", "argentina": "worldwide", "chile": "worldwide",
}


def resolve(destination: str) -> str | None:
    """Region for an allow-listed destination name, or None if it is not on the list."""
    return DESTINATIONS.get(destination.strip().lower())


def names() -> list[str]:
    return sorted(name.title() for name in DESTINATIONS)
