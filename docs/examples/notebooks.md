# Notebooks

Jupyter notebooks open in leaf as documents: markdown cells read like markdown, code cells are highlighted with their `[count]`, and each output shows in its richest saved form (an image, a table, markdown, text, or an error). **Hide code** turns a notebook into a report, and the arrow beside any output folds it away. There's no kernel: what shows is what the notebook saved.

Open [sales.ipynb](./notebooks/sales.ipynb) to see a whole notebook.

## A notebook inside a document

A ` ```ipynb ` block can name a notebook file next to the document:

```ipynb
from: ./notebooks/sales.ipynb
```

Or hold a small notebook's JSON itself:

<!-- prettier-ignore -->
```ipynb
{
  "nbformat": 4, "nbformat_minor": 5,
  "metadata": { "kernelspec": { "language": "python", "name": "python3" } },
  "cells": [
    { "cell_type": "code", "execution_count": 1, "metadata": {},
      "source": "squares = [n * n for n in range(6)]\nprint(squares)",
      "outputs": [ { "output_type": "stream", "name": "stdout", "text": "[0, 1, 4, 9, 16, 25]\n" } ] }
  ]
}
```
