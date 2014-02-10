#!/bin/sh

# execute this on a new AWS images to allow ssh access via the root user

sudo sed -i s/^#PermitRoot/PermitRoot/ /etc/ssh/sshd_config
sudo /etc/init.d/sshd restart
sudo sed -i s/^.*ssh-rsa/ssh-rsa/ /root/.ssh/authorized_keys
