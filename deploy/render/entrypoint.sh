#!/bin/sh
set -eu
mkdir -p /data/state /data/auth
chown node:node /data /data/state /data/auth
exec gosu node node /app/deploy/render/start.mjs
