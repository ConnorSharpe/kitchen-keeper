#!/usr/bin/env bash
exec node "${BASH_SOURCE%.sh}.mjs" "$@"
