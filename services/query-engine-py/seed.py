from pathlib import Path
import sys


def _prepend_local_src() -> None:
    root = Path(__file__).resolve().parent
    src = root / "src"
    src_str = str(src)
    if sys.path[:1] != [src_str]:
        sys.path.insert(0, src_str)


def main() -> None:
    _prepend_local_src()

    from rag.seed import main as seed_main

    seed_main()


if __name__ == "__main__":
    main()