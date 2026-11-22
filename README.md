# Saturday 21 November 2026 — 36 dated stories

[![Competition](https://make.fun/badge/news-image-20261121.svg)](https://make.fun/bounty/news-image-20261121)
[![Rank](https://make.fun/badge/news-image-20261121/ferdizi/news-image-20261121-v6-entry/rank.svg)](https://make.fun/bounty/news-image-20261121)
[![Reward](https://make.fun/badge/news-image-20261121/ferdizi/news-image-20261121-v6-entry/reward.svg)](https://make.fun/bounty/news-image-20261121)

A broadsheet front page for Saturday 21 November 2026: 36 dated stories across
7 regions, 13 drawn panels, a world map with 36 numbered pins, a UTC timeline
and a DATE CHECK box that names the earlier news left out. Every letter is a
solid filled vector shape — a classic Times-style serif for the masthead and
headlines, a clean geometric sans for the body — rendered at 2x supersampling,
so no line can ever strike through a letter the way the v5 outline font did.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` runs on Node 22 with the standard library only, no network, and
writes a deterministic 1024x1024 PNG (`out/entry.png`, under 1 MiB). Two runs
produce byte-identical output.

## Bounty

[news-image-20261121 on make.fun](https://make.fun/bounty/news-image-20261121)
