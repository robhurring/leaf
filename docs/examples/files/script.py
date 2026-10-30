"""A small Python file for the code viewer."""

from dataclasses import dataclass


@dataclass
class Leaf:
    name: str
    size: int

    def describe(self) -> str:
        return f"{self.name} ({self.size} bytes)"


if __name__ == "__main__":
    for leaf in [Leaf("README.md", 1024), Leaf("gfm.md", 2048)]:
        print(leaf.describe())
