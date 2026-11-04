#!/usr/bin/env python3
"""Pushne seznam proxy serverů do script.js, appsettings.json a router.php najednou.

Volá se ze scripts/change-proxy-servers.sh, není potřeba spouštět ručně.
Použití: apply_proxy_servers.py <script.js> <appsettings.json> <router.php> <url1> [url2 ...]
"""
import json
import sys

BEGIN = "PROXY-SERVERS:BEGIN"
END = "PROXY-SERVERS:END"


def update_marker_block(path, servers, quote):
    with open(path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    begin_i = next((i for i, l in enumerate(lines) if BEGIN in l), None)
    end_i = next((i for i, l in enumerate(lines) if END in l), None)
    if begin_i is None or end_i is None or end_i <= begin_i:
        raise SystemExit(f"❌ {path}: nenašel jsem markery {BEGIN}/{END}, needituj je ručně.")

    indent = lines[begin_i][: len(lines[begin_i]) - len(lines[begin_i].lstrip())]
    new_entries = [f"{indent}{quote}{url}{quote},\n" for url in servers]

    updated = lines[: begin_i + 1] + new_entries + lines[end_i:]
    with open(path, "w", encoding="utf-8") as f:
        f.writelines(updated)


def update_json(path, servers):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    data.setdefault("Prehraj", {})["ProxyUrls"] = servers
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def main():
    if len(sys.argv) < 5:
        raise SystemExit(__doc__)
    js_path, json_path, php_path, *servers = sys.argv[1:]

    update_marker_block(js_path, servers, quote="'")
    update_marker_block(php_path, servers, quote="'")
    update_json(json_path, servers)

    print(f"✅ Promítnuto do {js_path}, {json_path} a {php_path}.")


if __name__ == "__main__":
    main()
