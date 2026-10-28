#!/bin/sh
set -eu
ssh -i /Users/emie/Downloads/SSH_EMIE_New.pem \
  -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -N -L 127.0.0.1:5181:127.0.0.1:5180 root@8.135.51.39
