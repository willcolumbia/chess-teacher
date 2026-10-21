import argparse

from .web import app


def main() -> None:
    parser = argparse.ArgumentParser(description="Chess Teacher local web app")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    args = parser.parse_args()
    print(f"Chess Teacher running at http://{args.host}:{args.port}")
    app.run(host=args.host, port=args.port)


if __name__ == "__main__":
    main()
