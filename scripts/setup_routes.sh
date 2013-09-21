#!/usr/bin/env bash

# iptables commands to route port 80 to 8080, and 443 to 8443 so that
# reverse proxying can occur completly in user space.
#
# NOTE: this is only run once, then the settings persist in the AMI,
# script is stored here for documentation purposes.

sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 8080
sudo iptables -t nat -A PREROUTING -p tcp --dport 443 -j REDIRECT --to-port 8443
