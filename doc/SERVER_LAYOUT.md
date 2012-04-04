# AWSBOX Server Layout

awsbox consists of a pile of scripts and a "Template VM Image".  When you
create a VM, that template image is uses to build a running machine.
This document describes how the server is laid out and configured.

## The 'app' user

The 'app' os user is who your application is run as, who you deploy code as
(via `git push`).  When you ssh into your VM as the app user, you'll notice
many files in the home directory:

  * `500/` - static files served when your server is down
  * `git/` - a git repository ready for your push.
  * `var/` - where logs are stored
  * `ver.txt` - the currently running version of software in the git repository
  * `config.json` - The app's configuration, including the public_url for the
    server.  (available in the PUBLIC_URL env var when your server is run.)
  * `code` - populated at git push time - the files from the HEAD of the master
    branch that you've last pushed.  This is where your code will be run from
  * `code.old` - populated the second time you push - the previously running version
    of code.

## The 'ec2-user' user

You can use the 'ec2-user' as your "root" account, and log in with it to
install software or change the vm's configuration.

Your ssh key will be installed on the created VM, and you'll have full
sudo access to the machine when you log in as "ec2-user".  If you ssh
into your VM as `ec2-user`, the one thing you'll notice in that user's
home directory is a script named `pristinify.sh`.  This script will
attempt to return the VM to a "pristine" state and is useful when
creating custom template images.

## Installed/Running software

Write me.
