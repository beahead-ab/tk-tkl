# TrainMeet HTTP timetable reference

`trainmeet-timetable-v3.json` was generated from TrainMeet Server commit `63f3fd1` on 24 September 2026 by calling:

```python
RuntimePublication.parse(runtime_package_v3()).timetable(active_day="Lör", station_id="station-a")
```

`RuntimePublication` is in `src/tmbox_gateway/runtime.py`; `runtime_package_v3` is in `tests/runtime_fixture.py`. It is the server’s synthetic test data, not a captured live timetable. The response uses runtime schema 3 independently of HTTP protocol version 1. Unknown top-level fields remain in the fixture to verify that only the intended display subset is projected into TKL.
