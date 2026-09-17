# Lessons

Patterns from corrections. Review at session start.

## 17 Sep 2026: "every line gets X" includes the first line, visibly, before typing

The note composer stamped the first line only once text arrived, so an empty box looked unstamped and Peter pressed Enter to get the first stamp. When a feature promises something on every line, the first line must show it the moment the box is ready (on focus), not only after an input event. Judge the feature by what the user sees on opening it, not only by the event path a test drives.

## 17 Sep 2026: an id that "is" a Microsoft item id may still not be the id a link wants

The follow-ups tracker stores the Microsoft 365 connector's message id, which is Graph's URL-safe form ("_" for "+", "-" for "/"). Outlook's web link needs the standard form, URL-encoded. Building the link from the stored id as it was would have produced a link that opens nothing. Before building a link from a stored identifier, compare it with the real link the service itself returns for the same item.

