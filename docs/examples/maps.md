# Maps

Maps draw over a built-in outline of the world, with no map tiles and no network, so they work offline and in the sandbox. Hover a point or a shape for its details. Open the zoomed view to zoom, pan, and draw on a map like a diagram.

## Logs on a map

A ` ```map ` block plots the rows of a file by latitude and longitude. Columns named `lat`/`latitude` and `lon`/`lng`/`long`/`longitude` are found on their own (or name them with `lat:` and `lon:`). `color:` picks a column to color by, with a legend.

This one reads [data/requests.jsonl](./data/requests.jsonl), a log of web requests, one JSON object per line, colored by status:

```map
from: ./data/requests.jsonl
color: status
```

Append a line to the log and the map gains a point.

## GeoJSON

A ` ```geojson ` fence (or a `.geojson` file) draws its points, lines, and shapes:

<!-- prettier-ignore -->
```geojson
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "name": "Ferry" },
      "geometry": { "type": "LineString", "coordinates": [[-122.42, 37.81], [-122.27, 37.8]] }
    },
    {
      "type": "Feature",
      "properties": { "name": "Office" },
      "geometry": { "type": "Point", "coordinates": [-122.4, 37.79] }
    }
  ]
}
```

A map closes in on its data; data spread across the world shows the whole world.

## Map files

- [offices.geojson](./maps/offices.geojson): offices, a train route, and a sales region.
- [datacenters.topojson](./maps/datacenters.topojson): TopoJSON works the same way.

A ` ```map ` block can also point at either: `from: ./maps/offices.geojson`, with `color:` naming a property.
