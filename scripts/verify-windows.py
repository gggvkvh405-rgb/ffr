#!/usr/bin/env python3
"""Static checks for dist-win/ByAzen.exe.

Everything here can be verified without Windows: PE architecture, GUI subsystem,
embedded resources (the whole UI lives in RCDATA) and the imported DLL list.
"""

from __future__ import annotations

import hashlib
import struct
import sys
from pathlib import Path

RT_NAMES = {1: "CURSOR", 2: "BITMAP", 3: "ICON", 4: "MENU", 5: "DIALOG", 6: "STRING",
            9: "ACCELERATOR", 10: "RCDATA", 12: "GROUP_CURSOR", 14: "GROUP_ICON",
            16: "VERSION", 24: "MANIFEST"}

failures: list[str] = []


def check(condition: bool, message: str) -> None:
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        failures.append(message)


class Pe:
    def __init__(self, path: Path) -> None:
        self.data = path.read_bytes()
        self.size = len(self.data)
        if self.data[:2] != b"MZ":
            raise SystemExit("not an MZ file")
        self.pe = struct.unpack_from("<I", self.data, 0x3C)[0]
        if self.data[self.pe:self.pe + 4] != b"PE\0\0":
            raise SystemExit("no PE signature")
        self.machine, self.count, _, _, _, self.opt_size, _ = struct.unpack_from(
            "<HHIIIHH", self.data, self.pe + 4)
        self.opt = self.pe + 24
        self.magic = struct.unpack_from("<H", self.data, self.opt)[0]
        self.subsystem = struct.unpack_from("<H", self.data, self.opt + 68)[0]
        self.entry = struct.unpack_from("<I", self.data, self.opt + 16)[0]
        self.dirs_at = self.opt + (112 if self.magic == 0x20B else 96)
        self.sections = []
        base = self.opt + self.opt_size
        for index in range(self.count):
            off = base + index * 40
            name = self.data[off:off + 8].rstrip(b"\0").decode("latin-1")
            vsize, vaddr, rawsize, rawptr = struct.unpack_from("<IIII", self.data, off + 8)
            self.sections.append((name, vaddr, vsize, rawptr, rawsize))

    def directory(self, index: int) -> tuple[int, int]:
        return struct.unpack_from("<II", self.data, self.dirs_at + index * 8)

    def offset(self, rva: int) -> int | None:
        for _, vaddr, vsize, rawptr, rawsize in self.sections:
            if vaddr <= rva < vaddr + max(vsize, rawsize):
                return rawptr + (rva - vaddr)
        return None

    def cstring(self, rva: int) -> str:
        off = self.offset(rva)
        if off is None:
            return "?"
        end = self.data.index(b"\0", off)
        return self.data[off:end].decode("latin-1")

    def imports(self) -> list[str]:
        rva, _ = self.directory(1)
        if not rva:
            return []
        off = self.offset(rva)
        assert off is not None
        names = []
        while True:
            entry = self.data[off:off + 20]
            if len(entry) < 20 or entry == b"\0" * 20:
                break
            names.append(self.cstring(struct.unpack_from("<I", entry, 12)[0]))
            off += 20
        return names

    def resources(self) -> dict[tuple[int, int], bytes]:
        """Returns {(type_id, name_id): payload} for leaf entries."""
        rva, size = self.directory(2)
        if not rva or not size:
            return {}
        base = self.offset(rva)
        assert base is not None

        def walk(offset: int, depth: int, path: tuple[int, ...]):
            named, ids = struct.unpack_from("<HH", self.data, base + offset + 12)
            for index in range(named + ids):
                ent = base + offset + 16 + index * 8
                name_field, target = struct.unpack_from("<II", self.data, ent)
                ident = name_field & 0x7FFFFFFF if name_field & 0x80000000 else name_field
                if target & 0x80000000:
                    yield from walk(target & 0x7FFFFFFF, depth + 1, path + (ident,))
                else:
                    data_rva, data_size = struct.unpack_from("<II", self.data, base + target)
                    payload_at = self.offset(data_rva)
                    assert payload_at is not None
                    yield path + (ident,), self.data[payload_at:payload_at + data_size]

        return {key: value for key, value in walk(0, 0, ())}


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    exe_path = root / "dist-win" / "ByAzen.exe"
    html_path = root / "dist-desktop" / "index.html"
    if not exe_path.exists():
        raise SystemExit(f"missing {exe_path}")

    exe = Pe(exe_path)
    print(f"file: {exe_path} ({exe.size / 1048576:.2f} MiB)")

    print("headers")
    check(exe.machine == 0x8664, "architecture is x86-64")
    check(exe.magic == 0x20B, "PE32+ (64-bit)")
    check(exe.subsystem == 2, "subsystem is WINDOWS_GUI (no console window)")
    check(exe.entry != 0, f"entry point present (0x{exe.entry:x})")
    check(any(name == ".rsrc" for name, *_ in exe.sections), ".rsrc section present")

    resources = exe.resources()
    grouped: dict[int, list[int]] = {}
    for key in resources:
        rtype, name = key[0], key[1]
        grouped.setdefault(rtype, []).append(name)

    print("resources")
    for rtype, names in sorted(grouped.items()):
        print(f"  {RT_NAMES.get(rtype, str(rtype)):11} ids={sorted(names)}")
    check(101 in grouped.get(10, []), "RCDATA 101 (the app) is embedded")
    check(102 in grouped.get(10, []), "RCDATA 102 (favicon) is embedded")
    check(1 in grouped.get(3, []), "icon images embedded")
    check(1 in grouped.get(14, []), "icon group embedded")
    check(1 in grouped.get(24, []), "application manifest embedded")
    check(1 in grouped.get(16, []), "version information embedded")

    payload = next((value for key, value in resources.items() if key[:2] == (10, 101)), b"")
    expected = html_path.read_bytes() if html_path.exists() else b""
    if expected:
        check(payload == expected,
              f"RCDATA 101 byte-identical to the built UI ({len(payload)} bytes, "
              f"sha256 {hashlib.sha256(payload).hexdigest()[:12]})")

    print("imports")
    dlls = sorted(set(exe.imports()), key=str.lower)
    for dll in dlls:
        print(f"  {dll}")
    check(not any(dll.lower().startswith("webview2loader") for dll in dlls),
          "no link-time dependency on WebView2Loader.dll")
    standard = {"kernel32.dll", "user32.dll", "gdi32.dll", "shell32.dll", "ole32.dll",
                "advapi32.dll", "ws2_32.dll", "msvcrt.dll", "ucrtbase.dll",
                "api-ms-win-crt-runtime-l1-1-0.dll", "api-ms-win-crt-stdio-l1-1-0.dll",
                "api-ms-win-crt-string-l1-1-0.dll", "api-ms-win-crt-heap-l1-1-0.dll",
                "api-ms-win-crt-locale-l1-1-0.dll", "api-ms-win-crt-math-l1-1-0.dll",
                "api-ms-win-crt-convert-l1-1-0.dll", "api-ms-win-crt-environment-l1-1-0.dll",
                "api-ms-win-crt-filesystem-l1-1-0.dll", "api-ms-win-crt-time-l1-1-0.dll",
                "api-ms-win-crt-utility-l1-1-0.dll", "api-ms-win-crt-private-l1-1-0.dll"}
    unexpected = [dll for dll in dlls if dll.lower() not in standard]
    check(not unexpected, "imports are Windows system DLLs only"
          + (f" (unexpected: {unexpected})" if unexpected else ""))

    print()
    if failures:
        print(f"{len(failures)} check(s) failed")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
