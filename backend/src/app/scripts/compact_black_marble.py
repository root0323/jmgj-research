"""Usage: python -m app.scripts.compact_black_marble SOURCE.h5 OUTPUT.h5"""
import argparse
import json
from pathlib import Path

from app.services.black_marble_storage import compact_black_marble


def main():
    parser = argparse.ArgumentParser(description="Create a lossless, native-resolution Black Marble app subset.")
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--report", type=Path, help="Write verification JSON to a new file.")
    args = parser.parse_args()
    if args.report and (args.report.exists() or args.report.resolve() in (args.source.resolve(), args.output.resolve())):
        parser.error("The report must use a new path, separate from both H5 files.")
    report = compact_black_marble(args.source, args.output)
    encoded = json.dumps(report, ensure_ascii=True, indent=2)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        with args.report.open("x", encoding="utf-8") as stream:
            stream.write(encoded + "\n")
    print(encoded)


if __name__ == "__main__":
    main()
