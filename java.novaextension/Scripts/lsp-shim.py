#!/usr/bin/env python3
"""
A thin stdio proxy between Nova and the Eclipse JDT language server.

Why this exists
---------------
Nova advertises `textDocument.<feature>.dynamicRegistration = true` for hover,
completion, definition, declaration, typeDefinition, implementation,
documentHighlight, signatureHelp and codeAction.

JDT.LS takes that at its word: when a feature is dynamically registerable it
*omits* the corresponding capability from the `initialize` response
(`hoverProvider` comes back null) and announces it later with
`client/registerCapability` instead.

Nova replies "ok" to every one of those registrations and then never acts on
them, so it never sends `textDocument/hover` — or completion, or definition.
The features that keep working (references, formatting, rename) are precisely
the ones JDT.LS still declares statically.

Clearing the `dynamicRegistration` flags in the `initialize` request makes
JDT.LS declare everything statically, which Nova does honour.

Everything else is forwarded byte for byte. Only the first message is parsed;
after that this is a plain pipe, so there is no framing logic left to get
wrong mid-session.

Usage:
    lsp-shim.py [--log DIR] -- <server command> [args...]
"""

import json
import os
import signal
import subprocess
import sys
import threading

CHUNK = 65536


def parse_args(argv):
    log_dir = None
    rest = list(argv)
    if rest and rest[0] == "--log":
        log_dir = rest[1]
        rest = rest[2:]
    if rest and rest[0] == "--":
        rest = rest[1:]
    return log_dir, rest


def open_log(log_dir, name):
    if not log_dir:
        return None
    try:
        os.makedirs(log_dir, exist_ok=True)
        # Unbuffered append: the log must survive a hard kill of this process.
        return open(os.path.join(log_dir, name), "ab", buffering=0)
    except OSError:
        return None


def read_exact(fd, count):
    """Read exactly `count` bytes, or fewer on EOF. Never over-reads."""
    out = b""
    while len(out) < count:
        piece = os.read(fd, count - len(out))
        if not piece:
            break
        out += piece
    return out


def write_all(fd, data):
    """os.write may write only part of a large buffer; keep going."""
    view = memoryview(data)
    while view:
        written = os.write(fd, view)
        if written <= 0:
            break
        view = view[written:]


def read_frame(fd):
    """Read one LSP message. Returns (header_bytes, body_bytes) or (None, None).

    Headers are read a byte at a time and the body by exact length, so this
    never consumes bytes belonging to the next message — the raw pump takes
    over from precisely where this stops.
    """
    header = b""
    while b"\r\n\r\n" not in header:
        byte = os.read(fd, 1)
        if not byte:
            return None, None
        header += byte

    length = 0
    for line in header.split(b"\r\n"):
        if line[:15].lower() == b"content-length:":
            try:
                length = int(line[15:].strip())
            except ValueError:
                length = 0

    return header, read_exact(fd, length)


def strip_dynamic_registration(message):
    """Clear textDocument.*.dynamicRegistration in an `initialize` request."""
    try:
        params = message.get("params") or {}
        text_document = (params.get("capabilities") or {}).get("textDocument")
        if not isinstance(text_document, dict):
            return False
        changed = False
        for value in text_document.values():
            if isinstance(value, dict) and value.get("dynamicRegistration"):
                value["dynamicRegistration"] = False
                changed = True
        return changed
    except AttributeError:
        return False


def frame(body):
    return b"Content-Length: " + str(len(body)).encode("ascii") + b"\r\n\r\n" + body


def pump(source_fd, sink_fd, log):
    """Shovel bytes until EOF.

    Raw `os.read` on purpose: a BufferedReader's `read(n)` blocks until it has
    all n bytes, which for a request/response protocol means the reply never
    gets through until the pipe happens to fill.
    """
    try:
        while True:
            data = os.read(source_fd, CHUNK)
            if not data:
                break
            write_all(sink_fd, data)
            if log:
                log.write(data)
    except (OSError, ValueError):
        pass


def main():
    log_dir, command = parse_args(sys.argv[1:])
    if not command:
        sys.stderr.write("lsp-shim: no server command given\n")
        return 2

    to_server_log = open_log(log_dir, "lsp-client-to-server.log")
    from_server_log = open_log(log_dir, "lsp-server-to-client.log")

    child = subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=None,  # inherit, so server errors still reach Nova's console
    )
    child_stdin = child.stdin
    child_stdout = child.stdout
    assert child_stdin is not None and child_stdout is not None

    def shutdown(*_):
        # Nova kills this proxy, not the JVM behind it. Take the child with us
        # so a dead client can never leave the server holding its workspace
        # lock. See reapOrphanedServers in lspClient.ts for the other half.
        if child.poll() is None:
            try:
                child.terminate()
            except OSError:
                pass
        try:
            child.wait(timeout=5)
        except Exception:
            try:
                child.kill()
            except OSError:
                pass

    signal.signal(signal.SIGTERM, lambda *_a: (shutdown(), os._exit(0)))
    signal.signal(signal.SIGINT, lambda *_a: (shutdown(), os._exit(0)))

    stdin_fd = sys.stdin.fileno()
    stdout_fd = sys.stdout.fileno()
    child_in_fd = child_stdin.fileno()
    child_out_fd = child_stdout.fileno()

    reader = threading.Thread(
        target=pump,
        args=(child_out_fd, stdout_fd, from_server_log),
        daemon=True,
    )
    reader.start()

    header, body = read_frame(stdin_fd)
    if header is not None and body is not None:
        try:
            message = json.loads(body.decode("utf-8"))
        except ValueError:
            message = None

        if isinstance(message, dict) and message.get("method") == "initialize":
            if strip_dynamic_registration(message):
                sys.stderr.write(
                    "lsp-shim: cleared textDocument dynamicRegistration so the "
                    "server declares its capabilities statically\n"
                )
                body = json.dumps(message).encode("utf-8")
            header = b""  # rebuilt below with the correct length

        out = frame(body) if header == b"" else header + body
        write_all(child_in_fd, out)
        if to_server_log:
            to_server_log.write(out)

        # Past initialize: a plain pipe, no parsing.
        pump(stdin_fd, child_in_fd, to_server_log)

    shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
