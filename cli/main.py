"""Terminal face. No AI logic here: read a line, print the stream."""
from core.chat import Conversation


def main() -> None:
    convo = Conversation()
    print("Maham Code. Type 'exit' to quit, '/reset' to clear memory.\n")

    while True:
        try:
            user_text = input("you > ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if not user_text:
            continue
        if user_text.lower() in ("exit", "quit"):
            break
        if user_text == "/reset":
            convo.reset()
            print("(memory cleared)\n")
            continue

        print("bot > ", end="", flush=True)
        for chunk in convo.ask_stream(user_text):
            print(chunk, end="", flush=True)
        print("\n")


if __name__ == "__main__":
    main()
