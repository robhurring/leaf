# Realtime

leaf redraws whatever changes on disk: the document, and the files its charts and maps read. To see it, start the demo in a terminal:

```sh
bin/demo-live
```

It writes made-up web traffic into `docs/examples/live/` twice a second until you stop it. With it running, everything below moves on its own. Nothing on this page polls or animates itself; each chart and map redraws because its file changed, just as it would for a real log, a metrics export, or an agent writing as it works.

## Requests per second

```chart height=280
type: line
data:
  from: ./live/requests.csv
  x: time
  y: [requests, errors]
options:
  animation:
    duration: 250
  elements:
    point:
      radius: 0
    line:
      tension: 0.3
```

## Latency

```chart height=220
type: bar
data:
  from: ./live/requests.csv
  x: time
  y: [p95]
options:
  animation:
    duration: 250
```

## Where the traffic comes from

The last few hundred requests, colored by status:

```map
from: ./live/traffic.jsonl
color: status
```

## A document that writes itself

[live/board.md](./live/board.md) is rewritten twice a second: open it and watch the table and the alert change.

Before the demo has run, these say they can't read their files. Start it and they fill in.
