# Charts

A ` ```chart ` block is a [Chart.js](https://www.chartjs.org/docs/latest/) config written as YAML (JSON works too): a `type`, its `data`, and any `options`. It's data, not code, so it draws right in the page. Datasets without colors get leaf's, and the text and grid follow light and dark.

Edit a number below and save: the chart moves to it instead of starting over.

## Inline data

```chart
type: bar
data:
  labels: [Mon, Tue, Wed, Thu, Fri]
  datasets:
    - label: Deploys
      data: [4, 7, 3, 9, 6]
    - label: Rollbacks
      data: [0, 1, 0, 2, 0]
```

## From a file next to the document

Point `data.from` at a CSV, a JSON array, or a JSON Lines file. `x` names the column along the bottom; each `y` column becomes a line. Change [data/sales.csv](./data/sales.csv) and the chart redraws.

```chart height=360
type: line
data:
  from: ./data/sales.csv
  x: month
  y: [revenue, cost]
options:
  elements:
    line:
      tension: 0.3
```

## The other kinds

```chart height=300
type: doughnut
data:
  labels: [Search, Direct, Social, Email, Referral]
  datasets:
    - data: [44, 26, 14, 9, 7]
options:
  plugins:
    legend:
      position: right
```

```chart height=320
type: radar
data:
  labels: [Speed, Docs, Tests, Design, Support]
  datasets:
    - label: This year
      data: [8, 6, 9, 7, 5]
    - label: Last year
      data: [5, 4, 6, 6, 6]
```

```chart height=320
type: scatter
data:
  datasets:
    - label: Requests (size against time)
      data:
        - { x: 12, y: 80 }
        - { x: 30, y: 140 }
        - { x: 45, y: 120 }
        - { x: 64, y: 210 }
        - { x: 80, y: 260 }
        - { x: 96, y: 230 }
```

## Chart files

A `.chart` file is the same YAML on its own, and opens filling the window: [revenue.chart](./charts/revenue.chart) reads the sales CSV, [mix.chart](./charts/mix.chart) carries its data inline.

## When a chart is wrong

It says what's wrong where the chart would be:

```chart
type: bar
data:
  from: ./data/sales.csv
  x: month
  y: [profit]
```
