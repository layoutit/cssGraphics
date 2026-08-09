# Gravity Well references

The preparation authority is the pinned XScreenSaver checkout described by
`source-lock.json`. Set `CSSGRAVITYWELL_SOURCE_ROOT` to that local checkout.
Preparation reads and verifies the primary C source and XML configuration; it
does not download source or assets.

The selected first-slice source profile keeps the native delay, star count,
resolution, and speed. It selects `grid-size = 16 / 7`, a supported native
option that makes each prepared 16-unit cell correspond to one displayed grid
interval. Native oracle captures must use this same profile.
