#!/usr/bin/env bash

openssl genrsa -out key.pem 2048
openssl req -new -config request.cnf -x509 -key key.pem -out cert.pem -days 1095

