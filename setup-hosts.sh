#!/bin/bash

# Script to add clearing.local to /etc/hosts
# Run with sudo: sudo ./setup-hosts.sh

HOSTS_ENTRY="127.0.0.1 clearing.local"

if grep -q "clearing.local" /etc/hosts; then
    echo "clearing.local already exists in /etc/hosts"
else
    echo "$HOSTS_ENTRY" >> /etc/hosts
    echo "Added clearing.local to /etc/hosts"
fi

echo "Current hosts entry:"
grep "clearing.local" /etc/hosts



