#!/usr/bin/env bash

cd /home/proxy
openssl genrsa -out key.pem 2048
openssl req -new -config request.cnf -x509 -key key.pem -out cert.pem -days 1095

